#include <cstdio>
#include "goose_peer.hpp"

int main(int argc, char** argv)
{
    if (argc != 2) {
        std::fputs("Usage: goose-peer <isolated-interface>\n", stderr);
        return 2;
    }
    return runGoosePeer(argv[1]);
}
