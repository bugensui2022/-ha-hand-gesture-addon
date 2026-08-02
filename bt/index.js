const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 蓝牙追踪加载项 1.0.8 启动 ---');

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
const objectId = 'mbzbt'; // 建议 HA 生成 device_tracker.mbzbt
const uniqueId = `bt_tracker_${target_mac.replace(/:/g, '').toLowerCase()}`;
const stateTopic = `homeassistant/device_tracker/${objectId}/state`;
const configTopic = `homeassistant/device_tracker/${objectId}/config`;

// 状态追踪
let isPresent = false;
let failCount = 0;
let lastReportedState = null;

const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000
});

function publishDiscovery() {
    const payload = {
        name: "漫步者蓝牙",
        state_topic: stateTopic,
        unique_id: uniqueId,
        object_id: objectId,
        payload_home: 'home',
        payload_not_home: 'not_home',
        source_type: 'bluetooth',
        icon: 'mdi:bluetooth-connect',
        device: {
            identifiers: [uniqueId],
            name: '蓝牙离线/在线扫描器',
            manufacturer: 'Custom Add-on',
            model: 'L2Ping Tracker'
        }
    };
    // 使用 retain: true 发送配置，确保 HA 重启后能找回实体定义
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
    console.log(`[配置] 已发送 HA 发现协议到: ${configTopic}`);
}

function updateState(newState) {
    // 只有状态发生变化时才发布，减少不必要的 MQTT 流量
    // newState 为 'home' 或 'not_home'
    if (newState !== lastReportedState) {
        // 使用 retain: true 发送状态，确保 HA 重启后能找回最后的状态
        client.publish(stateTopic, newState, { retain: true });
        lastReportedState = newState;
        console.log(`[状态更新] 漫步者蓝牙 -> ${newState === 'home' ? '【在线 (home)】' : '【离线 (not_home)】'}`);
    }
}

function scan() {
    // 使用 l2ping 进行快速检测 (-c 1 表示只发一个包，-t 2 表示2秒超时)
    exec(`l2ping -i ${adapter_id} -c 1 -t 2 ${target_mac}`, (err, stdout) => {
        const success = !err;

        if (success) {
            // 即时上线逻辑
            failCount = 0;
            if (!isPresent) {
                isPresent = true;
                updateState('home');
            }
        } else {
            // 离线容错逻辑
            if (isPresent) {
                failCount++;
                if (failCount >= offline_tolerance) {
                    isPresent = false;
                    updateState('not_home');
                } else {
                    console.log(`[容错] 扫描失败 (${failCount}/${offline_tolerance})，等待重试...`);
                }
            }
        }
    });
}

client.on('connect', () => {
    console.log('成功连接到 MQTT Broker');
    publishDiscovery();
    
    // 初始状态设为未知，强制触发第一次发布
    lastReportedState = null;
    
    // 启动循环扫描
    setInterval(scan, scan_interval * 1000);
});

client.on('error', (err) => {
    console.error('MQTT 错误:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('未处理的异常:', reason);
});
