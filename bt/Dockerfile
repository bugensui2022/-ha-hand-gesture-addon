# 使用轻量级 Node 镜像，避开 HA 基础镜像的 s6-overlay 冲突
FROM node:20-alpine

# 安装蓝牙工具和必要的系统依赖
RUN apk add --no-cache \
    bluez \
    bluez-deprecated \
    dbus \
    util-linux

WORKDIR /app

# 复制依赖定义
COPY package.json ./

# 安装依赖
RUN npm install --production

# 复制主程序
COPY index.js ./

# 赋予执行权限并启动
# 注意：Node 程序将作为 PID 1 运行，这样更稳定
CMD [ "node", "index.js" ]
