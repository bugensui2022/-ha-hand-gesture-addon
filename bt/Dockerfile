ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装必要的工具：nodejs, npm, 蓝牙工具, dbus, bluez
RUN apk add --no-cache \
    nodejs \
    npm \
    bluez \
    bluez-deprecated \
    dbus \
    util-linux

WORKDIR /app

# 复制应用文件
COPY package.json .
COPY index.js .

# 安装依赖
RUN npm install --production

# 赋予 node 访问蓝牙栈的权限（即便在特权模式下，这也有助于稳定性）
RUN apk add --no-cache libcap && \
    setcap 'cap_net_raw,cap_net_admin+eip' $(readlink -f $(which node))

# 启动脚本，遵循 HA 加载项标准
RUN echo "#!/usr/bin/with-contenv bashio" > /run.sh && \
    echo "node /app/index.js" >> /run.sh && \
    chmod +x /run.sh

CMD [ "/run.sh" ]
