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
