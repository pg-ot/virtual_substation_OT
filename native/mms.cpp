#include "mms.hpp"
#include <atomic>
#include <chrono>
#include <charconv>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string_view>
#include <thread>

namespace bay {

const char* positionName(Dbpos state)
{
    switch (state) {
    case DBPOS_ON: return "CLOSED";
    case DBPOS_OFF: return "OPEN";
    case DBPOS_INTERMEDIATE_STATE: return "INTERMEDIATE";
    default: return "UNKNOWN";
    }
}

const char* positionJson(Dbpos state)
{
    switch (state) {
    case DBPOS_ON: return "\"CLOSED\"";
    case DBPOS_OFF: return "\"OPEN\"";
    case DBPOS_INTERMEDIATE_STATE: return "\"INTERMEDIATE\"";
    default: return "null";
    }
}

const char* address(const char* variable)
{
    const auto value = std::getenv(variable);
    return value && *value ? value : host;
}

bool distributed()
{
    const auto value = std::getenv("LAB_DISTRIBUTED");
    return value && std::string_view(value) == "1";
}

uint16_t loopbackPort(const char* variable, uint16_t fallback)
{
    const auto value = std::getenv(variable);
    if (!value) return fallback;
    const auto end = value + std::char_traits<char>::length(value);
    uint16_t port{};
    const auto parsed = std::from_chars(value, end, port);
    return parsed.ec == std::errc{} && parsed.ptr == end && port != 0 ? port : fallback;
}

namespace {
using Value = std::unique_ptr<MmsValue, decltype(&MmsValue_delete)>;

Value readObject(IedConnection connection, const char* name, FunctionalConstraint fc)
{
    IedClientError error{};
    Value value(IedConnection_readObject(connection, &error, name, fc), MmsValue_delete);
    if (error != IED_ERROR_OK) value.reset();
    return value;
}

bool structure(const Value& value, MmsType first)
{
    if (!value || MmsValue_getType(value.get()) != MMS_STRUCTURE ||
        MmsValue_getArraySize(value.get()) != 3) return false;
    return MmsValue_getType(MmsValue_getElement(value.get(), 0)) == first &&
        MmsValue_getType(MmsValue_getElement(value.get(), 1)) == MMS_BIT_STRING &&
        MmsValue_getType(MmsValue_getElement(value.get(), 2)) == MMS_UTC_TIME;
}

uint16_t quality(const Value& value)
{
    return static_cast<uint16_t>(MmsValue_getBitStringAsInteger(MmsValue_getElement(value.get(), 1)));
}

uint64_t timestamp(const Value& value)
{
    return MmsValue_getUtcTimeInMs(MmsValue_getElement(value.get(), 2));
}
}

MmsClient::MmsClient() : connection_(IedConnection_create()),
    breakerConnection_(distributed() ? IedConnection_create() : nullptr)
{
    IedConnection_setConnectTimeout(connection_, 800);
    IedConnection_setRequestTimeout(connection_, 800);
    if (breakerConnection_) {
        IedConnection_setConnectTimeout(breakerConnection_, 800);
        IedConnection_setRequestTimeout(breakerConnection_, 800);
    }
}

MmsClient::~MmsClient()
{
    IedConnection_destroy(connection_);
    if (breakerConnection_) IedConnection_destroy(breakerConnection_);
}

bool MmsClient::connect()
{
    if (connected()) return true;
    IedClientError error{};
    IedConnection_connect(connection_, &error, mmsHost(), mmsPort());
    return error == IED_ERROR_OK;
}

bool MmsClient::connected() const
{
    return IedConnection_getState(connection_) == IED_STATE_CONNECTED;
}

bool MmsClient::connectControl()
{
    if (!breakerConnection_) return connect();
    if (IedConnection_getState(breakerConnection_) == IED_STATE_CONNECTED) return true;
    IedClientError error{};
    IedConnection_connect(breakerConnection_, &error, breakerMmsHost(), breakerMmsPort());
    return error == IED_ERROR_OK;
}

bool MmsClient::subscribeToBayReport(ReportCallbackFunction callback)
{
    if (breakerConnection_) return false;
    if (!connect()) return false;
    IedClientError error{};
    const auto rcb = IedConnection_getRCBValues(connection_, &error, bayReport, nullptr);
    if (error != IED_ERROR_OK || !rcb) return false;
    IedConnection_installReportHandler(connection_, bayReport, ClientReportControlBlock_getRptId(rcb), callback, nullptr);
    ClientReportControlBlock_setRptEna(rcb, true);
    IedConnection_setRCBValues(connection_, &error, rcb, RCB_ELEMENT_RPT_ENA, true);
    if (error == IED_ERROR_OK) {
        ClientReportControlBlock_setGI(rcb, true);
        IedConnection_setRCBValues(connection_, &error, rcb, RCB_ELEMENT_GI, true);
    }
    ClientReportControlBlock_destroy(rcb);
    return error == IED_ERROR_OK;
}

bool MmsClient::printGooseConfiguration()
{
    if (!connect()) return false;
    IedClientError error{};
    const auto block = IedConnection_getGoCBValues(connection_, &error, "PRF01LD0/LLN0.Protection", nullptr);
    if (error != IED_ERROR_OK || !block) {
        std::cerr << "MMS GOOSE configuration read failed: " << error << std::endl;
        return false;
    }
    std::cout << "dataset=" << ClientGooseControlBlock_getDatSet(block)
              << " confRev=" << ClientGooseControlBlock_getConfRev(block)
              << " appid=" << ClientGooseControlBlock_getDstAddress_appid(block)
              << " min_ms=" << ClientGooseControlBlock_getMinTime(block)
              << " max_ms=" << ClientGooseControlBlock_getMaxTime(block) << std::endl;
    ClientGooseControlBlock_destroy(block);
    return true;
}

std::optional<Sample> MmsClient::read(bool controlStatus)
{
    auto feedbackSource = connection_;
    auto feedbackObject = position;
    bool feedbackOnline;
    if (breakerConnection_) {
        feedbackSource = breakerConnection_;
        feedbackObject = breakerPosition;
        if (IedConnection_getState(breakerConnection_) != IED_STATE_CONNECTED) {
            IedClientError error{};
            IedConnection_connect(breakerConnection_, &error, breakerMmsHost(), breakerMmsPort());
        }
        feedbackOnline = IedConnection_getState(breakerConnection_) == IED_STATE_CONNECTED;
    } else feedbackOnline = connect();

    Sample sample{};
    sample.positionQuality = sample.tripQuality = sample.currentQuality = QUALITY_VALIDITY_INVALID;
    bool hasPosition = false;
    if (feedbackOnline) {
        auto feedback = readObject(feedbackSource, feedbackObject, IEC61850_FC_ST);
        if (structure(feedback, MMS_BIT_STRING)) {
            sample.position = Dbpos_fromMmsValue(MmsValue_getElement(feedback.get(), 0));
            hasPosition = sample.position != DBPOS_BAD_STATE;
            sample.positionQuality = hasPosition ? quality(feedback) : QUALITY_VALIDITY_INVALID;
            sample.positionTime = timestamp(feedback);
        }
        if (breakerConnection_) {
            auto failure = readObject(feedbackSource, breakerFailure, IEC61850_FC_ST);
            if (structure(failure, MMS_BOOLEAN)) {
                sample.operationFailure = MmsValue_getBoolean(MmsValue_getElement(failure.get(), 0));
                sample.failureQuality = quality(failure);
                sample.failureTime = timestamp(failure);
            }
            if (controlStatus) {
                auto latch = readObject(feedbackSource, breakerLatch, IEC61850_FC_ST);
                if (structure(latch, MMS_BOOLEAN)) {
                    sample.closeInhibited = MmsValue_getBoolean(MmsValue_getElement(latch.get(), 0));
                    sample.latchQuality = quality(latch);
                    sample.latchTime = timestamp(latch);
                }
            }
        }
    }
    const bool protectionReady = readProtectionInto(sample, !breakerConnection_);
    if (!breakerConnection_ && !(hasPosition && protectionReady)) return std::nullopt;
    return sample;
}

std::optional<Sample> MmsClient::readProtection()
{
    Sample sample{};
    sample.tripQuality = sample.currentQuality = QUALITY_VALIDITY_INVALID;
    if (!readProtectionInto(sample, false)) return std::nullopt;
    return sample;
}

std::optional<bool> MmsClient::readProtectionTrip()
{
    if (!connect()) return std::nullopt;
    const auto protection = readObject(connection_, trip, IEC61850_FC_ST);
    if (!protection) {
        IedConnection_close(connection_);
        return std::nullopt;
    }
    if (!structure(protection, MMS_BOOLEAN) || quality(protection) != QUALITY_VALIDITY_GOOD ||
        !timestamp(protection)) return std::nullopt;
    return MmsValue_getBoolean(MmsValue_getElement(protection.get(), 0));
}

bool MmsClient::readProtectionInto(Sample& sample, bool requireBoth)
{
    if (!connect()) return false;
    auto protection = readObject(connection_, trip, IEC61850_FC_ST);
    const bool hasTrip = structure(protection, MMS_BOOLEAN);
    if (hasTrip) {
        sample.tripped = MmsValue_getBoolean(MmsValue_getElement(protection.get(), 0));
        sample.tripQuality = quality(protection);
        sample.tripTime = timestamp(protection);
    }
    auto measurement = readObject(connection_, current, IEC61850_FC_MX);
    bool hasCurrent = false;
    if (structure(measurement, MMS_STRUCTURE)) {
        auto vector = MmsValue_getElement(MmsValue_getElement(measurement.get(), 0), 0);
        auto analog = vector && MmsValue_getType(vector) == MMS_STRUCTURE ? MmsValue_getElement(vector, 0) : nullptr;
        if (analog && MmsValue_getType(analog) == MMS_FLOAT) {
            hasCurrent = true;
            sample.amperes = MmsValue_toFloat(analog);
            sample.currentQuality = quality(measurement);
            sample.currentTime = timestamp(measurement);
        }
    }
    return requireBoth ? hasTrip && hasCurrent : hasTrip || hasCurrent;
}

bool MmsClient::operate(bool close)
{
    if (breakerConnection_) return operateBreaker(breakerPosition, close);
    if (!connect()) return false;
    auto control = ControlObjectClient_create(position, connection_);
    if (!control) return false;
    std::atomic<int> termination{0};
    ControlObjectClient_setCommandTerminationHandler(control, [](void* context, ControlObjectClient client) {
        const auto error = ControlObjectClient_getLastApplError(client);
        *static_cast<std::atomic<int>*>(context) =
            error.error == CONTROL_ERROR_NO_ERROR && error.addCause == ADD_CAUSE_UNKNOWN ? 1 : -1;
    }, &termination);
    Value value(MmsValue_newBoolean(close), MmsValue_delete);
    const auto accepted = ControlObjectClient_operate(control, value.get(), 0);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    while (accepted && termination == 0 && std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    ControlObjectClient_destroy(control);
    return accepted && termination == 1;
}

bool MmsClient::operateBreaker(const char* reference, bool requested)
{
    if (!breakerConnection_) return false;
    if (!connectControl()) return false;
    const auto control = ControlObjectClient_create(reference, breakerConnection_);
    if (!control) return false;
    Value value(MmsValue_newBoolean(requested), MmsValue_delete);
    const auto accepted = ControlObjectClient_operate(control, value.get(), 0);
    ControlObjectClient_destroy(control);
    return accepted;
}

bool MmsClient::resetBreakerLatch()
{
    return operateBreaker(breakerReset, true);
}

void print(const Sample& s)
{
    std::cout << "breaker=" << positionName(s.position)
              << " position_quality=" << s.positionQuality << " position_time_ms=" << s.positionTime
              << " trip=" << s.tripped << " current_A=" << s.amperes
              << " trip_quality=" << s.tripQuality << " current_quality=" << s.currentQuality
              << " position_source=" << (distributed() ? breakerPosition : position) << std::endl;
}
}
