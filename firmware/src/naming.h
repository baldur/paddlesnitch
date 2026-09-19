#pragma once
#include <stddef.h>

// The pure decisions about session filenames and chunking, with NO Arduino
// dependency, so they can be compiled and tested on a host.
//
// This file exists because of one bug. `isTrackUpload` did not exclude the
// `_i10.csv` suffix when that suffix was introduced, so the upload-rate sidecar
// was classified as a track, the chunked sidecar path never ran, and every
// failure presented as a whole-file read of 2383054 bytes. It cost a full
// debugging session and five wrong diagnoses. A three-line host test would have
// caught it before the first flash.
//
// Keep everything here free of Arduino types, globals and I/O. If a function
// needs the SD card, the network or millis(), it does not belong in this file.

// Is this a session track the device should upload?
// True for `track_<stamp>.csv`; false for BOTH sidecar suffixes.
bool nameIsTrackUpload(const char *name);

// Is this the ~12 Hz motion sidecar the device should upload?
// True only for `track_<stamp>_i10.csv`. The full-rate `_imu.csv` stays on the
// card: it reaches 10 MB and re-reading it at sync time once boot-looped the
// device.
bool nameIsMotionUpload(const char *name);

// `track_<stamp>_i10.csv` -> `track_<stamp>_imu.csv`, the name the SERVER keys a
// sidecar by. The on-card name and the uploaded name differ on purpose.
// Writes at most `outSize` bytes including the terminator; returns false if it
// would not fit or the input is not a sidecar name.
bool nameMotionUploadName(const char *local, char *out, size_t outSize);

// How many chunks a file of `total` bytes splits into. Zero bytes is zero
// chunks -- an empty file is not a one-part upload, and treating it as one sends
// a part the server cannot assemble.
int chunkCount(size_t total, size_t chunkSize);

// Byte length of chunk `part` (1-based) of `total`. Returns 0 for an
// out-of-range part, so a caller that miscounts sends nothing rather than
// reading past the end of the file.
size_t chunkLength(size_t total, size_t chunkSize, int part);
