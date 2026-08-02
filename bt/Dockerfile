ARG BUILD_FROM
FROM $BUILD_FROM

# Install necessary tools
RUN apk add --no-cache \
    nodejs \
    npm \
    bluez \
    bluez-deprecated

WORKDIR /app

# Copy application files
COPY package.json .
COPY index.js .

RUN npm install

# Start the application
CMD [ "node", "index.js" ]
