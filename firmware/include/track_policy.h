#pragma once

// When the Track screen starts a recording by itself, and where a confirmed
// stop leaves you. Kept together because they only work as a pair: Track
// auto-starts whenever it is open, idle and has a fix, so a stop that left you
// ON Track was undone a second later by a brand-new recording (0.12.0 to
// 0.16.2; every "stopped" outing kept recording). A stop therefore returns to
// the menu, and the host test pins the pair.

struct TrackNav {
    bool menuOpen;   // a menu (Pick/Settings) is showing, not a screen
    bool onTrack;    // the current screen is Track
};

static inline bool trackShouldAutoStart(TrackNav nav, bool recording, bool fix)
{
    return !nav.menuOpen && nav.onTrack && !recording && fix;
}

// Where a confirmed stop leaves you: back on the menu (Track still highlighted).
static inline TrackNav trackNavAfterStop(TrackNav nav)
{
    nav.menuOpen = true;
    return nav;
}
