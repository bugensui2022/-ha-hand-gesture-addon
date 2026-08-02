const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('======================================');
console.log('   蓝牙经典在线扫描插件 (v1.0.5) 启动中');
console.log('======================================');

// 读取 HA 插件配置
const CONFIG_PATH = '/data/options.json';
let options = {};

if (fs.existsSync(CONFIG_PATH)) {
    try {
        options = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        console.log('成功加载配置文件');
    } catch (e) {
        console.error('解析配置文件失败:', e.message);
        process.exit(1);
    }
} else {
    console.error('未找到配置文件 /data/options.json，请确认插件设置已保存');
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

// MQTT 选项
const mqttOptions = {
    port: mqtt_port || 1883,
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000
};

console.log(`尝试连接到 MQTT Broker: ${mqtt_host}:${mqtt_port}`);
const client = mqtt.connect(`mqtt://${mqtt_host}`, mqttOptions);

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
    console.log(`已发布 HA 实体发现信息`);
}

function scan() {
    // 强制开启蓝牙适配器
    exec(`hciconfig ${adapter_id} up`, (err) => {
        if (err) {
            console.error(`[${new Date().toLocaleTimeString()}] 警告: 无法重置 ${adapter_id}: ${err.message}`);
        }

        // 核心扫描命令：hcitool name 会尝试获取设备名称，如果设备在线则能获取到
        exec(`hcitool -i ${adapter_id} name ${target_mac}`, { timeout: 15000 }, (err, stdout) => {
            const isPresent = stdout && stdout.trim().length > 0;
            const state = isPresent ? 'ON' : 'OFF';
            
            console.log(`[${new Date().toLocaleTimeString()}] 扫描 ${target_mac} -> ${isPresent ? '【在线】' : '【离线】'}`);
            client.publish(stateTopic, state, { retain: true });
        });
    });
}

client.on('connect', () => {
    console.log('MQTT 连接成功！');
    publishDiscovery();
    // 首次执行
    scan();
    // 循环执行
    setInterval(scan, (scan_interval || 30) * 1000);
});

client.on('error', (err) => {
    console.error('MQTT 连接错误:', err.message);
});

client.on('offline', () => {
    console.log('MQTT 已掉线，等待重连...');
});

// 处理系统信号
process.on('SIGTERM', () => {
    console.log('收到停止信号，正在关闭...');
    process.exit(0);
});
