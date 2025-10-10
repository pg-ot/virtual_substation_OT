# Virtual Substation - IEC 61850 GOOSE Communication System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Linux-blue.svg)](https://www.linux.org/)
[![IEC 61850](https://img.shields.io/badge/Standard-IEC%2061850-green.svg)](https://en.wikipedia.org/wiki/IEC_61850)

A complete virtual substation implementation demonstrating IEC 61850 GOOSE (Generic Object Oriented Substation Event) communication between Protection IED and Breaker IED using libiec61850 library.
A complete virtual substation implementation demonstrating IEC 61850 GOOSE (Generic Object Oriented Substation Event) communication between Protection IED and Breaker IED using libiec61850 library. The environment is intentionally self-contained so that control engineers and OT security teams can explore how GOOSE behaves, how permissions impact data sharing, and how adversarial conditions might disrupt coordination without touching production infrastructure.

> ⚠️ **Disclaimer**
>
> This repository is intended for educational experimentation only. The included publisher and subscriber do **not** produce or consume IEC 61850-compliant GOOSE datasets, the configuration revision embedded in the messages diverges from the provided SCL model, and the default heartbeat interval conflicts with the advertised `TimeAllowedToLive`. Do not rely on this code for standards-compliant interoperability or any safety-critical application without substantial rework of the data model and implementation.

## 🚀 Quick Start

```bash
git clone https://github.com/yourusername/virtual-substation.git
cd virtual-substation
./install.sh

# Terminal 1 - Protection IED
sudo ./start_protection.sh eth0

# Terminal 2 - Breaker IED  
sudo ./start_breaker.sh eth0

# Stop all
./stop_all.sh
```

## Project Overview

This project simulates a simplified substation protection system where:
- **Protection IED** detects faults and sends trip/close commands via GOOSE messages
- **Breaker IED** receives commands and operates the circuit breaker accordingly
- Communication follows IEC 61850-8-1 standard with proper timing sequences
- Communication mimics IEC 61850-8-1 messaging for demonstration purposes only, but the setup is also suited to OT security exercises such as practicing traffic capture/analysis, evaluating least-privilege boundaries, and rehearsing incident response playbooks for misbehaving IEDs.

## System Architecture

```
┌─────────────────┐    GOOSE Messages    ┌─────────────────┐
│  Protection IED │ ──────────────────► │   Breaker IED   │
│   (Publisher)   │   Ethernet/VLAN     │  (Subscriber)   │
│                 │                     │                 │
│ • Fault Detection│                     │ • Trip/Close    │
│ • Trip Commands │                     │ • Status Display│
│ • Measurements  │                     │ • Breaker Ctrl  │
└─────────────────┘                     └─────────────────┘
```

## GOOSE Message Content

The protection system transmits the following data:

| Data Point | Type | Description | Example |
|------------|------|-------------|----------|
| Trip Command | Boolean | Circuit breaker trip signal | true/false |
| Close Command | Boolean | Circuit breaker close signal | true/false |
| Fault Type | Integer | 0=No Fault, 1=Overcurrent, 2=Differential, 3=Distance | 0 |
| Protection Element | Integer | IEEE device number (e.g., 50, 87, 21) | 50 |
| Fault Current | Float | Measured fault current in Amperes | 1250.5 |
@@ -105,63 +109,70 @@ sudo ./goose_publisher_example <interface>
```bash
ip link show  # List all interfaces
# Common: eth0, enp0s3, enp0s8, wlan0
```

## GUI Features

### Protection IED GUI (Publisher)
- **Trip/Close Commands:** Toggle switches for breaker control
- **Fault Configuration:** Dropdown for fault types (No Fault/Overcurrent/Differential/Distance)
- **Live Measurements:** Color-coded sliders for Current (0-5000A), Voltage (0-15kV), Frequency (45-55Hz)
  - **Green:** Normal operating range
  - **Yellow:** Abnormal but non-tripping range  
  - **Red:** Fault range that triggers protection
- **Protection Logic:** Automatic fault detection and trip commands
- **Real-time Publishing:** Dynamic GOOSE message generation based on GUI inputs
- **Auto-start:** Automatically begins publishing when launched by start script

### Breaker IED GUI (Subscriber)
- **Command Display:** Visual indicators for received Trip/Close commands
- **Breaker Status:** Animated breaker position (Open/Closed)
- **Fault Information:** Real-time display of fault type and protection element
- **Measurements:** Live display of current, voltage, and frequency
- **Connection Status:** Timestamp of last received message

## IEC 61850 Compliance Notes

Although the project draws on libiec61850 and exchanges GOOSE frames, several aspects intentionally diverge from the IEC 61850-8-1 standard and the provided SCL configuration:

- **Dataset structure mismatch:** The publisher encodes a seven-element mix of boolean, integer, and float values, whereas the SCL `AnalogValues` dataset models four `MV` measurements that include magnitude, quality, and timestamp members. Standards-compliant subscribers will therefore reject these messages.
- **Configuration revision inconsistency:** The hard-coded `GoCBRef` advertises `ConfRev=1`, but the SCL model defines `confRev="2"`, causing compliant clients to treat the traffic as stale.
- **Heartbeat timing conflict:** The idle retransmission interval is 1000 ms even though `TimeAllowedToLive` is set to 500 ms, so conforming subscribers will flag the messages as expired mid-cycle.

Any deployment that requires interoperability with other IEC 61850 equipment must reconcile these discrepancies (for example by updating the SCL model, adjusting the publisher/subscriber payloads, and aligning retransmission timing) before attempting integration.

## OT Security Use Cases

### GOOSE Timing (IEC 61850-8-1)
- **Fast Retransmission:** 4ms intervals for first 3 messages after state change
- **Stabilization:** 100ms intervals for next few messages
- **Heartbeat:** 1000ms intervals during normal operation
- **Time to Live:** 500ms for message validity
While the data model is simplified, the project offers a convenient sandbox for cyber-physical security research and training:

### Network Configuration
- **Application ID:** 1000 (Protection)
- **Destination MAC:** 01:0c:cd:01:00:01 (GOOSE multicast)
- **VLAN Priority:** 4 (High priority for protection)
- **VLAN ID:** 0 (Untagged)
- **Traffic analysis practice:** Capture and dissect GOOSE frames to understand how control signals appear on the wire, how configuration revisions manifest, and where deviations from the SCL model surface.
- **Attack simulation:** Experiment with intentionally malformed datasets, delayed heartbeats, or tampered shared files to observe how the system reacts and to craft defensive monitoring rules.
- **Incident response tabletop exercises:** Use the GUIs and launcher scripts to rehearse detection and recovery procedures that map to OT playbooks without risking real equipment.

These OT-focused activities complement the electrical engineering perspective, making the repository useful for blue-team training, security research, and demonstrations of how process control software can fail under adversarial conditions.

## System Requirements

- **Operating System:** Linux (Ubuntu/Debian recommended)
- **Privileges:** Root access for raw socket operations
- **Python:** Python 3.x with tkinter for GUI
- **Network:** Ethernet interface for GOOSE communication
- **Compiler:** GCC for building libiec61850 examples

## 📦 Installation

### Automatic Installation (Recommended)
```bash
git clone https://github.com/yourusername/virtual-substation.git
cd virtual-substation
./install.sh
```
@@ -193,26 +204,36 @@ ip link show       # List network interfaces
## Troubleshooting

| Issue | Solution |
|-------|----------|
| Permission denied | Run with `sudo` |
| Interface not found | Check `ip link show` and use correct interface |
| GUI compilation error | Ensure libiec61850 is built: `cd libiec61850 && make lib` |
| No GOOSE communication | Verify both devices use same network interface |
| Python GUI not starting | Install tkinter: `sudo apt install python3-tk` |

## Educational Context

This project demonstrates:
- **IEC 61850 Standard:** International standard for substation automation
- **GOOSE Protocol:** Fast, reliable communication for protection systems
- **Virtual IEDs:** Software simulation of Intelligent Electronic Devices
- **Protection Logic:** Fault detection and circuit breaker control
- **Real-time Systems:** Time-critical communication in power systems

## Use Cases

- **Training:** Learn IEC 61850 and substation automation concepts
- **Testing:** Validate protection logic and communication timing
- **Development:** Prototype new protection algorithms
- **Education:** Understand power system protection principles
- **Research:** Experiment with GOOSE message structures and timing