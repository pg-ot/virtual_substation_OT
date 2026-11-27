#!/bin/sh
# Shared environment for the live attack scripts in this directory: points
# station-client and telecontrol104 at the real SCADA hosts over the
# networks compose.kali-demo.yaml joins Kali to.
export LAB_DISTRIBUTED=1
export LAB_PROCESS_MODEL=1
export LAB_MMS_HOST=relay-station
export LAB_BREAKER_MMS_HOST=breaker-station
export LAB_IEC104_HOST=iec104-supervisory
export LAB_IEC104_CONTROL=1
