# -ha-hand-gesture-addon、bt
 
 # 🖐️ Home Assistant 手势识别与中控联动加载项 (Hand Gesture Recognition Add-on)

[![Home Assistant Add-on](https://img.shields.io/badge/Home%20Assistant-Add--on-blue.svg?logo=home-assistant)](https://www.home-assistant.io/)
[![Google MediaPipe](https://img.shields.io/badge/Engine-Google%20MediaPipe-orange.svg?logo=google)](https://developers.google.com/mediapipe)
[![MQTT Auto Discovery](https://img.shields.io/badge/MQTT-Auto%20Discovery-brightgreen.svg?logo=mqtt)](https://www.home-assistant.io/integrations/mqtt/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 **Google MediaPipe** 神经网络视觉推理的高性能 Home Assistant 手势识别加载项。

针对家庭自动化场景（如玄关上墙平板、智能中控、家用监控 RTSP 流）深度优化，支持 **8 种高稳定低延迟手势**。内置 **MQTT 实体自动发现**、**1 秒防抖自动复位**、**静默自适应断线重连** 与 **连接状态探针**，即插即用，轻松联动【离家布防】、【灯光开关】与各类复杂场景。

---

## ✨ 核心特性

- 🎯 **8 种手势精准识别**：基于 MediaPipe 骨骼点实时识别，抗背景杂物干扰，低延迟毫秒级响应。
- 🔄 **MQTT 实体自动发现 (Auto Discovery)**：启动即自动在 Home Assistant 中注册传感器，完全告别手动编写 `configuration.yaml`。
- ⚡ **智能 1 秒防抖自动复位 (`reset_hand_status_time`)**：手势触发后保持指定时间自动重置回 `None` 空闲态，确保下一次动作无阻碍触发自动化，杜绝状态粘滞。
- 🛡️ **守护级断线自适应重连**：完美契合“玄关有人开摄像头推流、无人关流休眠”的节能机制。流断开时后台静默轮询，绝不崩溃闪退。
- 📡 **双实体健康监测**：
  - `sensor.hand_gesture_status`：手势状态传感器（纯净英文代号如 `Victory`、`Fist`，日志带 Emoji）；
  - `binary_sensor.hand_gesture_stream_connected`：RTSP 视频流连通性监测实体。

---

## 🖐️ 支持的 8 种手势列表

| 手势代号 (MQTT Payload) | 图标与名称 | 推荐应用场景 |
| :--- | :--- | :--- |
| `Victory` | ✌️ 剪刀手 / 胜利手势 | **离家模式布防** / 切换安防模式 |
| `Fist` | ✊ 握拳 | 全屋灯光一键全关 / 紧急暂停 |
| `Wave` | 👋 张开挥手 | 回家欢迎模式 / 唤醒玄关中控屏幕 |
| `Thumbs Up` | 👍 点赞 (向上大拇指) | 确认执行 / 调高空调温度 / 开灯 |
| `Thumbs Down` | 👎 踩 (向下大拇指) | 取消当前场景 / 调低空调温度 / 关灯 |
| `Point Up` | ☝️ 食指朝上指向 | 切换到下一个特定情景模式 |
| `Rock On` | 🤟 摇滚手势 | 播放喜爱的背景音乐 / 观影模式 |
| `OK` | 👌 OK 手势 | 确认执行脚本 / 开启会客模式 |
| `None` | ⭕ 无手势 (空闲态) | 自动复位待机状态 |

---

## 📦 架构工作原理

```text
┌─────────────────────────┐
│ 安卓上墙平板 / RTSP监控 │ ──(RTSP 视频流)──► ┌────────────────────────────────┐
└─────────────────────────┘                     │  Hand Gesture Recognition Add-on│
                                                │  - MediaPipe 骨骼点检测          │
                                                │  - 1s 防抖复位 (Reset to None)   │
                                                │  - 断线守护重试 (Auto Reconnect)  │
                                                └────────────────┬───────────────┘
                                                                 │
                                                       (MQTT 自动发现与状态推送)
                                                                 ▼
┌─────────────────────────┐                     ┌────────────────────────────────┐
│  Home Assistant 自动化  │ ◄──(触发手势联动)─── │       MQTT Broker (Mosquitto)  │
│  - 触发离家模式全关电器 │                     │  - sensor.hand_gesture_status  │
│  - 开启摄像头安防布防   │                     │  - binary_sensor.stream_connect│
└─────────────────────────┘                     └────────────────────────────────┘
