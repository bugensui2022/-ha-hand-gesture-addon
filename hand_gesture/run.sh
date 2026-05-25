#!/bin/bash
echo "[INFO] Starting Autodiscover Hand Gesture Recognition Daemon..."
echo "[INFO] Hand Gesture Recognition Addon Engine Initializing..."

# 启动 Python 视频循环解析及复位引擎，使用 -u 参数确保日志实时在 HA 终端更新
python3 -u /app/app.py
