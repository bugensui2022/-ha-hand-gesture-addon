FROM node:20-alpine

# 安装蓝牙工具和基础依赖
RUN apk add --no-cache \
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

# 启动脚本
CMD [ "node", "index.js" ]
