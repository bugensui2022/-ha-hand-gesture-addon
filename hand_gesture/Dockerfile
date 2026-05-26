# 使用带 Python 3.9 的 Debian/Ubuntu 极其稳定的镜像，确保 MediaPipe 完美适配预编译 Wheel
FROM python:3.9-slim-bullseye

# 安装系统级底层依赖（编译 OpenCV 图形引擎和 MediaPipe 运行所需）
RUN apt-get update && apt-get install -y --no-install-recommends     build-essential     libgl1-mesa-glx     libglib2.0-0     libgomp1     ffmpeg     && rm -rf /var/lib/apt/lists/*

# 指定容器内部运行根目录
WORKDIR /app

# 一键拉取运行时 Python 科学计算与流媒体模块
RUN pip install --no-cache-dir     mediapipe==0.10.11     opencv-python-headless==4.9.0.80     paho-mqtt==1.6.1

# 复制核心 Python 代码进入虚拟机
COPY app.py /app/app.py

# 直接启动 Python 进程，-u 参数能确保日志实时在 HA 终端更新
CMD [ "python3", "-u", "/app/app.py" ]
