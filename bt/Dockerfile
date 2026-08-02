FROM alpine:3.18

# 安装必要的工具：nodejs, npm, 蓝牙工具, dbus
RUN apk add --no-cache \
    nodejs \
    npm \
    bluez \
    bluez-deprecated \
    dbus \
    util-linux

WORKDIR /app

# 拷贝并安装依赖
COPY package.json .
RUN npm install --production

# 拷贝代码
COPY index.js .

# 启动脚本
CMD [ "node", "index.js" ]
