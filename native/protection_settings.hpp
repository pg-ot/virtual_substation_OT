#pragma once
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace protection {
using Clock = std::chrono::steady_clock;

struct Settings {
    float pickupAmperes = 200.0F;
    std::chrono::milliseconds operateDelay{0};
};

inline bool parseSettings(const char* pickup, const char* delay, Settings& settings, std::string& error)
{
    if (pickup) {
        const std::string_view text(pickup);
        float value{};
        const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
        if (result.ec != std::errc{} || result.ptr != text.data() + text.size() ||
            !std::isfinite(value) || value <= 0) {
            error = "LAB_PROTECTION_PICKUP_A must be a finite positive number";
            return false;
        }
        settings.pickupAmperes = value;
    }
    if (delay) {
        const std::string_view text(delay);
        uint32_t value{};
        const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
        if (result.ec != std::errc{} || result.ptr != text.data() + text.size()) {
            error = "LAB_PROTECTION_DELAY_MS must be an integer from 0 to 4294967295";
            return false;
        }
        settings.operateDelay = std::chrono::milliseconds(value);
    }
    return true;
}

class OvercurrentPickup {
public:
    explicit OvercurrentPickup(Settings settings) : settings_(settings) {}

    bool update(std::optional<float> current, Clock::time_point now)
    {
        if (!current || !std::isfinite(*current) || *current < settings_.pickupAmperes) {
            started_.reset();
            return false;
        }
        if (!started_) started_ = now;
        return now - *started_ >= settings_.operateDelay;
    }

private:
    Settings settings_;
    std::optional<Clock::time_point> started_;
};
}
