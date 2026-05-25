# 1. 使用带 Python 3.10 的 Debian/Ubuntu 轻量镜像
FROM python:3.10-slim-bullseye

# 2. 安装系统底层依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 3. 指定容器运行目录
WORKDIR /app

# 4. 安装流媒体与 AI 计算库
RUN pip install --no-cache-dir \
    mediapipe==0.10.11 \
    opencv-python-headless==4.9.0.80 \
    paho-mqtt==1.6.1

# 5. 只把 app.py 拷贝进容器即可
COPY app.py /app/app.py

# 6. 直接由 Python 引导启动，-u 参数能确保 Home Assistant 的控制台实时输出您的日志
CMD [ "python3", "-u", "/app/app.py" ]
