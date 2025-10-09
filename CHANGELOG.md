# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2024-10-09

### Added
- Complete IEC 61850 GOOSE communication system
- Protection IED with GUI controls and automatic protection logic
- Breaker IED with real-time status display
- Color-coded measurement sliders (Green/Yellow/Red)
- Comprehensive protection functions:
  - Overcurrent (50): >3500A
  - Undervoltage (27): <8000V  
  - Overvoltage (59): >14000V
  - Frequency (81): <49Hz or >51Hz
- Proper IEC 61850-8-1 timing and stNum/sqNum handling
- Automated installation script
- Process cleanup and signal handling
- Status checking utilities

### Features
- Real-time GOOSE message publishing/subscribing
- Interactive GUI with protection visualization
- Automatic fault detection and trip generation
- Manual trip/close override capability
- Network interface auto-detection
- Comprehensive error handling and cleanup

### Technical
- Built on libiec61850 v1.6
- Python 3 GUI with tkinter
- Linux platform support (Ubuntu/Debian)
- Raw socket communication
- Multi-threaded operation
- Signal-based process management