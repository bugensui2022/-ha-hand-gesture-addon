FROM python:3.11-slim-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 只安装经过验证的基础系统依赖，不加任何不存在的软件包
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# 锁定 paho-mqtt<2.0.0 避免新版破坏性升级导致 Python 闪退
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    mediapipe \
    opencv-python-headless \
    "paho-mqtt<2.0.0"

COPY . .

# -u 确保日志不被缓存，能实时完整输出
CMD [ "python", "-u", "/app/app.py" ]
