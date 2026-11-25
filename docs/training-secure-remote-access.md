# Secure remote access training pilot

This optional exercise demonstrates a **real WireGuard tunnel and SSH
jump-host session** between containers on the same training host. It is an
instructor-supervised simulation, not production remote access or an
IEC 62443 compliance claim. The base lab does not start these services.

```text
Browser on host
  -> host loopback port -> simulated vendor client
  -> SSH inside WireGuard -> VPN endpoint -> SSH jump host
  -> IEC 104 gateway web page on management network
```

Only the gateway web endpoint `web-gateway:8090` is permitted through the
jump host. SSH public-key authentication is required, shell sessions are
disabled, and the host-side forwarded browser port is bound to `127.0.0.1`.
WireGuard is not exposed outside Docker: the vendor client is another
container, not an external laptop. A real external deployment would require
independently engineered routing, access policy, credential management,
monitoring, review and acceptance.

This is an additional training route, **not an access-control boundary for
the existing lab**. The existing loopback-published pages remain available
directly on the host. Any user or process able to access the host loopback
port while a forward is active can use it without separately authenticating.
The SSH listener also binds within the client's Docker networks. Docker
administrators can access the containers and their credentials. The jump
host joins the existing management network; its SSH forwarding restriction
does not constitute a network firewall. No access is given to the capture
agent through this route.

## Preparation and configuration

1. Use a trusted local training host with Docker Desktop, Compose, Node.js and
   an already running SS-01 project. Verify the IEC 104 gateway is healthy
   and its management-network alias is `web-gateway`. Keep the station's
   controlling browser page open if using the direct-HTTP process input.
2. From the repository root, select the exact existing project name. The
   example uses `ss01-lab-overview`; substitute your actual project. These
   commands start only the access services, not the gateway or other lab
   services. Do not use a different project name and expect it to find the
   existing gateway.

   ```powershell
   $env:LAB_SECURE_ACCESS_PORT = '18084'
   $project = 'ss01-lab-overview'
   docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access build access-keys
   docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access up -d access-client
   ```

   The build installs the VPN and SSH packages and requires package
   repository access unless the image is already cached. Use a free port;
   the example binds only `127.0.0.1:18084`. Keep the same port setting
   for subsequent Compose commands. Docker must support WireGuard and the
   specified `NET_ADMIN` capability in these containers.
3. Check `docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access ps`
   and the gateway's normal local page. If a service failed, inspect
   `docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access logs access-keys access-vpn access-jump access-client`;
   do not bypass authentication or host-key checking.

The first startup generates unique WireGuard and SSH keys in three
project-specific Docker volumes. Keep them private: they are credentials,
not training handouts. They persist across restarts. The initialization
fails if it detects an incomplete key set; do not copy private keys into
documents or source control. The SSH client verifies the generated jump-host
key using its pre-provisioned `known_hosts`.

## Instructor demonstration

1. **Before connection:** `http://127.0.0.1:18084/` should not provide the
   gateway through this route. The separate original gateway URL remains
   available; that is an intentional bypass in this training lab.
2. **Connect:** record the hypothetical request and approval, then start the
   pre-provisioned vendor SSH session:

   ```powershell
   docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access exec -T access-client accessctl connect
   ```

   Open `http://127.0.0.1:18084/`. It should show the IEC 104 gateway page.
   The jump host permits this destination only; it does not permit an SSH
   shell. This is a web-page path, not IEC 104 tunnel forwarding.
3. **Observe:** display the VPN handshake and encrypted byte counts and
   verify that the SSH forward is active:

   ```powershell
   docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access exec -T access-client accessctl status
   docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access logs --tail 60 access-jump
   ```

   A WireGuard latest-handshake time is historical evidence, not proof of an
   active SSH session. Jump-host logs show the SSH username, authentication
   result and forwarding requests; they can contain sensitive metadata. The
   source address shown by SSH is the VPN endpoint's Docker address, not a
   unique external-user IP.
4. **Inspect the tunnel:** in a second terminal run:

   ```powershell
   docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access exec access-vpn tcpdump -Z root -ni any udp port 51820
   ```

   Refresh the forwarded page and observe the WireGuard UDP packets; stop
   tcpdump with Ctrl+C. `tcpdump -Z root -ni wg0` instead shows the inner SSH
   connection, which is also encrypted. These captures do not by themselves
   display the gateway's MMS or IEC 104 traffic. Endpoint captures can
   overlap and do not establish complete coverage.
5. **Terminate access:**

   ```powershell
   docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access exec -T access-client accessctl disconnect
   docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access exec -T access-client accessctl status
   ```

   The forwarded URL should fail and SSH should report inactive; the
   original direct lab URL still works. Disconnect terminates the current SSH
   session, but **does not revoke the keys or stop WireGuard**. The holder
   of the client credentials can reconnect. Approval, automatic expiry,
   credential revocation and active-session administration are not
   implemented; discuss these as requirements, not completed features.
6. To turn the feature off without stopping the lab, run:

   ```powershell
   docker compose -p $project -f compose.yaml -f compose.secure-access.yaml --profile secure-access stop access-client access-vpn access-jump
   ```

   Restart with the `up` command above and establish a new SSH session.
   Stopping preserves the three credential volumes. Do not run Compose
   `down` against an existing lab merely to stop this feature.

## Teaching points and limitations

- **Confidentiality:** compare the original direct HTTP browser path with
  UDP carrying encrypted WireGuard data. SSH adds another encrypted layer
  inside the VPN; the final jump-to-gateway connection is plain HTTP on the
  Docker management network. The browser-to-client loopback hop is also HTTP.
- **Integrity:** WireGuard and SSH authenticate their protected traffic.
  Packet observation alone does not demonstrate a tampering test or
  protect the unencrypted final HTTP hop.
- **Availability:** terminate the SSH session and observe loss of this
  access path, then reconnect. This does not demonstrate a substation or
  protection outage.
- **MFA:** not implemented. A WireGuard key plus an SSH key stored on the
  same machine is not a demonstrated second factor. Discuss an independent
  authenticator and the need to verify MFA and revoke active sessions.
- **Logging:** SSH authentication and forwarding diagnostics are available,
  but there is no centralized audit, approval workflow, session recording,
  named per-trainee identity or automatic access expiry. Logs are not
  tamper-proof and `DEBUG1` can generate substantial output.
- Only one vendor key and one fixed target are provisioned. The private
  Docker networks, SSH restrictions and host loopback binding do not prove
  production-grade segmentation or protection from a compromised host.

## Verification

After building the image, `node --test containers/secure-access/smoke.test.mjs`
creates a uniquely named isolated project and simulated gateway. It checks
the allowed path, rejection of an unknown SSH key and shell, denial of a
different target, and loss of access after disconnect. It removes its own
containers, networks and credential volumes. A separate browser rehearsal
against the real gateway is still necessary before class.
