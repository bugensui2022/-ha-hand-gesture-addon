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
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# 锁定带有 solutions.hands 的稳定经典版 mediapipe==0.10.14
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    "mediapipe==0.10.14" \
    opencv-python-headless \
    "paho-mqtt<2.0.0"

COPY . .

CMD [ "python", "-u", "/app/app.py" ]
