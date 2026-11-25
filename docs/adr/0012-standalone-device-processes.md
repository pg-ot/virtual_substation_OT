# ADR 0012 — Run virtual assets as independent processes before packaging

**Status:** Accepted for the first service integration.

**Decision.** Run the feeder process, protection IED, gateway and supervisory consumer as separate loopback services with individual diagnostic consoles. Device state lives in the services and protection continues with the consoles closed. Use a temporary HTTP/JSON transport to exercise service boundaries. Browser consoles are read-only in this slice. Issue instructor actions from the local command line.

**Alternative considered.** Extending the standalone HTML alone would leave device lifecycle and communications behavior inside the browser. Starting with Compose would mix service development with container setup.

**Consequences.** The service smoke test must verify a local protection trip and stale supervisory feedback. The next slice adds the station operator client and replaces internal integration transports with the specified native protocol adapters. Docker packaging follows a working process run. This development slice uses Node.js. C++ and native protocols remain the target from ADRs 0009 and 0010.
