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
    // A checksum mismatch means the pieces the server assembled don't match
    // what the tracker read -- usually a bad read off the card, which a fresh
    // attempt can fix. Retry it; never write a recording off for that.
    if (rc == 422 && body && strstr(body, "sha256_mismatch")) return UploadOutcome::Retry;
    // Bad filename, too large, nothing usable in it.
    if (rc == 400 || rc == 413 || rc == 422) return UploadOutcome::Rejected;
    // 401 (token), 5xx, and network failures (negative codes) are temporary.
    return UploadOutcome::Retry;
}

// Compression (docs/features/tracker-bluetooth-sync.md, P1). Each upload piece
// is zlib-compressed on the tracker and sent with &enc=zlib; the server unpacks
// it on arrival. A piece goes compressed only when that saves bytes: the
// compressor returns 0 on failure, and tiny or random data can grow.
static inline bool sendCompressed(size_t rawLen, size_t compressedLen)
{
    return compressedLen > 0 && compressedLen < rawLen;
}

// The server answers 400 bad_encoding when it can't unpack a piece. A 400 would
// otherwise write the whole recording off (uploadOutcome above), so a bug in
// the compression must never cost a paddle: resend that piece plain, at once.
static inline bool resendPlain(int rc, const char *body)
{
    return rc == 400 && body && strstr(body, "bad_encoding");
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
