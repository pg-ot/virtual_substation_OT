# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates cmake default-jre-headless \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY containers/deps/ /build/deps/
RUN cmake -DLAB_DEPS_SOURCE_DIR=/build/vendor -DLAB_DEPS_INIT_FILE=/build/dependencies.cmake \
      -P /build/deps/prepare.cmake
COPY native/ /build/native/
ARG BUILD_JOBS=2
ARG LAB_MMS_SINGLE_THREADED=OFF
RUN cmake -S native -B out -C /build/dependencies.cmake -DCMAKE_BUILD_TYPE=Release \
      -DFETCHCONTENT_FULLY_DISCONNECTED=ON \
      -DCONFIG_MMS_SINGLE_THREADED="${LAB_MMS_SINGLE_THREADED}" \
      -DCONFIG_IEC61850_L2_GOOSE=ON -DCONFIG_IEC61850_L2_SMV=ON -DLAB_DNP3=ON \
    && cmake --build out --parallel "${BUILD_JOBS}" --target \
      plant-ied plant-read feeder-ied merging-unit breaker-ied breaker-read station-client telecontrol104 telecontrol-dnp3

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /build/out/plant-ied /build/out/plant-read /build/out/feeder-ied /build/out/merging-unit /build/out/breaker-ied /build/out/breaker-read /build/out/station-client /build/out/telecontrol104 /build/out/telecontrol-dnp3 /usr/local/bin/
COPY src/ /app/src/
COPY web/ /app/web/
COPY containers/entrypoint.sh /app/containers/entrypoint.sh
USER node
ENTRYPOINT ["/bin/sh", "/app/containers/entrypoint.sh"]
