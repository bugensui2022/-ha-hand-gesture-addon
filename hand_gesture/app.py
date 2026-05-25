import os
import time
import json
import cv2
import mediapipe as mp
import paho.mqtt.client as mqtt

# 1. 尝试从 Home Assistant 挂载的本地选项 JSON 文件读取配置（即插即用）
options = {}
options_path = "/data/options.json"
if os.path.exists(options_path):
    try:
        with open(options_path, 'r', encoding='utf-8') as f:
            options = json.load(f)
        print(f"[SYSTEM] Successfully loaded HA Addon options: {options}")
    except Exception as e:
        print(f"[SYSTEM][WARN] Could not parse HA options file, fallback to env: {e}")

# 2. 从本地选项中读取，若无则回退至环境变量或默认值
RTSP_URL = options.get("rtsp_url", os.getenv("RTSP_URL", "rtsp://192.168.1.100:554/live/main"))
RECONNECT_INTERVAL = int(options.get("reconnect_interval", os.getenv("RECONNECT_INTERVAL", 5)))
MQTT_HOST = options.get("mqtt_host", os.getenv("MQTT_HOST", "192.168.1.5"))
MQTT_PORT = int(options.get("mqtt_port", os.getenv("MQTT_PORT", 1883)))
MQTT_USER = options.get("mqtt_username", os.getenv("MQTT_USERNAME", "homeassistant"))
MQTT_PASS = options.get("mqtt_password", os.getenv("MQTT_PASSWORD", "secure_password"))
MQTT_TOPIC = options.get("mqtt_topic", os.getenv("MQTT_TOPIC", "homeassistant/sensor/hand_gesture/state"))
SENSOR_NAME = options.get("sensor_name", os.getenv("SENSOR_NAME", "手势识别传感器"))

# 根据 MQTT 传感器主题自动解析发现配置主题
# Home Assistant 标准自动发现配置格式： <discovery_prefix>/sensor/<object_id>/config
discovery_topic = "homeassistant/sensor/hand_gesture/config"

# 初始化配置 MQTT 客户端
mqtt_client = mqtt.Client()
if MQTT_USER and MQTT_PASS:
    mqtt_client.username_pw_set(MQTT_USER, MQTT_PASS)

# 自动发现注册载荷
def send_ha_discovery_config():
    """发送 Home Assistant 自动发现 JSON 消息，无需人工手动修改 YAML"""
    discovery_payload = {
        "name": SENSOR_NAME,
        "unique_id": "mediapipe_hand_gesture_sensor",
        "state_topic": MQTT_TOPIC,
        "value_template": "{{ value }}",
        "icon": "mdi:gesture-tap-button",
        "device": {
            "identifiers": ["mediapipe_hand_gesture_system"],
            "name": "手势神经网络识别器",
            "model": "MediaPipe MLP AutoReset",
            "manufacturer": "Custom HA Addon Developer"
        }
    }
    
    print(f"[MQTT] Sending Auto Discovery config package to '{discovery_topic}'...")
    try:
        mqtt_client.publish(discovery_topic, json.dumps(discovery_payload), retain=True)
        print("[MQTT] Auto Discovery Registration Succeeded! Sensor 'sensor.hand_gesture_sensor' registered.")
    except Exception as e:
        print(f"[MQTT][ERROR] Sending discovery config failed: {e}")

def connect_mqtt():
    try:
        mqtt_client.connect(MQTT_HOST, MQTT_PORT, 60)
        mqtt_client.loop_start()
        print(f"[MQTT] Connected successfully to {MQTT_HOST}:{MQTT_PORT}")
        # 建立连接后立刻宣告 HA 自动发现
        send_ha_discovery_config()
    except Exception as e:
        print(f"[MQTT] Connection failed: {e}. Reconnection will occur in background...")

def run_gesture_recognition():
    # 初始化 Google 神经网络手势分析框架
    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    )
    
    # 常用手势几何关键点 3D 骨架判定规则
    def get_gesture(hand_landmarks):
        landmarks = hand_landmarks.landmark
        
        # 1. 拇指开合判断
        thumb_is_open = landmarks[4].x > landmarks[3].x if landmarks[4].y < landmarks[9].y else landmarks[4].x < landmarks[3].x
        
        # 2. 其他四指（食、中、无名、小指）开合状态
        fingers_open = []
        for tip, pip in [(8, 6), (12, 10), (16, 14), (20, 18)]:
            fingers_open.append(landmarks[tip].y < landmarks[pip].y)
            
        open_count = sum(fingers_open)
        
        if not thumb_is_open and open_count == 0:
            return "✊ Fist"
        elif thumb_is_open and open_count == 4:
            return "👋 Wave"
        elif not thumb_is_open and open_count == 2 and fingers_open[0] and fingers_open[1]:
            return "✌️ Victory"
        elif thumb_is_open and open_count == 0:
            # 判断手势顶点朝上还是朝下
            if landmarks[4].y < landmarks[5].y:
                return "👍 Thumbs Up"
            else:
                return "👎 Thumbs Down"
        elif not thumb_is_open and open_count == 1 and fingers_open[0]:
            return "☝️ Point Up"
        elif thumb_is_open and fingers_open[3] and not fingers_open[1] and not fingers_open[2]:
            return "🤟 Rock On"
            
        return "Unknown"

    print("[SYSTEM] Starting Gesture Recognition Single Stream Loop...")
    connect_mqtt()

    # 实体状态更新记录锁，用于实现精准 1 秒复位
    last_published_gesture = "None"
    last_published_time = 0.0
    reset_pending = False

    while True:
        print(f"[STREAM] Attempting to connect to camera RTSP source: {RTSP_URL}")
        cap = cv2.VideoCapture(RTSP_URL)
        
        if not cap.isOpened():
            print(f"[STREAM ERROR] Cannot open RTSP Stream: {RTSP_URL}")
            print(f"[STREAM RECON] Server is offline. Sleeping {RECONNECT_INTERVAL} seconds before reconnect...")
            cap.release()
            time.sleep(RECONNECT_INTERVAL)
            continue
            
        print("[STREAM SUCCESS] Video feed opened successfully! Running frame-level analysis (~30 FPS).")
        consecutive_failures = 0
        
        while cap.isOpened():
            # 1秒定时复位判定子引擎（重点！防止阻塞多进程，运行在主大环内部）
            if reset_pending and (time.time() - last_published_time >= 1.0):
                print("[MQTT] 1 second elapsed! Auto resetting sensor state to: 'None'")
                try:
                    mqtt_client.publish(MQTT_TOPIC, "None", retain=True)
                except Exception as e:
                    print(f"[MQTT][RESET ERROR] Reset clear failed: {e}")
                last_published_gesture = "None"
                reset_pending = False

            ret, frame = cap.read()
            if not ret:
                consecutive_failures += 1
                print(f"[STREAM WARN] Failed to read frame ({consecutive_failures}/{RECONNECT_INTERVAL})")
                if consecutive_failures >= 3:
                    print("[STREAM ERROR] Stream connection lost completely! Breaking reader lock...")
                    break
                time.sleep(1)
                continue
                
            consecutive_failures = 0
            
            # 转换色彩通道
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = hands.process(rgb_frame)
            
            gesture_detected = "None"
            if results.multi_hand_landmarks:
                for hand_landmarks in results.multi_hand_landmarks:
                    gesture_detected = get_gesture(hand_landmarks)
                    break # 只处理首要探测到的单张手掌
            
            # 当手势发生变化，且识别到了具体动作（非空闲）时推送
            if gesture_detected != "None" and gesture_detected != last_published_gesture:
                print(f"[MQTT] Gesture Triggered! New state: '{gesture_detected}'")
                try:
                    mqtt_client.publish(MQTT_TOPIC, gesture_detected, retain=True)
                except Exception as e:
                    print(f"[MQTT][ERROR] Publish action state failed: {e}")
                
                # 记录最新的触发和开始记录 1 秒倒计时
                last_published_gesture = gesture_detected
                last_published_time = time.time()
                reset_pending = True
                
            # 少量休眠降低对 HA 底层 Docker 主机的 CPU 占用率
            time.sleep(0.033)
            
        cap.release()
        print(f"[STREAM FAILOVER] Stream disconnected. Wait to repeat outer reconnection in {RECONNECT_INTERVAL}s")
        time.sleep(RECONNECT_INTERVAL)

if __name__ == "__main__":
    try:
        run_gesture_recognition()
    except KeyboardInterrupt:
        print("[SYSTEM] Received manual kill sig. Exiting safely.")
