import os
import time
import json
import cv2
import mediapipe as mp
import paho.mqtt.client as mqttFactory
import threading
from datetime import datetime

# 全局通用中文带时间戳日志工具
def log_msg(tag, msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [{tag}] {msg}")

# 1. 尝试从 Home Assistant 挂载的本地选项 JSON 文件读取配置（即插即用）
options = {}
options_path = "/data/options.json"
if os.path.exists(options_path):
    try:
        with open(options_path, 'r', encoding='utf-8') as f:
            options = json.load(f)
        log_msg("系统", f"成功加载 Home Assistant 选项配置文件: {options}")
    except Exception as e:
        log_msg("错误警告", f"解析 options.json 配置文件出错，将回退到环境变量或默认值: {e}")

# 2. 从本地选项中读取，若无则回退至环境变量或默认值
RTSP_URL = options.get("rtsp_url", os.getenv("RTSP_URL", "rtsp://192.168.1.100:554/live/main"))
RECONNECT_INTERVAL = int(options.get("reconnect_interval", os.getenv("RECONNECT_INTERVAL", 5)))
MQTT_HOST = options.get("mqtt_host", os.getenv("MQTT_HOST", "192.168.1.5"))
MQTT_PORT = int(options.get("mqtt_port", os.getenv("MQTT_PORT", 1883)))
MQTT_USER = options.get("mqtt_username", os.getenv("MQTT_USERNAME", "homeassistant"))
MQTT_PASS = options.get("mqtt_password", os.getenv("MQTT_PASSWORD", "secure_password"))
MQTT_TOPIC = options.get("mqtt_topic", os.getenv("MQTT_TOPIC", "homeassistant/sensor/hand_gesture/state"))
SENSOR_NAME = options.get("sensor_name", os.getenv("SENSOR_NAME", "手势识别传感器"))
RESET_HAND_STATUS_TIME = float(options.get("reset_hand_status_time", os.getenv("RESET_HAND_STATUS_TIME", 1)))

# 根据 MQTT 传感器主题自动解析发现配置主题
discovery_topic = "homeassistant/sensor/hand_gesture/config"

# 初始化配置 MQTT 客户端
mqtt_client = mqttFactory.Client()
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
    
    log_msg("MQTT", f"正在向主题 '{discovery_topic}' 发送 HA 实体自动发现注册信息...")
    try:
        mqtt_client.publish(discovery_topic, json.dumps(discovery_payload), retain=True)
        log_msg("MQTT", f"成功注册实体！Home Assistant 传感器设备 '{SENSOR_NAME}' 注册载荷发送完毕")
    except Exception as e:
        log_msg("MQTT错误", f"发送自动发现配置失败: {e}")

def connect_mqtt():
    try:
        mqtt_client.connect(MQTT_HOST, MQTT_PORT, 60)
        mqtt_client.loop_start()
        log_msg("MQTT", f"成功连接至本地/远程 MQTT 代理服务器 ({MQTT_HOST}:{MQTT_PORT})")
        # 建立连接后立刻宣告 HA 自动发现
        send_ha_discovery_config()
    except Exception as e:
        log_msg("MQTT错误", f"连接 MQTT 代理服务器失败: {e}。将在后台持续尝试重连...")

# 精端零延迟实时流抓取线程，彻底解决 OpenCV 因内部帧缓冲区队列造成的画面延迟与集中爆发问题
class RTSPStreamGrabber:
    def __init__(self, rtsp_url, reconnect_interval=5):
        self.rtsp_url = rtsp_url
        self.reconnect_interval = reconnect_interval
        self.frame = None
        self.ret = False
        self.stopped = False
        self.connected = False
        self.lock = threading.Lock()
        self.thread = None

    def start(self):
        self.stopped = False
        self.thread = threading.Thread(target=self._grab_loop)
        self.thread.daemon = True
        self.thread.start()
        return self

    def _grab_loop(self):
        while not self.stopped:
            log_msg("视频流", f"正在尝试建立与 RTSP 摄像头的连接: {self.rtsp_url}")
            cap = cv2.VideoCapture(self.rtsp_url)
            
            # 强化底层配置防止内部排队：设置缓冲区大小为 1，确保 read() 永远拉取最新的无延迟网络流
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            
            if not cap.isOpened():
                log_msg("视频警告", "连接失败！无法打开该 RTSP 视频源。请检查 IP、账号或流路径。")
                log_msg("系统通知", f"摄像头疑似离线或被占用。将在 {self.reconnect_interval} 秒后尝试重新连接...")
                cap.release()
                time.sleep(self.reconnect_interval)
                continue
                
            log_msg("视频成功", "摄像头 RTSP 视频源连接成功！开始启动极速帧提取子引擎")
            self.connected = True
            consecutive_failures = 0
            
            while not self.stopped:
                ret, frame = cap.read()
                if not ret:
                    consecutive_failures += 1
                    log_msg("视频警告", f"读取视频流帧数据失败 ({consecutive_failures}/3)")
                    if consecutive_failures >= 3:
                        log_msg("视频错误", "视频流帧连续读取失败超限，疑似连接断开！正在退出抓取器以触发重连...")
                        self.connected = False
                        break
                    time.sleep(1)
                    continue
                
                consecutive_failures = 0
                with self.lock:
                    self.frame = frame
                    self.ret = True
                
                # 休眠 2ms 降低多线程抢占，防止空转过热，同时支持极佳的拉流性能
                time.sleep(0.002)
                
            cap.release()
            self.connected = False
            log_msg("视频流", f"视频流已释放。等待 {self.reconnect_interval} 秒后自动尝试再次连入...")
            time.sleep(self.reconnect_interval)

    def read(self):
        with self.lock:
            # 每次获取都保证是最新提取的一帧
            return self.ret, self.frame

    def stop(self):
        self.stopped = True
        if self.thread:
            self.thread.join(timeout=2)

def run_gesture_recognition():
    # 建立手势骨架识别引擎
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

    log_msg("系统", "正在运行手势神经网络自动复位单流守护程序...")
    connect_mqtt()

    # 启动后台秒级无延迟视频拉流处理器
    grabber = RTSPStreamGrabber(RTSP_URL, RECONNECT_INTERVAL).start()

    # 实体状态更新记录锁，用于实现精准、自适应复位
    last_published_gesture = "None"
    last_published_time = 0.0
    reset_pending = False

    # 预设的有效可执行手势集合
    VALID_GESTURES = ["✊ Fist", "👋 Wave", "✌️ Victory", "👍 Thumbs Up", "👎 Thumbs Down", "☝️ Point Up", "🤟 Rock On"]

    while True:
        # 1/3 自定义时间定时复位判定子模块（非阻塞）
        if reset_pending and (time.time() - last_published_time >= RESET_HAND_STATUS_TIME):
            log_msg("MQTT", f"已达到当前设定的重置倒计时 {RESET_HAND_STATUS_TIME} 秒！自动恢复传感器状态为: 'None'")
            try:
                mqtt_client.publish(MQTT_TOPIC, "None", retain=True)
            except Exception as e:
                log_msg("MQTT错误", f"重置状态到 'None' 失败: {e}")
            last_published_gesture = "None"
            reset_pending = False

        # 2/3 从高速零延迟读取器管道获取实时帧进度
        ret, frame = grabber.read()
        if not ret or frame is None:
            # 视频流如果尚未连上，休眠等待 50ms 重新检测，保证主线程绝对不产生 CPU 爆负荷
            time.sleep(0.05)
            continue
            
        # 3/3 色彩空间转换以支持 Google 算法分析
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb_frame)
        
        gesture_detected = "None"
        if results.multi_hand_landmarks:
            for hand_landmarks in results.multi_hand_landmarks:
                gesture_detected = get_gesture(hand_landmarks)
                break # 实时高主频，每一帧仅分析首个检测到的主力手部
        
        # 核心防抖控制：只有在 7 种有效手势中，且其不等于前一次触发的消息时，才予发送
        if gesture_detected in VALID_GESTURES and gesture_detected != last_published_gesture:
            log_msg("MQTT", f"成功识别到手势: '{gesture_detected}'！正在向代理服务器推送物理状态...")
            try:
                mqtt_client.publish(MQTT_TOPIC, gesture_detected, retain=True)
                log_msg("MQTT", f"推送成功！当前设备寄存器状态已设定为: '{gesture_detected}'")
            except Exception as e:
                log_msg("MQTT错误", f"手势状态消息推送失败: {e}")
            
            # 更新运行统计与触发记录
            last_published_gesture = gesture_detected
            last_published_time = time.time()
            reset_pending = True
            
        # 微休眠 10ms 限制主分析环的极限帧速，既保证毫秒级超敏响应，又极其节省宿主机算力
        time.sleep(0.01)

if __name__ == "__main__":
    try:
        run_gesture_recognition()
    except KeyboardInterrupt:
        log_msg("系统", "监听到手动外部退出信号，手势守护守护线程安全注销。")
