#include <atomic>
#include <chrono>
#include <iostream>
#include <string_view>
#include <thread>
#include "cs104_connection.h"

struct Probe {
    std::atomic<bool> started{false};
    std::atomic<int> confirmation{0};
    std::atomic<int> termination{0};
    std::atomic<int> errorCause{0};
};

static void connectionEvent(void* context, CS104_Connection, CS104_ConnectionEvent event)
{
    if (event == CS104_CONNECTION_STARTDT_CON_RECEIVED)
        static_cast<Probe*>(context)->started = true;
}

static bool received(void* context, int, CS101_ASDU asdu)
{
    if (CS101_ASDU_getTypeID(asdu) == C_DC_NA_1) {
        const int result = CS101_ASDU_isNegative(asdu) ? -1 : 1;
        const auto cause = CS101_ASDU_getCOT(asdu);
        std::cout << "IEC 104 command response cause=" << cause << " result=" << result << std::endl;
        if (cause == CS101_COT_ACTIVATION_CON) static_cast<Probe*>(context)->confirmation = result;
        if (cause == CS101_COT_ACTIVATION_TERMINATION) static_cast<Probe*>(context)->termination = result;
        if (result < 0 && cause >= CS101_COT_UNKNOWN_TYPE_ID) static_cast<Probe*>(context)->errorCause = cause;
    }
    return true;
}

int main(int argc, char** argv)
{
    if (argc != 3 || (std::string_view(argv[2]) != "open" && std::string_view(argv[2]) != "close" &&
        std::string_view(argv[2]) != "execute-without-select" && std::string_view(argv[2]) != "expired" &&
        std::string_view(argv[2]) != "mismatch" && std::string_view(argv[2]) != "contention" &&
        std::string_view(argv[2]) != "disconnect-after-execute" && std::string_view(argv[2]) != "unknown-ca" &&
        std::string_view(argv[2]) != "unknown-ioa" && std::string_view(argv[2]) != "unknown-cot")) {
        std::cerr << "Usage: iec104-command-probe <gateway-host> <test-mode>\n";
        return 2;
    }
    Probe probe;
    auto connection = CS104_Connection_create(argv[1], 2404);
    CS104_Connection_setConnectionHandler(connection, connectionEvent, &probe);
    CS104_Connection_setASDUReceivedHandler(connection, received, &probe);
    if (!CS104_Connection_connect(connection)) {
        CS104_Connection_destroy(connection);
        return 3;
    }
    CS104_Connection_sendStartDT(connection);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (!probe.started && std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    const bool withoutSelect = std::string_view(argv[2]) == "execute-without-select";
    const int value = std::string_view(argv[2]) == "close" ? 2 : 1;
    const auto send = [&](bool select, int requestedValue) {
        auto command = DoubleCommand_create(nullptr, std::string_view(argv[2]) == "unknown-ioa" ? 999 : 100,
            requestedValue, select, 0);
        const auto cause = std::string_view(argv[2]) == "unknown-cot" ? CS101_COT_REQUEST : CS101_COT_ACTIVATION;
        const bool sent = CS104_Connection_sendProcessCommandEx(connection, cause,
            std::string_view(argv[2]) == "unknown-ca" ? 2 : 1, reinterpret_cast<InformationObject>(command));
        DoubleCommand_destroy(command);
        return sent;
    };
    const bool sent = probe.started && send(!withoutSelect, value);
    if (std::string_view(argv[2]).substr(0, 8) == "unknown-") {
        while (sent && !probe.errorCause && std::chrono::steady_clock::now() < deadline)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        const int expected = std::string_view(argv[2]) == "unknown-ca" ? CS101_COT_UNKNOWN_CA :
            std::string_view(argv[2]) == "unknown-ioa" ? CS101_COT_UNKNOWN_IOA : CS101_COT_UNKNOWN_COT;
        const bool correct = probe.errorCause == expected;
        CS104_Connection_destroy(connection);
        return sent && correct ? 0 : 1;
    }
    while (sent && !probe.confirmation && std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    if (withoutSelect) {
        const bool rejected = probe.confirmation == -1;
        CS104_Connection_destroy(connection);
        return sent && rejected ? 0 : 1;
    }
    if (!sent || probe.confirmation != 1) {
        CS104_Connection_destroy(connection);
        return 1;
    }
    if (std::string_view(argv[2]) == "contention") {
        Probe otherProbe;
        auto other = CS104_Connection_create(argv[1], 2404);
        CS104_Connection_setConnectionHandler(other, connectionEvent, &otherProbe);
        CS104_Connection_setASDUReceivedHandler(other, received, &otherProbe);
        bool passed = CS104_Connection_connect(other);
        if (passed) CS104_Connection_sendStartDT(other);
        const auto waitUntil = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        while (passed && !otherProbe.started && std::chrono::steady_clock::now() < waitUntil)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        auto otherSelect = DoubleCommand_create(nullptr, 100, 1, true, 0);
        passed = passed && otherProbe.started && CS104_Connection_sendProcessCommandEx(other,
            CS101_COT_ACTIVATION, 1, reinterpret_cast<InformationObject>(otherSelect));
        const auto responseDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        while (passed && !otherProbe.confirmation && std::chrono::steady_clock::now() < responseDeadline)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        passed = passed && otherProbe.confirmation == -1;
        CS104_Connection_destroy(connection);
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        otherProbe.confirmation = 0;
        passed = passed && CS104_Connection_sendProcessCommandEx(other, CS101_COT_ACTIVATION,
            1, reinterpret_cast<InformationObject>(otherSelect));
        const auto cleanupDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        while (passed && !otherProbe.confirmation && std::chrono::steady_clock::now() < cleanupDeadline)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        passed = passed && otherProbe.confirmation == 1;
        DoubleCommand_destroy(otherSelect);
        CS104_Connection_destroy(other);
        return passed ? 0 : 1;
    }
    if (std::string_view(argv[2]) == "expired") std::this_thread::sleep_for(std::chrono::milliseconds(5500));
    const bool expectRejection = std::string_view(argv[2]) == "expired" || std::string_view(argv[2]) == "mismatch";
    probe.confirmation = 0;
    const bool executed = send(false, std::string_view(argv[2]) == "mismatch" ? 2 : value);
    const auto executionDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(12);
    if (std::string_view(argv[2]) == "disconnect-after-execute") {
        while (executed && !probe.confirmation && std::chrono::steady_clock::now() < executionDeadline)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        const bool dispatched = probe.confirmation == 1;
        CS104_Connection_destroy(connection);
        return executed && dispatched ? 0 : 1;
    }
    if (expectRejection) {
        while (executed && !probe.confirmation && std::chrono::steady_clock::now() < executionDeadline)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        const bool rejected = probe.confirmation == -1;
        CS104_Connection_destroy(connection);
        return executed && rejected ? 0 : 1;
    }
    while (executed && !probe.termination && std::chrono::steady_clock::now() < executionDeadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    const bool confirmed = probe.confirmation == 1 && probe.termination == 1;
    CS104_Connection_destroy(connection);
    return executed && confirmed ? 0 : 1;
}
