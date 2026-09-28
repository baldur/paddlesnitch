#pragma once
#include <stdio.h>
#include <string.h>

// What a server reply to an upload means for the file on the card.
//
// The chunked upload used to treat anything but 201/202 as "try again next
// sync", forever. So a recording the server can never accept (no GPS points,
// no motion rows, too large) was re-sent every five minutes for the life of
// the card, and the Sync screen counted it as pending forever. The single-shot
// upload before it knew the difference; chunking lost it.

enum class UploadOutcome {
    Accepted,   // the server has it: mark it done
    Rejected,   // the server can never use it: stop sending it
    Retry,      // may work next time: leave it for the next sync
};

static inline UploadOutcome uploadOutcome(int rc, const char *body)
{
    if (rc == 200 || rc == 201) return UploadOutcome::Accepted;
    // 409 is several things. "already_uploaded" means the server has it (an
    // earlier sync landed it but the reply was lost). The others -- a part
    // missing, or a sidecar whose track hasn't arrived -- clear up on a retry.
    if (rc == 409) return (body && strstr(body, "already_uploaded")) ? UploadOutcome::Accepted : UploadOutcome::Retry;
    // Bad filename, too large, nothing usable in it, checksum mismatch.
    if (rc == 400 || rc == 413 || rc == 422) return UploadOutcome::Rejected;
    // 401 (token), 5xx, and network failures (negative codes) are temporary.
    return UploadOutcome::Retry;
}

// How uploaded.txt records each outcome (it stores the HTTP code).
static inline bool indexRcConfirmed(int rc) { return rc == 200 || rc == 201 || rc == 409; }
static inline bool indexRcRejected(int rc)  { return rc == 400 || rc == 413 || rc == 422; }

// The motion file recorded alongside a track: track_X.csv -> track_X_i10.csv.
// When the track is rejected its motion file can never attach to anything (the
// server answers 409 "track not uploaded" for ever), so it is rejected too.
static inline bool sidecarForTrack(const char *track, char *out, size_t outSize)
{
    const size_t n = strlen(track);
    if (n < 5 || strcmp(track + n - 4, ".csv") != 0) return false;
    return snprintf(out, outSize, "%.*s_i10.csv", (int)(n - 4), track) < (int)outSize;
}
