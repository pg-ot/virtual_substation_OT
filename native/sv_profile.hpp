#pragma once
#include <cstdint>
#include <optional>
#include <string_view>

// F01 training profile. Values are primary instantaneous quantities.
namespace svprofile {
inline constexpr char id[] = "MUF01/LLN0$Msv01";
inline constexpr uint16_t appId = 0x4000;
inline constexpr uint32_t revision = 1;
inline constexpr uint16_t samplesPerCycle = 80;
inline constexpr uint16_t samplesPerSecond = 4000;
struct Profile {
    const char* id;
    uint16_t samplesPerCycle;
    uint16_t samplesPerSecond;
};
inline constexpr Profile defaultTraining{id, samplesPerCycle, samplesPerSecond};
inline constexpr Profile slowTraining{"MUF01/LLN0$Msv08", 8, 400};
inline std::optional<Profile> fromSampleRate(const char* setting)
{
    if (!setting || std::string_view(setting) == "4000") return defaultTraining;
    if (std::string_view(setting) == "400") return slowTraining;
    return std::nullopt;
}
inline constexpr double currentCountsPerAmpere = 1000.0;
inline constexpr double voltageCountsPerVolt = 100.0;
inline constexpr uint8_t destination[] = {0x01, 0x0c, 0xcd, 0x04, 0x00, 0x01};
}
