const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

// 带时间戳的中文日志函数
function log(msg) {
    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    console.log(`[${now}] ${msg}`);
}

log('--- 蓝牙在场追踪与自动连接加载项已启动 (v1.1.7) ---');

// 1. 读取配置
let options;
try {
    const configPath = '/data/options.json';
    if (fs.existsSync(configPath)) {
        options = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else {
        console.error('[错误] 找不到配置文件 /data/options.json');
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
let isAttemptingConnection = false;
let connectionRetryTimer = null;

// 2. MQTT 连接
const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined,
    reconnectPeriod: 5000,
    will: { topic: stateTrackerTopic, payload: 'not_home', retain: true }
});

function publishDiscovery() {
    const deviceBase = {
        identifiers: [deviceId],
        name: '蓝牙离线/在线扫描器',
        manufacturer: 'Custom Add-on',
        model: 'L2Ping Presence Engine'
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

// 执行连接动作 (只有在物理在场时才被允许)
function doConnectAction() {
    if (!isCurrentlyPresent || isAttemptingConnection || isCurrentlyConnected) {
        if (connectionRetryTimer && !isCurrentlyPresent) {
            clearInterval(connectionRetryTimer);
            connectionRetryTimer = null;
        }
        return;
    }

    isAttemptingConnection = true;
    log(`[连接] 正在尝试建立蓝牙物理连接: ${target_mac}...`);

    exec(`bluetoothctl connect ${target_mac}`, { timeout: 10000 }, async (err) => {
        isAttemptingConnection = false;
        
        // 动作完成后，再次检查是否还在场
        if (!isCurrentlyPresent) {
            log(`[连接] 连接过程中设备已离线，中止后续重试`);
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
            }
            return;
        }

        const nowConnected = await checkConnection();
        if (nowConnected) {
            log(`[成功] 蓝牙已成功建立连接！`);
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
            }
        } else {
            log(`[重试] 连接未成功，2秒后将再次尝试重连...`);
            if (!connectionRetryTimer && isCurrentlyPresent) {
                connectionRetryTimer = setInterval(doConnectAction, 2000);
            }
        }
    });
}

// 核心逻辑：状态更新
async function updateAllStates(isPresent) {
    // A. 物理在场逻辑
    if (isPresent) {
        presenceFailures = 0;
        if (!isCurrentlyPresent) {
            isCurrentlyPresent = true;
            log(`[在线] 发现设备 ${target_mac} 在场`);
            client.publish(stateTrackerTopic, 'home', { retain: true });
            
            // 物理上线后，延迟尝试连接
            setTimeout(() => {
                if (isCurrentlyPresent && !isCurrentlyConnected && !isAttemptingConnection) {
                    doConnectAction();
                }
            }, connection_delay * 1000);
        }
    } else {
        presenceFailures++;
        if (presenceFailures >= offline_tolerance && isCurrentlyPresent) {
            isCurrentlyPresent = false;
            log(`[离线] 设备已彻底消失: ${target_mac}`);
            client.publish(stateTrackerTopic, 'not_home', { retain: true });
            
            // --- 关键修复：物理离线立即强制同步连接状态 ---
            if (isCurrentlyConnected) {
                isCurrentlyConnected = false;
                client.publish(stateConnTopic, 'OFF', { retain: true });
                log(`[连接] 物理离线触发强制断开，连接状态同步为：OFF`);
            }
            
            // 停止一切重连计时器
            if (connectionRetryTimer) {
                clearInterval(connectionRetryTimer);
                connectionRetryTimer = null;
                log(`[系统] 已销毁重连循环计时器`);
            }
            return; // 离线状态下不再执行后续的连接检查
        }
    }

    // B. 连接状态逻辑 (仅在物理在场时执行)
    if (isCurrentlyPresent) {
        const connected = await checkConnection();
        if (connected !== isCurrentlyConnected) {
            isCurrentlyConnected = connected;
            client.publish(stateConnTopic, connected ? 'ON' : 'OFF', { retain: true });
            log(`[连接状态] 变更: ${connected ? '连接已建立' : '连接已断开'}`);
            
            // 如果物理在场但连接意外断开，且不在重试中，重新启动重连流程
            if (!connected && !connectionRetryTimer && !isAttemptingConnection) {
                log(`[系统] 检测到连接断开，延迟 ${connection_delay}秒后启动重连...`);
                setTimeout(() => {
                    if (isCurrentlyPresent && !isCurrentlyConnected) {
                        doConnectAction();
                    }
                }, connection_delay * 1000);
            }
        }
    }
}

// 主循环
function performScan() {
    exec(`hciconfig ${adapter_id} up`, () => {
        exec(`l2ping -i ${adapter_id} -c 1 -t 2 ${target_mac}`, async (err, stdout) => {
            const isPresent = !err && stdout && stdout.includes('bytes from');
            await updateAllStates(isPresent);
        });
    });
}

client.on('connect', () => {
    log('[MQTT] 成功连接至 Mosquitto Broker');
    publishDiscovery();
    performScan();
    setInterval(performScan, scan_interval * 1000);
});

client.on('error', (err) => log(`[MQTT] 错误: ${err.message}`));

process.on('SIGTERM', () => {
    log('[系统] 收到停止信号，正在关闭...');
    if (connectionRetryTimer) clearInterval(connectionRetryTimer);
    client.end(true, () => process.exit(0));
});
