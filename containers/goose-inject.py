"""Transmit a modified GOOSE frame from a Linux cooked capture on a chosen interface."""

import argparse

from scapy.all import Dot1Q, Ether, PcapNgReader, Raw, get_if_hwaddr, sendp
from scapy.layers.l2 import CookedLinux, CookedLinuxV2


def tlv_header(data, offset):
    tag = data[offset]
    size = data[offset + 1]
    start = offset + 2
    if size & 0x80:
        count = size & 0x7f
        if not count or count > 4:
            raise ValueError("Unsupported ASN.1 length")
        size = int.from_bytes(data[start:start + count], "big")
        start += count
    if start + size > len(data):
        raise ValueError("Truncated ASN.1 element")
    return tag, start, size


def modify_goose(payload, revision, state, sequence, trip, quality=None):
    payload = bytearray(payload)
    tag, start, length = tlv_header(payload, 8)
    if tag != 0x61:
        raise ValueError("Expected a GOOSE PDU")
    found = set()
    offset = start
    while offset < start + length:
        tag, value_start, size = tlv_header(payload, offset)
        if tag in (0x85, 0x86, 0x88):
            replacement = {0x85: state, 0x86: sequence, 0x88: revision}[tag]
            if size != 1 or not 0 <= replacement <= 127:
                raise ValueError("Fixture requires one-byte nonnegative integers")
            payload[value_start] = replacement
            found.add(tag)
        if tag == 0xab:
            nested_tag, nested_start, nested_size = tlv_header(payload, value_start)
            if nested_tag != 0x83 or nested_size != 1:
                raise ValueError("Expected a boolean first dataset member")
            next_offset = nested_start + nested_size
            if next_offset < value_start + size:
                quality_tag, quality_start, quality_size = tlv_header(payload, next_offset)
                if quality_tag != 0x84 or quality_start + quality_size != value_start + size:
                    raise ValueError("Expected an optional quality bit string")
                if quality is not None:
                    if quality_size != 3 or payload[quality_start] != 3:
                        raise ValueError("Expected a 13-bit quality field")
                    payload[quality_start] = 4 if quality == "short" else 3
                    payload[quality_start + 1:quality_start + 3] = (
                        b"\x40\x00" if quality == "invalid" else b"\x00\x00")
            elif quality is not None:
                raise ValueError("The captured dataset has no quality field")
            payload[nested_start] = 1 if trip else 0
            found.add(tag)
        offset = value_start + size
    if found != {0x85, 0x86, 0x88, 0xab}:
        raise ValueError("Required GOOSE fields missing")
    return bytes(payload)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("capture")
    parser.add_argument("interface")
    parser.add_argument("--revision", type=int, required=True)
    parser.add_argument("--state", type=int, required=True)
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--trip", type=int, choices=(0, 1), required=True)
    parser.add_argument("--quality", choices=("good", "invalid", "short"))
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--steps", help="Comma-separated sequence:trip pairs sent 100 ms apart")
    parser.add_argument("--transitions", help="Comma-separated state:sequence:trip triples sent 100 ms apart")
    args = parser.parse_args()
    with PcapNgReader(args.capture) as capture:
        packet = next(packet for packet in capture if
                      (packet.haslayer(Dot1Q) and packet[Dot1Q].type == 0x88b8) or
                      any(packet.haslayer(layer) and packet[layer].proto == 0x88b8
                          for layer in (CookedLinux, CookedLinuxV2)))
    if packet.haslayer(Dot1Q):
        vlan = packet[Dot1Q]
        captured_payload = bytes(vlan.payload)
        priority, vlan_id = vlan.prio, vlan.vlan
    else:
        cooked = packet[CookedLinuxV2] if packet.haslayer(CookedLinuxV2) else packet[CookedLinux]
        captured_payload = bytes(cooked.payload)
        # The project's station SCL configures priority 4 and VLAN ID 0.
        priority, vlan_id = 4, 0
    if args.transitions:
        steps = [tuple(int(value) for value in step.split(":")) for step in args.transitions.split(",")]
        if any(len(step) != 3 or step[2] not in (0, 1) for step in steps):
            raise ValueError("Each transition must be state:sequence:trip with trip 0 or 1")
    elif args.steps:
        pairs = [tuple(int(value) for value in step.split(":")) for step in args.steps.split(",")]
        if any(len(step) != 2 or step[1] not in (0, 1) for step in pairs):
            raise ValueError("Each step must be sequence:trip with trip 0 or 1")
        steps = [(args.state, sequence, trip) for sequence, trip in pairs]
    else:
        steps = [(args.state, args.sequence, args.trip)] * args.count
    frames = []
    for state, sequence, trip in steps:
        payload = modify_goose(captured_payload, args.revision, state, sequence, trip, args.quality)
        frames.append(Ether(src=get_if_hwaddr(args.interface), dst="01:0c:cd:01:00:01", type=0x8100)
                      / Dot1Q(prio=priority, vlan=vlan_id, type=0x88b8) / Raw(payload))
    sendp(frames, iface=args.interface, inter=0.1, verbose=False)
    print(f"Sent GOOSE frames: confRev={args.revision} state/sequence/trip={steps}")


if __name__ == "__main__":
    main()
