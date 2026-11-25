#include "mms.hpp"
#include "web_status.hpp"
#include <chrono>
#include <csignal>
#include <iostream>
#include <string_view>
#include <thread>
#include <opendnp3/ConsoleLogger.h>
#include <opendnp3/DNP3Manager.h>
#include <opendnp3/master/DefaultMasterApplication.h>
#include <opendnp3/master/PrintingSOEHandler.h>
#include <opendnp3/outstation/DefaultOutstationApplication.h>
#include <opendnp3/outstation/SimpleCommandHandler.h>
#include <opendnp3/outstation/UpdateBuilder.h>

namespace {
using namespace opendnp3;
const auto port = bay::loopbackPort("LAB_DNP3_PORT", 20000);
constexpr uint16_t masterAddress = 1;
constexpr uint16_t outstationAddress = 10;
volatile std::sig_atomic_t running = 1;
void stop(int) { running = 0; }

Flags quality(bool available, uint16_t mmsQuality)
{
    return Flags(available && mmsQuality == 0 ? 0x01 : 0x04);
}

class WebChannel final : public IChannelListener {
public:
    void OnStateChange(ChannelState state) override
    {
        if (state == ChannelState::OPEN) web_status::link("CONNECTED");
        else if (state == ChannelState::OPENING) web_status::link("CONNECTING");
        else web_status::link("DISCONNECTED");
    }
};

class WebMeasurements final : public ISOEHandler {
public:
    void BeginFragment(const ResponseInfo& info) override { console_.BeginFragment(info); }
    void EndFragment(const ResponseInfo& info) override { console_.EndFragment(info); }
    void Process(const HeaderInfo& info, const ICollection<Indexed<Binary>>& values) override
    {
        console_.Process(info, values);
        const auto encode = [](bool value) { return value ? "true" : "false"; };
        emit(info, values, "trip", 0x1f, encode);
        emit(info, values, "operationFailure", 0x1f, encode, 1);
        emit(info, values, "closeInhibited", 0x1f, encode, 2);
    }
    void Process(const HeaderInfo& info, const ICollection<Indexed<DoubleBitBinary>>& values) override
    {
        console_.Process(info, values);
        emit(info, values, "position", 0x1f, [](DoubleBit value) {
            return bay::positionJson(static_cast<Dbpos>(value));
        });
    }
    void Process(const HeaderInfo& info, const ICollection<Indexed<Analog>>& values) override
    {
        console_.Process(info, values);
        emit(info, values, "current", 0x7f, web_status::analog);
    }
    void Process(const HeaderInfo&, const ICollection<Indexed<Counter>>&) override {}
    void Process(const HeaderInfo&, const ICollection<Indexed<FrozenCounter>>&) override {}
    void Process(const HeaderInfo&, const ICollection<Indexed<BinaryOutputStatus>>&) override {}
    void Process(const HeaderInfo&, const ICollection<Indexed<AnalogOutputStatus>>&) override {}
    void Process(const HeaderInfo&, const ICollection<Indexed<OctetString>>&) override {}
    void Process(const HeaderInfo&, const ICollection<Indexed<TimeAndInterval>>&) override {}
    void Process(const HeaderInfo&, const ICollection<Indexed<BinaryCommandEvent>>&) override {}
    void Process(const HeaderInfo&, const ICollection<Indexed<AnalogCommandEvent>>&) override {}
    void Process(const HeaderInfo&, const ICollection<DNPTime>&) override {}

private:
    template<class T, class Format>
    void emit(const HeaderInfo& info, const ICollection<Indexed<T>>& values, const char* name,
        unsigned qualityMask, Format format, uint16_t index = 0)
    {
        values.ForeachItem([&](const Indexed<T>& point) {
            if (point.index != index) return;
            const auto& value = point.value;
            const std::string encoded = format(value.value);
            const auto good = info.flagsValid && (value.flags.value & qualityMask) == 1 && encoded != "null";
            const auto time = info.tsquality == TimestampQuality::INVALID ? 0 : value.time.value;
            web_status::received(name, encoded, good, value.flags.value, time);
        });
    }
    PrintingSOEHandler console_;
};

int outstation()
{
    DNP3Manager manager(1, ConsoleLogger::Create());
    auto channel = manager.AddTCPServer("gateway", levels::NORMAL, ServerAcceptMode::CloseExisting,
        IPEndpoint(bay::bindAddress(), port), web_status::enabled() ? std::make_shared<WebChannel>() : nullptr);
    DatabaseConfig database;
    database.double_binary[0].clazz = PointClass::Class1;
    database.double_binary[0].svariation = StaticDoubleBinaryVariation::Group3Var2;
    database.double_binary[0].evariation = EventDoubleBinaryVariation::Group4Var2;
    database.binary_input[0].clazz = PointClass::Class1;
    database.binary_input[0].svariation = StaticBinaryVariation::Group1Var2;
    database.binary_input[0].evariation = EventBinaryVariation::Group2Var2;
    if (bay::distributed()) {
        database.binary_input[1] = database.binary_input[0];
        database.binary_input[2] = database.binary_input[0];
    }
    database.analog_input[0].clazz = PointClass::Class2;
    database.analog_input[0].svariation = StaticAnalogVariation::Group30Var5;
    database.analog_input[0].evariation = EventAnalogVariation::Group32Var7;

    OutstationStackConfig config(database);
    config.link.LocalAddr = outstationAddress;
    config.link.RemoteAddr = masterAddress;
    config.outstation.eventBufferConfig = EventBufferConfig::AllTypes(32);
    config.outstation.params.allowUnsolicited = false;
    auto device = channel->AddOutstation("GW-01",
        std::make_shared<SimpleCommandHandler>(CommandStatus::NOT_SUPPORTED),
        DefaultOutstationApplication::Create(), config);
    if (!device) return 1;

    bay::MmsClient mms;
    bay::Sample held{};
    const auto updateDatabase = [&] {
        auto sample = mms.read(true);
        if (sample) held = *sample;
        const bool available = sample.has_value();
        UpdateBuilder update;
        // DNP3 double-bit inputs use the same four wire values as Dbpos.
        const auto position = static_cast<DoubleBit>(held.position);
        update.Update(DoubleBitBinary(position, quality(available, held.positionQuality), DNPTime(held.positionTime)), 0);
        update.Update(Binary(held.tripped, quality(available, held.tripQuality), DNPTime(held.tripTime)), 0);
        update.Update(Analog(held.amperes, quality(available, held.currentQuality), DNPTime(held.currentTime)), 0);
        const auto failureFlags = quality(available && held.operationFailure.has_value(), held.failureQuality);
        const auto latchFlags = quality(available && held.closeInhibited.has_value(), held.latchQuality);
        if (bay::distributed()) {
            update.Update(Binary(held.operationFailure.value_or(false), failureFlags, DNPTime(held.failureTime)), 1);
            update.Update(Binary(held.closeInhibited.value_or(false), latchFlags, DNPTime(held.latchTime)), 2);
        }
        device->Apply(update.Build());
        web_status::gateway(held, quality(available, held.positionQuality).value,
            quality(available, held.tripQuality).value, quality(available, held.currentQuality).value, failureFlags.value, 1);
        web_status::received("closeInhibited", held.closeInhibited.value_or(false) ? "true" : "false",
            latchFlags.value == 1, latchFlags.value, held.latchTime);
    };
    updateDatabase();
    if (!device->Enable()) return 1;
    std::cout << "DNP3 ready at " << bay::bindAddress() << ':' << port << std::endl;
    while (running) {
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
        if (running) updateDatabase();
    }
    return 0;
}

int master()
{
    DNP3Manager manager(1, ConsoleLogger::Create());
    auto channel = manager.AddTCPClient("supervisory", levels::NORMAL, ChannelRetry::Default(),
        {IPEndpoint(bay::address("LAB_DNP3_HOST"), port)}, bay::bindAddress(),
        web_status::enabled() ? std::make_shared<WebChannel>() : nullptr);
    MasterStackConfig config;
    config.link.LocalAddr = masterAddress;
    config.link.RemoteAddr = outstationAddress;
    config.master.timeSyncMode = TimeSyncMode::LAN;
    config.master.disableUnsolOnStartup = false;
    config.master.unsolClassMask = ClassField::None();
    auto handler = PrintingSOEHandler::Create();
    if (web_status::enabled()) handler = std::make_shared<WebMeasurements>();
    auto device = channel->AddMaster("CC-01", handler, DefaultMasterApplication::Create(), config);
    if (!device) return 1;
    device->AddClassScan(ClassField::AllClasses(), TimeDuration::Seconds(15), handler);
    device->AddClassScan(ClassField(ClassField::CLASS_1 | ClassField::CLASS_2), TimeDuration::Seconds(1), handler);
    if (!device->Enable()) return 1;
    while (running) std::this_thread::sleep_for(std::chrono::milliseconds(100));
    return 0;
}
}

int main(int argc, char** argv)
{
    std::signal(SIGINT, stop);
    std::signal(SIGTERM, stop);
    const std::string_view role = argc > 1 ? argv[1] : "";
    try {
        if (role == "outstation") return outstation();
        if (role == "master") return master();
        std::cerr << "Usage: telecontrol-dnp3 outstation|master\n";
        return 2;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
