const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

console.log('--- 蓝牙在场追踪与自动连接加载项已启动 (v1.1.6) ---');

// 1. 读取配置
let options;
try {
    const configPath = '/data/options.json';
    if (fs.existsSync(configPath)) {
        options = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else {
        console.error('[错误] 找不到配置文件 /data/options.json，请确认加载项配置是否保存');
        process.exit(1);
    }
} catch (e) {
    console.error('[错误] 解析配置文件失败:', e.message);
    process.exit(1);
}

const {
    mqtt_host, mqtt_port, mqtt_user, mqtt_password,
    target_mac, scan_interval, offline_tolerance = 3,
    connection_delay = 2, adapter_id = 'hci0'
} = options;

const targetMacLower = target_mac.toLowerCase();
const deviceId = 'mbzbt'; // 固定 ID 方便管理

// MQTT 主题
const discoveryTrackerTopic = `homeassistant/device_tracker/${deviceId}/config`;
const stateTrackerTopic = `homeassistant/device_tracker/${deviceId}/state`;
const discoveryConnTopic = `homeassistant/binary_sensor/${deviceId}_conn/config`;
const stateConnTopic = `homeassistant/binary_sensor/${deviceId}_conn/state`;

// 内部状态
let presenceFailures = 0;
let isCurrentlyPresent = false;
let isCurrentlyConnected = false;
let isAttemptingConnection = false;
let connectionRetryTimer = null;

// 2. MQTT 连接
const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000,
    will: { topic: stateTrackerTopic, payload: 'not_home', retain: true }
});

// 发送 HA 自动发现配置
function publishDiscovery() {
    const deviceBase = {
        identifiers: [deviceId],
        name: '蓝牙离线/在线扫描器',
        manufacturer: 'Custom Add-on',
        model: 'L2Ping Presence Engine'
    };

    // 在场追踪器
    const trackerPayload = {
        name: '漫步者蓝牙',
        state_topic: stateTrackerTopic,
        unique_id: deviceId,
        payload_home: 'home',
        payload_not_home: 'not_home',
        source_type: 'bluetooth',
        device: deviceBase
    };

    // 连接状态传感器
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
    console.log(`[MQTT] 已发送自动发现配置到 Home Assistant`);
}

// 检查实际蓝牙连接情况
function checkConnection() {
    return new Promise((resolve) => {
        exec(`hcitool -i ${adapter_id} con`, (err, stdout) => {
            if (err) return resolve(false);
            resolve(stdout.toLowerCase().includes(targetMacLower));
        });
    });
}

// 执行连接动作
function doConnectAction() {
    if (isAttemptingConnection || isCurrentlyConnected) return;

    isAttemptingConnection = true;
    console.log(`[连接] 正在尝试建立蓝牙物理连接: ${target_mac}...`);

    exec(`bluetoothctl connect ${target_mac}`, { timeout: 10000 }, async (err) => {
        isAttemptingConnection = false;
        const nowConnected = await checkConnection();
        
        if (nowConnected) {
            console.log(`[成功] 蓝牙已连接成功！`);
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
            }
        } else {
            console.log(`[重试] 连接未成功，2秒后将再次尝试重连...`);
            if (!connectionRetryTimer) {
                connectionRetryTimer = setInterval(doConnectAction, 2000);
            }
        }
    });
}

// 更新所有状态
async function updateAllStates(isPresent) {
    // 1. 在场逻辑
    if (isPresent) {
        presenceFailures = 0;
        if (!isCurrentlyPresent) {
            isCurrentlyPresent = true;
            console.log(`[在线] 发现设备 ${target_mac} 在场`);
            client.publish(stateTrackerTopic, 'home', { retain: true });
            
            // 发现后，等待 connection_delay 秒主动连接
            setTimeout(() => {
                if (isCurrentlyPresent && !isCurrentlyConnected) {
                    doConnectAction();
                }
            }, connection_delay * 1000);
        }
    } else {
        presenceFailures++;
        if (presenceFailures >= offline_tolerance && isCurrentlyPresent) {
            isCurrentlyPresent = false;
            console.log(`[离线] 设备已消失 (重试 ${presenceFailures} 次失败): ${target_mac}`);
            client.publish(stateTrackerTopic, 'not_home', { retain: true });
            
            // 彻底离线，停止一切重连计时器
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
            }
        }
    }

    // 2. 连接状态逻辑
    const connected = await checkConnection();
    if (connected !== isCurrentlyConnected) {
        isCurrentlyConnected = connected;
        client.publish(stateConnTopic, connected ? 'ON' : 'OFF', { retain: true });
        console.log(`[连接状态] 变更: ${connected ? '已建立连接' : '连接已断开'}`);
        
        // 如果人在但连接断了，且没在重试中，立即启动重试
        if (isCurrentlyPresent && !connected && !connectionRetryTimer && !isAttemptingConnection) {
            doConnectAction();
        }
    }
}

// 主循环：l2ping 扫描
function performScan() {
    // 确保 hci0 开启
    exec(`hciconfig ${adapter_id} up`, () => {
        // 使用 l2ping 检测
        exec(`l2ping -i ${adapter_id} -c 1 -t 2 ${target_mac}`, async (err, stdout) => {
            const isPresent = !err && stdout && stdout.includes('bytes from');
            await updateAllStates(isPresent);
        });
    });
}

client.on('connect', () => {
    console.log('[MQTT] 成功连接至 Mosquitto Broker');
    publishDiscovery();
    performScan();
    setInterval(performScan, scan_interval * 1000);
});

client.on('error', (err) => console.error('[MQTT] 错误:', err.message));

// 优雅退出
process.on('SIGTERM', () => {
    console.log('[系统] 收到停止信号，正在关闭...');
    if (connectionRetryTimer) clearInterval(connectionRetryTimer);
    client.end(true, () => process.exit(0));
});
