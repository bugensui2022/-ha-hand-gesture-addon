ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装必要的工具：nodejs, npm, 蓝牙工具, dbus, util-linux
RUN apk add --no-cache \
    nodejs \
    npm \
    bluez \
    bluez-deprecated \
    dbus \
    util-linux

WORKDIR /app

# 拷贝应用文件
COPY package.json .
COPY index.js .

# 安装依赖
RUN npm install --production

# 启动脚本
CMD [ "node", "index.js" ]
