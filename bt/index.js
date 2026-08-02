const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

// 读取 HA 插件配置
let options;
try {
    options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
} catch (e) {
    console.error('无法读取配置文件 /data/options.json');
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

// 唯一 ID 处理
const cleanMac = target_mac.replace(/:/g, '').toLowerCase();
const deviceId = `bt_presence_${cleanMac}`;
const stateTopic = `homeassistant/binary_sensor/${deviceId}/state`;
const configTopic = `homeassistant/binary_sensor/${deviceId}/config`;

// MQTT 客户端设置
const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000 // 自动重连
});

// 发布 HA 自动发现配置
function publishDiscovery() {
    const payload = {
        name: `蓝牙音箱在线状态 (${target_mac})`,
        device_class: 'presence',
        state_topic: stateTopic,
        unique_id: deviceId,
        payload_on: 'ON',
        payload_off: 'OFF',
        device: {
            identifiers: [deviceId],
            name: '经典蓝牙扫描器',
            manufacturer: 'Custom Add-on'
        }
    };
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

// 扫描逻辑
function scan() {
    // 确保蓝牙适配器已启动
    exec(`hciconfig ${adapter_id} up`, (err) => {
        if (err) console.error(`无法启动蓝牙适配器 ${adapter_id}:`, err.message);

        // 使用 hcitool name 获取设备名称，如果能获取到说明设备在场
        // 这种方式不需要配对，只要设备在广播/可见范围内即可
        exec(`hcitool -i ${adapter_id} name ${target_mac}`, { timeout: 15000 }, (err, stdout) => {
            const isPresent = stdout && stdout.trim().length > 0;
            const state = isPresent ? 'ON' : 'OFF';
            
            console.log(`[${new Date().toLocaleTimeString()}] 扫描 ${target_mac}: ${isPresent ? '在线' : '离线'}`);
            client.publish(stateTopic, state, { retain: true });
        });
    });
}

client.on('connect', () => {
    console.log('已连接至 MQTT 服务器');
    publishDiscovery();
    // 立即执行一次扫描
    scan();
    // 定时扫描
    setInterval(scan, scan_interval * 1000);
});

client.on('error', (err) => {
    console.error('MQTT 连接错误:', err);
});
