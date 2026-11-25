#include "plant.hpp"
#include "protection_settings.hpp"
#include <atomic>
#include <chrono>
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include "hal_time.h"
#include "iec61850_server.h"
#ifdef LAB_SV
#include "sv_receiver.hpp"
#endif
extern "C" {
#include "feeder_model.h"
}

namespace {
using namespace std::chrono_literals;

ModelNode* node(void* object) { return static_cast<ModelNode*>(object); }
DataAttribute* attribute(ModelNode* parent, const char* name)
{
    return reinterpret_cast<DataAttribute*>(ModelNode_getChild(parent, name));
}

class FeederIed {
public:
    explicit FeederIed(protection::Settings settings) : settings_(settings), pickup_(settings)
    {
        server_ = IedServer_create(&iedModel);
        IedServer_setLocalIpAddress(server_, bay::bindAddress());
        IedServer_setPerformCheckHandler(server_, position_, check, this);
        IedServer_setControlHandler(server_, position_, operate, this);
        publish();
    }

    ~FeederIed()
    {
        running_ = false;
        if (processWorker_.joinable()) processWorker_.join();
#ifdef LAB_SV
        if (svWorker_.joinable()) svWorker_.join();
#endif
        if (IedServer_isRunning(server_)) IedServer_stop(server_);
        IedServer_destroy(server_);
    }

    bool start(const char* interface)
    {
        const auto httpInput = std::getenv("LAB_HTTP_PROCESS_INPUT");
        const auto svInput = std::getenv("LAB_SV_PROCESS");
        if (httpInput && std::string_view(httpInput) == "1" &&
            svInput && std::string_view(svInput) == "1") {
            std::cerr << "HTTP process input and SV process input are mutually exclusive\n";
            return false;
        }
#ifdef LAB_GOOSE
        if (interface) IedServer_setGooseInterfaceId(server_, interface);
#else
        if (interface) {
            std::cerr << "This build has no Layer 2 GOOSE support\n";
            return false;
        }
#endif
        IedServer_start(server_, bay::mmsPort());
#ifdef LAB_GOOSE
        if (interface && IedServer_isRunning(server_)) IedServer_enableGoosePublishing(server_);
#endif
        if (!IedServer_isRunning(server_)) return false;
#ifdef LAB_SV
        const auto svEnabled = std::getenv("LAB_SV_PROCESS");
        if (processEnabled_ && svEnabled && std::string_view(svEnabled) == "1") {
            const auto profile = svprofile::fromSampleRate(std::getenv("LAB_SV_SAMPLES_PER_SECOND"));
            if (!profile) {
                std::cerr << "LAB_SV_SAMPLES_PER_SECOND must be 400 or 4000\n";
                return false;
            }
            svReceiver_ = std::make_unique<SvCurrentReceiver>(*profile);
            if (!svReceiver_->start(std::getenv("LAB_SV_INTERFACE"))) {
                std::cerr << "Cannot start SV receiver on the process interface\n";
                return false;
            }
            std::cout << "PRF01 SV receiver ready svID=" << profile->id
                      << " samples_per_second=" << profile->samplesPerSecond << std::endl;
        }
#endif
        if (processEnabled_) processWorker_ = std::thread([this] {
            plant::Client client;
            while (running_) {
                applyProcess(client.read());
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
            }
        });
#ifdef LAB_SV
        if (svReceiver_) svWorker_ = std::thread([this] {
            while (running_) {
                applySv();
                std::this_thread::sleep_for(std::chrono::milliseconds(5));
            }
        });
#endif
        return true;
    }

    void local(const std::string& input)
    {
        IedServer_lockDataModel(server_);
        std::lock_guard lock(stateMutex_);
        if (processEnabled_ && (input == "fault" || input == "clear")) {
            std::cout << "Use the process simulator to change the fault" << std::endl;
            IedServer_unlockDataModel(server_);
            return;
        }
        constexpr std::string_view processInputPrefix = "process-input ";
        if (std::string_view(input).compare(0, processInputPrefix.size(), processInputPrefix) == 0) {
            if (!httpProcessInputEnabled_) {
                std::cout << "PROCESS_INPUT_REJECTED reason=disabled" << std::endl;
                IedServer_unlockDataModel(server_);
                return;
            }
            const auto value = std::string_view(input).substr(processInputPrefix.size());
            float amperes{};
            const auto parsed = std::from_chars(value.data(), value.data() + value.size(), amperes);
            if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size() ||
                !std::isfinite(amperes) || amperes < 0.0F || amperes > 1200.0F) {
                std::cout << "PROCESS_INPUT_REJECTED reason=invalid-value" << std::endl;
                IedServer_unlockDataModel(server_);
                return;
            }
            manualCurrent_ = amperes;
            manualCurrentUpdatedAt_ = protection::Clock::now();
            processCurrent_ = amperes;
            if (pickup_.update(processCurrent_, manualCurrentUpdatedAt_)) tripped_ = true;
            publish();
            IedServer_unlockDataModel(server_);
            std::cout << "PROCESS_INPUT_APPLIED current_A=" << amperes << std::endl;
            return;
        }
        if (input == "fault") {
            fault_ = true;
            if (distributed_) tripped_ = true;
            else if (closed_) {
                tripped_ = true;
                closed_ = false;
            }
        } else if (input == "clear") fault_ = false;
        else if (input == "reset" && !fault_ &&
            (!httpProcessInputEnabled_ || plantAvailable_) &&
            (!processEnabled_ || (processCurrent_ && *processCurrent_ < settings_.pickupAmperes))) tripped_ = false;
        else {
            std::cout << "Rejected. Available actions: fault, clear, reset, quit\n";
            IedServer_unlockDataModel(server_);
            return;
        }
        publish();
        IedServer_unlockDataModel(server_);
        std::cout << "Applied " << input << std::endl;
    }

private:
    void applyProcess(const std::optional<plant::Snapshot>& sample)
    {
        IedServer_lockDataModel(server_);
        std::lock_guard lock(stateMutex_);
        if (sample) {
            if (fault_ != sample->fault)
                std::cout << "Process fault " << (sample->fault ? "active" : "cleared") << std::endl;
            fault_ = sample->fault;
            plantAvailable_ = true;
#ifdef LAB_SV
            if (!svReceiver_) processCurrent_ = sample->feederA;
#else
            processCurrent_ = sample->feederA;
#endif
        } else {
            plantAvailable_ = false;
            if (!httpProcessInputEnabled_) processCurrent_.reset();
        }
        if (httpProcessInputEnabled_) {
            const auto now = protection::Clock::now();
            processCurrent_ = manualCurrent_ && now - manualCurrentUpdatedAt_ < 3s
                ? manualCurrent_ : std::nullopt;
        }
#ifdef LAB_SV
        if (!svReceiver_ || !sample)
#endif
            if (pickup_.update(processCurrent_, protection::Clock::now())) tripped_ = true;
        publish();
        IedServer_unlockDataModel(server_);
    }

#ifdef LAB_SV
    void applySv()
    {
        IedServer_lockDataModel(server_);
        std::lock_guard lock(stateMutex_);
        const auto current = svReceiver_->current();
        processCurrent_ = plantAvailable_ ? current : std::nullopt;
        if (pickup_.update(processCurrent_, protection::Clock::now())) tripped_ = true;
        publish();
        IedServer_unlockDataModel(server_);
    }
#endif

    static CheckHandlerResult check(ControlAction action, void* context, MmsValue* value, bool test, bool)
    {
        auto& self = *static_cast<FeederIed*>(context);
        std::lock_guard lock(self.stateMutex_);
        if (MmsValue_getType(value) != MMS_BOOLEAN) return CONTROL_VALUE_INVALID;
        if (self.distributed_ || test || (MmsValue_getBoolean(value) && (self.fault_ || self.tripped_))) {
            ControlAction_setAddCause(action, ADD_CAUSE_BLOCKED_BY_INTERLOCKING);
            return CONTROL_OBJECT_ACCESS_DENIED;
        }
        return CONTROL_ACCEPTED;
    }

    static ControlHandlerResult operate(ControlAction action, void* context, MmsValue* value, bool test)
    {
        auto& self = *static_cast<FeederIed*>(context);
        const auto close = MmsValue_getBoolean(value);
        IedServer_lockDataModel(self.server_);
        std::lock_guard lock(self.stateMutex_);
        const bool blocked = self.distributed_ || test || (close && (self.fault_ || self.tripped_));
        if (blocked) ControlAction_setAddCause(action, ADD_CAUSE_BLOCKED_BY_INTERLOCKING);
        else if (self.closed_ != close) {
            self.closed_ = close;
            self.publish();
        }
        IedServer_unlockDataModel(self.server_);
        return blocked ? CONTROL_RESULT_FAILED : CONTROL_RESULT_OK;
    }

    void publish()
    {
        const auto now = Hal_getTimeInMs();
        const auto updateMetadata = [&](DataObject* point) {
            IedServer_updateQuality(server_, attribute(node(point), "q"), QUALITY_VALIDITY_GOOD);
            IedServer_updateUTCTimeAttributeValue(server_, attribute(node(point), "t"), now);
        };
        if (!publishedClosed_ || *publishedClosed_ != closed_) {
            updateMetadata(position_);
            if (distributed_)
                IedServer_updateQuality(server_, attribute(node(position_), "q"), QUALITY_VALIDITY_INVALID);
            IedServer_updateDbposValue(server_, attribute(node(position_), "stVal"),
                distributed_ ? DBPOS_BAD_STATE : closed_ ? DBPOS_ON : DBPOS_OFF);
            publishedClosed_ = closed_;
        }
        const auto amperes = processEnabled_ ? processCurrent_.value_or(0.0F) :
            distributed_ ? (fault_ ? 1200.0F : 120.0F) : (closed_ ? 120.0F : 0.0F);
        const bool currentValid = !processEnabled_ || processCurrent_.has_value();
        if (!publishedCurrent_ || *publishedCurrent_ != amperes || publishedCurrentValid_ != currentValid) {
            updateMetadata(current_);
            if (!currentValid) IedServer_updateQuality(server_, attribute(node(current_), "q"), QUALITY_VALIDITY_INVALID);
            auto vector = ModelNode_getChild(node(current_), "cVal");
            auto magnitude = ModelNode_getChild(vector, "mag");
            IedServer_updateFloatAttributeValue(server_, attribute(magnitude, "f"), amperes);
            publishedCurrent_ = amperes;
            publishedCurrentValid_ = currentValid;
        }
        if (!publishedTrip_ || *publishedTrip_ != tripped_ || publishedTripValid_ != currentValid) {
            const bool tripChanged = publishedTrip_ && *publishedTrip_ != tripped_;
            updateMetadata(trip_);
            if (!currentValid) IedServer_updateQuality(server_, attribute(node(trip_), "q"), QUALITY_VALIDITY_INVALID);
            const auto eventTime = std::chrono::steady_clock::now();
            IedServer_updateBooleanAttributeValue(server_, attribute(node(trip_), "general"), tripped_);
            const auto timing = std::getenv("LAB_GOOSE_TIMING");
            if (tripChanged && timing && std::string_view(timing) == "1") {
                const auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
                    eventTime.time_since_epoch()).count();
                std::cout << "GOOSE_TIMING event_ns=" << ns << " trip=" << tripped_ << std::endl;
            }
            publishedTrip_ = tripped_;
            publishedTripValid_ = currentValid;
        }
    }

    IedServer server_{};
    DataObject* const position_ = IEDMODEL_LD0_XCBR1_Pos;
    DataObject* const trip_ = IEDMODEL_LD0_PTRC1_Tr;
    DataObject* const current_ = IEDMODEL_LD0_MMXU1_A_phsA;
    std::mutex stateMutex_;
    const protection::Settings settings_;
    protection::OvercurrentPickup pickup_;
    const bool distributed_ = bay::distributed();
    const bool processEnabled_ = plant::enabled();
    std::atomic<bool> running_{true};
    std::thread processWorker_;
#ifdef LAB_SV
    std::unique_ptr<SvCurrentReceiver> svReceiver_;
    std::thread svWorker_;
#endif
    bool closed_ = true;
    bool fault_ = false;
    bool tripped_ = false;
    std::optional<bool> publishedClosed_;
    std::optional<bool> publishedTrip_;
    std::optional<float> publishedCurrent_;
    std::optional<float> processCurrent_;
    const bool httpProcessInputEnabled_ = [] {
        const auto value = std::getenv("LAB_HTTP_PROCESS_INPUT");
        return value && std::string_view(value) == "1";
    }();
    std::optional<float> manualCurrent_;
    protection::Clock::time_point manualCurrentUpdatedAt_{};
    bool plantAvailable_ = false;
    bool publishedCurrentValid_ = false;
    bool publishedTripValid_ = false;
};
}

int main(int argc, char** argv)
{
    protection::Settings settings;
    std::string error;
    if (!protection::parseSettings(std::getenv("LAB_PROTECTION_PICKUP_A"),
            std::getenv("LAB_PROTECTION_DELAY_MS"), settings, error)) {
        std::cerr << error << std::endl;
        return 2;
    }
    std::cout << "PRF01 protection settings pickup_A=" << settings.pickupAmperes
              << " delay_ms=" << settings.operateDelay.count() << std::endl;
    FeederIed ied(settings);
    if (!ied.start(argc > 1 ? argv[1] : nullptr)) {
        std::cerr << "Cannot start feeder IED\n";
        return 1;
    }
    std::cout << "PRF01 MMS ready at " << bay::bindAddress() << ':' << bay::mmsPort() << std::endl;
    for (std::string input; std::getline(std::cin, input) && input != "quit";) ied.local(input);
}
