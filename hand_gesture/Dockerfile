# 使用基于 Debian 12 (Bookworm) 的最新 Slim 版 Python 基础镜像
FROM python:3.11-slim-bookworm

# 设置工作目录
WORKDIR /app

# 设置环境变量，避免 apt 交互弹窗 & 禁止 python 产生 pyc 文件
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 安装 OpenCV / MediaPipe 运行所需的系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件并安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 启动脚本
RUN chmod +x /app/run.sh
CMD [ "/app/run.sh" ]
