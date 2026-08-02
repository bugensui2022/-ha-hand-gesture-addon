const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 蓝牙追踪器 (device_tracker) 启动中 ---');

// 读取配置
let options;
try {
    options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
} catch (e) {
    console.error('无法读取配置文件');
    process.exit(1);
}

const {
    mqtt_host, mqtt_port, mqtt_user, mqtt_password,
    target_mac, scan_interval, offline_tolerance, adapter_id
} = options;

// 固定实体 ID 为 device_tracker.mbzbt
const entityId = 'mbzbt';
const stateTopic = `homeassistant/device_tracker/${entityId}/state`;
const configTopic = `homeassistant/device_tracker/${entityId}/config`;

let lastState = null;
let errorCount = 0;

const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000
});

function publishDiscovery() {
    const payload = {
        name: "漫步者蓝牙",
        state_topic: stateTopic,
        unique_id: `bt_tracker_${target_mac.replace(/:/g, '').toLowerCase()}`,
        payload_home: 'home',
        payload_not_home: 'not_home',
        source_type: 'bluetooth',
        icon: 'mdi:bluetooth',
        device: {
            identifiers: [`bt_dev_${entityId}`],
            name: '漫步者蓝牙',
            model: 'Classic BT Tracker',
            manufacturer: 'Custom Add-on'
        }
    };
    // 发送自动发现配置，设置 retain: true 保证 HA 重启后能找回实体
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

function updateState(isPresent) {
    const newState = isPresent ? 'home' : 'not_home';
    
    if (newState !== lastState) {
        console.log(`[${new Date().toLocaleTimeString()}] 状态变更: ${lastState} -> ${newState}`);
        // 发送状态，设置 retain: true 保证 HA 重启后恢复最后一次的状态
        client.publish(stateTopic, newState, { retain: true });
        lastState = newState;
    }
}

function scan() {
    // 使用 l2ping 进行单次探测 (-c 1)
    // l2ping 成功返回 0，失败返回非 0
    exec(`l2ping -i ${adapter_id} -c 1 ${target_mac}`, { timeout: 3000 }, (err) => {
        const success = !err;

        if (success) {
            errorCount = 0; // 只要成功一次，立即重置计数
            updateState(true); // 立即上线
        } else {
            errorCount++;
            if (errorCount >= offline_tolerance) {
                updateState(false); // 达到容错上限，判定离线
            }
        }
    });
}

client.on('connect', () => {
    console.log('MQTT 已连接');
    publishDiscovery();
    setInterval(scan, scan_interval * 1000);
});

client.on('error', (err) => console.error('MQTT 错误:', err.message));
