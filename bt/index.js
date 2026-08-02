const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 漫步者蓝牙追踪器 1.0.9 启动 ---');

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
    target_mac, scan_interval, adapter_id, offline_tolerance
} = options;

// 实体配置
const deviceId = 'mbzbt'; // 固定 ID
const stateTopic = `homeassistant/device_tracker/${deviceId}/state`;
const configTopic = `homeassistant/device_tracker/${deviceId}/config`;

const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000
});

let lastReportedState = null;
let consecutiveFailures = 0;

function publishDiscovery() {
    const payload = {
        name: "漫步者蓝牙",
        state_topic: stateTopic,
        unique_id: deviceId,
        payload_home: 'home',
        payload_not_home: 'not_home',
        source_type: 'bluetooth',
        icon: 'mdi:bluetooth',
        device: {
            identifiers: [deviceId],
            name: '蓝牙离线/在线扫描器',
            manufacturer: 'Custom Add-on',
            model: 'L2Ping Tracker'
        }
    };
    // 使用 retain 确保 HA 重启后能看到配置
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

function updateState(isPresent) {
    const newState = isPresent ? 'home' : 'not_home';
    
    // 只有状态发生变化时才打印日志并发布 MQTT
    if (newState !== lastReportedState) {
        const time = new Date().toLocaleTimeString();
        const statusText = isPresent ? '【在线】' : '【离线】';
        console.log(`[${time}] 状态变化: ${target_mac} -> ${statusText}`);
        
        // 启用 retain: true 确保 HA 重启后恢复状态
        client.publish(stateTopic, newState, { retain: true });
        lastReportedState = newState;
    }
}

function doScan() {
    // 强制执行 1 次 l2ping，超时时间设为 3 秒
    const cmd = `l2ping -i ${adapter_id} -c 1 -t 3 ${target_mac}`;
    
    exec(cmd, (err, stdout) => {
        const success = !err && stdout.includes('bytes from');
        
        if (success) {
            consecutiveFailures = 0;
            updateState(true);
        } else {
            consecutiveFailures++;
            // 只有连续失败次数达到阈值才判定为离线
            if (consecutiveFailures >= offline_tolerance) {
                updateState(false);
            }
        }
    });
}

client.on('connect', () => {
    console.log('MQTT 已连接');
    publishDiscovery();
    setInterval(doScan, scan_interval * 1000);
    doScan();
});

client.on('error', (err) => console.error('MQTT 错误:', err.message));
