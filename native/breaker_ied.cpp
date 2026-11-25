#include "plant.hpp"
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include "hal_time.h"
#include "iec61850_server.h"
#include "iec61850_dynamic_model.h"
#include "iec61850_cdc.h"

#ifdef LAB_GOOSE
#include "goose_peer.hpp"
#ifndef _WIN32
#include <poll.h>
#include <unistd.h>
#endif
#endif

namespace {
class Breaker {
public:
    explicit Breaker(bool bench)
        : benchProtectionMms_(bench && processEnabled_ && benchProtectionMmsEnabled())
    {
        auto ld = LogicalDevice_create("LD0", model_);
        LogicalNode_create("LLN0", ld);
        auto breaker = LogicalNode_create("XCBR1", ld);
        position_ = CDC_DPC_create("Pos", reinterpret_cast<ModelNode*>(breaker), 0,
            processEnabled_ ? CDC_CTL_MODEL_DIRECT_NORMAL : CDC_CTL_MODEL_NONE);
        if (processEnabled_) {
            auto io = reinterpret_cast<ModelNode*>(LogicalNode_create("GGIO1", ld));
            failure_ = CDC_SPS_create("Ind1", io, 0);
            latch_ = CDC_SPS_create("Ind2", io, 0);
            reset_ = CDC_SPC_create("SPCSO1", io, 0, CDC_CTL_MODEL_DIRECT_NORMAL);
        }
        server_ = IedServer_create(model_);
        IedServer_setLocalIpAddress(server_, bay::bindAddress());
        if (processEnabled_) {
            IedServer_setPerformCheckHandler(server_, position_, checkStationRequest, this);
            IedServer_setControlHandler(server_, position_, operateFromStation, this);
            IedServer_setPerformCheckHandler(server_, reset_, checkStationReset, this);
            IedServer_setControlHandler(server_, reset_, resetFromStation, this);
        }
        publish();
    }

    ~Breaker()
    {
        running_ = false;
        if (protectionWorker_.joinable()) protectionWorker_.join();
        if (worker_.joinable()) worker_.join();
        if (IedServer_isRunning(server_)) IedServer_stop(server_);
        IedServer_destroy(server_);
        IedModel_destroy(model_);
    }

    bool start()
    {
        const auto port = bay::breakerMmsPort();
        IedServer_start(server_, port);
        if (!IedServer_isRunning(server_)) return false;
        std::cout << "BRF01 MMS ready at " << bay::bindAddress() << ':' << port << std::endl;
        if (processEnabled_) worker_ = std::thread([this] {
            plant::Client client;
            while (running_) {
                pollProcess(client);
                std::this_thread::sleep_for(std::chrono::milliseconds(40));
            }
        });
        if (benchProtectionMms_) protectionWorker_ = std::thread([this] {
            bay::MmsClient client;
            bool previouslyClear = false;
            while (running_) {
                const bool clear = client.readProtectionTrip() == false;
                {
                    std::lock_guard lock(mutex_);
                    benchMmsClearUntil_ = clear ? Clock::now() + std::chrono::milliseconds(750) : Clock::time_point{};
                }
                if (clear != previouslyClear)
                    std::cout << "Breaker MMS protection permissive " << (clear ? "clear" : "blocked") << std::endl;
                previouslyClear = clear;
                std::this_thread::sleep_for(std::chrono::milliseconds(200));
            }
        });
        return true;
    }

    void protection(bool asserted, uint32_t lifetimeMs)
    {
        std::lock_guard lock(mutex_);
        tripDeadline_ = Clock::now() + std::chrono::milliseconds(lifetimeMs);
        if (lifetimeMs == 0) return;
        if (processEnabled_) {
            asserted_ = asserted;
            if (asserted) {
                setLatch(true);
                closeQueued_ = false;
                if (!tripDispatched_) pendingTrip_ = true;
            } else tripDispatched_ = false;
            return;
        }
        if (asserted && !asserted_) faultCleared_ = false;
        asserted_ = asserted;
        if (asserted) trip();
    }

    void command(const std::string& command, bool bench)
    {
        if (bench && distributed_ && (command == "trip" || command == "healthy" || command == "stale")) {
            protection(command == "trip", command == "stale" ? 0 : 3000);
            return;
        }
        std::lock_guard lock(mutex_);
        if (processEnabled_) {
            if (command == "reset" && canClose()) {
                setLatch(false);
                setFailure(false);
                std::cout << "Breaker trip latch reset" << std::endl;
            } else if (command == "close" && !latched_ && !closeQueued_ && !stationRequest_ && canClose()) {
                closeQueued_ = true;
                std::cout << "Breaker close queued" << std::endl;
            } else std::cout << "Breaker command rejected: " << command << std::endl;
        } else if (bench && !distributed_ && command == "trip") {
            trip();
        } else if (distributed_ && !closed_ && (command == "feedback-open" || command == "feedback-closed")) {
            changePosition(command == "feedback-closed");
            if (pendingTrip_) trip();
        } else if (distributed_ && command == "fault-cleared") {
            faultCleared_ = true;
            std::cout << "Fixture confirmed fault clearance" << std::endl;
        } else if (command == "reset" && (!distributed_ ||
                   (closed_ == false && freshDeasserted() && faultCleared_))) {
            latched_ = false;
            pendingTrip_ = false;
            std::cout << "Breaker trip latch reset" << std::endl;
        } else if (command == "close" && !latched_ &&
                   (!distributed_ || (closed_ == false && freshDeasserted() && faultCleared_))) {
            changePosition(true);
        } else std::cout << "Breaker command rejected: " << command << std::endl;
    }

private:
    using Clock = std::chrono::steady_clock;

    struct Movement {
        bool close;
        Clock::time_point deadline;
    };

    static bool benchProtectionMmsEnabled()
    {
        const auto flag = std::getenv("LAB_BENCH_PROTECTION_MMS");
        return flag && std::string(flag) == "1";
    }

    static CheckHandlerResult checkStationReset(ControlAction action, void* context, MmsValue* value, bool test, bool)
    {
        auto& self = *static_cast<Breaker*>(context);
        if (test || MmsValue_getType(value) != MMS_BOOLEAN || !MmsValue_getBoolean(value)) return CONTROL_VALUE_INVALID;
        std::lock_guard lock(self.mutex_);
        if (self.canResetFromStation()) return CONTROL_ACCEPTED;
        ControlAction_setAddCause(action, ADD_CAUSE_BLOCKED_BY_INTERLOCKING);
        return CONTROL_OBJECT_ACCESS_DENIED;
    }

    static ControlHandlerResult resetFromStation(ControlAction action, void* context, MmsValue* value, bool test)
    {
        auto& self = *static_cast<Breaker*>(context);
        if (test || MmsValue_getType(value) != MMS_BOOLEAN || !MmsValue_getBoolean(value)) return CONTROL_RESULT_FAILED;
        std::lock_guard lock(self.mutex_);
        if (!self.canResetFromStation()) {
            ControlAction_setAddCause(action, ADD_CAUSE_BLOCKED_BY_INTERLOCKING);
            return CONTROL_RESULT_FAILED;
        }
        self.resetQueued_ = true;
        return CONTROL_RESULT_OK;
    }

    static ControlHandlerResult operateFromStation(ControlAction action, void* context, MmsValue* value, bool test)
    {
        auto& self = *static_cast<Breaker*>(context);
        if (test || MmsValue_getType(value) != MMS_BOOLEAN) return CONTROL_RESULT_FAILED;
        const bool close = MmsValue_getBoolean(value);
        std::lock_guard lock(self.mutex_);
        if (!self.stationPermitted(action, close)) return CONTROL_RESULT_FAILED;
        self.stationRequest_ = close;
        return CONTROL_RESULT_OK;
    }

    static CheckHandlerResult checkStationRequest(ControlAction action, void* context, MmsValue* value, bool test, bool)
    {
        auto& self = *static_cast<Breaker*>(context);
        if (test || MmsValue_getType(value) != MMS_BOOLEAN) return CONTROL_VALUE_INVALID;
        std::lock_guard lock(self.mutex_);
        return self.stationPermitted(action, MmsValue_getBoolean(value)) ? CONTROL_ACCEPTED : CONTROL_OBJECT_ACCESS_DENIED;
    }

    bool stationPermitted(ControlAction action, bool close) const
    {
        if (stationRequest_ || resetQueued_ || closeQueued_ || pendingTrip_ || issuingCommand_ || movement_) {
            ControlAction_setAddCause(action, ADD_CAUSE_COMMAND_ALREADY_IN_EXECUTION);
            return false;
        }
        if (close ? latched_ || !canClose(true) : processState_ != DBPOS_ON) {
            ControlAction_setAddCause(action, ADD_CAUSE_BLOCKED_BY_INTERLOCKING);
            return false;
        }
        return true;
    }

    static const char* positionName(Dbpos state)
    {
        if (state == DBPOS_ON) return "CLOSED";
        if (state == DBPOS_OFF) return "OPEN";
        if (state == DBPOS_INTERMEDIATE_STATE) return "INTERMEDIATE";
        return "UNKNOWN";
    }

    bool canClose(bool station = false) const
    {
        const auto now = Clock::now();
        const bool clear = station && benchProtectionMms_ ?
            now < benchMmsClearUntil_ && !(asserted_ && now < tripDeadline_) : freshDeasserted();
        return processFault_ == false && processState_ == DBPOS_OFF && clear &&
            !pendingTrip_ && !movement_ && !issuingCommand_;
    }

    bool canResetFromStation() const
    {
        return latched_ && !resetQueued_ && !closeQueued_ && !stationRequest_ && canClose(true);
    }

    void pollProcess(plant::Client& client)
    {
        const auto feedback = client.read();
        std::optional<bool> request;
        {
            std::lock_guard lock(mutex_);
            processFault_ = feedback ? std::optional<bool>(feedback->fault) : std::nullopt;
            auto state = feedback ? feedback->position() : DBPOS_BAD_STATE;
            if (pendingTrip_ && Clock::now() >= tripDeadline_) pendingTrip_ = false;
            if (feedback && pendingTrip_) {
                const bool closing = movement_ && movement_->close;
                const bool opening = movement_ && !movement_->close;
                if (closing) {
                    movement_.reset();
                    std::cout << "Breaker close superseded by trip" << std::endl;
                }
                if (!opening && (state != DBPOS_OFF || closing)) request = false;
                pendingTrip_ = false;
                tripDispatched_ = asserted_;
            } else if (closeQueued_) {
                if (!latched_ && state == DBPOS_OFF && canClose()) request = true;
                else std::cout << "Breaker queued close rejected" << std::endl;
            } else if (stationRequest_) {
                const bool close = *stationRequest_;
                if (close ? (!latched_ && canClose(true) && state == DBPOS_OFF) : state == DBPOS_ON)
                    request = close;
                else std::cout << "Breaker station request blocked before dispatch" << std::endl;
            } else if (resetQueued_ && state == DBPOS_OFF && canClose(true)) {
                setLatch(false);
                setFailure(false);
                std::cout << "Breaker trip latch reset from station" << std::endl;
            }
            closeQueued_ = false;
            stationRequest_.reset();
            resetQueued_ = false;
            if (movement_) {
                if (state == (movement_->close ? DBPOS_ON : DBPOS_OFF)) {
                    movement_.reset();
                    movementFailed_ = false;
                    setFailure(false);
                } else if (!feedback || Clock::now() >= movement_->deadline) {
                    movement_.reset();
                    movementFailed_ = true;
                    setFailure(true);
                    std::cout << "Breaker operation failed: " <<
                        (feedback ? "movement timeout" : "feedback lost") << std::endl;
                }
            }
            if (state == DBPOS_INTERMEDIATE_STATE && (!movement_ || movementFailed_)) state = DBPOS_BAD_STATE;
            const auto time = !feedback ? uint64_t{0} :
                state == DBPOS_BAD_STATE && feedback->position() == DBPOS_INTERMEDIATE_STATE && movementFailed_
                    ? failureTime_ : feedback->contactTime;
            if (state != processState_ || time != processTime_) {
                processState_ = state;
                processTime_ = time;
                IedServer_lockDataModel(server_);
                publish();
                IedServer_unlockDataModel(server_);
                std::cout << "Breaker feedback " << positionName(state) << std::endl;
            }
            issuingCommand_ = request.has_value();
        }
        if (!request) return;
        std::cout << "Breaker operate " << (*request ? "CLOSE" : "OPEN") << std::endl;
        const bool accepted = client.operate(*request);
        std::lock_guard lock(mutex_);
        issuingCommand_ = false;
        if (accepted) {
            movementFailed_ = false;
            movement_ = Movement{*request, Clock::now() + std::chrono::milliseconds(plant::movementTimeoutMs)};
        } else {
            movementFailed_ = true;
            setFailure(true);
            std::cout << "Breaker operation failed: request unconfirmed" << std::endl;
        }
    }

    void setFailure(bool failed)
    {
        if (operationFailed_ == failed) return;
        operationFailed_ = failed;
        failureTime_ = Hal_getTimeInMs();
        IedServer_lockDataModel(server_);
        publish();
        IedServer_unlockDataModel(server_);
    }

    void setLatch(bool latched)
    {
        if (latched_ == latched) return;
        latched_ = latched;
        latchTime_ = Hal_getTimeInMs();
        IedServer_lockDataModel(server_);
        publish();
        IedServer_unlockDataModel(server_);
    }

    bool freshDeasserted() const
    {
        return !asserted_ && Clock::now() < tripDeadline_;
    }

    void trip()
    {
        latched_ = true;
        pendingTrip_ = !closed_.has_value();
        if (closed_ != true) return;
        std::cout << "Breaker operate OPEN" << std::endl;
        changePosition(false);
    }

    void changePosition(bool closed)
    {
        if (closed_ == closed) return;
        closed_ = closed;
        IedServer_lockDataModel(server_);
        publish();
        IedServer_unlockDataModel(server_);
        std::cout << "Breaker feedback " << (closed ? "CLOSED" : "OPEN") << std::endl;
    }

    void publish()
    {
        const auto attribute = [](DataObject* point, const char* name) {
            return reinterpret_cast<DataAttribute*>(ModelNode_getChild(reinterpret_cast<ModelNode*>(point), name));
        };
        const auto state = processEnabled_ ? processState_ : !closed_ ? DBPOS_BAD_STATE : *closed_ ? DBPOS_ON : DBPOS_OFF;
        const auto time = processEnabled_ ? processTime_ : Hal_getTimeInMs();
        IedServer_updateUTCTimeAttributeValue(server_, attribute(position_, "t"), time);
        IedServer_updateQuality(server_, attribute(position_, "q"),
            state == DBPOS_BAD_STATE ? QUALITY_VALIDITY_INVALID : QUALITY_VALIDITY_GOOD);
        IedServer_updateDbposValue(server_, attribute(position_, "stVal"), state);
        if (failure_) {
            IedServer_updateUTCTimeAttributeValue(server_, attribute(failure_, "t"), failureTime_);
            IedServer_updateQuality(server_, attribute(failure_, "q"), QUALITY_VALIDITY_GOOD);
            IedServer_updateBooleanAttributeValue(server_, attribute(failure_, "stVal"), operationFailed_);
        }
        if (latch_) {
            IedServer_updateUTCTimeAttributeValue(server_, attribute(latch_, "t"), latchTime_);
            IedServer_updateQuality(server_, attribute(latch_, "q"), QUALITY_VALIDITY_GOOD);
            IedServer_updateBooleanAttributeValue(server_, attribute(latch_, "stVal"), latched_);
        }
    }

    IedModel* model_ = IedModel_create("BRF01");
    IedServer server_{};
    DataObject* position_{};
    DataObject* failure_{};
    DataObject* latch_{};
    DataObject* reset_{};
    std::mutex mutex_;
    const bool distributed_ = bay::distributed();
    const bool processEnabled_ = plant::enabled();
    const bool benchProtectionMms_;
    std::optional<bool> closed_ = distributed_ ? std::nullopt : std::optional<bool>(true);
    bool latched_ = distributed_;
    bool pendingTrip_ = false;
    bool faultCleared_ = false;
    bool asserted_ = false;
    Clock::time_point tripDeadline_{};
    std::atomic<bool> running_{true};
    std::thread worker_;
    std::thread protectionWorker_;
    Clock::time_point benchMmsClearUntil_{};
    std::optional<Movement> movement_;
    std::optional<bool> processFault_;
    Dbpos processState_ = DBPOS_BAD_STATE;
    uint64_t processTime_ = 0;
    uint64_t failureTime_ = Hal_getTimeInMs();
    uint64_t latchTime_ = Hal_getTimeInMs();
    bool tripDispatched_ = false;
    bool closeQueued_ = false;
    std::optional<bool> stationRequest_;
    bool resetQueued_ = false;
    bool issuingCommand_ = false;
    bool operationFailed_ = false;
    bool movementFailed_ = false;
};

#if defined(LAB_GOOSE) && !defined(_WIN32)
struct LocalConsole {
    Breaker& breaker;
    std::string pending;
    bool available = true;

    bool pollInput()
    {
        if (!available) return true;
        pollfd input{STDIN_FILENO, POLLIN, 0};
        if (poll(&input, 1, 0) <= 0) return true;
        char buffer[256];
        const auto count = read(STDIN_FILENO, buffer, sizeof(buffer));
        if (count <= 0) {
            available = false;
            return true;
        }
        for (ssize_t i = 0; i < count; ++i) {
            if (buffer[i] == '\r') continue;
            if (buffer[i] != '\n') {
                pending += buffer[i];
                continue;
            }
            if (pending == "quit") return false;
            breaker.command(pending, false);
            pending.clear();
        }
        return true;
    }
};
#endif
}

int main(int argc, char** argv)
{
    if (argc != 2) {
        std::cerr << "Usage: breaker-ied <station-interface|--bench>\n";
        return 2;
    }

    const bool bench = std::string(argv[1]) == "--bench";
#ifndef LAB_GOOSE
    if (!bench) {
        std::cerr << "Native Layer 2 GOOSE is unavailable in this build\n";
        return 2;
    }
#endif

    Breaker breaker(bench);
    if (!breaker.start()) return 1;
    if (bench) {
        for (std::string input; std::getline(std::cin, input) && input != "quit";) breaker.command(input, true);
        return 0;
    }
#if defined(LAB_GOOSE) && !defined(_WIN32)
    LocalConsole console{breaker};
    return runGoosePeer(argv[1], [](void* context, bool trip, uint32_t ttl) {
        static_cast<LocalConsole*>(context)->breaker.protection(trip, ttl);
    }, &console, [](void* context) { return static_cast<LocalConsole*>(context)->pollInput(); });
#endif
    return 2;
}
