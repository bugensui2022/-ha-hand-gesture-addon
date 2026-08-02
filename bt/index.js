const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

// 读取 HA 加载项配置
let options;
try {
    options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
} catch (e) {
    console.error('无法从 /data/options.json 读取配置');
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

// MQTT 连接配置
const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000 // 5秒自动重连
});

// 发布 HA 自动发现配置
function publishDiscovery() {
    const payload = {
        name: `蓝牙在线状态 (${target_mac})`,
        device_class: 'presence',
        state_topic: stateTopic,
        unique_id: deviceId,
        payload_on: 'ON',
        payload_off: 'OFF',
        device: {
            identifiers: [deviceId],
            name: '蓝牙离线/在线扫描器',
            manufacturer: 'Custom Add-on'
        }
    };
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

// 执行蓝牙扫描
function scan() {
    // 确保适配器已启动
    exec(`hciconfig ${adapter_id} up`, (err) => {
        if (err) console.error(`启动适配器 ${adapter_id} 失败:`, err);

        // 使用经典蓝牙 hcitool 扫描
        exec(`hcitool -i ${adapter_id} name ${target_mac}`, { timeout: 10000 }, (err, stdout) => {
            const isPresent = stdout && stdout.trim().length > 0;
            const state = isPresent ? 'ON' : 'OFF';
            
            console.log(`[${new Date().toLocaleTimeString()}] 扫描 ${target_mac}: ${state}`);
            client.publish(stateTopic, state, { retain: true });
        });
    });
}

client.on('connect', () => {
    console.log('已连接到 MQTT Broker');
    publishDiscovery();
    
    // 立即执行一次扫描
    scan();
    
    // 设置定时循环扫描
    setInterval(scan, scan_interval * 1000);
});

client.on('error', (err) => {
    console.error('MQTT 错误:', err);
});
