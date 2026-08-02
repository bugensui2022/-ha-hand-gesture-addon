ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 环境变量，告知 s6 不要接管控制权或以简单模式运行
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2

# 安装环境
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

# 启动命令
CMD [ "node", "/app/index.js" ]
