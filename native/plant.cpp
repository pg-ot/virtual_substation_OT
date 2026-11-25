#include "plant.hpp"
#include <cmath>
#include <cstdlib>
#include <memory>
#include <string_view>

namespace plant {

bool enabled()
{
    const auto value = std::getenv("LAB_PROCESS_MODEL");
    return bay::distributed() && value && std::string_view(value) == "1";
}

Dbpos Snapshot::position() const
{
    if (contact52a) return contact52b ? DBPOS_BAD_STATE : DBPOS_ON;
    return contact52b ? DBPOS_OFF : DBPOS_INTERMEDIATE_STATE;
}

Client::Client() : connection_(IedConnection_create())
{
    IedConnection_setConnectTimeout(connection_, 250);
    IedConnection_setRequestTimeout(connection_, 250);
}

Client::~Client()
{
    IedConnection_destroy(connection_);
}

std::optional<Snapshot> Client::read()
{
    IedClientError error{};
    if (IedConnection_getState(connection_) != IED_STATE_CONNECTED) {
        IedConnection_connect(connection_, &error, bay::address("LAB_PLANT_MMS_HOST"), port());
        if (error != IED_ERROR_OK) return std::nullopt;
    }
    const std::unique_ptr<sClientDataSet, decltype(&ClientDataSet_destroy)> dataset(
        IedConnection_readDataSetValues(connection_, &error, snapshotReference, nullptr), ClientDataSet_destroy);
    if (error != IED_ERROR_OK || !dataset) return std::nullopt;
    const auto values = ClientDataSet_getValues(dataset.get());
    const MmsType types[] = { MMS_BOOLEAN, MMS_BOOLEAN, MMS_BOOLEAN, MMS_FLOAT, MMS_FLOAT, MMS_UTC_TIME };
    if (!values || MmsValue_getArraySize(values) != sizeof(types) / sizeof(types[0])) return std::nullopt;
    for (unsigned i = 0; i < sizeof(types) / sizeof(types[0]); ++i) {
        const auto value = MmsValue_getElement(values, i);
        if (!value || MmsValue_getType(value) != types[i]) return std::nullopt;
    }
    Snapshot snapshot{
        MmsValue_getBoolean(MmsValue_getElement(values, 0)),
        MmsValue_getBoolean(MmsValue_getElement(values, 1)),
        MmsValue_getBoolean(MmsValue_getElement(values, 2)),
        MmsValue_toFloat(MmsValue_getElement(values, 3)),
        MmsValue_toFloat(MmsValue_getElement(values, 4)),
        MmsValue_getUtcTimeInMs(MmsValue_getElement(values, 5))};
    if (!std::isfinite(snapshot.sourceKv) || !std::isfinite(snapshot.feederA) || snapshot.contactTime == 0)
        return std::nullopt;
    return snapshot;
}

bool Client::operate(bool close)
{
    if (IedConnection_getState(connection_) != IED_STATE_CONNECTED) return false;
    const auto control = ControlObjectClient_create(actuatorReference, connection_);
    if (!control) return false;
    const auto request = MmsValue_newBoolean(close);
    const auto accepted = ControlObjectClient_operate(control, request, 0);
    MmsValue_delete(request);
    ControlObjectClient_destroy(control);
    return accepted;
}
}
