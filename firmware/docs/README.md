# Firmware docs

| Doc | Lives where | Why |
|---|---|---|
| `device-states-spec.md` | **here** | Device-only: states, screens, gestures. paddlesnitch has no stake in it. |
| Device uplink contract | `../../docs/features/device-uplink.md` | Describes endpoints paddlesnitch implements. |
| Device data contract | `../../docs/features/device-data.md` | Describes the CSV paddlesnitch parses, and how far to trust each column. |

The two contracts deliberately live **once**, on the paddlesnitch side, because
that is where the code implementing them lives and where the repo's other
feature specs are. Both were previously duplicated here; that copy is gone.

**Changing the CSV columns or the sensor pipeline means updating
`../../docs/features/device-data.md` in the same change.** paddlesnitch makes
segmentation, retention and trust decisions from it.
