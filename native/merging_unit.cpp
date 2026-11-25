#include "plant.hpp"
#include "sv_profile.hpp"
#include "web_status.hpp"
#include "hal_time.h"
#include "sv_publisher.h"
#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <mutex>
#include <optional>
#include <thread>
#ifdef __linux__
#include <sched.h>
#endif

namespace {
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;
volatile std::sig_atomic_t running = 1;
void stop(int) { running = 0; }
}

int main(int argc, char** argv)
{
    if (argc != 2) {
        std::cerr << "Usage: merging-unit <process-interface>\n";
        return 2;
    }
    std::signal(SIGINT, stop);
    std::signal(SIGTERM, stop);
    const auto profile = svprofile::fromSampleRate(std::getenv("LAB_SV_SAMPLES_PER_SECOND"));
    if (!profile) {
        std::cerr << "LAB_SV_SAMPLES_PER_SECOND must be 400 or 4000\n";
        return 2;
    }
    const auto samplePeriodUs = 1000000 / profile->samplesPerSecond;
    const char* batchSetting = std::getenv("LAB_SV_ASDUS_PER_FRAME");
    if (batchSetting && std::strcmp(batchSetting, "1") != 0 && std::strcmp(batchSetting, "4") != 0) {
        std::cerr << "LAB_SV_ASDUS_PER_FRAME must be 1 or 4\n";
        return 2;
    }
    const unsigned batchSize = batchSetting && std::strcmp(batchSetting, "4") == 0 ? 4 : 1;
    int realtimePriority = 0;
    if (const char* setting = std::getenv("LAB_SV_REALTIME_PRIORITY")) {
        char* end = nullptr;
        errno = 0;
        const long value = std::strtol(setting, &end, 10);
        if (errno || end == setting || *end || value < 0 || value > 99) {
            std::cerr << "LAB_SV_REALTIME_PRIORITY must be between 0 and 99\n";
            return 2;
        }
        realtimePriority = static_cast<int>(value);
    }
#ifndef __linux__
    if (realtimePriority) {
        std::cerr << "Real-time SV scheduling requires Linux\n";
        return 2;
    }
#endif
    CommParameters address{4, 0, svprofile::appId,
        {0x01, 0x0c, 0xcd, 0x04, 0x00, 0x01}};
    // The Linux libiec61850 receiver binds its packet socket to the SV EtherType.
    // Untagged frames reach that socket on the Docker veth process network.
    const auto publisher = SVPublisher_createEx(&address, argv[1], false);
    if (!publisher) {
        std::cerr << "Cannot open SV publisher interface\n";
        return 1;
    }
    struct SampleData {
        SVPublisher_ASDU asdu{};
        std::array<int, 8> value{};
        std::array<int, 8> quality{};
    };
    std::array<SampleData, 4> samples{};
    for (unsigned item = 0; item < batchSize; ++item) {
        auto& sample = samples[item];
        sample.asdu = SVPublisher_addASDU(publisher, profile->id, nullptr, svprofile::revision);
        if (!sample.asdu) {
            SVPublisher_destroy(publisher);
            return 1;
        }
        for (unsigned channel = 0; channel < sample.value.size(); ++channel) {
            sample.value[channel] = SVPublisher_ASDU_addINT32(sample.asdu);
            sample.quality[channel] = SVPublisher_ASDU_addQuality(sample.asdu);
        }
        SVPublisher_ASDU_setSmpRate(sample.asdu, profile->samplesPerCycle);
    }
    // libiec61850 1.6.2.1 encodes smpMod with a length its subscriber rejects.
    // Omit this optional field and engineer the sampling mode in the profile.
    SVPublisher_setupComplete(publisher);
    for (unsigned item = 0; item < batchSize; ++item) SVPublisher_ASDU_setSmpSynch(samples[item].asdu, 0);

    std::mutex mutex;
    std::optional<plant::Snapshot> latest;
    Clock::time_point lastRead{};
    std::atomic<bool> polling{true};
    std::atomic<uint64_t> skippedSamples{0};
    std::atomic<uint64_t> skipEvents{0};
    std::thread reader([&] {
        plant::Client client;
        while (polling) {
            const auto snapshot = client.read();
            if (snapshot) {
                std::lock_guard lock(mutex);
                latest = snapshot;
                lastRead = Clock::now();
            }
            std::this_thread::sleep_for(50ms);
        }
    });
    std::thread diagnostics([&] {
        while (polling) {
            std::optional<plant::Snapshot> snapshot;
            {
                std::lock_guard lock(mutex);
                if (latest && Clock::now() - lastRead < 500ms) snapshot = latest;
            }
            web_status::link(snapshot ? "PUBLISHING SV" : "PROCESS UNAVAILABLE");
            web_status::received("current", web_status::analog(snapshot ? snapshot->feederA : 0),
                snapshot.has_value(), 0, Hal_getTimeInMs());
            web_status::received("voltage", web_status::analog(snapshot ? snapshot->sourceKv : 0),
                snapshot.has_value(), 0, Hal_getTimeInMs());
            web_status::received("skippedSamples", std::to_string(skippedSamples.load()), true, 0, Hal_getTimeInMs());
            web_status::received("skipEvents", std::to_string(skipEvents.load()), true, 0, Hal_getTimeInMs());
            std::this_thread::sleep_for(1s);
        }
    });

#ifdef __linux__
    if (realtimePriority) {
        sched_param scheduling{};
        scheduling.sched_priority = realtimePriority;
        if (sched_setscheduler(0, SCHED_FIFO, &scheduling) != 0) {
            std::cerr << "Cannot enable real-time SV scheduling: " << std::strerror(errno) << std::endl;
            polling = false;
            reader.join();
            diagnostics.join();
            SVPublisher_destroy(publisher);
            return 1;
        }
    }
#endif
    std::cout << "MUF01 SV publisher ready on " << argv[1] << " appid=0x4000 svID=" << profile->id
              << " samples_per_second=" << profile->samplesPerSecond << " asdus=" << batchSize
              << " fifo_priority=" << realtimePriority << std::endl;
    const auto started = Clock::now();
    uint64_t sample = 0;
    constexpr double pi = 3.14159265358979323846;
    constexpr double root2 = 1.4142135623730950488;
    while (running) {
        const auto now = Clock::now();
        const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(now - started).count();
        const auto completedSamples = static_cast<uint64_t>(elapsed / samplePeriodUs);
        if (completedSamples < batchSize) {
            std::this_thread::sleep_until(started + std::chrono::microseconds(batchSize * samplePeriodUs));
            continue;
        }
        const auto latestBatch = (completedSamples / batchSize - 1) * batchSize;
        if (latestBatch > sample) {
            skippedSamples += latestBatch - sample;
            ++skipEvents;
            sample = latestBatch;
        }
        std::optional<plant::Snapshot> snapshot;
        {
            std::lock_guard lock(mutex);
            if (latest && now - lastRead < 500ms) snapshot = latest;
        }
        const double amps = snapshot ? snapshot->feederA * root2 * svprofile::currentCountsPerAmpere : 0;
        const double volts = snapshot ? snapshot->sourceKv * 1000.0 / std::sqrt(3.0) * root2 * svprofile::voltageCountsPerVolt : 0;
        for (unsigned item = 0; item < batchSize; ++item) {
            auto& data = samples[item];
            const auto sampleNumber = sample + item;
            const double angle = 2.0 * pi * static_cast<double>(sampleNumber % profile->samplesPerCycle) /
                profile->samplesPerCycle;
            for (unsigned channel = 0; channel < data.value.size(); ++channel) {
                const bool neutral = channel == 3 || channel == 7;
                const unsigned phase = channel % 4;
                const double magnitude = channel < 4 ? amps : volts;
                const double instantaneous = neutral ? 0 : magnitude * std::sin(angle - phase * 2.0 * pi / 3.0);
                SVPublisher_ASDU_setINT32(data.asdu, data.value[channel], static_cast<int32_t>(std::lround(instantaneous)));
                SVPublisher_ASDU_setQuality(data.asdu, data.quality[channel],
                    snapshot ? QUALITY_VALIDITY_GOOD : QUALITY_VALIDITY_INVALID);
            }
            SVPublisher_ASDU_setSmpCnt(data.asdu, static_cast<uint16_t>(sampleNumber % profile->samplesPerSecond));
        }
        SVPublisher_publish(publisher);
        sample += batchSize;
        std::this_thread::sleep_until(started + std::chrono::microseconds((sample + batchSize) * samplePeriodUs));
    }
    polling = false;
    reader.join();
    diagnostics.join();
    SVPublisher_destroy(publisher);
    return 0;
}
