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

# 赋予 node 访问蓝牙栈的权限
RUN apk add --no-cache libcap && \
    setcap 'cap_net_raw,cap_net_admin+eip' $(readlink -f $(which node))

# 直接启动 node，不再使用 run.sh 脚本，避免 s6-overlay PID 1 冲突
CMD [ "node", "index.js" ]
