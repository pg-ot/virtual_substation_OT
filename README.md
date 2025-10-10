# 🏭 Virtual Substation – IEC 61850 GOOSE for OT/ICS Security Labs

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Linux-blue.svg)](https://www.linux.org/)
[![IEC 61850](https://img.shields.io/badge/Standard-IEC%2061850-green.svg)](https://en.wikipedia.org/wiki/IEC_61850)

A **virtual substation** that demonstrates IEC 61850 GOOSE communication between a **Protection IED** (publisher) and a **Breaker IED** (subscriber) using `libiec61850` — enhanced for **OT/ICS security training, testing, and research**.  
Ideal for **blue-team detection labs**, **red-team simulations**, and **hands-on industrial-protocol forensics**.

> ⚠️ **Disclaimer**  
> This repository is for **educational and lab use only**.  
> The included publisher/subscriber diverge from strict IEC 61850 conformance (dataset, confRev, TTL timing) to simplify demonstrations.  
> **Never use** this code in production, live substations, or for interoperability claims without redesign.

---

## 🧭 Why This Project (Security Angle)

- 🔍 **Blue-team** – Identify normal vs. anomalous GOOSE behavior (`stNum`/`sqNum`, TTL expiry, confRev drift).  
- 🧨 **Red-team** – Safely simulate malformed frames, replay bursts, or multicast spoofing in an isolated lab.  
- 🧰 **Forensics** – Capture, decode, and correlate packets to MITRE ATT&CK for ICS (e.g., *T0843 – Manipulation of Control*).  
- 🧱 **Controls testing** – Validate VLAN segregation, IGMP snooping, storm control, and port-based ACLs.

---

## 🚀 Quick Start

```bash
git clone https://github.com/yourusername/virtual-substation.git
cd virtual-substation
./install.sh

# Terminal 1 – Protection IED (publisher)
sudo ./start_protection.sh eth0

# Terminal 2 – Breaker IED (subscriber + GUI)
sudo ./start_breaker.sh eth0

# Stop all
./stop_all.sh
Command-Line Mode (no GUI)
bash
Copy code
cd libiec61850/examples/goose_subscriber
sudo ./goose_subscriber_example <interface>

cd ../goose_publisher
sudo ./goose_publisher_example <interface>
⚙️ Architecture Overview
mathematica
Copy code
┌─────────────────┐    GOOSE Multicast    ┌─────────────────┐
│  Protection IED │ ────────────────────► │ Breaker IED │
│ (Publisher) │     Ethernet/VLAN 802.1Q  │ (Subscriber) │
│ • Fault Logic   │                       │ • Trip/Close Actuation │
│ • Trip/Close Cmd│                       │ • Live GUI Display │
└─────────────────┘                       └─────────────────┘
📡 GOOSE Dataset (Example)
#	Signal	Type	Description	Example
1	Trip Cmd	Boolean	Breaker open signal	true
2	Close Cmd	Boolean	Breaker close signal	false
3	Fault Type	Int	0=No fault 1=OC 2=Diff 3=Dist	1
4	Prot Element	Int	Device number (50/87/21 etc.)	50
5	Fault Current	Float	Amps	1250.5
6	Fault Voltage	Float	Volts	10500.0
7	Frequency	Float	Hz	49.8

🧩 Folder Structure
cpp
Copy code
virtual-substation/
├── libiec61850/
│   └── examples/
│       ├── goose_publisher/
│       └── goose_subscriber/
├── protection_gui.py
├── breaker_gui.py
├── start_protection.sh
├── start_breaker.sh
├── stop_all.sh
└── README.md
🔐 OT Security Scenarios
🧪 Perform all tests inside an isolated lab or VM-only network.

1️⃣ Baseline Traffic
bash
Copy code
sudo tcpdump -i eth0 ether proto 0x88b8 -w goose-baseline.pcap
→ Observe stNum, sqNum, and TTL progression in Wireshark.

2️⃣ Heartbeat & TTL Stress
Toggle faults and trip signals; note TTL expiration alerts.

3️⃣ ConfRev Mismatch / Denial
ConfRev differs from SCL – verify detection in GOOSE decoder.

4️⃣ Replay Burst (Attack Sim)
bash
Copy code
sudo tcpreplay --intf1=eth0 goose-baseline.pcap
→ Watch for sqNum reversals and timestamp anomalies.

5️⃣ Multicast Segregation
Test VLAN and IGMP controls prevent off-bus propagation.

⚠️ IEC 61850 Compliance Notes
Deviation	Impact
Dataset mismatch (7-element flat list)	Non-compliant with MV/Q/T structure.
confRev inconsistency	Frames appear stale to strict stacks.
TTL vs heartbeat conflict	Subscribers flag expired messages.

To achieve interoperability: realign SCL, rebuild datasets, and sync heartbeat/TTL with IEC 61850-8-1.

💻 Requirements
Linux (Ubuntu/Debian recommended)

Root access for raw sockets

Python 3 with Tkinter

GCC / Make

libiec61850 v1.6+

List interfaces:

bash
Copy code
ip link show
🔧 Manual Build
bash
Copy code
sudo apt update
sudo apt install -y build-essential gcc make python3 python3-tk
cd libiec61850 && make lib
cd examples/goose_publisher && make
cd ../goose_subscriber && make
chmod +x *.sh
🧠 Security Lab Usage
Purpose	Tool/Method
Packet analysis	Wireshark (eth.type == 0x88B8)
Frame logging	tcpdump or Scapy
Blue-team validation	Detect TTL, confRev, sqNum anomalies
Red-team simulation	Replay, inject, spoof MAC (offline only)
Hardening tests	VLAN separation, storm control, ACLs

🧱 Ethical & Safety Guidelines
Use offline labs only – never on production networks.

Obtain authorization for any security tests.

Prefer passive monitoring before injection.

Document risks and safeguards for trainees.

🗺️ Future Enhancements
Standards-aligned SCL mode

Replay/fuzz toggle for attack simulation

Suricata/Wireshark detection rule set

Dockerized multi-IED topology

Optional PCAP stream generator

📜 License
Released under the MIT License.

Acknowledgements
Built on libiec61850.
Special thanks to the OT security community advancing safe training and research in industrial networks.

yaml
Copy code

---
