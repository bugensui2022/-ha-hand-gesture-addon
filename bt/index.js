const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 蓝牙在场追踪与自动连接加载项启动 ---');

// 读取 HA 加载项配置
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
    offline_tolerance = 3,
    connection_delay = 2,
    adapter_id = 'hci0'
} = options;

const targetMacLower = target_mac.toLowerCase();
const deviceId = 'mbzbt';

// MQTT Topics
const discoveryTrackerTopic = `homeassistant/device_tracker/${deviceId}/config`;
const stateTrackerTopic = `homeassistant/device_tracker/${deviceId}/state`;

const discoveryConnTopic = `homeassistant/binary_sensor/${deviceId}_conn/config`;
const stateConnTopic = `homeassistant/binary_sensor/${deviceId}_conn/state`;

// 内部状态记录
let presenceFailures = 0;
let isCurrentlyPresent = false;
let isCurrentlyConnected = false;
let isAttemptingConnection = false;
let connectionRetryTimer = null;

// MQTT 连接
const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000,
    will: {
        topic: stateTrackerTopic,
        payload: 'not_home',
        retain: true
    }
});

function publishDiscovery() {
    const deviceBase = {
        identifiers: [deviceId],
        name: '漫步者蓝牙',
        manufacturer: 'Custom Add-on',
        model: 'L2Ping Presence Tracker'
    };

    // 1. Device Tracker (Presence)
    const trackerPayload = {
        name: '漫步者蓝牙',
        state_topic: stateTrackerTopic,
        unique_id: deviceId,
        payload_home: 'home',
        payload_not_home: 'not_home',
        source_type: 'bluetooth',
        device: deviceBase
    };

    // 2. Binary Sensor (Connection)
    const connPayload = {
        name: '漫步者蓝牙连接状态',
        state_topic: stateConnTopic,
        unique_id: `${deviceId}_connected`,
        device_class: 'connectivity',
        payload_on: 'ON',
        payload_off: 'OFF',
        device: deviceBase
    };

    client.publish(discoveryTrackerTopic, JSON.stringify(trackerPayload), { retain: true });
    client.publish(discoveryConnTopic, JSON.stringify(connPayload), { retain: true });
    
    console.log(`[MQTT] 已发送 Home Assistant 自动发现配置 (device_tracker.mbzbt)`);
}

function checkConnection() {
    return new Promise((resolve) => {
        exec(`hcitool -i ${adapter_id} con`, (err, stdout) => {
            if (err) {
                resolve(false);
                return;
            }
            const connected = stdout.toLowerCase().includes(targetMacLower);
            resolve(connected);
        });
    });
}

function tryConnect() {
    if (isAttemptingConnection || isCurrentlyConnected) return;

    isAttemptingConnection = true;
    console.log(`[连接] 尝试连接到设备 ${target_mac}...`);

    exec(`bluetoothctl connect ${target_mac}`, { timeout: 10000 }, async (err, stdout) => {
        isAttemptingConnection = false;
        const nowConnected = await checkConnection();
        
        if (nowConnected) {
            console.log(`[成功] 已成功建立蓝牙连接！`);
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
            }
        } else {
            console.log(`[失败] 连接尝试未成功，2秒后重试...`);
            if (!connectionRetryTimer) {
                connectionRetryTimer = setInterval(tryConnect, 2000);
            }
        }
    });
}

async function updateStates(isPresent) {
    // 物理在场逻辑（带容错）
    if (isPresent) {
        presenceFailures = 0;
        if (!isCurrentlyPresent) {
            isCurrentlyPresent = true;
            console.log(`[状态] 设备上线: ${target_mac}`);
            client.publish(stateTrackerTopic, 'home', { retain: true });
            
            // 上线后，等待指定秒数尝试连接
            setTimeout(() => {
                if (isCurrentlyPresent && !isCurrentlyConnected) {
                    tryConnect();
                }
            }, connection_delay * 1000);
        }
    } else {
        presenceFailures++;
        if (presenceFailures >= offline_tolerance && isCurrentlyPresent) {
            isCurrentlyPresent = false;
            console.log(`[状态] 设备离线 (已连续失败 ${presenceFailures} 次): ${target_mac}`);
            client.publish(stateTrackerTopic, 'not_home', { retain: true });
            
            // 离线后停止连接重试
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
            }
        }
    }

    // 连接状态逻辑
    const connected = await checkConnection();
    if (connected !== isCurrentlyConnected) {
        isCurrentlyConnected = connected;
        const state = connected ? 'ON' : 'OFF';
        client.publish(stateConnTopic, state, { retain: true });
        console.log(`[连接] 状态变更: ${connected ? '已连接' : '已断开'}`);
        
        // 如果物理在场但连接断开，且没有在重试，则开始重试
        if (isCurrentlyPresent && !connected && !connectionRetryTimer && !isAttemptingConnection) {
            tryConnect();
        }
    }
}

function scan() {
    // 确保适配器处于 UP 状态
    exec(`hciconfig ${adapter_id} up`, (err) => {
        if (err) console.error(`[警告] 无法开启适配器 ${adapter_id}:`, err.message);

        // 使用 l2ping 进行极速检测
        exec(`l2ping -i ${adapter_id} -c 1 -t 2 ${target_mac}`, async (err, stdout) => {
            const isPresent = !err && stdout.includes('bytes from');
            await updateStates(isPresent);
        });
    });
}

client.on('connect', () => {
    console.log('[MQTT] 成功连接到 Broker');
    publishDiscovery();
    scan();
    setInterval(scan, scan_interval * 1000);
});

client.on('error', (err) => {
    console.error('[MQTT] 错误:', err.message);
});

// 优雅退出处理
process.on('SIGTERM', () => {
    console.log('[系统] 收到 SIGTERM，正在关闭...');
    if (connectionRetryTimer) clearInterval(connectionRetryTimer);
    client.end(true, () => {
        console.log('[系统] 已断开 MQTT，正常退出');
        process.exit(0);
    });
});
