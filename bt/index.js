const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 漫步者蓝牙追踪器启动中 (v1.1.0) ---');

// 读取配置
let options;
try {
    options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
} catch (e) {
    console.error('解析配置失败:', e.message);
    process.exit(1);
}

const {
    mqtt_host, mqtt_port, mqtt_user, mqtt_password,
    target_mac, scan_interval, offline_tolerance, adapter_id
} = options;

const deviceId = 'mbzbt';
const stateTopic = `homeassistant/device_tracker/${deviceId}/state`;
const configTopic = `homeassistant/device_tracker/${deviceId}/config`;

let consecutiveFailures = 0;
let lastState = null; // 记录上一次发送的状态，避免重复发送

// 连接 MQTT
const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000
});

function publishDiscovery() {
    const payload = {
        name: '漫步者蓝牙',
        state_topic: stateTopic,
        unique_id: deviceId,
        source_type: 'bluetooth',
        payload_home: 'home',
        payload_not_home: 'not_home',
        device: {
            identifiers: [deviceId],
            name: '蓝牙离线/在线扫描器',
            manufacturer: 'Custom Add-on',
            model: 'L2Ping Tracker'
        }
    };
    // retain: true 确保 HA 重启后能重新发现设备
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

function updateState(isPresent) {
    let newState = isPresent ? 'home' : 'not_home';
    
    // 只有当状态发生变化时，或者刚启动时才发送 MQTT 消息和打印日志
    if (newState !== lastState) {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] 状态变化: ${lastState || '未知'} -> ${newState === 'home' ? '【在线】' : '【离线】'}`);
        
        client.publish(stateTopic, newState, { retain: true });
        lastState = newState;
    }
}

function scan() {
    // 1 ping，2秒超时。因为是 l2ping，如果是开机状态，响应通常在几百毫秒内
    exec(`l2ping -i ${adapter_id} -c 1 -t 2 ${target_mac}`, (err) => {
        const success = !err;

        if (success) {
            consecutiveFailures = 0;
            updateState(true);
        } else {
            consecutiveFailures++;
            // 只有达到设定的容错次数，才判定为离线
            if (consecutiveFailures >= offline_tolerance) {
                updateState(false);
            } else {
                // 如果是中间偶尔失败，保持当前状态，静默处理
                if (lastState === 'home') {
                    // console.log(`[DEBUG] 扫描失败 (${consecutiveFailures}/${offline_tolerance}), 保持在线状态...`);
                }
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

client.on('error', (err) => console.error('MQTT 错误:', err.message));
