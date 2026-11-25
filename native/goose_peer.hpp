#pragma once
#include <cstdint>

// A zero lifetime means the subscription has expired.
using GooseInput = void (*)(void*, bool trip, uint32_t lifetimeMs);
using GooseTick = bool (*)(void*);
int runGoosePeer(const char* interfaceName, GooseInput input = nullptr,
    void* context = nullptr, GooseTick tick = nullptr);
