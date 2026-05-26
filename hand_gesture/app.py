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
        log_msg("系统驱动", f"成功加载 Home Assistant 选项配置文件: {options}")
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
    
    log_msg("MQTT通信", f"正在向主题 '{discovery_topic}' 发送 HA 实体自动发现注册信息...")
    try:
        mqtt_client.publish(discovery_topic, json.dumps(discovery_payload), retain=True)
        log_msg("MQTT通信", f"成功注册实体！Home Assistant 传感器设备 '{SENSOR_NAME}' 注册载荷发送完毕")
    except Exception as e:
        log_msg("MQTT错误", f"发送自动发现配置失败: {e}")

def connect_mqtt():
    try:
        mqtt_client.connect(MQTT_HOST, MQTT_PORT, 60)
        mqtt_client.loop_start()
        log_msg("MQTT通信", f"成功连接至本地/远程 MQTT 代理服务器 ({MQTT_HOST}:{MQTT_PORT})")
        # 建立连接后立刻宣告 HA 自动发现
        send_ha_discovery_config()
    except Exception as e:
        log_msg("MQTT错误", f"连接 MQTT 代理服务器失败: {e}。将在后台持续尝试重连...")

# 精细无延迟实时流抓取线程，开启多线程事件通知，彻底消除 OpenCV 帧缓存堆积与延迟爆发问题
class RTSPStreamGrabber:
    def __init__(self, rtsp_url, reconnect_interval=5):
        self.rtsp_url = rtsp_url
        self.reconnect_interval = reconnect_interval
        self.frame = None
        self.ret = False
        self.stopped = False
        self.connected = False
        self.lock = threading.Lock()
        self.new_frame_event = threading.Event()
        self.thread = None

    def start(self):
        self.stopped = False
        self.thread = threading.Thread(target=self._grab_loop)
        self.thread.daemon = True
        self.thread.start()
        return self

    def _grab_loop(self):
        while not self.stopped:
            log_msg("监控画质", f"正在尝试建立与 RTSP 摄像头的物理连接: {self.rtsp_url}")
            cap = cv2.VideoCapture(self.rtsp_url)
            
            # 强化底层配置防止内部排队：设置缓冲区大小为 1，确保 read() 永远拉取最新的无延迟网络流
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            
            if not cap.isOpened():
                log_msg("监控警告", "连接失败！无法打开该 RTSP 视频流。请检查 IP、账号或流路径。")
                log_msg("监控调度", f"摄像头当前可能离线或被占用。将在 {self.reconnect_interval} 秒后自动尝试重新连接...")
                cap.release()
                time.sleep(self.reconnect_interval)
                continue
                
            log_msg("监控成功", "摄像头 RTSP 视频源连接成功！最新秒回流抓取引擎启动中...")
            self.connected = True
            consecutive_failures = 0
            
            while not self.stopped:
                ret, frame = cap.read()
                if not ret:
                    consecutive_failures += 1
                    log_msg("监控警告", f"读取视频流帧数据失败 ({consecutive_failures}/3)")
                    if consecutive_failures >= 3:
                        log_msg("监控故障", "视频流帧连续读取失败超限，判定已断线！正在触发自愈重连程序...")
                        self.connected = False
                        break
                    time.sleep(1)
                    continue
                
                consecutive_failures = 0
                with self.lock:
                    self.frame = frame
                    self.ret = True
                    self.new_frame_event.set() # 唤醒正在堵塞等待的新帧分析器
                
                # 极微休眠 1 毫秒防止过度抢占
                time.sleep(0.001)
                
            cap.release()
            self.connected = False
            log_msg("监控自愈", f"视频管道已释放。等待 {self.reconnect_interval} 秒后自动尝试再次连入...")
            time.sleep(self.reconnect_interval)

    def read_new_frame(self, timeout=0.1):
        # 挂起当前线程，等待新物理帧到达。完全不消耗 CPU 资源，摆脱空转造成的 100% CPU 占用
        if self.new_frame_event.wait(timeout):
            with self.lock:
                self.new_frame_event.clear()
                return self.ret, self.frame
        return False, None

    def stop(self):
        self.stopped = True
        self.new_frame_event.set() # 避免线程永久阻塞在 new_frame_event 上
        if self.thread:
            self.thread.join(timeout=2)

def run_gesture_recognition():
    # 建立手势骨架识别神经元守护
    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    )
    
    # 手势核心几何特征自适应计算
    def get_gesture(hand_landmarks):
        landmarks = hand_landmarks.landmark
        wrist = landmarks[0]
        
        # 核心手掌尺度归一化基准（手腕到中指根部 9 的 3D 欧氏距离），彻底消除人体手部伸缩、距离远近造成的尺度误判
        palm_size = ((landmarks[9].x - wrist.x)**2 + (landmarks[9].y - wrist.y)**2 + (landmarks[9].z - wrist.z)**2)**0.5
        if palm_size == 0:
            palm_size = 0.001
            
        def get_dist(p1, p2):
            return ((p1.x - p2.x)**2 + (p1.y - p2.y)**2 + (p1.z - p2.z)**2)**0.5
            
        # 多角度、绝对距离归一化自适应判定：4指开合状态（若指尖到手腕距离 > 指关节到手腕距离，则判定为舒展张开）
        index_open  = get_dist(landmarks[8], wrist)  > (get_dist(landmarks[6], wrist)  + 0.1 * palm_size)
        middle_open = get_dist(landmarks[12], wrist) > (get_dist(landmarks[10], wrist) + 0.1 * palm_size)
        ring_open   = get_dist(landmarks[16], wrist) > (get_dist(landmarks[14], wrist) + 0.1 * palm_size)
        pinky_open  = get_dist(landmarks[20], wrist) > (get_dist(landmarks[18], wrist) + 0.1 * palm_size)
        
        # 大拇指防抖相对检测：大拇指尖 (4) 到食指根部 (5) 的空间距离
        thumb_dist = get_dist(landmarks[4], landmarks[5])
        thumb_open = thumb_dist > (1.1 * palm_size)
        
        # 统计开启手指数量
        open_count = sum([index_open, middle_open, ring_open, pinky_open])
        
        # 1. 拳头✊ Fist: 全部闭合
        if open_count == 0 and not thumb_open:
            return "✊ Fist"
            
        # 2. 挥手张开👋 Wave: 全部打开
        if open_count == 4 and thumb_open:
            return "👋 Wave"
            
        # 3. 剪刀差✌️ Victory: 仅食指中指打开
        if index_open and middle_open and not ring_open and not pinky_open:
            return "✌️ Victory"
            
        # 4. 点赞大拇指👍 Thumbs Up / 踩👎 Thumbs Down
        if thumb_open and open_count == 0:
            if landmarks[4].y < landmarks[5].y:
                return "👍 Thumbs Up"
            else:
                return "👎 Thumbs Down"
                
        # 5. 食指朝上☝️ Point Up
        if index_open and not middle_open and not ring_open and not pinky_open:
            return "☝️ Point Up"
            
        # 6. 摇滚🤟 Rock On: 大拇指、食指、小拇指张开
        if thumb_open and index_open and pinky_open and not middle_open and not ring_open:
            return "🤟 Rock On"
            
        return "Unknown"

    log_msg("算法引擎", "成功初始化手势神经网络模型，单流自适应机制激活")
    connect_mqtt()

    # 启动后台秒级无延迟视频拉流处理器
    grabber = RTSPStreamGrabber(RTSP_URL, RECONNECT_INTERVAL).start()

    # 实体状态更新记录，用于实现精准、自适应及时的自动复位控制
    last_published_gesture = "None"
    last_published_time = 0.0
    reset_pending = False

    # 预设的可执行高识别率手势
    VALID_GESTURES = ["✊ Fist", "👋 Wave", "✌️ Victory", "👍 Thumbs Up", "👎 Thumbs Down", "☝️ Point Up", "🤟 Rock On"]

    while True:
        # 1/3 自定义时间定时复位判定部分
        if reset_pending and (time.time() - last_published_time >= RESET_HAND_STATUS_TIME):
            log_msg("MQTT", f"已达到重置倒计时 {RESET_HAND_STATUS_TIME} 秒！自动恢复传感器状态为: 'None'")
            try:
                mqtt_client.publish(MQTT_TOPIC, "None", retain=True)
            except Exception as e:
                log_msg("MQTT错误", f"重置传感器状态同步失败: {e}")
            last_published_gesture = "None"
            reset_pending = False

        # 2/3 获取最新刚出炉的物理帧（采用线程事件，阻塞挂起，极简省主频算力）
        ret, frame = grabber.read_new_frame(timeout=0.05)
        if not ret or frame is None:
            continue
            
        # 3/3 色彩空间转换以支持 Google MLP 算法分析
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb_frame)
        
        gesture_detected = "None"
        if results.multi_hand_landmarks:
            for hand_landmarks in results.multi_hand_landmarks:
                gesture_detected = get_gesture(hand_landmarks)
                break # 实时高主频，每一帧仅分析首个检测到的主力手部
        
        # 核心防抖控制：只有在 7 种有效手势中，且其不等于前一次触发的消息时，才予发送
        if gesture_detected in VALID_GESTURES and gesture_detected != last_published_gesture:
            log_msg("系统识别", f"成功感应手势: '{gesture_detected}'！正在向代理服务器推送物理状态...")
            try:
                mqtt_client.publish(MQTT_TOPIC, gesture_detected, retain=True)
                log_msg("MQTT", f"推送成功！当前传感器状态已正式设定为: '{gesture_detected}'")
            except Exception as e:
                log_msg("MQTT错误", f"手势状态消息推送失败: {e}")
            
            # 更新运行统计与触发记录
            last_published_gesture = gesture_detected
            last_published_time = time.time()
            reset_pending = True

if __name__ == "__main__":
    try:
        run_gesture_recognition()
    except KeyboardInterrupt:
        log_msg("系统驱动", "监听到手动外部退出信号，手势守护守护线程安全注销。")
