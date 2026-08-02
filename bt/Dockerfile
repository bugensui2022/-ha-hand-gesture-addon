ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# 安装必要的工具
RUN apk add --no-cache \
    nodejs \
    npm \
    bluez \
    bluez-deprecated \
    dbus \
    util-linux

WORKDIR /app

COPY package.json .
COPY index.js .

RUN npm install --production

CMD [ "node", "index.js" ]
