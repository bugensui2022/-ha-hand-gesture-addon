# 使用带 Python 3.10 的 Debian/Ubuntu 极其稳定的轻量镜像
FROM python:3.10-slim-bullseye

# 安装系统级底层依赖（编译 OpenCV 图形引擎和 MediaPipe 神经网络所需）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 指定容器内部运行根目录
WORKDIR /app

# 一键拉取运行时 Python 科学计算与流媒体模块
RUN pip install --no-cache-dir \
    mediapipe==0.10.11 \
    opencv-python-headless==4.9.0.80 \
    paho-mqtt==1.6.1

# 复制可执行及配置代码进入虚拟机
COPY run.sh /app/run.sh
COPY app.py /app/app.py

# 强制转换 Windows 下 CRLF 为 Linux LF，彻底解决 tini/bash 找不到执行路径报错！
RUN sed -i 's/\r$//' /app/run.sh && chmod a+x /app/run.sh

# 启动守护程序
CMD [ "/app/run.sh" ]
