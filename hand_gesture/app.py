import os
# 阻断 FFmpeg / OpenCV 的底层 C++ 报错刷屏，保持终端日志纯净
os.environ["OPENCV_LOG_LEVEL"] = "OFF"
os.environ["FFMPEG_LOG_LEVEL"] = "quiet"
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"
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
RTSP_URL = options.get("rtsp_url", os.getenv("RTSP_URL", "rtsp://192.168.0.15:8554/live"))
RECONNECT_INTERVAL = int(options.get("reconnect_interval", os.getenv("RECONNECT_INTERVAL", 5)))
MQTT_HOST = options.get("mqtt_host", os.getenv("MQTT_HOST", "192.168.0.16"))
MQTT_PORT = int(options.get("mqtt_port", os.getenv("MQTT_PORT", 1883)))
MQTT_USER = options.get("mqtt_username", os.getenv("MQTT_USERNAME", "mqtt"))
MQTT_PASS = options.get("mqtt_password", os.getenv("MQTT_PASSWORD", "mqtt"))
MQTT_TOPIC = options.get("mqtt_topic", os.getenv("MQTT_TOPIC", "homeassistant/sensor/hand_gesture/state"))
SENSOR_NAME = options.get("sensor_name", os.getenv("SENSOR_NAME", "手势识别传感器"))
RESET_HAND_STATUS_TIME = float(options.get("reset_hand_status_time", os.getenv("RESET_HAND_STATUS_TIME", 3)))

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
            "name": SENSOR_NAME,
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
        consecutive_connect_failures = 0
        while not self.stopped:
            # 只有第1次连不上或建立连接时打印日志，防止掉线后刷屏
            if consecutive_connect_failures == 0:
                log_msg("监控画质", f"正在尝试建立与 RTSP 摄像头的物理连接: {self.rtsp_url}")
            
            cap = cv2.VideoCapture(self.rtsp_url)
            
            # 强化底层配置防止内部排队：设置缓冲区大小为 1，确保 read() 永远拉取最新的无延迟网络流
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            
            if not cap.isOpened():
                if consecutive_connect_failures == 0:
                    log_msg("监控警告", f"摄像头连接失败或离线！程序将在后台每 {self.reconnect_interval} 秒静默尝试重连...")
                consecutive_connect_failures += 1
                cap.release()
                time.sleep(self.reconnect_interval)
                continue
                
            if consecutive_connect_failures > 0:
                log_msg("监控自愈", f"已成功恢复与摄像头 RTSP 视频源的物理连接！(历经 {consecutive_connect_failures} 次静默重试)")
            else:
                log_msg("监控成功", "摄像头 RTSP 视频源连接成功！最新秒回流抓取引擎启动中...")
                
            consecutive_connect_failures = 0
            self.connected = True
            consecutive_failures = 0
            
            while not self.stopped:
                ret, frame = cap.read()
                if not ret:
                    consecutive_failures += 1
                    if consecutive_failures == 1:
                        log_msg("监控警告", "读取视频流帧数据失败！正在后台静默重试...")
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
            # 重连等待静默处理，外面已有 log
            time.sleep(self.reconnect_interval)

    def read_new_frame(self, timeout=0.1):
        # 挂起当前线程，等待新物理帧到达。完全不消耗 CPU 资源，摆退空转造成的 100% CPU 占用
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
        min_detection_confidence=0.8,  # 提高检测置信度至 0.8，防止环境背景噪声及弱阴影误判为手部
        min_tracking_confidence=0.8   # 提高跟踪置信度至 0.8，防止手势运动期间骨架抖动异动引起的误判定
    )
    
    # 手势核心几何特征自适应计算
    def get_gesture(hand_landmarks):
        landmarks = hand_landmarks.landmark
        
        # 2D Euclidean Distance Helper to avoid noisy Z coord jittering
        def get_dist_2d(p1, p2):
            return ((p1.x - p2.x)**2 + (p1.y - p2.y)**2)**0.5
            
        # 核心手掌尺度归一化基准（手腕到中指 MCP 9 的 2D 欧氏距离），消除人体手部伸缩、距离远近造成的尺度误判
        palm_size = get_dist_2d(landmarks[9], landmarks[0])
        if palm_size < 0.01:
            palm_size = 0.01
            
        # 4指 tip, pip joint, MCP joint 距离手腕的绝对 2D 距离
        # Tip landmarks: Index(8), Middle(12), Ring(16), Pinky(20)
        # PIP landmarks: Index(6), Middle(10), Ring(14), Pinky(18)
        # MCP landmarks: Index(5), Middle(9), Ring(13), Pinky(17)
        # Wrist is 0
        
        index_tip_dist  = get_dist_2d(landmarks[8], landmarks[0])
        index_pip_dist  = get_dist_2d(landmarks[6], landmarks[0])
        index_mcp_dist  = get_dist_2d(landmarks[5], landmarks[0])
        
        middle_tip_dist = get_dist_2d(landmarks[12], landmarks[0])
        middle_pip_dist = get_dist_2d(landmarks[10], landmarks[0])
        middle_mcp_dist = get_dist_2d(landmarks[9], landmarks[0])
        
        ring_tip_dist   = get_dist_2d(landmarks[16], landmarks[0])
        ring_pip_dist   = get_dist_2d(landmarks[14], landmarks[0])
        ring_mcp_dist   = get_dist_2d(landmarks[13], landmarks[0])
        
        pinky_tip_dist  = get_dist_2d(landmarks[20], landmarks[0])
        pinky_pip_dist  = get_dist_2d(landmarks[18], landmarks[0])
        pinky_mcp_dist  = get_dist_2d(landmarks[17], landmarks[0])
        
        # 判定开合，加入迟滞保护区间，使临界晃动彻底静音
        index_open  = (index_tip_dist > index_pip_dist + 0.1 * palm_size) and (index_tip_dist > index_mcp_dist + 0.15 * palm_size)
        middle_open = (middle_tip_dist > middle_pip_dist + 0.1 * palm_size) and (middle_tip_dist > middle_mcp_dist + 0.15 * palm_size)
        ring_open   = (ring_tip_dist > ring_pip_dist + 0.1 * palm_size) and (ring_tip_dist > ring_mcp_dist + 0.15 * palm_size)
        pinky_open  = (pinky_tip_dist > pinky_pip_dist + 0.1 * palm_size) and (pinky_tip_dist > pinky_mcp_dist + 0.15 * palm_size)
        
        index_closed  = index_tip_dist < index_pip_dist + 0.02 * palm_size
        middle_closed = middle_tip_dist < middle_pip_dist + 0.02 * palm_size
        ring_closed   = ring_tip_dist < ring_pip_dist + 0.02 * palm_size
        pinky_closed  = pinky_tip_dist < pinky_pip_dist + 0.02 * palm_size
        
        # 大拇指防抖相对检测：大拇指尖 (4) 到食指 MCP 关节 (5) 的 2D 空间距离
        thumb_dist = get_dist_2d(landmarks[4], landmarks[5])
        thumb_open = thumb_dist > 1.25 * palm_size
        thumb_closed = thumb_dist < 0.95 * palm_size
        
        # 结合手部生理特征，实现8种极致稳定的手势精确匹配
        # 1. 拳头✊ Fist: 全部闭合
        if index_closed and middle_closed and ring_closed and pinky_closed and thumb_closed:
            return "✊ Fist"
            
        # 2. OK手势👌 OK: 食指尖与大拇指尖接触形成圆圈，中指、无名指、小指张开
        thumb_index_dist = get_dist_2d(landmarks[4], landmarks[8])
        if thumb_index_dist < 0.22 * palm_size and middle_open and ring_open and pinky_open:
            return "👌 OK"
            
        # 3. 挥手张开👋 Wave: 全部打开
        if index_open and middle_open and ring_open and pinky_open and thumb_open:
            return "👋 Wave"
            
        # 4. 剪刀差✌️ Victory: 仅食指中指打开，其余闭合
        if index_open and middle_open and ring_closed and pinky_closed and thumb_closed:
            return "✌️ Victory"
            
        # 5. 点赞大拇指👍 Thumbs Up / 踩👎 Thumbs Down: 仅大拇指打开
        if thumb_open and index_closed and middle_closed and ring_closed and pinky_closed:
            if landmarks[4].y < landmarks[5].y:
                return "👍 Thumbs Up"
            else:
                return "👎 Thumbs Down"
                
        # 6. 食指朝上☝️ Point Up: 仅食指打开，其余闭合
        if index_open and middle_closed and ring_closed and pinky_closed and thumb_closed:
            return "☝️ Point Up"
            
        # 7. 摇滚🤟 Rock On: 大拇指、食指、小拇指张开，中指无名指闭合
        if thumb_open and index_open and pinky_open and middle_closed and ring_closed:
            return "🤟 Rock On"
            
        return "None"

    log_msg("算法引擎", "成功初始化手势神经网络模型，单流自适应机制激活")
    connect_mqtt()

    # 启动后台秒级无延迟视频拉流处理器
    grabber = RTSPStreamGrabber(RTSP_URL, RECONNECT_INTERVAL).start()

    # 实体状态更新记录，用于实现精准、自适应及时的自动复位控制与手势冷静期
    last_published_gesture = "None"
    last_published_time = 0.0
    reset_pending = False

    # 预设的可执行高识别率手势
    VALID_GESTURES = ["✊ Fist", "👋 Wave", "✌️ Victory", "👍 Thumbs Up", "👎 Thumbs Down", "☝️ Point Up", "🤟 Rock On", "👌 OK"]

    # 引入手势平滑防抖引擎：连续 N 帧识别一致才判定为有效手势，彻底杜绝过渡性晃动或手势切换时产生的误判触发
    STABILIZATION_FRAMES = 5
    current_candidate = "None"
    candidate_count = 0

    while True:
        current_time = time.time()

        # 1/3 自定义时间定时复位与冷静期(Cooldown)判定
        if reset_pending:
            if current_time - last_published_time >= RESET_HAND_STATUS_TIME:
                try:
                    mqtt_client.publish(MQTT_TOPIC, "None", retain=True)
                    log_msg("系统识别", f"已达到冷静重置限制 ({RESET_HAND_STATUS_TIME} 秒)！已自动恢复传感器状态为: 'None'")
                except Exception as e:
                    log_msg("MQTT错误", f"重置传感器状态同步失败: {e}")
                last_published_gesture = "None"
                reset_pending = False
                # 清除防抖候选器
                current_candidate = "None"
                candidate_count = 0
            else:
                # 仍处于手势冷静期内部，忽略新手势识别，充分利用 CPU 算力
                # 精准读取新帧防止多线程 grabber 发送事件阻塞溢出
                ret, frame = grabber.read_new_frame(timeout=0.05)
                continue

        # 2/3 获取最新刚出炉的物理帧（采用线程事件，阻塞挂起，极简省主频算力）
        ret, frame = grabber.read_new_frame(timeout=0.05)
        if not ret or frame is None:
            continue
            
        # 3/3 色彩空间转换以支持 Google MLP 算法分析
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb_frame)
        
        # 确定本帧的最优手势匹配
        raw_gesture = "None"
        if results.multi_hand_landmarks:
            for hand_landmarks in results.multi_hand_landmarks:
                raw_gesture = get_gesture(hand_landmarks)
                break # 实时高主频，每一帧仅分析首个检测到的主力手部
        
        # 将 "Unknown" 或非有效手势，统一规整为 "None" 以支持精准判定
        if raw_gesture not in VALID_GESTURES:
            raw_gesture = "None"

        # 手势平滑防抖过滤：
        if raw_gesture == current_candidate:
            if current_candidate != "None":
                candidate_count += 1
            else:
                candidate_count = 0 # None 无需累加防抖帧
        else:
            current_candidate = raw_gesture
            if current_candidate != "None":
                candidate_count = 1
            else:
                candidate_count = 0

        # 如果某种有效手势连续稳定出现了足够数量 of 帧，且不是上一次刚发布过的手势（避免立刻重复发布相同手势）
        if candidate_count >= STABILIZATION_FRAMES:
            gesture_detected = current_candidate
            
            if gesture_detected != last_published_gesture:
                try:
                    mqtt_client.publish(MQTT_TOPIC, gesture_detected, retain=True)
                    log_msg("系统识别", f"成功感应有效手势: '{gesture_detected}'，已在 MQTT 代理推送成功")
                except Exception as e:
                    log_msg("MQTT错误", f"手势状态消息推送失败: {e}")
                
                # 激活冷静期/复位倒计时
                last_published_gesture = gesture_detected
                last_published_time = time.time()
                reset_pending = True
                
                # 重置候选状态
                current_candidate = "None"
                candidate_count = 0

if __name__ == "__main__":
    try:
        run_gesture_recognition()
    except KeyboardInterrupt:
        log_msg("系统驱动", "监听到手动外部退出信号，手势守护守护线程安全注销。")
