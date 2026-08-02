const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 蓝牙高效扫描加载项 v1.0.5 启动 ---');

// 读取配置
let options;
try {
    options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
} catch (e) {
    console.error('解析配置文件失败:', e.message);
    process.exit(1);
}

const {
    mqtt_host,
    mqtt_port,
    mqtt_user,
    mqtt_password,
    target_mac,
    scan_interval,
    adapter_id
} = options;

const cleanMac = target_mac.replace(/:/g, '').toLowerCase();
const deviceId = `bt_presence_${cleanMac}`;
const stateTopic = `homeassistant/binary_sensor/${deviceId}/state`;
const configTopic = `homeassistant/binary_sensor/${deviceId}/config`;

let lastState = null; // 记录上一次的状态
let failCount = 0;    // 连续失败计数
const MAX_FAILS = 3;  // 允许连续失败的次数（容错）

// MQTT 连接
const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000
});

function publishDiscovery() {
    const payload = {
        name: `蓝牙设备在场 (${target_mac})`,
        device_class: 'presence',
        state_topic: stateTopic,
        unique_id: deviceId,
        payload_on: 'ON',
        payload_off: 'OFF',
        device: {
            identifiers: [deviceId],
            name: '蓝牙扫描器',
            manufacturer: 'Custom Add-on',
            model: 'High-Speed L2Ping'
        }
    };
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

function updateState(newState) {
    if (newState !== lastState) {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] 状态切换: ${lastState || '未知'} -> ${newState}`);
        client.publish(stateTopic, newState, { retain: true });
        lastState = newState;
    }
}

function scan() {
    // 确保适配器是开启的
    exec(`hciconfig ${adapter_id} up`);

    /**
     * 使用 l2ping 代替 hcitool name
     * -c 1: 只发送一个包
     * -t 5: 5秒超时
     */
    const cmd = `l2ping -i ${adapter_id} -c 1 -t 5 ${target_mac}`;
    
    exec(cmd, (err, stdout) => {
        // 如果命令返回 0 且 stdout 包含 "from"，说明设备响应了
        const success = !err && stdout.includes('from');

        if (success) {
            failCount = 0;
            updateState('ON');
        } else {
            failCount++;
            // 只有连续失败达到阈值才判定为离线
            if (failCount >= MAX_FAILS) {
                updateState('OFF');
            }
        }
    });
}

client.on('connect', () => {
    console.log('MQTT 已连接，开始监控...');
    publishDiscovery();
    
    // 立即执行一次
    scan();
    // 定时循环
    setInterval(scan, scan_interval * 1000);
});

client.on('error', (err) => console.error('MQTT 错误:', err.message));

// 保持服务不退出
process.on('unhandledRejection', (reason) => console.error('Error:', reason));
