const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

// 统一日志格式化函数
function getTimestamp() {
    return new Date().toLocaleString('zh-CN', { hour12: false });
}

function log(msg) {
    console.log(`[${getTimestamp()}] ${msg}`);
}

function error(msg) {
    console.error(`[${getTimestamp()}] [错误] ${msg}`);
}

log('--- 蓝牙在场追踪与自动连接加载项已启动 (v1.1.7) ---');

// 1. 读取配置
let options;
try {
    const configPath = '/data/options.json';
    if (fs.existsSync(configPath)) {
        options = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else {
        error('找不到配置文件 /data/options.json');
        process.exit(1);
    }
} catch (e) {
    error(`解析配置文件失败: ${e.message}`);
    process.exit(1);
}

const {
    mqtt_host, mqtt_port, mqtt_user, mqtt_password,
    target_mac, scan_interval, offline_tolerance = 3,
    connection_delay = 2, adapter_id = 'hci0'
} = options;

const targetMacLower = target_mac.toLowerCase();
const deviceId = 'mbzbt';

// MQTT 主题
const discoveryTrackerTopic = `homeassistant/device_tracker/${deviceId}/config`;
const stateTrackerTopic = `homeassistant/device_tracker/${deviceId}/state`;
const discoveryConnTopic = `homeassistant/binary_sensor/${deviceId}_conn/config`;
const stateConnTopic = `homeassistant/binary_sensor/${deviceId}_conn/state`;

// 内部状态
let presenceFailures = 0;
let isCurrentlyPresent = false;

let isCurrentlyConnected = false;
let connectionStableCount = 0; // 用于平滑连接状态变更

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
        name: '蓝牙扫描器',
        manufacturer: 'Custom Add-on',
        model: 'L2Ping Engine v1.1.7'
    };

    const trackerPayload = {
        name: '漫步者蓝牙',
        state_topic: stateTrackerTopic,
        unique_id: deviceId,
        payload_home: 'home',
        payload_not_home: 'not_home',
        source_type: 'bluetooth',
        device: deviceBase
    };

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
    log(`[MQTT] 已发送自动发现配置到 Home Assistant`);
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
    // 前置条件检查：不在场或已连接或正忙，则不执行
    if (!isCurrentlyPresent || isCurrentlyConnected || isAttemptingConnection) {
        if (!isCurrentlyPresent && connectionRetryTimer) {
            clearInterval(connectionRetryTimer);
            connectionRetryTimer = null;
        }
        return;
    }

    isAttemptingConnection = true;
    log(`[连接] 正在发起物理连接请求: ${target_mac}...`);

    exec(`bluetoothctl connect ${target_mac}`, { timeout: 10000 }, async (err) => {
        isAttemptingConnection = false;
        const nowConnected = await checkConnection();
        
        if (nowConnected) {
            log(`[成功] 蓝牙物理连接已建立`);
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
            }
        } else if (isCurrentlyPresent) {
            log(`[重试] 连接失败，将在 2 秒后重试...`);
            if (!connectionRetryTimer) {
                connectionRetryTimer = setInterval(doConnectAction, 2000);
            }
        }
    });
}

// 核心逻辑：状态机更新
async function updateAllStates(isPresent) {
    // 1. 物理在场逻辑 (l2ping)
    if (isPresent) {
        presenceFailures = 0;
        if (!isCurrentlyPresent) {
            isCurrentlyPresent = true;
            log(`[在线] 发现设备 ${target_mac}`);
            client.publish(stateTrackerTopic, 'home', { retain: true });
            
            // 发现后延迟尝试连接
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
            log(`[离线] 设备已消失 (连续 ${presenceFailures} 次失败)`);
            client.publish(stateTrackerTopic, 'not_home', { retain: true });
            
            // 清理一切重连逻辑
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
            }
        }
    }

    // 2. 连接状态逻辑 (hcitool con)
    const rawConnected = await checkConnection();
    
    // 【关键修复】如果物理判定不在场，强制认为连接已断开，防止系统缓存导致的反复横跳
    const filteredConnected = isCurrentlyPresent ? rawConnected : false;

    if (filteredConnected !== isCurrentlyConnected) {
        connectionStableCount++;
        // 【关键修复】连续 3 次检测结果一致才更新状态，过滤噪音
        if (connectionStableCount >= 3) {
            isCurrentlyConnected = filteredConnected;
            connectionStableCount = 0;
            client.publish(stateConnTopic, isCurrentlyConnected ? 'ON' : 'OFF', { retain: true });
            log(`[连接状态] 变更: ${isCurrentlyConnected ? '已连接' : '已断开'}`);
            
            // 补偿逻辑：如果人在但由于某种原因断连了，启动自动重连
            if (isCurrentlyPresent && !isCurrentlyConnected && !connectionRetryTimer && !isAttemptingConnection) {
                doConnectAction();
            }
        }
    } else {
        connectionStableCount = 0;
    }
}

// 主扫描任务
function performScan() {
    exec(`hciconfig ${adapter_id} up`, () => {
        exec(`l2ping -i ${adapter_id} -c 1 -t 2 ${target_mac}`, async (err, stdout) => {
            const isPresent = !err && stdout && stdout.includes('bytes from');
            await updateAllStates(isPresent);
        });
    });
}

client.on('connect', () => {
    log('[MQTT] 已连接');
    publishDiscovery();
    performScan();
    setInterval(performScan, scan_interval * 1000);
});

client.on('error', (err) => error(`MQTT 异常: ${err.message}`));

process.on('SIGTERM', () => {
    log('正在安全关闭...');
    if (connectionRetryTimer) clearInterval(connectionRetryTimer);
    client.end(true, () => process.exit(0));
});
