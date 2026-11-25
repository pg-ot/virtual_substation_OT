#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <thread>
#include <vector>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <unistd.h>
#include <opendnp3/ConsoleLogger.h>
#include <opendnp3/DNP3Manager.h>
#include <opendnp3/outstation/DefaultOutstationApplication.h>
#include <opendnp3/outstation/SimpleCommandHandler.h>
#include "link/CRC.h"

using namespace opendnp3;
using namespace std::chrono_literals;

class Handler final : public SimpleCommandHandler {
public:
    Handler() : SimpleCommandHandler(CommandStatus::SUCCESS) {}
    std::atomic<unsigned> selects{0};
    std::atomic<unsigned> operations{0};
    void DoSelect(const ControlRelayOutputBlock&, uint16_t) override { ++selects; }
    void DoOperate(const ControlRelayOutputBlock&, uint16_t, OperateType) override { ++operations; }
};

void appendCrc(std::vector<uint8_t>& data, size_t offset, size_t length)
{
    const auto crc = CRC::CalcCrc(data.data() + offset, length);
    data.push_back(static_cast<uint8_t>(crc));
    data.push_back(static_cast<uint8_t>(crc >> 8));
}

std::vector<uint8_t> request(uint8_t applicationSequence, uint8_t function)
{
    const std::vector<uint8_t> payload = {
        0xc0, static_cast<uint8_t>(0xc0 | applicationSequence), function,
        12, 1, 0x17, 1, 0, 0x81, 1, 100, 0, 0, 0, 100, 0, 0, 0, 0
    };
    std::vector<uint8_t> frame = {0x05, 0x64, static_cast<uint8_t>(5 + payload.size()), 0xc4,
        10, 0, 1, 0};
    appendCrc(frame, 0, frame.size());
    for (size_t offset = 0; offset < payload.size(); offset += 16) {
        const auto length = std::min<size_t>(16, payload.size() - offset);
        const auto start = frame.size();
        frame.insert(frame.end(), payload.begin() + offset, payload.begin() + offset + length);
        appendCrc(frame, start, length);
    }
    return frame;
}

int connectClient(uint16_t port)
{
    const auto fd = socket(AF_INET, SOCK_STREAM, 0);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(port);
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    for (int attempt = 0; attempt < 30; ++attempt) {
        if (connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == 0) return fd;
        std::this_thread::sleep_for(100ms);
    }
    close(fd);
    return -1;
}

bool exchange(int fd, const std::vector<uint8_t>& frame)
{
    timeval timeout{3, 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    if (send(fd, frame.data(), frame.size(), 0) != static_cast<ssize_t>(frame.size())) return false;
    uint8_t response[256];
    return recv(fd, response, sizeof(response), 0) > 0;
}

int main(int argc, char** argv)
{
    constexpr uint16_t port = 23201;
    DNP3Manager manager(1, ConsoleLogger::Create());
    auto channel = manager.AddTCPServer("fixture", levels::NORMAL, ServerAcceptMode::CloseExisting,
        IPEndpoint("127.0.0.1", port), nullptr);
    auto handler = std::make_shared<Handler>();
    OutstationStackConfig config{DatabaseConfig{}};
    config.link.LocalAddr = 10;
    config.link.RemoteAddr = 1;
    auto outstation = channel->AddOutstation("fixture", handler, DefaultOutstationApplication::Create(), config);
    if (!outstation || !outstation->Enable()) return 1;
    auto first = connectClient(port);
    if (first < 0 || !exchange(first, request(4, 3))) return 2;
    if (!exchange(first, request(5, 4)) || !exchange(first, request(5, 4))) return 3;
    std::this_thread::sleep_for(100ms);
    if (handler->operations != 1 || !exchange(first, request(6, 3))) return 4;
    close(first);
    std::this_thread::sleep_for(400ms);
    auto second = connectClient(port);
    if (second < 0 || !exchange(second, request(7, 4))) return 5;
    std::this_thread::sleep_for(200ms);
    close(second);
    std::cout << "selects=" << handler->selects << " total_operates=" << handler->operations << '\n';
    const bool safeExpected = argc > 1 && std::strcmp(argv[1], "--expect-safe") == 0;
    return handler->selects == 2 && handler->operations == (safeExpected ? 1U : 2U) ? 0 : 6;
}
