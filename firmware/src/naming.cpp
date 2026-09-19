#include "naming.h"
#include <string.h>
#include <stdio.h>

static bool endsWith(const char *s, const char *suffix)
{
    const size_t n = strlen(s), m = strlen(suffix);
    return m <= n && strcmp(s + (n - m), suffix) == 0;
}

static bool startsWith(const char *s, const char *prefix)
{
    return strncmp(s, prefix, strlen(prefix)) == 0;
}

bool nameIsTrackUpload(const char *name)
{
    if (!name) return false;
    // Must exclude BOTH sidecar suffixes. `_i10.csv` was added later and this
    // predicate was not updated, which is the whole reason this file exists.
    return startsWith(name, "track_") && endsWith(name, ".csv")
        && !endsWith(name, "_imu.csv") && !endsWith(name, "_i10.csv");
}

bool nameIsMotionUpload(const char *name)
{
    if (!name) return false;
    return startsWith(name, "track_") && endsWith(name, "_i10.csv");
}

bool nameMotionUploadName(const char *local, char *out, size_t outSize)
{
    if (!local || !out || !nameIsMotionUpload(local)) return false;
    const size_t stem = strlen(local) - strlen("_i10.csv");
    if (stem + strlen("_imu.csv") + 1 > outSize) return false;
    memcpy(out, local, stem);
    strcpy(out + stem, "_imu.csv");
    return true;
}

int chunkCount(size_t total, size_t chunkSize)
{
    if (total == 0 || chunkSize == 0) return 0;
    return (int)((total + chunkSize - 1) / chunkSize);
}

size_t chunkLength(size_t total, size_t chunkSize, int part)
{
    const int parts = chunkCount(total, chunkSize);
    if (part < 1 || part > parts) return 0;
    if (part < parts) return chunkSize;
    return total - (size_t)(part - 1) * chunkSize;   // the last one is the remainder
}
