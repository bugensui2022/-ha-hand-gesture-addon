const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 蓝牙 L2PING 扫描加载项 v1.0.7 启动 ---');

// 读取配置
let options;
try {
    options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
} catch (e) {
    console.error('无法读取配置文件:', e.message);
    process.exit(1);
}

const {
    mqtt_host, mqtt_port, mqtt_user, mqtt_password,
    target_mac, scan_interval, adapter_id, offline_tolerance
} = options;

const cleanMac = target_mac.replace(/:/g, '').toLowerCase();
const deviceId = `bt_presence_${cleanMac}`;
const stateTopic = `homeassistant/binary_sensor/${deviceId}/state`;
const configTopic = `homeassistant/binary_sensor/${deviceId}/config`;

let currentState = 'INIT'; // 初始状态
let failCount = 0; // 连续失败计数

// MQTT 连接
const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000
});

function publishDiscovery() {
    const payload = {
        name: `蓝牙音箱 (${target_mac})`,
        device_class: 'presence',
        state_topic: stateTopic,
        unique_id: deviceId,
        payload_on: 'ON',
        payload_off: 'OFF',
        device: {
            identifiers: [deviceId],
            name: '蓝牙扫描检测器',
            model: 'L2PING Scanner',
            manufacturer: 'Custom Add-on'
        }
    };
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

function updateState(newState) {
    if (newState !== currentState) {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] 状态变更: ${currentState} -> ${newState}`);
        client.publish(stateTopic, newState, { retain: true });
        currentState = newState;
    }
}

function scan() {
    // 使用 l2ping 发送 1 个包
    // -c 1: 发送一个包, -i: 指定适配器, -t 2: 2秒超时
    const cmd = `l2ping -c 1 -i ${adapter_id} ${target_mac}`;
    
    exec(cmd, { timeout: 4000 }, (err) => {
        if (!err) {
            // 扫描成功 -> 即时上线
            failCount = 0;
            updateState('ON');
        } else {
            // 扫描失败 -> 累加失败计数
            failCount++;
            if (failCount >= offline_tolerance) {
                updateState('OFF');
            }
        }
    });
}

client.on('connect', () => {
    console.log('MQTT 连接成功');
    publishDiscovery();
    setInterval(scan, scan_interval * 1000);
    scan(); // 立即执行第一次扫描
});

client.on('error', (err) => console.error('MQTT 错误:', err.message));

// 捕捉退出信号
process.on('SIGTERM', () => {
    console.log('加载项停止中...');
    process.exit(0);
});
