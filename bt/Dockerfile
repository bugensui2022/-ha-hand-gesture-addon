ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装必要的工具
RUN apk add --no-cache \
    nodejs \
    npm \
    bluez \
    bluez-deprecated \
    dbus \
    util-linux

WORKDIR /app

# 复制文件
COPY package.json .
COPY index.js .

# 安装依赖
RUN npm install --production

# 启动
CMD [ "node", "index.js" ]
