#pragma once
#include "mms.hpp"
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string_view>

namespace web_status {

inline bool enabled()
{
    const auto value = std::getenv("LAB_WEB_DIAGNOSTICS");
    return value && std::string_view(value) == "1";
}

inline void emit(const std::string& json)
{
    static std::mutex mutex;
    std::lock_guard lock(mutex);
    std::clog << "@ss01 " << json << std::endl;
}

inline void link(const char* status)
{
    if (enabled()) emit(std::string("{\"link\":\"") + status + "\"}");
}

inline void point(std::ostream& out, const char* name, const std::string& value, bool good,
    unsigned flags, uint64_t sourceTime)
{
    out << '"' << name << "\":{\"value\":" << (good ? value : "null") << ",\"quality\":\""
        << (good ? "GOOD" : "INVALID") << "\",\"flags\":" << flags << ",\"sourceTimeMs\":" << sourceTime << '}';
}

inline std::string analog(double value)
{
    if (!std::isfinite(value)) return "null";
    std::ostringstream out;
    out << value;
    return out.str();
}

inline void received(const char* name, const std::string& value, bool good, unsigned flags, uint64_t time)
{
    if (!enabled()) return;
    std::ostringstream out;
    out << "{\"points\":{";
    point(out, name, value, good, flags, time);
    out << "}}";
    emit(out.str());
}

inline void gateway(const bay::Sample& sample, unsigned positionFlags, unsigned tripFlags, unsigned currentFlags,
    unsigned failureFlags, unsigned validFlag)
{
    if (!enabled()) return;
    std::ostringstream out;
    out << "{\"points\":{";
    point(out, "position", bay::positionJson(sample.position),
        sample.position != DBPOS_BAD_STATE && positionFlags == validFlag, positionFlags, sample.positionTime);
    out << ',';
    point(out, "trip", sample.tripped ? "true" : "false",
        sample.tripTime && tripFlags == validFlag, tripFlags, sample.tripTime);
    out << ',';
    point(out, "current", analog(sample.amperes),
        sample.currentTime && currentFlags == validFlag && std::isfinite(sample.amperes), currentFlags, sample.currentTime);
    out << ',';
    point(out, "operationFailure", sample.operationFailure.value_or(false) ? "true" : "false",
        sample.operationFailure.has_value() && failureFlags == validFlag, failureFlags, sample.failureTime);
    out << "}}";
    emit(out.str());
}
}
