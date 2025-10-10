# Virtual Substation - IEC 61850 GOOSE Communication System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Linux-blue.svg)](https://www.linux.org/)
[![IEC 61850](https://img.shields.io/badge/Standard-IEC%2061850-green.svg)](https://en.wikipedia.org/wiki/IEC_61850)

A complete virtual substation implementation demonstrating IEC 61850 GOOSE (Generic Object Oriented Substation Event) communication between Protection IED and Breaker IED using libiec61850 library.

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
- Communication mimics IEC 61850-8-1 messaging for demonstration purposes only

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
| Fault Voltage | Float | Measured voltage in Volts | 10500.0 |
| Frequency | Float | System frequency in Hz | 49.8 |

## Project Structure

```
virtual substation/
├── libiec61850/                    # IEC 61850 library (v1.6)
│   ├── examples/
│   │   ├── goose_publisher/        # Enhanced publisher with protection data
│   │   └── goose_subscriber/       # Enhanced subscriber with live display
│   └── build/libiec61850.a         # Compiled library
├── protection_gui.py               # Protection IED GUI (Publisher)
├── breaker_gui.py                  # Breaker IED GUI (Subscriber)
├── start_protection.sh             # Protection IED launcher
├── start_breaker.sh                # Breaker IED launcher
├── stop_all.sh                     # Stop all processes script
├── goose_setup.sh                  # Setup helper script
├── test_goose.sh                   # Verification script
└── README.md                       # This documentation
```

## 🎮 Usage

### GUI Mode (Recommended)
```bash
# Terminal 1 - Protection IED (Publisher)
sudo ./start_protection.sh <interface>

# Terminal 2 - Breaker IED (Subscriber)  
sudo ./start_breaker.sh <interface>

# Stop all processes
./stop_all.sh
```

### Command Line Mode
```bash
# Terminal 1 - Subscriber
cd libiec61850/examples/goose_subscriber
sudo ./goose_subscriber_example <interface>

# Terminal 2 - Publisher
cd libiec61850/examples/goose_publisher
sudo ./goose_publisher_example <interface>
```

### Available Interfaces
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

## Network Interfaces

Supported interfaces (auto-detected):
- `enp0s3` - Primary network interface
- `enp0s8` - Secondary network interface  
- `enp0s9` - Tertiary network interface
- `eth0` - Legacy Ethernet interface

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

### Manual Installation
```bash
# Install dependencies
sudo apt update
sudo apt install -y build-essential gcc make python3 python3-tk

# Build library
cd libiec61850
make lib

# Build examples
cd examples/goose_publisher && make
cd ../goose_subscriber && make

# Set permissions
chmod +x *.sh
```

### Verification
```bash
./check_status.sh  # Check system status
ip link show       # List network interfaces
```

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