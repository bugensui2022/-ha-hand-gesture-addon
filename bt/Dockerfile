FROM node:20-alpine

# 安装蓝牙工具和必要库
RUN apk add --no-cache \
    bluez \
    bluez-deprecated \
    dbus \
    util-linux \
    libcap

WORKDIR /app

# 复制应用文件
COPY package.json .
COPY index.js .

# 安装依赖
RUN npm install --production

# 赋予 node 进程直接访问网络栈的权限
RUN setcap 'cap_net_raw,cap_net_admin+eip' $(readlink -f $(which node))

# 直接启动，确保 node 是 PID 1
CMD [ "node", "index.js" ]
