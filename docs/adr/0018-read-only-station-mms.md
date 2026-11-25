# ADR 0018 — Connect the read-only station single-line to native MMS

**Status:** Accepted for development.

## Context

P1 requires that the station operator can independently observe confirmed breaker position, protection trip and their source identity while the gateway runs in parallel.

## Decision

The existing station server offers a native mode. One long-lived `station-client stream` process per HMI server uses the distributed MMS profile. The browser polls a loopback JSON endpoint. The native mode exposes read-only indications and shares the industrial single-line renderer with the classroom view.

Each point carries its MMS source and source timestamp. Good position drives the breaker symbol. Unusable data appears as UNKNOWN with its quality indicated. A missing position leaves available trip and current indications visible. The event list records value and quality changes when the station poller observes them. The event observation clock and MMS source timestamps are shown independently.

## Alternatives and consequences

Connecting the HMI through the gateway would make the two views dependent on the same consumer. Separate MMS polling keeps the two station-level paths independent.

Polling reads individual points and can miss short transitions. Ordered device events, buffered reporting and recovery remain separate engineering work under T028. Native station control remains a later milestone.
