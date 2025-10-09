/*
 * goose_publisher_example.c
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdio.h>
#include <signal.h>

#include "mms_value.h"
#include "goose_publisher.h"
#include "hal_thread.h"

static int running = 1;

static void
sigint_handler(int signalId)
{
    running = 0;
}

/* has to be executed as root! */
int
main(int argc, char **argv)
{
    char *interface;

    if (argc > 1)
        interface = argv[1];
    else
        interface = "eth0";

    printf("Using interface %s\n", interface);
    printf("Reading data from GUI at /tmp/gui_data.txt\n");

    CommParameters gooseCommParameters;

    gooseCommParameters.appId = 1000;
    gooseCommParameters.dstAddress[0] = 0x01;
    gooseCommParameters.dstAddress[1] = 0x0c;
    gooseCommParameters.dstAddress[2] = 0xcd;
    gooseCommParameters.dstAddress[3] = 0x01;
    gooseCommParameters.dstAddress[4] = 0x00;
    gooseCommParameters.dstAddress[5] = 0x01;
    gooseCommParameters.vlanId = 0;
    gooseCommParameters.vlanPriority = 4;

    /*
     * Create a new GOOSE publisher instance. As the second parameter the interface
     * name can be provided (e.g. "eth0" on a Linux system). If the second parameter
     * is NULL the interface name as defined with CONFIG_ETHERNET_INTERFACE_ID in
     * stack_config.h is used.
     */
    GoosePublisher publisher = GoosePublisher_create(&gooseCommParameters, interface);

    if (publisher) {
        GoosePublisher_setGoCbRef(publisher, "simpleIOGenericIO/LLN0$GO$gcbAnalogValues");
        GoosePublisher_setConfRev(publisher, 1);
        GoosePublisher_setDataSetRef(publisher, "simpleIOGenericIO/LLN0$AnalogValues");
        GoosePublisher_setTimeAllowedToLive(publisher, 500);

        signal(SIGINT, sigint_handler);
        
        printf("Publishing GOOSE messages according to IEC 61850. Press Ctrl+C to stop.\n");
        
        int prev_trip = -1, prev_close = -1, prev_fault = -1, prev_elem = -1;
        float prev_current = -1, prev_voltage = -1, prev_freq = -1;
        int state_changed = 0, first_publish = 1;
        
        while (running) {
            // Read GUI data
            FILE *f = fopen("/tmp/gui_data.txt", "r");
            int trip = 0, close = 0, fault_type = 0, prot_elem = 50;
            float current = 1250.5, voltage = 10500.0, freq = 49.8;
            
            if (f) {
                fscanf(f, "%d,%d,%d,%d,%f,%f,%f", &trip, &close, &fault_type, &prot_elem, &current, &voltage, &freq);
                fclose(f);
            }
            
            // Protection Logic Implementation
            int protection_trip = 0;
            int detected_fault = 0;
            int protection_element = 50;
            
            // Overcurrent Protection (50/51)
            if (current > 3500.0) {
                protection_trip = 1;
                detected_fault = 1;
                protection_element = 50;
            }
            
            // Undervoltage/Overvoltage Protection (27/59)
            if (voltage < 8000.0 || voltage > 14000.0) {
                protection_trip = 1;
                detected_fault = 2;
                protection_element = (voltage < 8000.0) ? 27 : 59;
            }
            
            // Frequency Protection (81)
            if (freq < 49.0 || freq > 51.0) {
                protection_trip = 1;
                detected_fault = 3;
                protection_element = 81;
            }
            
            // Manual fault type override
            if (fault_type > 0) {
                protection_trip = 1;
                detected_fault = fault_type;
                if (fault_type == 2) protection_element = 87; // Differential
                if (fault_type == 3) protection_element = 21; // Distance
            }
            
            // Apply protection logic
            if (protection_trip) {
                trip = 1;
                fault_type = detected_fault;
                prot_elem = protection_element;
            } else if (fault_type == 0) {
                // No manual fault, use measurement-based trip
                trip = trip; // Keep manual trip setting
            }
            
            // Check for state changes (IEC 61850-8-1)
            if (!first_publish && (trip != prev_trip || close != prev_close || fault_type != prev_fault || 
                prot_elem != prev_elem || current != prev_current || 
                voltage != prev_voltage || freq != prev_freq)) {
                state_changed = 1;
                GoosePublisher_increaseStNum(publisher);  // Increment stNum, reset sqNum
            }
            
            prev_trip = trip; prev_close = close; prev_fault = fault_type;
            prev_elem = prot_elem; prev_current = current; 
            prev_voltage = voltage; prev_freq = freq;
            first_publish = 0;
            
            LinkedList dataSetValues = LinkedList_create();
            
            LinkedList_add(dataSetValues, MmsValue_newBoolean(trip));
            LinkedList_add(dataSetValues, MmsValue_newBoolean(close));
            LinkedList_add(dataSetValues, MmsValue_newIntegerFromInt32(fault_type));
            LinkedList_add(dataSetValues, MmsValue_newIntegerFromInt32(prot_elem));
            LinkedList_add(dataSetValues, MmsValue_newFloat(current));
            LinkedList_add(dataSetValues, MmsValue_newFloat(voltage));
            LinkedList_add(dataSetValues, MmsValue_newFloat(freq));
            
            if (GoosePublisher_publish(publisher, dataSetValues) == -1) {
                printf("Error sending message!\n");
            }
            
            LinkedList_destroyDeep(dataSetValues, (LinkedListValueDeleteFunction) MmsValue_delete);
            
            // IEC 61850-8-1 timing
            if (state_changed) {
                Thread_sleep(4);  // Fast retransmission
                state_changed = 0;
            } else {
                Thread_sleep(1000);  // Heartbeat
            }
        }

        GoosePublisher_destroy(publisher);
    }
    else {
        printf("Failed to create GOOSE publisher. Reason can be that the Ethernet interface doesn't exist or root permission are required.\n");
    }

    return 0;
}