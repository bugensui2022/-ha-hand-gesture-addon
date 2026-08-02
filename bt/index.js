const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 蓝牙扫描加载项启动中 ---');

// 读取 HA 配置
let options;
try {
    const configPath = '/data/options.json';
    if (fs.existsSync(configPath)) {
        options = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else {
        console.error('错误: 找不到配置文件 /data/options.json');
        process.exit(1);
    }
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

// MQTT 客户端设置
const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000
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
            manufacturer: 'Custom Add-on',
            model: 'Classic BT Scanner'
        }
    };
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
    console.log(`已发送 HA 自动发现配置到: ${configTopic}`);
}

// 执行扫描
function scan() {
    exec(`hciconfig ${adapter_id} up`, (err) => {
        if (err) console.error(`警告: 无法开启适配器 ${adapter_id}:`, err.message);

        // 使用 hcitool name 扫描
        exec(`hcitool -i ${adapter_id} name ${target_mac}`, { timeout: 15000 }, (err, stdout) => {
            const isPresent = stdout && stdout.trim().length > 0;
            const state = isPresent ? 'ON' : 'OFF';
            
            console.log(`[${new Date().toLocaleTimeString()}] 扫描 ${target_mac}: ${isPresent ? '【在线】' : '【离线】'}`);
            client.publish(stateTopic, state, { retain: true });
        });
    });
}

client.on('connect', () => {
    console.log('成功连接到 MQTT Broker');
    publishDiscovery();
    scan(); 
    setInterval(scan, scan_interval * 1000);
});

client.on('error', (err) => {
    console.error('MQTT 错误:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的拒绝:', reason);
});
