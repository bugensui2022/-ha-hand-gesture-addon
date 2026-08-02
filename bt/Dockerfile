ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装必要的运行时工具
RUN apk add --no-cache \
    nodejs \
    npm \
    bluez \
    dbus

WORKDIR /app

# 复制应用文件
COPY package.json .
COPY index.js .

# 安装依赖
RUN npm install --production

# 直接启动 node，由 S6 托管，避免 PID 1 错误
CMD [ "node", "/app/index.js" ]
