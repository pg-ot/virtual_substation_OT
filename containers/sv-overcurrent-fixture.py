"""Send a sustained SV overcurrent to an isolated process network for regression tests."""

import math
import socket
import struct
import sys
import time

interface = sys.argv[1]
duration = float(sys.argv[2]) if len(sys.argv) > 2 else 20.0
sample_rate = int(sys.argv[3]) if len(sys.argv) > 3 else 4000
if sample_rate not in (400, 4000):
    raise ValueError("sample rate must be 400 or 4000")
samples_per_cycle = sample_rate // 50
stream_id = b"MUF01/LLN0$Msv08" if sample_rate == 400 else b"MUF01/LLN0$Msv01"
sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW)
sock.bind((interface, 0))
source = sock.getsockname()[4]
ethernet = bytes.fromhex("010ccd040001") + source + bytes.fromhex("88ba4000007600000000")
asdu_start = bytes.fromhex("606c800101a26730658010") + stream_id + bytes.fromhex("8202")
asdu_end = bytes.fromhex("8304000000018501008602") + struct.pack(">H", samples_per_cycle) + bytes.fromhex("8740")
deadline = time.monotonic() + duration
count = 0

while time.monotonic() < deadline:
    angle = 2 * math.pi * (count % samples_per_cycle) / samples_per_cycle
    currents = [round(1200 * math.sqrt(2) * math.sin(angle - phase * 2 * math.pi / 3) * 1000)
                for phase in range(3)] + [0]
    values = b"".join(struct.pack(">iI", value, 0) for value in currents + [0, 0, 0, 0])
    frame = ethernet + asdu_start + struct.pack(">H", count) + asdu_end + values
    sock.send(frame)
    count = (count + 1) % sample_rate
    time.sleep(1 / sample_rate)
