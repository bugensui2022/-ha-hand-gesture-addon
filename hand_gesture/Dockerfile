FROM python:3.11-slim-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 补充 mediapipe 底层所需的 libatomic1 等关键 C++ 库
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# 锁定依赖：mediapipe + 兼容的 protobuf
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    "protobuf<4.0.0" \
    mediapipe \
    opencv-python-headless \
    "paho-mqtt<2.0.0"

COPY . .

CMD [ "python", "-u", "/app/app.py" ]
