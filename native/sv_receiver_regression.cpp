#include <array>
#include <chrono>
#include <cmath>
#include <mutex>
#include <optional>
#include <thread>
#include <vector>

// Exercise the library's ASDU callback without relying on host packet scheduling.
#define private public
#include "sv_receiver.hpp"
#undef private
#include "sv_profile.hpp"

int main()
{
    SvCurrentReceiver receiver;
    auto subscriber = SVSubscriber_create(svprofile::destination, svprofile::appId);
    if (!subscriber) return 1;
    SVSubscriber_setListener(subscriber, SvCurrentReceiver::receive, &receiver);
    SVReceiver_addSubscriber(receiver.receiver_, subscriber);

    std::vector<uint8_t> frame = {
        0x01, 0x0c, 0xcd, 0x04, 0x00, 0x01, 0x02, 0, 0, 0, 0, 1,
        0x88, 0xba, 0x40, 0, 0, 0x76, 0, 0, 0, 0,
        0x60, 0x6c, 0x80, 1, 1, 0xa2, 0x67, 0x30, 0x65, 0x80, 0x10,
        'M', 'U', 'F', '0', '1', '/', 'L', 'L', 'N', '0', '$', 'M', 's', 'v', '0', '1',
        0x82, 2, 0, 0, 0x83, 4, 0, 0, 0, 1, 0x85, 1, 0,
        0x86, 2, 0, 80, 0x87, 64
    };
    frame.resize(frame.size() + 64, 0);
    const auto send = [&](uint16_t count) {
        frame[51] = static_cast<uint8_t>(count >> 8);
        frame[52] = static_cast<uint8_t>(count);
        SVReceiver_handleL2Message(receiver.receiver_, frame.data(), static_cast<int>(frame.size()));
    };

    for (uint16_t count = 0; count < 80; ++count) send(count);
    if (!receiver.current()) return 2;

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    send(80);
    if (receiver.current()) return 3;
    for (uint16_t count = 81; count < 160; ++count) send(count);
    if (!receiver.current()) return 4;

    send(161);
    if (receiver.current()) return 5;

    // A repeated sample invalidates the window until a complete new cycle arrives.
    for (uint16_t count = 162; count < 241; ++count) send(count);
    if (!receiver.current()) return 6;
    send(240);
    if (receiver.current()) return 7;
    for (uint16_t count = 241; count < 320; ++count) send(count);
    if (!receiver.current()) return 8;

    // The counter wraps at 4000, not at the integer type's maximum.
    send(3960);
    if (receiver.current()) return 24;
    for (uint16_t count = 3961; count < 4000; ++count) send(count);
    for (uint16_t count = 0; count < 40; ++count) send(count);
    if (!receiver.current()) return 9;
    send(4000);
    if (receiver.current()) return 10;
    for (uint16_t count = 40; count < 120; ++count) send(count);
    if (!receiver.current()) return 11;

    // Invalid sample quality discards the window and requires a new cycle.
    frame[frame.size() - 64 + 7] = 2;
    send(120);
    if (receiver.current()) return 12;
    frame[frame.size() - 64 + 7] = 0;
    for (uint16_t count = 121; count < 201; ++count) send(count);
    if (!receiver.current()) return 13;

    // A different stream identifier cannot refresh this stream's timeout.
    frame[33] = 'X';
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    send(201);
    if (receiver.current()) return 14;
    frame[33] = 'M';
    for (uint16_t count = 202; count < 282; ++count) send(count);
    if (!receiver.current()) return 15;

    // A different configuration revision cannot refresh the valid stream.
    frame[58] = 2;
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    send(282);
    if (receiver.current()) return 16;
    frame[58] = 1;
    for (uint16_t count = 283; count < 363; ++count) send(count);
    if (!receiver.current()) return 17;

    // A gap and recovery between process polls must still be observed.
    send(363);
    send(365);
    for (uint16_t count = 366; count < 445; ++count) send(count);
    if (receiver.current()) return 18;
    if (!receiver.current()) return 19;

    // The same applies to a transient bad-quality sample.
    frame[frame.size() - 64 + 7] = 2;
    send(445);
    frame[frame.size() - 64 + 7] = 0;
    for (uint16_t count = 446; count < 526; ++count) send(count);
    if (receiver.current()) return 20;
    if (!receiver.current()) return 21;

    // A timeout and recovery between polls must also be reported.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    for (uint16_t count = 526; count < 606; ++count) send(count);
    if (receiver.current()) return 22;
    if (!receiver.current()) return 23;

    if (!svprofile::fromSampleRate(nullptr) || !svprofile::fromSampleRate("400") ||
        svprofile::fromSampleRate("401") || svprofile::fromSampleRate("")) return 25;

    SvCurrentReceiver slow(svprofile::slowTraining);
    auto slowSubscriber = SVSubscriber_create(svprofile::destination, svprofile::appId);
    if (!slowSubscriber) return 26;
    SVSubscriber_setListener(slowSubscriber, SvCurrentReceiver::receive, &slow);
    SVReceiver_addSubscriber(slow.receiver_, slowSubscriber);
    frame[48] = '8';
    frame[65] = 8;
    const auto valueOffset = frame.size() - 64;
    frame[valueOffset] = 0;
    frame[valueOffset + 1] = 1;
    frame[valueOffset + 2] = 0xd4;
    frame[valueOffset + 3] = 0xc0;
    const auto sendSlow = [&](uint16_t count) {
        frame[51] = static_cast<uint8_t>(count >> 8);
        frame[52] = static_cast<uint8_t>(count);
        SVReceiver_handleL2Message(slow.receiver_, frame.data(), static_cast<int>(frame.size()));
    };
    for (uint16_t count = 0; count < 7; ++count) sendSlow(count);
    if (slow.current()) return 27;
    sendSlow(7);
    const auto slowCurrent = slow.current();
    if (!slowCurrent || std::abs(*slowCurrent - 120.0F) > 0.01F) return 28;
    sendSlow(9);
    if (slow.current()) return 29;
    for (uint16_t count = 10; count < 17; ++count) sendSlow(count);
    if (!slow.current()) return 30;

    sendSlow(398);
    if (slow.current()) return 31;
    sendSlow(399);
    for (uint16_t count = 0; count < 6; ++count) sendSlow(count);
    if (!slow.current()) return 32;
    sendSlow(400);
    if (slow.current()) return 33;

    frame[65] = 80;
    for (uint16_t count = 0; count < 8; ++count) sendSlow(count);
    if (slow.current()) return 34;
    frame[65] = 8;
    for (uint16_t count = 0; count < 8; ++count) sendSlow(count);
    if (!slow.current()) return 35;

    // A fast-profile stream cannot refresh the slow receiver.
    frame[48] = '1';
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    sendSlow(8);
    if (slow.current()) return 36;
    return 0;
}
