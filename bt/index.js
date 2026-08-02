const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 蓝牙 L2CAP 扫描加载项 v1.0.5 启动 ---');

// 读取配置
let options;
try {
    options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
} catch (e) {
    console.error('无法读取配置:', e.message);
    process.exit(1);
}

const {
    mqtt_host, mqtt_port, mqtt_user, mqtt_password,
    target_mac, scan_interval, adapter_id
} = options;

// 状态追踪
let confirmedState = 'OFF'; // 当前确认的状态
let failCounter = 0;        // 连续失败计数器
const MAX_FAILURES = 3;     // 离线容错阈值

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
        name: `蓝牙音箱状态 (${target_mac})`,
        device_class: 'presence',
        state_topic: stateTopic,
        unique_id: deviceId,
        payload_on: 'ON',
        payload_off: 'OFF',
        device: {
            identifiers: [deviceId],
            name: '蓝牙扫描器',
            model: 'L2Ping Optimizer',
            manufacturer: 'Custom Add-on'
        }
    };
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

function updateState(newState) {
    if (newState !== confirmedState) {
        confirmedState = newState;
        client.publish(stateTopic, confirmedState, { retain: true });
        console.log(`[${new Date().toLocaleTimeString()}] 状态切换 -> ${confirmedState === 'ON' ? '【在线】' : '【离线】'}`);
    }
}

function scan() {
    // 使用 l2ping 发送 1 个包，超时时间 3 秒
    // -c 1: 发送一次, -t 3: 3秒超时
    exec(`l2ping -i ${adapter_id} -c 1 -t 3 ${target_mac}`, (err, stdout) => {
        const success = !err && stdout.includes('bytes from');

        if (success) {
            failCounter = 0;
            // 发现即上线 (快速响应)
            updateState('ON');
        } else {
            failCounter++;
            // 只有达到阈值才下线 (稳定防止误报)
            if (failCounter >= MAX_FAILURES) {
                updateState('OFF');
            } else if (confirmedState === 'ON') {
                console.log(`[${new Date().toLocaleTimeString()}] 扫描失败 (${failCounter}/${MAX_FAILURES})，保持在线等待容错...`);
            }
        }
    });
}

client.on('connect', () => {
    console.log('MQTT 已连接');
    publishDiscovery();
    setInterval(scan, scan_interval * 1000);
    scan(); 
});

client.on('error', (err) => console.error('MQTT 错误:', err.message));
