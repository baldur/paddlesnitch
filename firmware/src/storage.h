#pragma once
#include <Arduino.h>

// CSV logging to the microSD card.
//
// Every row is flushed immediately. This costs write throughput but means
// pulling the USB cable -- the normal way this device gets switched off --
// never loses the session. At 1 Hz that trade is free.

bool     storageInit();                 // mounts the card; does NOT open a file
bool     storageReady();                // card mounted

// Recording is deliberate: a file is one paddle, not one power-on. Logging
// whenever the device has power fills the card with bench noise -- of the first
// 31 sessions uploaded, all 31 contained no usable track points.
bool     storageStartSession();
void     storageStopSession();
bool     storageRecording();
const char *storageFilename();
uint32_t storageRowCount();
void     storageLogRow(const char *csvLine);
void     storageClose();

// Serial file access, so logs can be pulled off the card without removing it.
// Both write framing markers that tools/dump.py keys on.
void     storageList();
void     storageCat(const char *name);
