ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装必要的工具
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

# 启动脚本：使用 bashio 环境
RUN echo "#!/usr/bin/with-contenv bashio" > /run.sh && \
    echo "node /app/index.js" >> /run.sh && \
    chmod +x /run.sh

CMD [ "/run.sh" ]
