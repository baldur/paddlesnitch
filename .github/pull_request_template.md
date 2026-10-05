## What and why



## Tests

- [ ] `pnpm test` passes (web)

## Firmware release checklist

<!-- Delete this section if the PR doesn't touch firmware/src.
     Merging firmware to main RELEASES it to every tracker.
     docs/features/release-testing.md has the steps. -->

- [ ] `firmware/VERSION` bumped and `firmware/NOTES` written for paddlers
- [ ] **A. Bench** (paste `tools/bench.sh` output below)
  - [ ] `pio test -e native` and both builds pass
  - [ ] `bench.sh status`: starts, no crash, headroom ≥ 7,000 B
  - [ ] `bench.sh put-fixture` + `bench.sh sync`: uploads, compressed, recording on /devices
  - [ ] crash recovery (if start-up, uploads or updates changed)
- [ ] **B. Phone** (if Bluetooth or setup changed): pair, WiFi, sync, add to account
- [ ] **C. After merge** (same day): release run green, a tracker updates itself from the previous release, trackers show "up to date"

<details><summary>Bench output</summary>

```
```

</details>
