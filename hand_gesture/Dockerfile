FROM python:3.11-slim-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 安装系统依赖（包含 OpenCV 和 MediaPipe 所需的所有底层 C++ 动态库）
RUN sed -i 's/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true && \
    apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libffmpeg-dev \
    && rm -rf /var/lib/apt/lists/*

# 锁定 paho-mqtt<2.0.0，解决 2.0+ 版本的 API 破坏性兼容报错
RUN pip install --no-cache-dir --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip install --no-cache-dir \
    mediapipe \
    opencv-python-headless \
    "paho-mqtt<2.0.0" \
    pyyaml \
    -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY . .

# 增加 -u 选项，保证所有 print 和报错能实时完整打印到 HA 插件日志中
CMD [ "python", "-u", "/app/app.py" ]
