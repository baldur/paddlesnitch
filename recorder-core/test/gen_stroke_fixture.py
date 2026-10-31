"""Writes fixtures/stroke_paddle/calls.csv: a short paddle with real stroke
windows, so every platform's build of the stroke maths is held to the same
bytes. Then `make fixtures` writes its outputs.

    python3 test/gen_stroke_fixture.py fixtures && make fixtures

Samples come about every 80 ms with the tracker's jitter (some gaps longer,
as when the SD card holds the bus), so the mean gap is above the median:
the rate is taken from each window's mean spacing, which this pins.
"""
import math, os, sys

out = sys.argv[1]
seed = 11
def rnd():
    global seed
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed / 0x7fffffff - 0.5) * 2

# (seconds, strokes/min or 0, km/h): parked, paddling, a rest, paddling
plan = [(60, 0, 0.0), (150, 56, 8.0), (80, 0, 6.5), (150, 62, 8.5), (20, 0, 0.0)]

lines = [
    "# A paddle with real stroke windows: 1 min parked, 2.5 min at 56 spm, an\n",
    "# 80 s rest drifting at 6.5 km/h, 2.5 min at 62 spm, stopped. Alternating\n",
    "# (a smooth swing, one cycle per pair of strokes). Samples ~80 ms apart\n",
    "# with the tracker's jitter: the mean gap is longer than the median.\n",
    "config,tracker\n",
]
t_ms, row_ms, t_s = 5000, 6000, 0.0
for secs, spm, kmh in plan:
    end = t_s + secs
    while t_s < end:
        while row_ms < t_ms:   # rows before this sample; a sample in a row's ms goes first
            lines.append(f"second,{row_ms},1,2026-09-13,09:{(row_ms // 60000) % 60:02d}:{(row_ms // 1000) % 60:02d},"
                         f"51.4600000,-0.9700000,38.0,{kmh:.2f},90.0,12,0.9,3950,{row_ms // 1000},1,24.5\n")
            row_ms += 1000
        if spm:
            period = 60 / spm
            g = 40 * math.sin(math.pi * t_s / period) + 2 * rnd()
        else:
            g = 0.3 * rnd()
        lines.append(f"imu,{t_ms},0.0100,0.0200,1.0000,{g * 0.2:.2f},{g:.2f},{g * 0.4:.2f}\n")
        gap = 80 + (12 if rnd() > 0.8 else 0) + int(abs(rnd()) * 3)
        t_ms += gap
        t_s += gap / 1000
lines += ["finish\n",
          "# known answers: the two stretches' median, the series, its points\n",
          "expect_session,moving,57,61\n",
          "expect_series,1\n",
          "expect_points,40,80,53,66\n"]
os.makedirs(f"{out}/stroke_paddle", exist_ok=True)
open(f"{out}/stroke_paddle/calls.csv", "w").write("".join(lines))
