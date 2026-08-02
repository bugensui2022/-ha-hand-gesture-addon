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
} catch (err) {
    console.error('读取配置失败:', err.message);
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
const deviceId = 'mbzbt'; // 强制使用 mbzbt 作为 ID

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

    // 1. Device Tracker (物理在场)
    const trackerPayload = {
        name: '漫步者蓝牙',
        state_topic: stateTrackerTopic,
        unique_id: `${deviceId}_tracker`,
        payload_home: 'home',
        payload_not_home: 'not_home',
        source_type: 'bluetooth',
        device: deviceBase
    };

    // 2. Binary Sensor (蓝牙链路连接状态)
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
    // 如果正在尝试、已连接或物理上不在线，则退出
    if (isAttemptingConnection || isCurrentlyConnected || !isCurrentlyPresent) return;

    isAttemptingConnection = true;
    console.log(`[连接] 正在尝试连接设备: ${target_mac}...`);

    exec(`bluetoothctl connect ${target_mac}`, { timeout: 10000 }, async (err, stdout) => {
        isAttemptingConnection = false;
        const nowConnected = await checkConnection();
        
        if (nowConnected) {
            console.log(`[成功] 蓝牙已连接成功！`);
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
            }
        } else {
            console.log(`[重试] 连接失败，将在 2 秒后重新尝试...`);
            if (!connectionRetryTimer && isCurrentlyPresent) {
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
            console.log(`[状态] 设备进入范围: ${target_mac}`);
            client.publish(stateTrackerTopic, 'home', { retain: true });
            
            // 发现设备后，等待指定秒数尝试连接
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
            console.log(`[状态] 设备离开 (连续失败 ${presenceFailures} 次): ${target_mac}`);
            client.publish(stateTrackerTopic, 'not_home', { retain: true });
            
            // 离线后停止连接重试
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
            }
        }
    }

    // 链路连接状态检测
    const connected = await checkConnection();
    if (connected !== isCurrentlyConnected) {
        isCurrentlyConnected = connected;
        const state = connected ? 'ON' : 'OFF';
        client.publish(stateConnTopic, state, { retain: true });
        console.log(`[连接] 链路状态变更: ${connected ? '已连接' : '已断开'}`);
        
        // 如果物理在场但连接意外断开，启动自动重试
        if (isCurrentlyPresent && !connected && !connectionRetryTimer && !isAttemptingConnection) {
            tryConnect();
        }
    }
}

function scan() {
    exec(`hciconfig ${adapter_id} up`, (err) => {
        if (err) console.error(`[警告] 适配器 ${adapter_id} 启动失败:`, err.message);

        // 使用 l2ping 进行极速在场检测
        exec(`l2ping -i ${adapter_id} -c 1 -t 2 ${target_mac}`, async (err, stdout) => {
            const isPresent = !err && stdout.includes('bytes from');
            await updateStates(isPresent);
        });
    });
}

client.on('connect', () => {
    console.log('[MQTT] 已连接至 Broker');
    publishDiscovery();
    
    // 立即扫描并设置定时器
    scan();
    setInterval(scan, scan_interval * 1000);
});

client.on('error', (err) => {
    console.error('[MQTT] 错误:', err.message);
});

// 优雅退出
process.on('SIGTERM', () => {
    console.log('[系统] 收到停止信号，正在清理...');
    if (connectionRetryTimer) clearInterval(connectionRetryTimer);
    client.end(true, () => {
        console.log('[系统] 加载项已停止');
        process.exit(0);
    });
});

process.on('unhandledRejection', (reason) => {
    console.error('[错误] 未处理的异常:', reason);
});
