#pragma once
#include "mms.hpp"

namespace plant {
inline constexpr auto movementTimeoutMs = 950;

inline constexpr char snapshotReference[] = "SIMF01LD0/LLN0.ProcessState";
inline constexpr char actuatorReference[] = "SIMF01LD0/GGIO1.SPCSO1";
inline uint16_t port() { return bay::loopbackPort("LAB_PLANT_MMS_PORT", 8104); }
bool enabled();

struct Snapshot {
    bool contact52a;
    bool contact52b;
    bool fault;
    float sourceKv;
    float feederA;
    uint64_t contactTime;

    Dbpos position() const;
};

class Client {
public:
    Client();
    ~Client();
    Client(const Client&) = delete;
    Client& operator=(const Client&) = delete;
    std::optional<Snapshot> read();
    bool operate(bool close);

private:
    IedConnection connection_;
};
}
