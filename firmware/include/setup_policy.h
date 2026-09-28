#pragma once
#include <string.h>

// Two setup decisions that used to go wrong for a new owner.

// A hold while the tracker is not yet on an account normally retries setup or
// linking ("Hold BOOT to retry"). But while the code is on screen the link is
// already running in the background, and a hold started a SECOND one: it
// froze the screen for up to five minutes and replaced the code the owner was
// typing into the website. So a hold does nothing while a code is out.
static inline bool linkHoldRetries(bool claimInProgress) { return !claimInProgress; }

// Whether saved WiFi details still count as "have worked". The tracker only
// reopens setup by itself for details that have NEVER worked (a failure on a
// network that has worked means it is away from home). Saving a new network
// or password in setup kept the old "worked" mark, so a mistyped new password
// looked like being away from home: setup never came back, and the only way
// out was knowing about Settings > Network. New details now have to work once
// before they count.
static inline bool wifiStillProven(bool everConnected, const char *oldSsid, const char *oldPass,
                                   const char *newSsid, const char *newPass)
{
    return everConnected && strcmp(oldSsid, newSsid) == 0 && strcmp(oldPass, newPass) == 0;
}
