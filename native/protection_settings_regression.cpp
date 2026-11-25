#include "protection_settings.hpp"
#include <cstdlib>
#include <iostream>
#include <string>

void require(bool condition)
{
    if (!condition) {
        std::cerr << "Protection settings regression failed" << std::endl;
        std::exit(1);
    }
}

int main()
{
    protection::Settings settings;
    std::string error;
    require(protection::parseSettings(nullptr, nullptr, settings, error));
    const auto start = protection::Clock::time_point{};
    protection::OvercurrentPickup immediate(settings);
    require(!immediate.update(199.9F, start));
    require(immediate.update(200.0F, start));
    require(!protection::parseSettings("nan", "0", settings, error));
    require(!protection::parseSettings("0", "0", settings, error));
    require(!protection::parseSettings("200", "-1", settings, error));
    require(!protection::parseSettings("200", "4294967296", settings, error));
    require(!protection::parseSettings("200A", "0", settings, error));
    require(protection::parseSettings("250.5", "100", settings, error));
    protection::OvercurrentPickup delayed(settings);
    using namespace std::chrono_literals;
    require(!delayed.update(250.5F, start));
    require(!delayed.update(300.0F, start + 99ms));
    require(delayed.update(300.0F, start + 100ms));
    require(!delayed.update(249.0F, start + 101ms));
    require(!delayed.update(300.0F, start + 150ms));
    require(!delayed.update(std::nullopt, start + 200ms));
    require(!delayed.update(300.0F, start + 250ms));
    require(delayed.update(300.0F, start + 350ms));
}
