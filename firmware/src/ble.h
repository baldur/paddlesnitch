#pragma once
// The tracker's Bluetooth service (docs/features/tracker-bluetooth-sync.md, P4).
// Compiled only with -DBLE_ENABLED=1, which only the bench build sets so far:
// there is no pairing yet, so it must not reach trackers in use.
void bleStart();
