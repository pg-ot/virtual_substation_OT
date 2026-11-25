#include "sv_receiver.hpp"
#include "sv_profile.hpp"
#include <cmath>
#include <cstring>
#include <iostream>
#ifdef __linux__
#include <net/if.h>
#include <netpacket/packet.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace {
constexpr auto sampleTimeout = std::chrono::milliseconds(250);
}

SvCurrentReceiver::SvCurrentReceiver(svprofile::Profile profile) : profile_(profile), receiver_(SVReceiver_create()) {}

SvCurrentReceiver::~SvCurrentReceiver()
{
    if (receiver_) {
        if (SVReceiver_isRunning(receiver_)) SVReceiver_stop(receiver_);
        SVReceiver_destroy(receiver_);
    }
#ifdef __linux__
    if (membershipSocket_ >= 0) close(membershipSocket_);
#endif
}

bool SvCurrentReceiver::start(const char* interfaceName)
{
    if (!receiver_ || !interfaceName || !*interfaceName) return false;
#ifdef __linux__
    membershipSocket_ = socket(AF_PACKET, SOCK_RAW, 0);
    packet_mreq membership{};
    membership.mr_ifindex = if_nametoindex(interfaceName);
    membership.mr_type = PACKET_MR_MULTICAST;
    membership.mr_alen = 6;
    std::memcpy(membership.mr_address, svprofile::destination, 6);
    if (membershipSocket_ < 0 || membership.mr_ifindex == 0 ||
        setsockopt(membershipSocket_, SOL_PACKET, PACKET_ADD_MEMBERSHIP, &membership, sizeof(membership)) != 0) {
        std::cerr << "Cannot join SV multicast group on " << interfaceName << std::endl;
        return false;
    }
#endif
    auto subscriber = SVSubscriber_create(svprofile::destination, svprofile::appId);
    if (!subscriber) return false;
    SVSubscriber_setListener(subscriber, receive, this);
    SVReceiver_setInterfaceId(receiver_, interfaceName);
    SVReceiver_enableDestAddrCheck(receiver_);
    SVReceiver_addSubscriber(receiver_, subscriber);
    SVReceiver_start(receiver_);
    return SVReceiver_isRunning(receiver_);
}

void SvCurrentReceiver::receive(SVSubscriber, void* context, SVSubscriber_ASDU asdu)
{
    auto& self = *static_cast<SvCurrentReceiver*>(context);
    const char* id = SVSubscriber_ASDU_getSvId(asdu);
    if (!id || std::strcmp(id, self.profile_.id) != 0 ||
        SVSubscriber_ASDU_getConfRev(asdu) != svprofile::revision ||
        SVSubscriber_ASDU_getDataSize(asdu) != 64) return;
    const bool hasRate = SVSubscriber_ASDU_hasSmpRate(asdu);
    if ((hasRate && SVSubscriber_ASDU_getSmpRate(asdu) != self.profile_.samplesPerCycle) ||
        (!hasRate && self.profile_.samplesPerSecond == 400)) return;
    const auto count = SVSubscriber_ASDU_getSmpCnt(asdu);
    auto quality = SVSubscriber_ASDU_getQuality(asdu, 4);
    std::lock_guard lock(self.mutex_);
    const auto now = std::chrono::steady_clock::now();
    if (!self.loggedSample_) {
        std::cout << "PRF01 received matching SV stream" << std::endl;
        self.loggedSample_ = true;
    }
    if (count >= self.profile_.samplesPerSecond || Quality_getValidity(&quality) != QUALITY_VALIDITY_GOOD) {
        self.count_ = 0;
        self.index_ = 0;
        self.sum_ = 0;
        self.previous_.reset();
        self.invalidSinceRead_ = true;
        return;
    }
    if (self.previous_ && (now - self.lastSample_ > sampleTimeout ||
        count != (*self.previous_ + 1) % self.profile_.samplesPerSecond)) {
        self.count_ = 0;
        self.index_ = 0;
        self.sum_ = 0;
        self.invalidSinceRead_ = true;
    }
    self.previous_ = count;
    const double current = SVSubscriber_ASDU_getINT32(asdu, 0) / svprofile::currentCountsPerAmpere;
    const double square = current * current;
    if (self.count_ == self.profile_.samplesPerCycle) self.sum_ -= self.squares_[self.index_];
    else ++self.count_;
    self.squares_[self.index_] = square;
    self.sum_ += square;
    self.index_ = (self.index_ + 1) % self.profile_.samplesPerCycle;
    self.lastSample_ = now;
}

std::optional<float> SvCurrentReceiver::current()
{
    std::lock_guard lock(mutex_);
    if (previous_ && std::chrono::steady_clock::now() - lastSample_ > sampleTimeout) {
        count_ = 0;
        index_ = 0;
        sum_ = 0;
        previous_.reset();
        invalidSinceRead_ = false;
        return std::nullopt;
    }
    if (invalidSinceRead_) {
        invalidSinceRead_ = false;
        return std::nullopt;
    }
    if (count_ != profile_.samplesPerCycle) return std::nullopt;
    return static_cast<float>(std::sqrt(sum_ / profile_.samplesPerCycle));
}
