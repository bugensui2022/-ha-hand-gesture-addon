ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装运行环境
RUN apk add --no-cache \
    nodejs \
    npm \
    bluez \
    bluez-deprecated \
    dbus

WORKDIR /app

# 复制文件
COPY package.json index.js ./

# 安装依赖
RUN npm install --production

# 启动脚本
CMD [ "node", "index.js" ]
