#pragma once
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <map>
#include <string>

// The upload index (UPLOADED_INDEX on the card: one "name\tcode" line per
// upload, appended; very old lines are just "name") read ONCE into memory.
//
// Scans used to re-read the whole index from the card for every file on it:
// files x lines of slow SD reads in one go. On a well-used card the count after
// each sync kept CPU 0 busy past the 5 s task watchdog, and the tracker
// restarted itself ~15 s after every start (0.18.0, 2026-10-08).
//
// The index is never trimmed (a deleted file's line stays), so a scan first
// names the files it cares about (want) and only those are kept: memory follows
// what is on the card, not the card's whole history.
//
// Same answers as the line-by-line lookups it replaces: the FIRST line for a
// name wins, a line without a code counts as uploaded with code 0, and
// whitespace around a line is ignored.
class UploadIndex {
public:
    // Only keep lines for these names (call before addLine). Never called = keep all.
    void want(const char *name) { if (name) wanted_.emplace(name, 0); }

    void addLine(const char *raw)
    {
        std::string line(raw ? raw : "");
        size_t b = 0, e = line.size();
        while (b < e && isspace((unsigned char)line[b])) b++;
        while (e > b && isspace((unsigned char)line[e - 1])) e--;
        line = line.substr(b, e - b);
        if (line.empty()) return;
        size_t tab = line.find('\t');
        std::string name = tab == std::string::npos ? line : line.substr(0, tab);
        if (!wanted_.empty() && !wanted_.count(name)) return;
        int rc = tab == std::string::npos ? 0 : atoi(line.c_str() + tab + 1);
        m_.emplace(name, rc);   // emplace keeps the first entry
    }
    bool has(const char *name) const { return m_.count(name) > 0; }
    // The HTTP code recorded for a file, or 0 if it has none.
    int rc(const char *name) const
    {
        auto it = m_.find(name);
        return it == m_.end() ? 0 : it->second;
    }
    size_t size() const { return m_.size(); }

private:
    std::map<std::string, int> m_;
    std::map<std::string, int> wanted_;
};
