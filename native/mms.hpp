#pragma once
#include <cstdint>
#include <optional>
#include "iec61850_client.h"

namespace bay {

inline constexpr char host[] = "127.0.0.1";
// The native bench defaults to loopback when no endpoint is configured.
const char* address(const char* variable);
inline const char* bindAddress() { return address("LAB_BIND_ADDRESS"); }
inline const char* mmsHost() { return address("LAB_MMS_HOST"); }
inline const char* breakerMmsHost() { return address("LAB_BREAKER_MMS_HOST"); }
uint16_t loopbackPort(const char* variable, uint16_t fallback);
inline uint16_t mmsPort() { return loopbackPort("LAB_MMS_PORT", 8102); }
inline uint16_t breakerMmsPort() { return loopbackPort("LAB_BREAKER_MMS_PORT", 8103); }
bool distributed();
inline constexpr char position[] = "PRF01LD0/XCBR1.Pos";
inline constexpr char breakerPosition[] = "BRF01LD0/XCBR1.Pos";
inline constexpr char breakerFailure[] = "BRF01LD0/GGIO1.Ind1";
inline constexpr char breakerLatch[] = "BRF01LD0/GGIO1.Ind2";
inline constexpr char breakerReset[] = "BRF01LD0/GGIO1.SPCSO1";
inline constexpr char trip[] = "PRF01LD0/PTRC1.Tr";
inline constexpr char current[] = "PRF01LD0/MMXU1.A.phsA";
inline constexpr char bayReport[] = "PRF01LD0/LLN0.RP.BayReport01";

struct Sample {
    Dbpos position{DBPOS_BAD_STATE};
    bool tripped{};
    float amperes{};
    uint16_t positionQuality{};
    uint16_t tripQuality{};
    uint16_t currentQuality{};
    uint64_t positionTime{};
    uint64_t tripTime{};
    uint64_t currentTime{};
    std::optional<bool> operationFailure;
    uint16_t failureQuality{QUALITY_VALIDITY_INVALID};
    uint64_t failureTime{};
    std::optional<bool> closeInhibited;
    uint16_t latchQuality{QUALITY_VALIDITY_INVALID};
    uint64_t latchTime{};
};

const char* positionName(Dbpos state);
const char* positionJson(Dbpos state);
class MmsClient {
public:
    MmsClient();
    ~MmsClient();
    MmsClient(const MmsClient&) = delete;
    MmsClient& operator=(const MmsClient&) = delete;

    bool connect();
    bool connected() const;
    bool connectControl();
    std::optional<Sample> read(bool controlStatus = false);
    std::optional<Sample> readProtection();
    std::optional<bool> readProtectionTrip();
    bool operate(bool close);
    bool resetBreakerLatch();
    bool subscribeToBayReport(ReportCallbackFunction callback);
    bool printGooseConfiguration();
private:
    bool operateBreaker(const char* address, bool value);
    bool readProtectionInto(Sample& sample, bool requireBoth);
    IedConnection connection_;
    IedConnection breakerConnection_;
};

void print(const Sample& sample);

}
