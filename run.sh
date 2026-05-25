#!/usr/bin/with-contenv bashio
# 从 Home Assistant Addon 管理看板中无感读取环境变量参数
export RTSP_URL=$(bashio::config 'rtsp_url')
export RECONNECT_INTERVAL=$(bashio::config 'reconnect_interval')
export MQTT_HOST=$(bashio::config 'mqtt_host')
export MQTT_PORT=$(bashio::config 'mqtt_port')
export MQTT_USERNAME=$(bashio::config 'mqtt_username')
export MQTT_PASSWORD=$(bashio::config 'mqtt_password')
export MQTT_TOPIC=$(bashio::config 'mqtt_topic')
export SENSOR_NAME=$(bashio::config 'sensor_name')

echo "[INFO] Starting Autodiscover Hand Gesture Recognition Daemon..."
echo "[INFO] Targeting RTSP Stream: $RTSP_URL"
echo "[INFO] Reconnect Sleep Delay: $RECONNECT_INTERVAL Sec"
echo "[INFO] Sensor Entity Name: $SENSOR_NAME"

# 启动 Python 视频循环解析及复位引擎
python3 /app/app.py
