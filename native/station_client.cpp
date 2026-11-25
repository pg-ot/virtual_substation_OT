#include "mms.hpp"
#include <chrono>
#include <cmath>
#include <csignal>
#include <iostream>
#include <string_view>
#include <thread>

namespace {
volatile std::sig_atomic_t running = 1;
void stop(int) { running = 0; }

void writeSnapshot(const bay::Sample& sample)
{
    const auto position = bay::positionJson(sample.position);
    const auto trip = sample.tripTime == 0 ? "null" : sample.tripped ? "true" : "false";
    std::cout << "{\"position\":{\"value\":" << position
              << ",\"quality\":" << sample.positionQuality << ",\"sourceTimeMs\":" << sample.positionTime
              << "},\"trip\":{\"value\":" << trip
              << ",\"quality\":" << sample.tripQuality << ",\"sourceTimeMs\":" << sample.tripTime
              << "},\"current\":{\"value\":";
    if (sample.currentTime && std::isfinite(sample.amperes)) std::cout << sample.amperes;
    else std::cout << "null";
    std::cout << ",\"quality\":" << sample.currentQuality << ",\"sourceTimeMs\":" << sample.currentTime << '}';
    if (sample.operationFailure) {
        std::cout << ",\"operationFailure\":{\"value\":" << (*sample.operationFailure ? "true" : "false")
                  << ",\"quality\":" << sample.failureQuality << ",\"sourceTimeMs\":" << sample.failureTime << '}';
    }
    if (sample.closeInhibited) {
        std::cout << ",\"closeInhibited\":{\"value\":" << (*sample.closeInhibited ? "true" : "false")
                  << ",\"quality\":" << sample.latchQuality << ",\"sourceTimeMs\":" << sample.latchTime << '}';
    }
    std::cout << '}' << std::endl;
}

void report(void*, ClientReport report)
{
    const auto data = ClientReport_getDataSetValues(report);
    if (!data || MmsValue_getArraySize(data) != 3) return;
    if (ClientReport_getReasonForInclusion(report, 0) != IEC61850_REASON_NOT_INCLUDED) {
        const auto position = MmsValue_getElement(data, 0);
        if (position && MmsValue_getType(position) == MMS_STRUCTURE) {
            const auto state = Dbpos_fromMmsValue(MmsValue_getElement(position, 0));
            std::cout << "MMS report breaker=" << bay::positionName(state) << std::endl;
        }
    }
    if (ClientReport_getReasonForInclusion(report, 1) != IEC61850_REASON_NOT_INCLUDED) {
        const auto trip = MmsValue_getElement(data, 1);
        if (trip && MmsValue_getType(trip) == MMS_BOOLEAN) {
            std::cout << "MMS report trip=" << MmsValue_getBoolean(trip) << std::endl;
        }
    }
}
}

int main(int argc, char** argv)
{
    bay::MmsClient client;
    const std::string_view action = argc > 1 ? argv[1] : "read";
    if (action == "goose-config") return client.printGooseConfiguration() ? 0 : 1;
    if (action == "protection-read") {
        const auto sample = client.readProtection();
        if (!sample) return 1;
        writeSnapshot(*sample);
        return 0;
    }
    if (action == "watch" || action == "stream") {
        std::signal(SIGINT, stop);
        std::signal(SIGTERM, stop);
        if (bay::distributed()) {
            if (action == "watch") std::cout << "Polling position from BRF01 and protection from PRF01" << std::endl;
            while (running) {
                if (const auto sample = client.read(action == "stream")) {
                    if (action == "stream") writeSnapshot(*sample);
                    else bay::print(*sample);
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(250));
            }
            return 0;
        }
        if (action == "stream") {
            std::cerr << "stream requires LAB_DISTRIBUTED=1\n";
            return 2;
        }
        if (!client.subscribeToBayReport(report)) {
            std::cerr << "Failed to enable MMS bay reporting\n";
            return 1;
        }
        while (running && client.connected()) std::this_thread::sleep_for(std::chrono::milliseconds(100));
        return running ? 1 : 0;
    }
    if (action == "open" || action == "close" || action == "reset-latch") {
        if (!client.connectControl()) {
            std::cout << "command=NO RESPONSE" << std::endl;
            return 1;
        }
        const auto accepted = action == "reset-latch" ? client.resetBreakerLatch() : client.operate(action == "close");
        std::cout << "command=" << (accepted ? "ACCEPTED" : "REJECTED") << std::endl;
        if (!accepted) return 1;
    } else if (action != "read") {
        std::cerr << "Usage: station-client [read|open|close|reset-latch|watch|stream|protection-read|goose-config]\n";
        return 2;
    }
    const auto sample = client.read();
    if (!sample) {
        std::cerr << "MMS sample unavailable\n";
        return 1;
    }
    bay::print(*sample);
}
