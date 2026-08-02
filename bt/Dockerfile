ARG BUILD_FROM
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

# 生产环境安装依赖
RUN npm install --production

# 启动程序
CMD [ "node", "index.js" ]
