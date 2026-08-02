const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 蓝牙检测加载项 v1.0.6 启动 ---');

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
    target_mac, scan_interval, max_failed_scans, adapter_id
} = options;

let lastState = null; // 记录上一次的状态: 'ON' 或 'OFF'
let failedCount = 0;  // 当前连续失败计数

const cleanMac = target_mac.replace(/:/g, '').toLowerCase();
const deviceId = `bt_presence_${cleanMac}`;
const stateTopic = `homeassistant/binary_sensor/${deviceId}/state`;
const configTopic = `homeassistant/binary_sensor/${deviceId}/config`;

const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000
});

function publishDiscovery() {
    const payload = {
        name: `蓝牙在场检测 (${target_mac})`,
        device_class: 'presence',
        state_topic: stateTopic,
        unique_id: deviceId,
        payload_on: 'ON',
        payload_off: 'OFF',
        device: {
            identifiers: [deviceId],
            name: '蓝牙扫描器',
            model: 'L2Ping Scanner',
            manufacturer: 'Custom Add-on'
        }
    };
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

function updateState(newState) {
    if (newState !== lastState) {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] 状态变化: ${lastState || '未知'} -> ${newState}`);
        client.publish(stateTopic, newState, { retain: true });
        lastState = newState;
    }
}

function scan() {
    // 使用 l2ping 进行快速检测，发送 1 个包
    exec(`l2ping -i ${adapter_id} -c 1 ${target_mac}`, { timeout: 4000 }, (err, stdout) => {
        const isSuccess = !err && stdout.includes('bytes from');

        if (isSuccess) {
            // 只要成功一次，立即判定为在线
            failedCount = 0;
            updateState('ON');
        } else {
            // 失败时，增加计数
            failedCount++;
            // 只有连续失败次数达到设定值，才判定为离线
            if (failedCount >= max_failed_scans) {
                updateState('OFF');
            }
            // 如果还不到次数，保持当前状态（通常是 ON），等待下一次扫描
        }
    });
}

client.on('connect', () => {
    console.log('MQTT 已连接，开始监控...');
    publishDiscovery();
    setInterval(scan, scan_interval * 1000);
    scan(); // 立即执行第一次
});

client.on('error', (err) => console.error('MQTT 错误:', err.message));
