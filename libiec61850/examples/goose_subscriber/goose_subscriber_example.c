/*
 * goose_subscriber_example.c
 *
 * This is an example for a standalone GOOSE subscriber
 *
 * Has to be started as root in Linux.
 */

#include "goose_receiver.h"
#include "goose_subscriber.h"
#include "hal_thread.h"
#include "linked_list.h"

#include <stdlib.h>
#include <stdio.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <stdbool.h>

#define GOOSE_SHARED_FILE "/tmp/goose_data.txt"
#define GOOSE_FILE_MODE \
    (S_IRUSR | S_IWUSR | S_IRGRP | S_IWGRP | S_IROTH)

static int running = 1;

static void
sigint_handler(int signalId)
{
    running = 0;
}

static int ownershipInitialized = 0;
static int haveTargetUid = 0;
static uid_t targetUid;
static int haveTargetGid = 0;
static gid_t targetGid;

static void
adoptExistingOwnership(void)
{
    if (haveTargetUid && haveTargetGid)
        return;

    struct stat existingStat;

    if (stat(GOOSE_SHARED_FILE, &existingStat) != 0)
        return;

    if (!haveTargetUid) {
        targetUid = existingStat.st_uid;
        haveTargetUid = 1;
    }

    if (!haveTargetGid) {
        targetGid = existingStat.st_gid;
        haveTargetGid = 1;
    }
}

static void
initFileOwnership(void)
{
    if (ownershipInitialized)
        return;

    ownershipInitialized = 1;

    const char* uidEnv = getenv("GOOSE_FILE_OWNER_UID");
    if (uidEnv) {
        char* endPtr = NULL;
        long parsed = strtol(uidEnv, &endPtr, 10);
        if ((endPtr != uidEnv) && (*endPtr == '\0') && (parsed >= 0)) {
            targetUid = (uid_t) parsed;
            haveTargetUid = 1;
        }
    }

    const char* gidEnv = getenv("GOOSE_FILE_OWNER_GID");
    if (gidEnv) {
        char* endPtr = NULL;
        long parsed = strtol(gidEnv, &endPtr, 10);
        if ((endPtr != gidEnv) && (*endPtr == '\0') && (parsed >= 0)) {
            targetGid = (gid_t) parsed;
            haveTargetGid = 1;
        }
    }

    if (!haveTargetUid || !haveTargetGid)
        adoptExistingOwnership();
}

static void
writeSharedDataset(bool tripCommand,
                   bool closeCommand,
                   int32_t faultType,
                   int32_t protElement,
                   float faultCurrent,
                   float faultVoltage,
                   float frequency)
{
    char buffer[128];
    int written = snprintf(buffer, sizeof(buffer),
                           "%d,%d,%d,%d,%.1f,%.0f,%.1f",
                           tripCommand ? 1 : 0,
                           closeCommand ? 1 : 0,
                           faultType,
                           protElement,
                           faultCurrent,
                           faultVoltage,
                           frequency);

    if (written < 0) {
        perror("snprintf goose dataset");
        return;
    }

    size_t bufferLen = strnlen(buffer, sizeof(buffer));

    adoptExistingOwnership();

    char tempTemplate[] = "/tmp/goose_data.txt.XXXXXX";
    int fd = mkstemp(tempTemplate);

    if (fd < 0) {
        perror("mkstemp goose_data");
        return;
    }

    if (fchmod(fd, GOOSE_FILE_MODE) != 0)
        perror("fchmod goose_data temp");

    if (haveTargetUid || haveTargetGid) {
        uid_t uid = haveTargetUid ? targetUid : (uid_t) -1;
        gid_t gid = haveTargetGid ? targetGid : (gid_t) -1;

        if (fchown(fd, uid, gid) != 0)
            perror("fchown goose_data temp");
    }

    ssize_t toWrite = (ssize_t) bufferLen;
    ssize_t totalWritten = 0;

    while (totalWritten < toWrite) {
        ssize_t chunk = write(fd, buffer + totalWritten, (size_t)(toWrite - totalWritten));
        if (chunk < 0) {
            if (errno == EINTR)
                continue;

            perror("write goose_data temp");
            close(fd);
            unlink(tempTemplate);
            return;
        }

        totalWritten += chunk;
    }

    if (fsync(fd) != 0)
        perror("fsync goose_data temp");

    if (close(fd) != 0)
        perror("close goose_data temp");

    if (rename(tempTemplate, GOOSE_SHARED_FILE) != 0) {
        perror("rename goose_data temp");
        unlink(tempTemplate);
        return;
    }

    if (haveTargetUid || haveTargetGid) {
        uid_t uid = haveTargetUid ? targetUid : (uid_t) -1;
        gid_t gid = haveTargetGid ? targetGid : (gid_t) -1;

        if (chown(GOOSE_SHARED_FILE, uid, gid) != 0)
            perror("chown goose_data final");
    }

    if (chmod(GOOSE_SHARED_FILE, GOOSE_FILE_MODE) != 0)
        perror("chmod goose_data final");
}

static void
gooseListener(GooseSubscriber subscriber, void* parameter)
{
    initFileOwnership();

    // Clear screen and move cursor to top
    printf("\033[2J\033[H");
    
    printf("=== GOOSE SUBSCRIBER - LIVE DATA ===\n\n");
    printf("stNum: %u | sqNum: %u | TTL: %ums\n", 
           GooseSubscriber_getStNum(subscriber),
           GooseSubscriber_getSqNum(subscriber),
           GooseSubscriber_getTimeAllowedToLive(subscriber));

    uint64_t timestamp = GooseSubscriber_getTimestamp(subscriber);
    printf("Timestamp: %u.%03u | Status: %s\n\n", 
           (uint32_t)(timestamp / 1000), (uint32_t)(timestamp % 1000),
           GooseSubscriber_isValid(subscriber) ? "VALID" : "INVALID");

    MmsValue* values = GooseSubscriber_getDataSetValues(subscriber);
    
    if (MmsValue_getArraySize(values) >= 7) {
        bool tripCommand = MmsValue_getBoolean(MmsValue_getElement(values, 0));
        bool closeCommand = MmsValue_getBoolean(MmsValue_getElement(values, 1));
        int32_t faultType = MmsValue_toInt32(MmsValue_getElement(values, 2));
        int32_t protElement = MmsValue_toInt32(MmsValue_getElement(values, 3));
        float faultCurrent = MmsValue_toFloat(MmsValue_getElement(values, 4));
        float faultVoltage = MmsValue_toFloat(MmsValue_getElement(values, 5));
        float frequency = MmsValue_toFloat(MmsValue_getElement(values, 6));
        
        printf("PROTECTION COMMANDS:\n");
        printf("  Trip Command:  [%s]\n", tripCommand ? "ACTIVE" : "INACTIVE");
        printf("  Close Command: [%s]\n\n", closeCommand ? "ACTIVE" : "INACTIVE");
        
        printf("FAULT INFORMATION:\n");
        printf("  Fault Type:    %d (0=No Fault, 1=Overcurrent, 2=Differential, 3=Distance)\n", faultType);
        printf("  Prot Element:  %d\n\n", protElement);
        
        printf("MEASUREMENTS:\n");
        printf("  Current:       %.1f A\n", faultCurrent);
        printf("  Voltage:       %.0f V\n", faultVoltage);
        printf("  Frequency:     %.1f Hz\n\n", frequency);
        
        if (tripCommand) {
            printf("\033[31m>>> BREAKER TRIP COMMAND ACTIVE <<<\033[0m\n");
        }
        if (closeCommand) {
            printf("\033[32m>>> BREAKER CLOSE COMMAND ACTIVE <<<\033[0m\n");
        }
        
        writeSharedDataset(tripCommand,
                           closeCommand,
                           faultType,
                           protElement,
                           faultCurrent,
                           faultVoltage,
                           frequency);
    }
    
    printf("\nPress Ctrl+C to stop...\n");
    fflush(stdout);
}

int
main(int argc, char** argv)
{
    GooseReceiver receiver = GooseReceiver_create();

    if (argc > 1) {
        printf("Set interface id: %s\n", argv[1]);
        GooseReceiver_setInterfaceId(receiver, argv[1]);
    }
    else {
        printf("Using interface eth0\n");
        printf("Fault types: 1=overcurrent, 2=differential, 3=distance\n");
        GooseReceiver_setInterfaceId(receiver, "eth0");
    }

    GooseSubscriber subscriber = GooseSubscriber_create("simpleIOGenericIO/LLN0$GO$gcbAnalogValues", NULL);

    uint8_t dstMac[6] = {0x01,0x0c,0xcd,0x01,0x00,0x01};
    GooseSubscriber_setDstMac(subscriber, dstMac);
    GooseSubscriber_setAppId(subscriber, 1000);

    GooseSubscriber_setListener(subscriber, gooseListener, NULL);

    GooseReceiver_addSubscriber(receiver, subscriber);

    GooseReceiver_start(receiver);

    if (GooseReceiver_isRunning(receiver)) {
        signal(SIGINT, sigint_handler);
        printf("\033[2J\033[H");
        printf("Starting GOOSE Subscriber...\n");

        while (running) {
            Thread_sleep(100);
        }
    }
    else {
        printf("Failed to start GOOSE subscriber. Reason can be that the Ethernet interface doesn't exist or root permission are required.\n");
    }

    GooseReceiver_stop(receiver);

    GooseReceiver_destroy(receiver);

    return 0;
}
