"""Writes the phone layer's fixture inputs, fixtures/phone_*/phone.csv.

    python3 test/gen_phone_fixtures.py fixtures && make fixtures

Each event gets a delivery time (end of its batch + latency, never before
the previous event of the same sensor), and the file lists events in
delivery order, as a phone hands them to recorder_phone.h. Read every
changed line of the outputs before committing (fixtures/README.md)."""
import math, sys, os, datetime
out = sys.argv[1]

def utc(y, mo, d, h, mi, s, ms=0):
    return int(datetime.datetime(y, mo, d, h, mi, s, tzinfo=datetime.timezone.utc).timestamp()) * 1000 + ms

def fmt(v):
    return repr(round(v, 9)) if isinstance(v, float) else str(v)

def write(name, header, events, tail):
    os.makedirs(f"{out}/{name}", exist_ok=True)
    events.sort(key=lambda e: (e[0], e[1]))
    with open(f"{out}/{name}/phone.csv", "w") as f:
        f.write(header)
        for _, _, line in events:
            f.write(line + "\n")
        f.write(tail)

def sensors(t0, secs, hz, platform, accel_batch, gyro_batch, gyro_offset_ns, latency_ns,
            delayed=None, gyro_stop_ns=None):
    """accel/gyro events; delivered at the end of their batch + latency.
    delayed = (start_ns, end_ns, extra_ns): accel batches in that span come late."""
    ev, seq = [], 0
    step = 1_000_000_000 // hz
    n = secs * hz
    for kind, batch, off in (("accel", accel_batch, 0), ("gyro", gyro_batch, gyro_offset_ns)):
        prev = 0  # each sensor's events arrive in order: a late batch holds back the rest
        for i in range(n):
            t = t0 + i * step + off
            if kind == "gyro" and gyro_stop_ns is not None and t >= gyro_stop_ns:
                break
            ph = 2 * math.pi * i / hz  # 1 Hz stroke-like motion
            if kind == "accel":
                gx, gy, gz = 0.12 * math.sin(ph), 0.05 * math.cos(ph), 1.0 + 0.2 * math.sin(2 * ph)
                if platform == "android":
                    x, y, z = gx * 9.80665, gy * 9.80665, gz * 9.80665
                else:
                    x, y, z = -gx, -gy, -gz
            else:
                x, y, z = 0.3 * math.sin(ph), -0.4 * math.cos(ph), 0.1 * math.sin(3 * ph)
            batch_end = t0 + ((i // batch) + 1) * batch * step + off
            deliver = batch_end + latency_ns
            if delayed and kind == "accel" and delayed[0] <= t < delayed[1]:
                deliver += delayed[2]
            deliver = prev = max(deliver, prev)
            ev.append((deliver, seq, f"{kind},{t},{fmt(x)},{fmt(y)},{fmt(z)}"))
            seq += 1
    return ev

def locations(t0, secs, utc0, start_ms=200, skip=(), invalid_first=False, ev=None):
    for k in range(secs):
        if k in skip:
            continue
        t = t0 + k * 1_000_000_000 + start_ms * 1_000_000
        lat = 51.4600000 + k * 0.0000312
        lon = -0.9700000 + k * 0.0000451
        if invalid_first and k == 1:
            alt, spd, crs = "", "", ""
        else:
            alt, spd, crs = f"{38.0 + 0.1 * k:.1f}", f"{2.30 + 0.01 * k:.2f}", f"{45.0 + k:.1f}"
        ev.append((t, 0, f"location,{t},{utc0 + k * 1000},{lat:.7f},{lon:.7f},{alt},{spd},{crs}"))

def ticks(t0, secs, tick_ns, ev, sats=lambda k: 10 + k % 3, batt=lambda k: 3950 - k):
    for k in range(1, secs + 1):
        t = t0 + k * 1_000_000_000 + tick_ns
        ev.append((t, 1, f"tick,{t},{sats(k)},{batt(k)}"))

# A. Android, 50 Hz, batches of 25 (0.5 s), latency 40 ms; one accel stretch
# 2.5 s late; ticks fall 0.3 ms after an accel sample in the same millisecond.
t0 = 3_600_123_456_789
ev = sensors(t0, 7, 50, "android", 25, 25, 3_000_000, 40_000_000,
             delayed=(t0 + 3_000_000_000, t0 + 4_000_000_000, 2_500_000_000))
locations(t0, 7, utc(2026, 9, 20, 9, 14, 7, 0), ev=ev)
ticks(t0, 6, 300_000, ev)
dup = t0 + 3_000_000_000 + 300_000 + 100_000   # same ms as tick 3, while it's held
ev.append((dup, 1, f"tick,{dup},99,1"))
write("phone_android",
      "# Android: m/s² and rad/s in batches of 0.5 s, the gyroscope 3 ms behind,\n"
      "# one stretch of accelerometer events 2.5 s late (holding back the rest),\n"
      "# the first sample before any gyroscope reading (unpaired), each tick 0.3 ms\n"
      "# after a sample in the same millisecond (the sample goes in that row), and\n"
      "# a second tick in tick 3's millisecond while rows are held (ignored).\n"
      "phone,android,sats batt_mv,1\n", ev,
      "finish\nexpect,dropped_late,0,dropped_unpaired,1\n")

# B. iPhone: g with up reading -1; gyro in 1 s batches, accel in 0.2 s ones;
# the first fix has no speed, course or altitude; no fixes for seconds 3-6,
# so rows 4-6 have none (stale at 3 s), then the fix comes back.
t0 = 98_765_432_100_000
ev = sensors(t0, 9, 50, "ios", 10, 50, 0, 15_000_000)
locations(t0, 9, utc(2026, 9, 20, 23, 59, 56, 450), skip=(3, 4, 5, 6), invalid_first=True, ev=ev)
ticks(t0, 8, 500_000_000, ev)
# tick 2's timer fires late, after the gyroscope batch to 3 s went on: its
# row is written at the latest sample's millisecond, not lost.
for i, e in enumerate(ev):
    if e[2].startswith(f"tick,{t0 + 2_500_000_000},"):
        ev[i] = (t0 + 3_100_000_000, e[1], e[2])
write("phone_ios",
      "# iPhone: g with up reading -1 (negated to +1); both sensors on the same\n"
      "# instants (the gyroscope goes first on a tie, so each sample pairs with\n"
      "# its own reading), the gyroscope in 1 s batches behind 0.2 s\n"
      "# accelerometer ones; row 1's fix has no speed, course or\n"
      "# altitude (written 0); no fixes in seconds 3-6, so rows 5 and 6 have\n"
      "# none (over 3 s old, as the tracker); the UTC date rolls over midnight;\n"
      "# tick 2 arrives late, after samples to 3 s went on: its row is written\n"
      "# at the latest sample's millisecond, not lost.\n"
      "phone,ios,,1\n", ev,
      "finish\nexpect,dropped_late,0,dropped_unpaired,0\n")

# C. Android, the gyroscope stops at 2.5 s: rows wait until 8 are held, then
# go without it; accelerometer samples with no gyroscope in 100 ms are
# dropped (unpaired); rows read motion down (zeros). Then one straggler
# from before a written row arrives (late), and finish writes what's held.
t0 = 5_000_000_000
ev = sensors(t0, 14, 50, "android", 5, 5, 2_000_000, 10_000_000, gyro_stop_ns=t0 + 2_500_000_000)
locations(t0, 14, utc(2026, 9, 20, 7, 0, 0, 0), ev=ev)
ticks(t0, 13, 250_000_000, ev)
straggler_t = t0 + 1_000_000_000 + 10_000_000
ev.append((t0 + 13_600_000_000, 2, f"accel,{straggler_t},0.1,0.2,9.8"))
write("phone_sensor_stops",
      "# Android: the gyroscope stops 2.5 s in. Rows are held until 8 wait,\n"
      "# then written without it; accelerometer samples without a gyroscope\n"
      "# reading in the last 100 ms are dropped; a straggler from before a\n"
      "# written row is dropped as late; finish writes the rest.\n"
      "phone,android,batt_mv,1\n", ev,
      "finish\nexpect,dropped_late,1,dropped_unpaired,571\n")

# E. Both sensors pause 2.5-13 s (nothing delivered): rows wait until 8 are
# held, then go without them. When the sensors come back, the first
# accelerometer sample is in a written row's millisecond (late), the rest go on.
t0 = 20_000_000_000
ev = [e for e in sensors(t0, 16, 50, "android", 5, 5, 0, 10_000_000)
      if not (t0 + 2_500_000_000 <= int(e[2].split(",")[1]) < t0 + 13_000_000_000)]
locations(t0, 16, utc(2026, 9, 20, 8, 0, 0, 0), ev=ev)
ticks(t0, 15, 0, ev)
# Tick 11 forces out row 3 (8 were held); then, still in the pause, a
# sample in row 3's millisecond arrives: its row is written, so it's late.
same = t0 + 3_000_000_000 + 500_000
ev.append((t0 + 11_500_000_000, 0, f"accel,{same},0.5,0.5,9.0"))
write("phone_sensors_pause",
      "# Android: both sensors deliver nothing from 2.5 s to 13 s. Rows wait\n"
      "# until 8 are held, then go without them (motion down). Mid-pause a\n"
      "# sample arrives in a written row's millisecond: dropped as late.\n"
      "phone,android,,1\n", ev,
      "finish\nexpect,dropped_late,1,dropped_unpaired,0\n")

# D. Track only (no gyroscope): rows aren't held; sensor events are ignored;
# a fix 2.999 s old counts and 3.000 s doesn't; 29 Feb in a leap year.
t0 = 1_000_000_000
L = lambda t, u: f"location,{t},{u},-33.8567844,151.2152967,4.0,1.50,270.0"
lines = [
    "# Track only: no motion held or written; a fix is current while under 3 s\n",
    "# old (2.999 s yes, 3.000 s no); 29 Feb 2028; sensor calls are ignored.\n",
    "phone,android,sats,0\n",
    f"{L(t0, utc(2028, 2, 29, 12, 0, 0, 999))}\n",
    f"accel,{t0 + 100_000_000},0,0,9.8\n",
    f"gyro,{t0 + 100_000_000},0,0,0\n",
    f"tick,{t0 + 1_000_000_000},7,0\n",
    f"tick,{t0 + 2_999_000_000},7,0\n",
    f"tick,{t0 + 3_000_000_000},7,0\n",
    f"tick,{t0 + 3_000_000_000},7,0\n",
    f"{L(t0 + 4_000_000_000, utc(2028, 2, 29, 23, 59, 59, 0))}\n",
    f"tick,{t0 + 4_500_000_000},8,0\n",
    "finish\n", "expect,dropped_late,0,dropped_unpaired,0\n",
]
os.makedirs(f"{out}/phone_track_only", exist_ok=True)
open(f"{out}/phone_track_only/phone.csv", "w").write("".join(lines))
