#include "plant.hpp"
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include "hal_time.h"
#include "iec61850_server.h"
#include "iec61850_dynamic_model.h"
#include "iec61850_cdc.h"

namespace {
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;
enum class Mechanism { normal, stuck, stall };

class Plant {
public:
    Plant()
    {
        auto ld = LogicalDevice_create("LD0", model_);
        auto lln0 = LogicalNode_create("LLN0", ld);
        auto io = reinterpret_cast<ModelNode*>(LogicalNode_create("GGIO1", ld));
        contactA_ = CDC_SPS_create("Ind1", io, 0);
        contactB_ = CDC_SPS_create("Ind2", io, 0);
        faultPoint_ = CDC_SPS_create("Ind3", io, 0);
        source_ = CDC_MV_create("AnIn1", io, 0, false);
        feeder_ = CDC_MV_create("AnIn2", io, 0, false);
        auto actuator = CDC_SPC_create("SPCSO1", io, 0, CDC_CTL_MODEL_DIRECT_NORMAL);
        auto data = DataSet_create("ProcessState", lln0);
        for (const auto entry : {"GGIO1$ST$Ind1$stVal", "GGIO1$ST$Ind2$stVal", "GGIO1$ST$Ind3$stVal",
            "GGIO1$MX$AnIn1$mag$f", "GGIO1$MX$AnIn2$mag$f", "GGIO1$ST$Ind1$t"}) {
            DataSetEntry_create(data, entry, -1, nullptr);
        }
        server_ = IedServer_create(model_);
        IedServer_setLocalIpAddress(server_, bay::bindAddress());
        IedServer_setControlHandler(server_, actuator, operate, this);
        publish();
    }

    ~Plant()
    {
        if (IedServer_isRunning(server_)) IedServer_stop(server_);
        IedServer_destroy(server_);
        IedModel_destroy(model_);
    }

    bool start()
    {
        IedServer_start(server_, plant::port());
        if (!IedServer_isRunning(server_)) return false;
        std::cout << "SIMF01 plant MMS ready at " << bay::bindAddress() << ':' << plant::port() << std::endl;
        return true;
    }

    void advance()
    {
        std::lock_guard lock(mutex_);
        const auto now = Clock::now();
        if (target_ && now >= due_) {
            closed_ = *target_;
            target_.reset();
            publish();
            std::cout << "Plant contacts " << (closed_ ? "CLOSED" : "OPEN") << std::endl;
        }
        if (liveVariation_ && now >= nextMeasurement_) {
            const double seconds = std::chrono::duration<double>(now - started_).count();
            sourceKv_ = static_cast<float>(std::round((11.0 + 0.04 * std::sin(seconds * 0.19)) * 100.0) / 100.0);
            normalCurrent_ = static_cast<float>(std::round((120.0 + 2.0 * std::sin(seconds * 0.31)) * 10.0) / 10.0);
            nextMeasurement_ = now + 1s;
            publish();
        }
    }

    void scenario(const std::string& command)
    {
        std::lock_guard lock(mutex_);
        if (command == "fault") {
            fault_ = true;
            if (target_ == true) target_.reset();
        } else if (command == "clear") fault_ = false;
        else if (command == "stuck") mechanism_ = Mechanism::stuck;
        else if (command == "stall") mechanism_ = Mechanism::stall;
        else if (command == "contacts-invalid") contradictory_ = true;
        else if (command == "normal") {
            if (mechanism_ == Mechanism::stall) target_.reset();
            mechanism_ = Mechanism::normal;
            contradictory_ = false;
        } else {
            std::cout << "Plant command rejected: " << command << std::endl;
            return;
        }
        publish();
        std::cout << "Plant applied " << command << std::endl;
    }

private:
    static DataAttribute* attribute(DataObject* object, const char* path)
    {
        return reinterpret_cast<DataAttribute*>(ModelNode_getChild(reinterpret_cast<ModelNode*>(object), path));
    }

    static ControlHandlerResult operate(ControlAction action, void* context, MmsValue* value, bool test)
    {
        auto& self = *static_cast<Plant*>(context);
        if (test || MmsValue_getType(value) != MMS_BOOLEAN) return CONTROL_RESULT_FAILED;
        const bool close = MmsValue_getBoolean(value);
        std::lock_guard lock(self.mutex_);
        if (close && (self.fault_ || self.contradictory_ || self.target_)) {
            ControlAction_setAddCause(action, ADD_CAUSE_BLOCKED_BY_INTERLOCKING);
            return CONTROL_RESULT_FAILED;
        }
        if (!close && self.target_ == true) {
            self.target_.reset();
            std::cout << "Plant close superseded by OPEN" << std::endl;
        }
        if (self.target_ != close && self.closed_ != close && self.mechanism_ != Mechanism::stuck) {
            self.target_ = close;
            self.due_ = self.mechanism_ == Mechanism::stall ? Clock::time_point::max() : Clock::now() + 300ms;
        }
        self.publish();
        std::cout << "Plant accepted " << (close ? "CLOSE" : "OPEN") << std::endl;
        return CONTROL_RESULT_OK;
    }

    void publish()
    {
        const bool a = contradictory_ || (!target_ && closed_);
        const bool b = contradictory_ || (!target_ && !closed_);
        const auto contacts = std::make_pair(a, b);
        const auto now = Hal_getTimeInMs();
        IedServer_lockDataModel(server_);
        if (!lastContacts_ || *lastContacts_ != contacts) {
            IedServer_updateBooleanAttributeValue(server_, attribute(contactA_, "stVal"), a);
            IedServer_updateBooleanAttributeValue(server_, attribute(contactB_, "stVal"), b);
            IedServer_updateUTCTimeAttributeValue(server_, attribute(contactA_, "t"), now);
            IedServer_updateUTCTimeAttributeValue(server_, attribute(contactB_, "t"), now);
            lastContacts_ = contacts;
        }
        IedServer_updateBooleanAttributeValue(server_, attribute(faultPoint_, "stVal"), fault_);
        IedServer_updateFloatAttributeValue(server_, attribute(source_, "mag.f"), sourceKv_);
        IedServer_updateFloatAttributeValue(server_, attribute(feeder_, "mag.f"), closed_ ? (fault_ ? 1200.0F : normalCurrent_) : 0.0F);
        IedServer_unlockDataModel(server_);
    }

    IedModel* model_ = IedModel_create("SIMF01");
    IedServer server_{};
    DataObject *contactA_{}, *contactB_{}, *faultPoint_{}, *source_{}, *feeder_{};
    std::mutex mutex_;
    bool closed_ = true;
    bool fault_ = false;
    bool contradictory_ = false;
    const bool liveVariation_ = [] {
        const auto value = std::getenv("LAB_LIVE_VARIATION");
        return value && std::string_view(value) == "1";
    }();
    const Clock::time_point started_ = Clock::now();
    Clock::time_point nextMeasurement_ = started_;
    float sourceKv_ = 11.0F;
    float normalCurrent_ = 120.0F;
    Mechanism mechanism_ = Mechanism::normal;
    std::optional<bool> target_;
    Clock::time_point due_{};
    std::optional<std::pair<bool, bool>> lastContacts_;
};
}

int main()
{
    Plant plant;
    if (!plant.start()) return 1;
    std::atomic<bool> running{true};
    std::thread mechanism([&] {
        while (running) {
            plant.advance();
            std::this_thread::sleep_for(10ms);
        }
    });
    for (std::string input; std::getline(std::cin, input) && input != "quit";) plant.scenario(input);
    running = false;
    mechanism.join();
}
