#include "mms.hpp"
#include "web_status.hpp"
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <iostream>
#include <string_view>
#include <thread>
#include "cs104_connection.h"
#include "cs104_slave.h"
#include "hal_time.h"

namespace {
const auto port = bay::loopbackPort("LAB_IEC104_PORT", 2404);
constexpr int station = 1;
constexpr int breakerAddress = 100;
constexpr int tripAddress = 101;
constexpr int currentAddress = 102;
constexpr int failureAddress = 103;
constexpr int latchAddress = 104;
volatile std::sig_atomic_t running = 1;
void stop(int) { running = 0; }

bool localTime = false;

bool configureTimeZone()
{
    const auto zone = std::getenv("LAB_IEC104_TIMEZONE");
    if (!zone || !*zone) return true;
#ifdef _WIN32
    std::cerr << "LAB_IEC104_TIMEZONE requires an IANA timezone database on Linux\n";
    return false;
#else
    const std::string_view name(zone);
    std::error_code error;
    if (name.front() == '/' || name.find("..") != std::string_view::npos ||
        !std::filesystem::is_regular_file(std::filesystem::path("/usr/share/zoneinfo") / zone, error) ||
        setenv("TZ", zone, 1) != 0) {
        std::cerr << "Invalid or unavailable IEC 104 timezone: " << zone << std::endl;
        return false;
    }
    tzset();
    localTime = true;
    std::cout << "IEC 104 timestamps use timezone " << zone << std::endl;
    return true;
#endif
}

bool encodeTime(CP56Time2a encoded, uint64_t milliseconds)
{
    CP56Time2a_createFromMsTimestamp(encoded, milliseconds);
    if (!localTime) return true;
    const auto seconds = static_cast<std::time_t>(milliseconds / 1000);
    std::tm time{};
#ifdef _WIN32
    if (localtime_s(&time, &seconds) != 0) return false;
#else
    if (!localtime_r(&seconds, &time)) return false;
#endif
    if (time.tm_year < 100 || time.tm_year > 199) return false;
    CP56Time2a_setSecond(encoded, time.tm_sec);
    CP56Time2a_setMinute(encoded, time.tm_min);
    CP56Time2a_setHour(encoded, time.tm_hour);
    CP56Time2a_setDayOfMonth(encoded, time.tm_mday);
    CP56Time2a_setMonth(encoded, time.tm_mon + 1);
    CP56Time2a_setYear(encoded, time.tm_year);
    CP56Time2a_setSummerTime(encoded, time.tm_isdst > 0);
    return true;
}

using Send = void (*)(void*, CS101_ASDU);

uint8_t quality(bool valid, uint16_t mmsQuality)
{
    return valid && mmsQuality == 0 ? IEC60870_QUALITY_GOOD : IEC60870_QUALITY_INVALID;
}

void sendPoint(CS101_AppLayerParameters params, CS101_CauseOfTransmission cot, int originator,
    InformationObject point, Send send, void* target)
{
    auto asdu = CS101_ASDU_create(params, false, cot, originator, station, false, false);
    if (CS101_ASDU_addInformationObject(asdu, point)) send(target, asdu);
    InformationObject_destroy(point);
    CS101_ASDU_destroy(asdu);
}

struct Gateway {
    bay::Sample sample{};
    bool valid = false;
    bay::MmsClient mms;
    CS104_Slave server = CS104_Slave_create(32, 16);

    IMasterConnection selectedBy = nullptr;
    int selectedValue = 0;
    int selectedOriginator = 0;
    std::chrono::steady_clock::time_point selectionExpires{};
    IMasterConnection commandConnection = nullptr;
    CS101_ASDU commandRequest = nullptr;
    std::thread commandWorker;
    std::atomic<int> commandResult{0};

    ~Gateway()
    {
        if (commandWorker.joinable()) commandWorker.join();
        if (commandRequest) CS101_ASDU_destroy(commandRequest);
        CS104_Slave_destroy(server);
    }

    void finishCommand()
    {
        const int result = commandResult.load();
        if (!commandRequest || result == 0) return;
        if (commandWorker.joinable()) commandWorker.join();
        if (commandConnection) {
            CS101_ASDU_setCOT(commandRequest, CS101_COT_ACTIVATION_TERMINATION);
            CS101_ASDU_setNegative(commandRequest, result != 1);
            IMasterConnection_sendASDU(commandConnection, commandRequest);
        }
        std::cout << "IEC 104 breaker command " << (result == 1 ? "position confirmed" : "not confirmed") << std::endl;
        CS101_ASDU_destroy(commandRequest);
        commandRequest = nullptr;
        commandConnection = nullptr;
        commandResult = 0;
    }

    void executeBreaker(bool close)
    {
        bay::MmsClient client;
        const auto before = client.read(true);
        const auto expectedBefore = close ? DBPOS_OFF : DBPOS_ON;
        const auto expectedAfter = close ? DBPOS_ON : DBPOS_OFF;
        if (!before || before->position != expectedBefore || before->positionQuality != QUALITY_VALIDITY_GOOD ||
            !before->positionTime) {
            std::cerr << "IEC 104 command rejected by position precheck" << std::endl;
            commandResult = -1;
            return;
        }
        if (!client.operate(close)) {
            std::cerr << "IEC 104 command rejected or unconfirmed by breaker MMS" << std::endl;
            commandResult = -1;
            return;
        }
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
        while (std::chrono::steady_clock::now() < deadline) {
            const auto after = client.read(true);
            if (after && after->position == expectedAfter && after->positionQuality == QUALITY_VALIDITY_GOOD &&
                after->positionTime > before->positionTime) {
                commandResult = 1;
                return;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(75));
        }
        commandResult = -1;
    }

    void transmit(bool timed, int originator, Send send, void* target) const
    {
        auto params = CS104_Slave_getAppLayerParameters(server);
        // IEC 61850 Dbpos and IEC 104 DPI use the same four wire values.
        const auto breaker = static_cast<DoublePointValue>(sample.position);
        const auto posQ = quality(valid, sample.positionQuality);
        const auto tripQ = quality(valid, sample.tripQuality);
        const auto ampQ = quality(valid, sample.currentQuality);
        const auto failureQ = quality(valid && sample.operationFailure.has_value(), sample.failureQuality);
        const auto failure = sample.operationFailure.value_or(false);
        const auto latchQ = quality(valid && sample.closeInhibited.has_value(), sample.latchQuality);
        const auto latch = sample.closeInhibited.value_or(false);
        const auto cot = timed ? CS101_COT_SPONTANEOUS : CS101_COT_INTERROGATED_BY_STATION;
        if (timed) {
            sCP56Time2a posTime{}, tripTime{}, ampTime{}, failureTime{}, latchTime{};
            const auto now = Hal_getTimeInMs();
            const auto prepareTime = [now](CP56Time2a time, uint64_t source) {
                const bool encoded = encodeTime(time, source ? source : now);
                if (!encoded) std::cerr << "Cannot encode IEC 104 timestamp in configured timezone\n";
                CP56Time2a_setInvalid(time, !source || !encoded);
            };
            prepareTime(&posTime, sample.positionTime);
            prepareTime(&tripTime, sample.tripTime);
            prepareTime(&ampTime, sample.currentTime);
            prepareTime(&failureTime, sample.failureTime);
            prepareTime(&latchTime, sample.latchTime);
            sendPoint(params, cot, originator, reinterpret_cast<InformationObject>(
                DoublePointWithCP56Time2a_create(nullptr, breakerAddress, breaker, posQ, &posTime)), send, target);
            sendPoint(params, cot, originator, reinterpret_cast<InformationObject>(
                SinglePointWithCP56Time2a_create(nullptr, tripAddress, sample.tripped, tripQ, &tripTime)), send, target);
            sendPoint(params, cot, originator, reinterpret_cast<InformationObject>(
                MeasuredValueShortWithCP56Time2a_create(nullptr, currentAddress, sample.amperes, ampQ, &ampTime)), send, target);
            if (bay::distributed()) sendPoint(params, cot, originator, reinterpret_cast<InformationObject>(
                SinglePointWithCP56Time2a_create(nullptr, failureAddress, failure, failureQ, &failureTime)), send, target);
            if (bay::distributed()) sendPoint(params, cot, originator, reinterpret_cast<InformationObject>(
                SinglePointWithCP56Time2a_create(nullptr, latchAddress, latch, latchQ, &latchTime)), send, target);
        } else {
            sendPoint(params, cot, originator, reinterpret_cast<InformationObject>(
                DoublePointInformation_create(nullptr, breakerAddress, breaker, posQ)), send, target);
            sendPoint(params, cot, originator, reinterpret_cast<InformationObject>(
                SinglePointInformation_create(nullptr, tripAddress, sample.tripped, tripQ)), send, target);
            sendPoint(params, cot, originator, reinterpret_cast<InformationObject>(
                MeasuredValueShort_create(nullptr, currentAddress, sample.amperes, ampQ)), send, target);
            if (bay::distributed()) sendPoint(params, cot, originator, reinterpret_cast<InformationObject>(
                SinglePointInformation_create(nullptr, failureAddress, failure, failureQ)), send, target);
            if (bay::distributed()) sendPoint(params, cot, originator, reinterpret_cast<InformationObject>(
                SinglePointInformation_create(nullptr, latchAddress, latch, latchQ)), send, target);
        }
    }

    void poll()
    {
        web_status::link(CS104_Slave_getOpenConnections(server) ? "CLIENT CONNECTED" : "LISTENING");
        const auto next = mms.read(true);
        const bool changed = next.has_value() != valid ||
            (next && (next->position != sample.position || next->tripped != sample.tripped ||
                next->amperes != sample.amperes || next->positionQuality != sample.positionQuality ||
                next->tripQuality != sample.tripQuality || next->currentQuality != sample.currentQuality ||
                next->operationFailure != sample.operationFailure || next->failureQuality != sample.failureQuality ||
                next->closeInhibited != sample.closeInhibited || next->latchQuality != sample.latchQuality));
        if (next) sample = *next;
        valid = next.has_value();
        if (changed) transmit(true, 0, [](void* target, CS101_ASDU asdu) {
            CS104_Slave_enqueueASDU(static_cast<CS104_Slave>(target), asdu);
        }, server);
        web_status::gateway(sample, quality(valid, sample.positionQuality), quality(valid, sample.tripQuality),
            quality(valid, sample.currentQuality), quality(valid, sample.failureQuality), IEC60870_QUALITY_GOOD);
        const auto latchFlags = quality(valid && sample.closeInhibited.has_value(), sample.latchQuality);
        web_status::received("closeInhibited", sample.closeInhibited.value_or(false) ? "true" : "false",
            latchFlags == IEC60870_QUALITY_GOOD, latchFlags, sample.latchTime);
    }
};

void peerEvent(void* context, IMasterConnection connection, CS104_PeerConnectionEvent event)
{
    auto& gateway = *static_cast<Gateway*>(context);
    if (event != CS104_CON_EVENT_CONNECTION_CLOSED && event != CS104_CON_EVENT_DEACTIVATED) return;
    if (gateway.selectedBy == connection) gateway.selectedBy = nullptr;
    if (gateway.commandConnection == connection) gateway.commandConnection = nullptr;
}

bool processCommand(void* context, IMasterConnection connection, CS101_ASDU request)
{
    if (CS101_ASDU_getTypeID(request) != C_DC_NA_1) return false;
    auto& gateway = *static_cast<Gateway*>(context);
    const auto now = std::chrono::steady_clock::now();
    if (gateway.selectedBy && now >= gateway.selectionExpires) gateway.selectedBy = nullptr;
    if (CS101_ASDU_getCOT(request) != CS101_COT_ACTIVATION || CS101_ASDU_getCA(request) != station) {
        CS101_ASDU_setCOT(request, CS101_ASDU_getCOT(request) != CS101_COT_ACTIVATION ?
            CS101_COT_UNKNOWN_COT : CS101_COT_UNKNOWN_CA);
        CS101_ASDU_setNegative(request, true);
        IMasterConnection_sendASDU(connection, request);
        return true;
    }
    if (CS101_ASDU_isTest(request) || CS101_ASDU_isNegative(request) ||
        CS101_ASDU_getNumberOfElements(request) != 1) {
        IMasterConnection_sendACT_CON(connection, request, true);
        return true;
    }
    auto object = CS101_ASDU_getElement(request, 0);
    if (!object) {
        IMasterConnection_sendACT_CON(connection, request, true);
        return true;
    }
    auto command = reinterpret_cast<DoubleCommand>(object);
    const int value = DoubleCommand_getState(command);
    const bool select = DoubleCommand_isSelect(command);
    const bool knownAddress = InformationObject_getObjectAddress(object) == breakerAddress;
    const bool valid = (value == 1 || value == 2) && DoubleCommand_getQU(command) == 0;
    InformationObject_destroy(object);
    if (!knownAddress) {
        CS101_ASDU_setCOT(request, CS101_COT_UNKNOWN_IOA);
        CS101_ASDU_setNegative(request, true);
        IMasterConnection_sendASDU(connection, request);
        return true;
    }
    const int originator = CS101_ASDU_getOA(request);
    if (!valid || gateway.commandRequest || (gateway.selectedBy && gateway.selectedBy != connection)) {
        IMasterConnection_sendACT_CON(connection, request, true);
        return true;
    }
    if (select) {
        gateway.selectedBy = connection;
        gateway.selectedValue = value;
        gateway.selectedOriginator = originator;
        gateway.selectionExpires = now + std::chrono::seconds(5);
        IMasterConnection_sendACT_CON(connection, request, false);
        return true;
    }
    if (gateway.selectedBy != connection || gateway.selectedValue != value || gateway.selectedOriginator != originator) {
        IMasterConnection_sendACT_CON(connection, request, true);
        return true;
    }
    gateway.selectedBy = nullptr;
    gateway.commandRequest = CS101_ASDU_clone(request, nullptr);
    if (!gateway.commandRequest) {
        IMasterConnection_sendACT_CON(connection, request, true);
        return true;
    }
    gateway.commandConnection = connection;
    gateway.commandResult = 0;
    gateway.commandWorker = std::thread([&gateway, value] { gateway.executeBreaker(value == 2); });
    IMasterConnection_sendACT_CON(connection, request, false);
    return true;
}

bool interrogate(void* context, IMasterConnection connection, CS101_ASDU request, uint8_t qoi)
{
    if (CS101_ASDU_getCA(request) != station || CS101_ASDU_getCOT(request) != CS101_COT_ACTIVATION ||
        qoi != IEC60870_QOI_STATION) {
        IMasterConnection_sendACT_CON(connection, request, true);
        return true;
    }

    IMasterConnection_sendACT_CON(connection, request, false);
    static_cast<Gateway*>(context)->transmit(false, CS101_ASDU_getOA(request),
        [](void* target, CS101_ASDU asdu) {
            IMasterConnection_sendASDU(static_cast<IMasterConnection>(target), asdu);
        }, connection);
    IMasterConnection_sendACT_TERM(connection, request);
    return true;
}

int gateway()
{
    Gateway gateway;
    CS104_Slave_setLocalAddress(gateway.server, bay::bindAddress());
    CS104_Slave_setLocalPort(gateway.server, port);
    CS104_Slave_setServerMode(gateway.server, CS104_MODE_CONNECTION_IS_REDUNDANCY_GROUP);
    CS104_Slave_setInterrogationHandler(gateway.server, interrogate, &gateway);
    const char* control = std::getenv("LAB_IEC104_CONTROL");
    if (control && std::string_view(control) == "1") {
        CS104_Slave_setASDUHandler(gateway.server, processCommand, &gateway);
        CS104_Slave_setConnectionEventHandler(gateway.server, peerEvent, &gateway);
        std::cout << "IEC 104 supervised breaker control enabled" << std::endl;
    }
    CS104_Slave_startThreadless(gateway.server);
    if (!CS104_Slave_isRunning(gateway.server)) return 1;
    web_status::link("LISTENING");
    std::cout << "IEC 104 ready at " << bay::bindAddress() << ':' << port << std::endl;
    auto next = std::chrono::steady_clock::now();
    while (running) {
        CS104_Slave_tick(gateway.server);
        gateway.finishCommand();
        const auto now = std::chrono::steady_clock::now();
        if (now >= next) {
            gateway.poll();
            next = std::chrono::steady_clock::now() + std::chrono::milliseconds(250);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    CS104_Slave_stopThreadless(gateway.server);
    return 0;
}

struct Master {
    std::atomic<bool> started{false};
    std::atomic<bool> disconnected{false};
    std::atomic<bool> giEnded{false};
    int received = 0;
    bool valid = true;
};

void connectionEvent(void* context, CS104_Connection, CS104_ConnectionEvent event)
{
    auto& state = *static_cast<Master*>(context);
    if (event == CS104_CONNECTION_STARTDT_CON_RECEIVED) {
        state.started = true;
        web_status::link("TRANSFERRING");
    }
    if (event == CS104_CONNECTION_CLOSED || event == CS104_CONNECTION_FAILED) {
        state.disconnected = true;
        web_status::link("DISCONNECTED");
    }
}

uint64_t sourceTime(CP56Time2a timestamp)
{
    if (!timestamp || CP56Time2a_isInvalid(timestamp)) return 0;
    if (!localTime) return CP56Time2a_toMsTimestamp(timestamp);
    std::tm time{};
    time.tm_year = CP56Time2a_getYear(timestamp) + 100;
    time.tm_mon = CP56Time2a_getMonth(timestamp) - 1;
    time.tm_mday = CP56Time2a_getDayOfMonth(timestamp);
    time.tm_hour = CP56Time2a_getHour(timestamp);
    time.tm_min = CP56Time2a_getMinute(timestamp);
    time.tm_sec = CP56Time2a_getSecond(timestamp);
    time.tm_isdst = CP56Time2a_isSummerTime(timestamp) ? 1 : 0;
    const auto expected = time;
    const auto seconds = std::mktime(&time);
    if (seconds < 0 || time.tm_year != expected.tm_year || time.tm_mon != expected.tm_mon ||
        time.tm_mday != expected.tm_mday || time.tm_hour != expected.tm_hour ||
        time.tm_min != expected.tm_min || time.tm_sec != expected.tm_sec ||
        time.tm_isdst != expected.tm_isdst) {
        std::cerr << "Invalid IEC 104 local timestamp for configured timezone\n";
        return 0;
    }
    return static_cast<uint64_t>(seconds) * 1000 + CP56Time2a_getMillisecond(timestamp);
}

bool asduReceived(void* context, int, CS101_ASDU asdu)
{
    auto& state = *static_cast<Master*>(context);
    if (CS101_ASDU_getCA(asdu) != station) return false;
    const auto type = CS101_ASDU_getTypeID(asdu);
    const auto cot = CS101_ASDU_getCOT(asdu);
    if (type == C_IC_NA_1) {
        if (cot == CS101_COT_ACTIVATION_TERMINATION || CS101_ASDU_isNegative(asdu)) state.giEnded = true;
        return true;
    }
    auto point = CS101_ASDU_getElement(asdu, 0);
    if (!point) return false;
    const auto address = InformationObject_getObjectAddress(point);
    const auto source = cot == CS101_COT_INTERROGATED_BY_STATION ? "GI" : "EVENT";
    if (address == breakerAddress && (type == M_DP_NA_1 || type == M_DP_TB_1)) {
        auto p = reinterpret_cast<DoublePointInformation>(point);
        const auto value = DoublePointInformation_getValue(p);
        const auto q = DoublePointInformation_getQuality(p);
        const auto position = static_cast<Dbpos>(value);
        std::cout << source << " breaker=" << bay::positionName(position)
                  << " quality=" << static_cast<int>(q) << std::endl;
        web_status::received("position", bay::positionJson(position),
            q == IEC60870_QUALITY_GOOD && position != DBPOS_BAD_STATE, q,
            type == M_DP_TB_1 ? sourceTime(DoublePointWithCP56Time2a_getTimestamp(
                reinterpret_cast<DoublePointWithCP56Time2a>(point))) : 0);
        if (cot == CS101_COT_INTERROGATED_BY_STATION) {
            state.received |= 1;
            state.valid &= q == IEC60870_QUALITY_GOOD;
        }
    } else if ((address == tripAddress || address == failureAddress || address == latchAddress) &&
        (type == M_SP_NA_1 || type == M_SP_TB_1)) {
        auto p = reinterpret_cast<SinglePointInformation>(point);
        const auto name = address == tripAddress ? "trip" : address == failureAddress ? "operationFailure" : "closeInhibited";
        std::cout << source << ' ' << name << '=' << SinglePointInformation_getValue(p) << std::endl;
        const auto q = SinglePointInformation_getQuality(p);
        web_status::received(name, SinglePointInformation_getValue(p) ? "true" : "false", q == IEC60870_QUALITY_GOOD, q,
            type == M_SP_TB_1 ? sourceTime(SinglePointWithCP56Time2a_getTimestamp(
                reinterpret_cast<SinglePointWithCP56Time2a>(point))) : 0);
        if (address == tripAddress && cot == CS101_COT_INTERROGATED_BY_STATION) {
            state.received |= 2;
            state.valid &= SinglePointInformation_getQuality(p) == IEC60870_QUALITY_GOOD;
        }
    } else if (address == currentAddress && (type == M_ME_NC_1 || type == M_ME_TF_1)) {
        auto p = reinterpret_cast<MeasuredValueShort>(point);
        std::cout << source << " current_A=" << MeasuredValueShort_getValue(p) << std::endl;
        const auto q = MeasuredValueShort_getQuality(p);
        const auto amps = MeasuredValueShort_getValue(p);
        web_status::received("current", web_status::analog(amps), q == IEC60870_QUALITY_GOOD && std::isfinite(amps), q,
            type == M_ME_TF_1 ? sourceTime(MeasuredValueShortWithCP56Time2a_getTimestamp(
                reinterpret_cast<MeasuredValueShortWithCP56Time2a>(point))) : 0);
        if (cot == CS101_COT_INTERROGATED_BY_STATION) {
            state.received |= 4;
            state.valid &= MeasuredValueShort_getQuality(p) == IEC60870_QUALITY_GOOD;
        }
    }
    InformationObject_destroy(point);
    return true;
}

int master(bool watch)
{
    Master state;
    web_status::link("CONNECTING");
    auto connection = CS104_Connection_create(bay::address("LAB_IEC104_HOST"), port);
    CS104_Connection_setConnectionHandler(connection, connectionEvent, &state);
    CS104_Connection_setASDUReceivedHandler(connection, asduReceived, &state);
    if (CS104_Connection_connect(connection)) {
        CS104_Connection_sendStartDT(connection);
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
        while (running && !state.disconnected && !state.started && std::chrono::steady_clock::now() < deadline)
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        if (state.started) {
            CS104_Connection_sendInterrogationCommand(connection, CS101_COT_ACTIVATION, station, IEC60870_QOI_STATION);
            while (running && !state.disconnected && !state.giEnded && std::chrono::steady_clock::now() < deadline)
                std::this_thread::sleep_for(std::chrono::milliseconds(20));
            if (watch && state.giEnded) {
                while (running && !state.disconnected) std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
        }
    }
    CS104_Connection_destroy(connection);
    return state.giEnded && state.received == 7 && state.valid ? 0 : 1;
}

struct MasterCommand {
    std::atomic<bool> started{false};
    std::atomic<bool> disconnected{false};
    std::atomic<int> selection{0};
    std::atomic<int> execution{0};
    std::atomic<int> termination{0};
    int value = 0;
};

void commandConnectionEvent(void* context, CS104_Connection, CS104_ConnectionEvent event)
{
    auto& state = *static_cast<MasterCommand*>(context);
    if (event == CS104_CONNECTION_STARTDT_CON_RECEIVED) state.started = true;
    if (event == CS104_CONNECTION_CLOSED || event == CS104_CONNECTION_FAILED) state.disconnected = true;
}

bool commandResponse(void* context, int, CS101_ASDU asdu)
{
    auto& state = *static_cast<MasterCommand*>(context);
    if (CS101_ASDU_getTypeID(asdu) != C_DC_NA_1 || CS101_ASDU_getCA(asdu) != station ||
        CS101_ASDU_getNumberOfElements(asdu) != 1) return false;
    auto object = CS101_ASDU_getElement(asdu, 0);
    if (!object) return false;
    auto command = reinterpret_cast<DoubleCommand>(object);
    const bool matches = InformationObject_getObjectAddress(object) == breakerAddress &&
        DoubleCommand_getState(command) == state.value && DoubleCommand_getQU(command) == 0;
    const bool selected = DoubleCommand_isSelect(command);
    InformationObject_destroy(object);
    if (!matches) return false;
    const int result = CS101_ASDU_isNegative(asdu) ? -1 : 1;
    if (CS101_ASDU_getCOT(asdu) == CS101_COT_ACTIVATION_CON)
        (selected ? state.selection : state.execution) = result;
    else if (!selected && CS101_ASDU_getCOT(asdu) == CS101_COT_ACTIVATION_TERMINATION)
        state.termination = result;
    return true;
}

int masterCommand(bool close)
{
    MasterCommand state;
    state.value = close ? 2 : 1;
    auto connection = CS104_Connection_create(bay::address("LAB_IEC104_HOST"), port);
    CS104_Connection_setConnectionHandler(connection, commandConnectionEvent, &state);
    CS104_Connection_setASDUReceivedHandler(connection, commandResponse, &state);
    if (!CS104_Connection_connect(connection)) {
        CS104_Connection_destroy(connection);
        std::cout << "command=NO RESPONSE" << std::endl;
        return 1;
    }
    CS104_Connection_sendStartDT(connection);
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (!state.started && !state.disconnected && std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    const auto send = [&](bool select) {
        auto command = DoubleCommand_create(nullptr, breakerAddress, state.value, select, 0);
        const bool sent = CS104_Connection_sendProcessCommandEx(connection, CS101_COT_ACTIVATION,
            station, reinterpret_cast<InformationObject>(command));
        DoubleCommand_destroy(command);
        return sent;
    };
    const bool selected = state.started && !state.disconnected && send(true);
    while (selected && !state.selection && !state.disconnected && std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    if (!selected || state.selection != 1 || state.disconnected) {
        const bool rejected = state.selection == -1;
        CS104_Connection_destroy(connection);
        std::cout << (rejected ? "command=REJECTED" : "command=NO RESPONSE") << std::endl;
        return 1;
    }
    const bool executed = send(false);
    deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    while (executed && !state.termination && state.execution != -1 && !state.disconnected &&
        std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    const bool confirmed = state.execution == 1 && state.termination == 1;
    const bool rejected = state.execution == -1 || state.termination == -1;
    CS104_Connection_destroy(connection);
    std::cout << (confirmed ? "command=POSITION CONFIRMED" : rejected ? "command=REJECTED OR NOT CONFIRMED" :
        "command=NO RESPONSE") << std::endl;
    return confirmed ? 0 : 1;
}
}

int main(int argc, char** argv)
{
    std::signal(SIGINT, stop);
    std::signal(SIGTERM, stop);
    if (!configureTimeZone()) return 1;
    const std::string_view role = argc > 1 ? argv[1] : "";
    if (role == "gateway") return gateway();
    if (role == "master") {
        const std::string_view action = argc > 2 ? argv[2] : "";
        if (action == "open" || action == "close") return masterCommand(action == "close");
        return master(action == "watch");
    }
    std::cerr << "Usage: telecontrol104 gateway | master [watch]\n";
    return 2;
}
