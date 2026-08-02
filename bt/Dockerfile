# 显式指定默认基础镜像，防止 $BUILD_FROM 变量丢失导致的报错
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装必要的工具：nodejs, npm, 蓝牙工具, dbus
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

# 仅安装生产环境依赖
RUN npm install --production

# 启动应用程序
CMD [ "node", "index.js" ]
