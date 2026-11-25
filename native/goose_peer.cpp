#include "mms.hpp"
#include "goose_peer.hpp"
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include "goose_receiver.h"
#include "goose_subscriber.h"
extern "C" {
#include "feeder_model.h"
}

namespace {
volatile std::sig_atomic_t running = 1;
void stop(int) { running = 0; }

struct Subscription {
    std::string dataSet;
    uint32_t revision;
    GooseInput input;
    void* context;
    std::mutex mutex;
    int64_t expiresAt = 0;
    uint32_t lastState = 0;
    uint32_t lastSequence = 0;
    bool hasState = false;
};

int64_t monotonicMilliseconds()
{
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

void report(GooseSubscriber subscriber, void* context)
{
    auto& expected = *static_cast<Subscription*>(context);
    if (!GooseSubscriber_isValid(subscriber) || GooseSubscriber_isTest(subscriber) ||
        GooseSubscriber_needsCommission(subscriber) || GooseSubscriber_getConfRev(subscriber) != expected.revision ||
        GooseSubscriber_getDataSet(subscriber) != expected.dataSet) return;
    auto data = GooseSubscriber_getDataSetValues(subscriber);
    if (!data || MmsValue_getArraySize(data) != 2) return;
    auto trip = MmsValue_getElement(data, 0);
    auto quality = MmsValue_getElement(data, 1);
    if (!trip || MmsValue_getType(trip) != MMS_BOOLEAN || !quality ||
        MmsValue_getType(quality) != MMS_BIT_STRING || MmsValue_getBitStringSize(quality) != 13) return;
    const auto lifetime = GooseSubscriber_getTimeAllowedToLive(subscriber);
    if (lifetime == 0) return;
    std::lock_guard lock(expected.mutex);
    const auto now = monotonicMilliseconds();
    if (expected.expiresAt != 0 && now >= expected.expiresAt) {
        expected.hasState = false;
        expected.expiresAt = 0;
        if (expected.input) expected.input(expected.context, false, 0);
    }
    const auto state = GooseSubscriber_getStNum(subscriber);
    const auto sequence = GooseSubscriber_getSqNum(subscriber);
    if (expected.hasState) {
        const auto difference = state == expected.lastState
            ? sequence - expected.lastSequence : state - expected.lastState;
        if (difference == 0 || difference >= 0x80000000U) return;
    }
    expected.lastState = state;
    expected.lastSequence = sequence;
    expected.hasState = true;
    expected.expiresAt = now + lifetime;
    if (Quality_fromMmsValue(quality) != QUALITY_VALIDITY_GOOD) {
        std::puts("GOOSE INVALID: protection quality is not good");
        std::fflush(stdout);
        if (expected.input) expected.input(expected.context, false, 0);
        return;
    }
    const auto asserted = MmsValue_getBoolean(trip);
    std::printf("GOOSE LIVE stNum=%u sqNum=%u confRev=%u ttl_ms=%u trip=%d\n",
        GooseSubscriber_getStNum(subscriber), GooseSubscriber_getSqNum(subscriber),
        expected.revision, lifetime, asserted);
    std::fflush(stdout);
    const auto acceptedAt = std::chrono::steady_clock::now();
    if (expected.input) expected.input(expected.context, asserted, lifetime);
    const auto timing = std::getenv("LAB_GOOSE_TIMING");
    if (timing && std::string_view(timing) == "1") {
        const auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
            acceptedAt.time_since_epoch()).count();
        std::printf("GOOSE_TIMING accepted_ns=%lld stNum=%u sqNum=%u trip=%d\n",
            static_cast<long long>(ns), state, sequence, asserted);
        std::fflush(stdout);
    }
}
}

int runGoosePeer(const char* interfaceName, GooseInput input, void* context, GooseTick tick)
{
    std::signal(SIGINT, stop);
    std::signal(SIGTERM, stop);
    const auto block = iedModel.gseCBs;
    if (!block || !block->address) {
        std::fputs("Feeder SCL contains no GOOSE address\n", stderr);
        return 1;
    }
    char nodeReference[130]{};
    ModelNode_getObjectReference(reinterpret_cast<ModelNode*>(block->parent), nodeReference);
    std::string control = std::string(nodeReference) + "$GO$" + block->name;
    Subscription subscription{std::string(nodeReference) + '$' + block->dataSetName, block->confRev, input, context, {}};
    auto receiver = GooseReceiver_create();
    auto subscriber = GooseSubscriber_create(control.data(), nullptr);
    GooseSubscriber_setDstMac(subscriber, block->address->dstAddress);
    GooseSubscriber_setAppId(subscriber, block->address->appId);
    GooseSubscriber_setListener(subscriber, report, &subscription);
    GooseReceiver_setInterfaceId(receiver, interfaceName);
    GooseReceiver_addSubscriber(receiver, subscriber);
    GooseReceiver_start(receiver);
    if (!GooseReceiver_isRunning(receiver)) {
        std::fputs("Unable to start Layer 2 receiver on the requested interface\n", stderr);
        GooseReceiver_destroy(receiver);
        return 1;
    }
    while (running) {
        {
            std::lock_guard lock(subscription.mutex);
            if (subscription.expiresAt != 0 && monotonicMilliseconds() >= subscription.expiresAt) {
                subscription.expiresAt = 0;
                subscription.hasState = false;
                std::puts("GOOSE STALE: time allowed to live expired");
                std::fflush(stdout);
                if (input) input(context, false, 0);
            }
        }
        if (tick && !tick(context)) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    GooseReceiver_stop(receiver);
    GooseReceiver_destroy(receiver);
    return 0;
}
