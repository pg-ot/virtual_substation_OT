#include <cstdint>
#include "outstation/ControlState.h"
#include <chrono>
#include <iostream>

int main()
{
    using namespace opendnp3;
    const uint8_t bytes[] = {12, 1, 0, 1, 2, 3};
    const ser4cpp::rseq_t objects(bytes, sizeof(bytes));
    const Timestamp selected(std::chrono::steady_clock::now());
    const auto now = selected + TimeDuration::Milliseconds(100);
    const auto timeout = TimeDuration::Seconds(5);
    ControlState state;
    state.Select(AppSeqNum(4), selected, objects);
    const auto first = state.ValidateSelection(AppSeqNum(5), now, timeout, objects);
    const auto second = state.ValidateSelection(AppSeqNum(5), now, timeout, objects);
    state.Unselect();
    const auto cleared = state.ValidateSelection(AppSeqNum(5), now, timeout, objects);
    if (first != CommandStatus::SUCCESS || second != CommandStatus::SUCCESS || cleared != CommandStatus::NO_SELECT)
        return 1;
    std::cout << "Selection validation is repeatable until explicitly cleared.\n";
}
