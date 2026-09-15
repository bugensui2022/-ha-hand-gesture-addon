FROM python:3.11-slim-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# 直接安装 Python 所需依赖包（MediaPipe, OpenCV, MQTT 等）
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    mediapipe \
    opencv-python-headless \
    paho-mqtt

# 复制当前文件夹下所有应用代码
COPY . .

# 直接启动 app.py 脚本
CMD [ "python", "/app/app.py" ]
