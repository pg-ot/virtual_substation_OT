#pragma once
#include "sv_profile.hpp"
#include "sv_subscriber.h"
#include <array>
#include <chrono>
#include <mutex>
#include <optional>

class SvCurrentReceiver {
public:
    explicit SvCurrentReceiver(svprofile::Profile profile = svprofile::defaultTraining);
    ~SvCurrentReceiver();
    bool start(const char* interfaceName);
    std::optional<float> current();

private:
    static void receive(SVSubscriber, void* context, SVSubscriber_ASDU asdu);
    const svprofile::Profile profile_;
    SVReceiver receiver_{};
    int membershipSocket_ = -1;
    bool loggedSample_ = false;
    bool invalidSinceRead_ = false;
    std::mutex mutex_;
    std::array<double, svprofile::samplesPerCycle> squares_{};
    unsigned count_ = 0;
    unsigned index_ = 0;
    double sum_ = 0;
    std::optional<uint16_t> previous_;
    std::chrono::steady_clock::time_point lastSample_{};
};
