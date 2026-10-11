#pragma once
#include <stdint.h>
#include <string.h>
#include <algorithm>
#include <map>
#include <string>
#include <vector>
#include "upload_index.h"
#include "upload_policy.h"

// What may be deleted from the card, and when. Pure, so it is host-tested: a
// wrong answer here deletes a paddle that exists nowhere else.
//
// A paddle on the card is up to three files sharing one base name:
//   track_X.csv       the track             -- uploaded
//   track_X_i10.csv   motion at ~10 Hz      -- uploaded after the track
//   track_X_imu.csv   motion at full rate   -- NEVER uploaded; card only
//
// THE RULE: nothing is deleted until the server has confirmed the track AND its
// 10 Hz motion file (or that file never existed, or the server refused it for
// good). The full-rate file has no copy anywhere, so it goes only when the card
// is short of space -- oldest paddles first -- and never by the manual "delete
// uploaded", which keeps it as before.

struct CardFile { std::string name; uint64_t size; };

// "track_X" for any of the three files, "" for anything else.
static inline std::string cardUnitBase(const std::string &name)
{
    if (name.compare(0, 6, "track_") != 0 || name.size() < 10) return "";
    const char *sfx[] = { "_i10.csv", "_imu.csv", ".csv" };
    for (const char *s : sfx) {
        const size_t n = strlen(s);
        if (name.size() > n + 6 && name.compare(name.size() - n, n, s) == 0) return name.substr(0, name.size() - n);
    }
    return "";
}

// The index answer "the server has it": 200/201/409, or a pre-code line ("name"
// alone), which very old firmware wrote only after a 200.
static inline bool cardConfirmed(const UploadIndex &ix, const std::string &name)
{
    return ix.has(name.c_str()) && (ix.rc(name.c_str()) == 0 || indexRcConfirmed(ix.rc(name.c_str())));
}

// Is this paddle safely on the server? Its track confirmed, and its 10 Hz motion
// file confirmed, refused for good, or not on the card.
static inline bool cardUnitSafe(const UploadIndex &ix, const std::string &base, bool i10OnCard)
{
    if (!cardConfirmed(ix, base + ".csv")) return false;
    if (!i10OnCard) return true;
    const std::string i10 = base + "_i10.csv";
    return cardConfirmed(ix, i10) || indexRcRejected(ix.rc(i10.c_str()));
}

// Start freeing space above this share of the card, and stop below the second,
// so a card near the line does not delete one paddle per sync.
static const unsigned CARD_CLEAN_START_PCT = 80;
static const unsigned CARD_CLEAN_STOP_PCT  = 70;

// Files to delete to bring the card under CARD_CLEAN_STOP_PCT, whole paddles,
// oldest first (the base name starts with the date, so it sorts by time).
// Empty unless the card is above CARD_CLEAN_START_PCT. `activeBase` is the paddle
// being recorded ("" if none) and is never touched. `totalBytes` is the card.
static inline std::vector<std::string> cardSpacePlan(const std::vector<CardFile> &files, const UploadIndex &ix,
                                                     uint64_t totalBytes, const std::string &activeBase)
{
    std::vector<std::string> out;
    uint64_t used = 0;
    for (const auto &f : files) used += f.size;
    if (!totalBytes || used * 100 <= totalBytes * CARD_CLEAN_START_PCT) return out;

    std::map<std::string, std::vector<const CardFile *>> units;   // ordered: oldest first
    for (const auto &f : files) {
        const std::string b = cardUnitBase(f.name);
        if (!b.empty() && b != activeBase) units[b].push_back(&f);
    }
    for (const auto &u : units) {
        if (used * 100 <= totalBytes * CARD_CLEAN_STOP_PCT) break;
        bool i10 = false;
        for (const CardFile *f : u.second) if (f->name == u.first + "_i10.csv") i10 = true;
        if (!cardUnitSafe(ix, u.first, i10)) continue;
        for (const CardFile *f : u.second) { out.push_back(f->name); used -= f->size; }
    }
    return out;
}

// The manual "delete uploaded" (a held, confirmed action on the Sync screen):
// every confirmed track and every confirmed 10 Hz motion file -- the motion file
// used to be left behind for ever. The full-rate file stays, as it always has.
static inline std::vector<std::string> cardManualPlan(const std::vector<CardFile> &files, const UploadIndex &ix,
                                                      const std::string &activeBase)
{
    std::vector<std::string> out;
    for (const auto &f : files) {
        const std::string b = cardUnitBase(f.name);
        if (b.empty() || b == activeBase) continue;
        const bool isTrack = f.name == b + ".csv", isI10 = f.name == b + "_i10.csv";
        if ((isTrack || isI10) && cardConfirmed(ix, f.name)) out.push_back(f.name);
    }
    return out;
}

// Should this upload-index line stay? Only while some file of its paddle is
// still on the card: the line is what stops a re-upload, and what lets a 10 Hz
// motion file upload after its track was deleted (it waits for the track's
// line). Once the whole paddle is gone the line is history and goes (#417).
static inline bool cardIndexLineKeep(const std::string &name, const std::vector<CardFile> &files)
{
    const std::string b = cardUnitBase(name);
    for (const auto &f : files) {
        if (f.name == name) return true;
        if (!b.empty() && cardUnitBase(f.name) == b) return true;
    }
    return false;
}
