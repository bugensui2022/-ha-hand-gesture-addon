ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装必要的工具：nodejs, npm, 蓝牙核心工具, 蓝牙弃用工具(含hciconfig), dbus
RUN apk add --no-cache \
    nodejs \
    npm \
    bluez \
    bluez-deprecated \
    dbus

WORKDIR /app

# 复制应用文件
COPY package.json .
COPY index.js .

# 安装依赖
RUN npm install --production

# 直接启动 node 程序，避免 s6-overlay 权限冲突
CMD [ "node", "index.js" ]
