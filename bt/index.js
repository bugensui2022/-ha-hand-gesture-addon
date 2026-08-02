const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 蓝牙扫描加载项 v1.1.1 启动中 ---');

// 读取配置
let options;
try {
    options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
} catch (e) {
    console.error('解析配置文件失败:', e.message);
    process.exit(1);
}

const {
    mqtt_host, mqtt_port, mqtt_user, mqtt_password,
    target_mac, scan_interval, adapter_id, offline_tolerance
} = options;

const cleanMac = target_mac.replace(/:/g, '').toLowerCase();
const deviceId = `mbzbt`; // 实体 ID: device_tracker.mbzbt
const stateTopic = `homeassistant/device_tracker/${deviceId}/state`;
const configTopic = `homeassistant/device_tracker/${deviceId}/config`;

let lastState = null;
let offlineCount = 0;

const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000,
    will: {
        topic: stateTopic,
        payload: 'not_home',
        retain: true
    }
});

function publishDiscovery() {
    const payload = {
        name: `漫步者蓝牙`,
        state_topic: stateTopic,
        unique_id: `bt_tracker_${cleanMac}`,
        payload_home: 'home',
        payload_not_home: 'not_home',
        source_type: 'bluetooth',
        device: {
            identifiers: [cleanMac],
            name: '漫步者蓝牙音响',
            model: 'Classic Bluetooth Device',
            manufacturer: 'Edifier'
        }
    };
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

function scan() {
    exec(`l2ping -c 1 -i ${adapter_id} ${target_mac}`, { timeout: 4000 }, (err) => {
        const isPresent = !err;
        
        if (isPresent) {
            offlineCount = 0;
            if (lastState !== 'home') {
                console.log(`[${new Date().toLocaleTimeString()}] 设备上线: ${target_mac}`);
                client.publish(stateTopic, 'home', { retain: true });
                lastState = 'home';
            }
        } else {
            offlineCount++;
            if (offlineCount >= offline_tolerance && lastState !== 'not_home') {
                console.log(`[${new Date().toLocaleTimeString()}] 设备离线 (已重试 ${offlineCount} 次): ${target_mac}`);
                client.publish(stateTopic, 'not_home', { retain: true });
                lastState = 'not_home';
            }
        }
    });
}

client.on('connect', () => {
    console.log('成功连接到 MQTT Broker');
    publishDiscovery();
    scan();
    setInterval(scan, scan_interval * 1000);
});

// --- 优雅停机逻辑 ---
function handleShutdown(signal) {
    console.log(`收到 ${signal} 信号，正在关闭...`);
    // 停止前发送离线状态
    if (client.connected) {
        client.publish(stateTopic, 'not_home', { retain: true }, () => {
            client.end(true, () => {
                console.log('MQTT 连接已关闭，程序退出');
                process.exit(0); // 必须返回 0 才能让 HA 显示“已停止”
            });
        });
    } else {
        process.exit(0);
    }
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

client.on('error', (err) => console.error('MQTT 错误:', err.message));
