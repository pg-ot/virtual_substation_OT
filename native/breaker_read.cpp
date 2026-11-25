#include "mms.hpp"
#include "plant.hpp"
#include <iostream>
#include <memory>

int main()
{
    const auto client = std::unique_ptr<sIedConnection, decltype(&IedConnection_destroy)>(
        IedConnection_create(), IedConnection_destroy);
    IedConnection_setConnectTimeout(client.get(), 1000);
    IedConnection_setRequestTimeout(client.get(), 1000);
    const auto port = bay::breakerMmsPort();
    IedClientError error{};
    IedConnection_connect(client.get(), &error, bay::breakerMmsHost(), port);
    if (error != IED_ERROR_OK) return 1;

    const auto point = std::unique_ptr<MmsValue, decltype(&MmsValue_delete)>(
        IedConnection_readObject(client.get(), &error, bay::breakerPosition, IEC61850_FC_ST), MmsValue_delete);
    if (error != IED_ERROR_OK || !point || MmsValue_getArraySize(point.get()) != 3) return 1;
    const auto position = Dbpos_fromMmsValue(MmsValue_getElement(point.get(), 0));
    const auto label = position == DBPOS_ON ? "CLOSED" : position == DBPOS_OFF ? "OPEN" :
        position == DBPOS_INTERMEDIATE_STATE ? "INTERMEDIATE" : "UNKNOWN";
    std::cout << "breaker=" << label
              << " quality=" << MmsValue_getBitStringAsInteger(MmsValue_getElement(point.get(), 1))
              << " source_ms=" << MmsValue_getUtcTimeInMs(MmsValue_getElement(point.get(), 2)) << std::endl;
    if (plant::enabled()) {
        const auto alarm = std::unique_ptr<MmsValue, decltype(&MmsValue_delete)>(
            IedConnection_readObject(client.get(), &error, bay::breakerFailure, IEC61850_FC_ST), MmsValue_delete);
        if (error != IED_ERROR_OK || !alarm || MmsValue_getArraySize(alarm.get()) != 3) return 1;
        std::cout << "operation_failure=" << MmsValue_getBoolean(MmsValue_getElement(alarm.get(), 0)) << '\n'
                  << "operation_failure_quality=" << MmsValue_getBitStringAsInteger(MmsValue_getElement(alarm.get(), 1))
                  << " source_ms=" << MmsValue_getUtcTimeInMs(MmsValue_getElement(alarm.get(), 2)) << std::endl;
    }
}
