# 默认使用 Home Assistant 官方基础镜像（ Supervisor 会在构建时自动替换此参数）
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装必要的工具：
# nodejs/npm: 运行环境
# bluez/bluez-deprecated: 提供 l2ping, hcitool, hciconfig 等经典蓝牙工具
# dbus: 蓝牙通信基础服务
# util-linux: 提供更完整的系统工具支持
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

# 安装生产环境依赖并清理缓存
RUN npm install --production && \
    npm cache clean --force

# 直接运行 Node.js 应用
CMD [ "node", "index.js" ]
