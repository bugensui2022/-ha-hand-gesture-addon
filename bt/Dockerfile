ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装必要的系统组件
RUN apk add --no-cache \
    nodejs \
    npm \
    bluez \
    dbus

WORKDIR /app

# 复制 package.json 并安装依赖
COPY package.json .
RUN npm install --production

# 复制源代码
COPY index.js .

# 直接通过 node 启动，避免 s6-overlay 环境下的 PID 冲突
CMD [ "node", "/app/index.js" ]
