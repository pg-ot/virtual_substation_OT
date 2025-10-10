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

static int running = 1;

static void
sigint_handler(int signalId)
{
    running = 0;
}

static void
gooseListener(GooseSubscriber subscriber, void* parameter)
{
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
        
        // Write data to shared file for GUI
        FILE *f = fopen("/tmp/goose_data.txt", "w");
        if (f) {
            fprintf(f, "%d,%d,%d,%d,%.1f,%.0f,%.1f",
                   tripCommand ? 1 : 0, closeCommand ? 1 : 0,
                   faultType, protElement, faultCurrent, faultVoltage, frequency);
            fclose(f);

            /* Ensure the GUI (running unprivileged) can read updates written by the
             * privileged subscriber even when sudo applies a restrictive umask. */
            if (chmod("/tmp/goose_data.txt", S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH) != 0) {
                perror("chmod /tmp/goose_data.txt");
            }
        }
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
