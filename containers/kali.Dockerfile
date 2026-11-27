# syntax=docker/dockerfile:1

# Builds station-client and telecontrol104 from the same native sources as
# the bench image (see the top-level Dockerfile), so the Kali image carries
# its own copies instead of requiring a docker cp from a running bench
# container before the live attack demo scripts can be used.
FROM node:22-bookworm-slim AS native-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates cmake default-jre-headless \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY containers/deps/ /build/deps/
RUN cmake -DLAB_DEPS_SOURCE_DIR=/build/vendor -DLAB_DEPS_INIT_FILE=/build/dependencies.cmake \
      -P /build/deps/prepare.cmake
COPY native/ /build/native/
ARG BUILD_JOBS=2
RUN cmake -S native -B out -C /build/dependencies.cmake -DCMAKE_BUILD_TYPE=Release \
      -DFETCHCONTENT_FULLY_DISCONNECTED=ON \
      -DCONFIG_IEC61850_L2_GOOSE=ON -DCONFIG_IEC61850_L2_SMV=ON -DLAB_DNP3=OFF \
    && cmake --build out --parallel "${BUILD_JOBS}" --target station-client telecontrol104

FROM fortiphyd/grfics-attacker:latest

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl iproute2 libcap2-bin python3-scapy tcpdump tshark wireshark \
    && rm -rf /var/lib/apt/lists/*
COPY --from=native-build /build/out/station-client /build/out/telecontrol104 /usr/local/bin/
