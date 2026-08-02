const mqtt = require('mqtt');
const { exec } = require('child_process');
const fs = require('fs');

// Read HA Add-on configuration
const options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));

const {
    mqtt_host,
    mqtt_port,
    mqtt_user,
    mqtt_password,
    target_mac,
    scan_interval,
    adapter_id
} = options;

const deviceId = `bt_presence_${target_mac.replace(/:/g, '').toLowerCase()}`;
const stateTopic = `homeassistant/binary_sensor/${deviceId}/state`;
const configTopic = `homeassistant/binary_sensor/${deviceId}/config`;

// MQTT Connection
const client = mqtt.connect(`mqtt://${mqtt_host}:${mqtt_port}`, {
    username: mqtt_user || undefined,
    password: mqtt_password || undefined
});

function publishDiscovery() {
    const payload = {
        name: `Bluetooth Presence ${target_mac}`,
        device_class: 'presence',
        state_topic: stateTopic,
        unique_id: deviceId,
        payload_on: 'ON',
        payload_off: 'OFF',
        device: {
            identifiers: [deviceId],
            name: 'Bluetooth Presence Scanner',
            manufacturer: 'Custom Add-on'
        }
    };
    client.publish(configTopic, JSON.stringify(payload), { retain: true });
}

function scan() {
    // Bring up the adapter just in case
    exec(`hciconfig ${adapter_id} up`, (err) => {
        if (err) console.error(`Error bringing up ${adapter_id}:`, err);

        // Classic Bluetooth scan using hcitool name
        // This attempts to get the friendly name of the device
        exec(`hcitool -i ${adapter_id} name ${target_mac}`, (err, stdout) => {
            const isPresent = stdout.trim().length > 0;
            const state = isPresent ? 'ON' : 'OFF';
            
            console.log(`[${new Date().toLocaleTimeString()}] Scanning ${target_mac} on ${adapter_id}: ${state}`);
            client.publish(stateTopic, state, { retain: true });
        });
    });
}

client.on('connect', () => {
    console.log('Connected to MQTT broker');
    publishDiscovery();
    
    // Initial scan
    scan();
    
    // Periodic scan
    setInterval(scan, scan_interval * 1000);
});

client.on('error', (err) => {
    console.error('MQTT Error:', err);
});
