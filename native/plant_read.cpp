#include "plant.hpp"
#include <iostream>

int main()
{
    plant::Client client;
    const auto data = client.read();
    if (!data) {
        std::cerr << "Plant feedback unavailable\n";
        return 1;
    }
    std::cout << "52a=" << data->contact52a << " 52b=" << data->contact52b
              << " fault=" << data->fault << " source_kV=" << data->sourceKv
              << " feeder_A=" << data->feederA << " contact_time_ms=" << data->contactTime << std::endl;
}
