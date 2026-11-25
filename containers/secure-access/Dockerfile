FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl iproute2 openssh-client openssh-server socat tcpdump wireguard-tools \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/sh vendor \
    && passwd -d vendor
COPY containers/secure-access/entrypoint.sh /usr/local/bin/secure-access
COPY containers/secure-access/accessctl.sh /usr/local/bin/accessctl
COPY containers/secure-access/sshd_config /etc/ssh/sshd_config
RUN sed -i 's/\r$//' /usr/local/bin/secure-access /usr/local/bin/accessctl /etc/ssh/sshd_config \
    && chmod 755 /usr/local/bin/accessctl
ENTRYPOINT ["/bin/sh", "/usr/local/bin/secure-access"]
