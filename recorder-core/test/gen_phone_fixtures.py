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
            delayed=None, gyro_stop_ns=None, gyro_phase=0):
    """accel/gyro events; delivered at the end of their batch + latency.
    delayed = (start_ns, end_ns, extra_ns): accel batches in that span come late."""
    ev, seq = [], 0
    step = 1_000_000_000 // hz
    n = secs * hz
    for kind, batch, off, phase in (("accel", accel_batch, 0, 0),
                                    ("gyro", gyro_batch, gyro_offset_ns, gyro_phase)):
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
            batch_end = t0 + (((i + phase) // batch) + 1) * batch * step - phase * step + off
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

def ticks(t0, secs, tick_ns, ev, batt=lambda k: 3950 - k, first=1):
    for k in range(first, secs + 1):
        t = t0 + k * 1_000_000_000 + tick_ns
        ev.append((t, 1, f"tick,{t},{batt(k)}"))

# A. Android, 50 Hz, batches of 25 (0.5 s), latency 40 ms; one accel stretch
# 2.5 s late; ticks fall 0.3 ms after an accel sample in the same millisecond.
t0 = 3_600_123_456_789
ev = sensors(t0, 7, 50, "android", 25, 25, 3_000_000, 40_000_000,
             delayed=(t0 + 3_000_000_000, t0 + 4_000_000_000, 2_500_000_000))
locations(t0, 7, utc(2026, 9, 20, 9, 14, 7, 0), ev=ev)
ticks(t0, 6, 300_000, ev)
dup = t0 + 3_000_000_000 + 300_000 + 100_000   # same ms as tick 3, while it's held
ev.append((dup, 1, f"tick,{dup},1"))
write("phone_android",
      "# Android: m/s² and rad/s in batches of 0.5 s, the gyroscope 3 ms behind,\n"
      "# one stretch of accelerometer events 2.5 s late (holding back the rest),\n"
      "# the first sample before any gyroscope reading (unpaired), each tick 0.3 ms\n"
      "# after a sample in the same millisecond (the sample goes in that row), and\n"
      "# a second tick in tick 3's millisecond while rows are held (ignored);\n"
      "# configured with satellites, which phones leave blank.\n"
      "phone,android,sats batt_mv,1\n", ev,
      "finish\nexpect,dropped_late,0,dropped_unpaired,1\n")

# B. iPhone (what it pins is in the file's comment below).
t0 = 98_765_432_100_000
ev = sensors(t0, 9, 50, "ios", 10, 50, 0, 15_000_000)
locations(t0, 9, utc(2026, 9, 20, 23, 59, 56, 450), skip=(3, 4, 5, 6), invalid_first=True, ev=ev)
ticks(t0, 8, 500_000_000, ev)
# A cached fix (the first CLLocation is often minutes old), stamped with when
# it was taken, and a tick before the sensors start: no fix, motion down.
ev.append((t0 - 600_000_000, 0,
           f"location,{t0 - 600_000_000_000},{utc(2026, 9, 20, 23, 50, 0, 0)},51.5000000,-0.9000000,40.0,0.00,0.0"))
ev.append((t0 - 500_000_000, 1, f"tick,{t0 - 500_000_000},0"))
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
      "# altitude (written 0); no fixes in seconds 3-6, so rows 3 and 4 reuse\n"
      "# the last fix with the clock running on, and rows 5 and 6 have none\n"
      "# (over 3 s old, as the tracker); the UTC date rolls over midnight;\n"
      "# tick 2 arrives late, after samples to 3 s went on: its row is written\n"
      "# at the latest sample's millisecond, not lost; a cached fix 10 minutes\n"
      "# old and a tick before the sensors start (no fix, motion down).\n"
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

# E. Both sensors pause 2.5-40 s (nothing delivered): rows wait until 32
# are held, then go without them. Mid-pause, a sample in a written row's
# millisecond arrives (late); after the pause the rest go on.
t0 = 20_000_000_000
ev = [e for e in sensors(t0, 43, 50, "android", 5, 5, 0, 10_000_000)
      if not (t0 + 2_500_000_000 <= int(e[2].split(",")[1]) < t0 + 40_000_000_000)]
locations(t0, 43, utc(2026, 9, 20, 8, 0, 0, 0), ev=ev)
ticks(t0, 42, 0, ev)
# Tick 35 forces out row 3 (32 were held); then, still in the pause, a
# sample in row 3's millisecond arrives: its row is written, so it's late.
same = t0 + 3_000_000_000 + 500_000
ev.append((t0 + 35_500_000_000, 0, f"accel,{same},0.5,0.5,9.0"))
write("phone_sensors_pause",
      "# Android: both sensors deliver nothing from 2.5 s to 40 s. Rows wait\n"
      "# until 32 are held, then go without them (motion down). Mid-pause a\n"
      "# sample arrives in a written row's millisecond: dropped as late.\n"
      "phone,android,,1\n", ev,
      "finish\nexpect,dropped_late,1,dropped_unpaired,0\n")

# F. Batches 12 s long (each sensor's FIFO emptied every 12 s, the
# gyroscope's half a batch out of step): rows wait, nothing is lost.
t0 = 40_000_000_000
ev = sensors(t0, 36, 50, "android", 600, 600, 3_000_000, 20_000_000, gyro_phase=300)
locations(t0, 36, utc(2026, 9, 20, 10, 0, 0, 0), ev=ev)
ticks(t0, 35, 500_000, ev)
write("phone_long_batches",
      "# Android: both sensors in 12 s batches, the gyroscope's half a batch\n"
      "# out of step (the BATCHING limit is 15 s at 50 Hz): rows wait for\n"
      "# them and nothing is dropped but the first, unpaired, sample.\n"
      "phone,android,batt_mv,1\n", ev,
      "finish\nexpect,dropped_late,0,dropped_unpaired,1\n")

# G. Timing the platform really produces: two ticks delivered more than a
# second late, after the samples to 13 s went on (each still gets its row);
# a gyroscope timestamp 1 ms before the one before (late); and a sample
# repeated in the same millisecond as a tick that's exactly on a sample,
# arriving in the next batch (it goes in that tick's row).
t0 = 60_000_000_000
ev = sensors(t0, 16, 50, "android", 5, 5, 0, 10_000_000)
locations(t0, 16, utc(2026, 9, 20, 11, 0, 0, 0), ev=ev)
ticks(t0, 15, 0, ev)
# (ticks keep their own order: an app takes each tick's time as it calls)
for i, e in enumerate(ev):
    for k in (11, 12, 13):
        if e[2].startswith(f"tick,{t0 + k * 1_000_000_000},"):
            ev[i] = (t0 + 13_050_000_000 + k, e[1], e[2])
R = t0 + 5_000_000_000            # sample 250 of each sensor, and tick 5, exactly
prev_batch = R + 10_000_000       # when samples 245-249 are delivered
nxt = R + 5 * 20_000_000 + 10_000_000
for i, e in enumerate(ev):
    if e[2].startswith(f"accel,{R},") or e[2].startswith(f"gyro,{R},"):
        ev[i] = (prev_batch + 1, e[1], e[2])
ev.append((nxt - 1, 0, f"accel,{R},0.5,0.4,9.7"))
back = t0 + 8_000_000_000         # a gyroscope sample, then one 1 ms earlier
ev.append((back + 10_000_000 + 1, 99, f"gyro,{back - 1_000_000},0.1,0.1,0.1"))
for i, e in enumerate(ev):
    if e[2].startswith(f"gyro,{back},"):
        ev[i] = (back + 10_000_000, e[1], e[2])
write("phone_timing",
      "# Android: ticks 11 and 12 delivered after the samples to 13 s went on\n"
      "# (each gets its row, just after them); a gyroscope timestamp 1 ms\n"
      "# before the previous one (dropped, late); tick 5 exactly on a sample,\n"
      "# with that sample repeated in the same millisecond in the next batch\n"
      "# (the row waits for it).\n"
      "phone,android,,1\n", ev,
      "finish\nexpect,dropped_late,1,dropped_unpaired,0\n")

# H. The accelerometer fills its buffer before the gyroscope delivers
# anything (45 s of it, then the gyroscope's whole 45 s at once): the
# oldest samples go on unpaired to make room, and the gyroscope readings
# older than them arrive too late.
t0 = 80_000_000_000
ev = [e for e in sensors(t0, 45, 50, "android", 50, 2250, 2_000_000, 5_000_000)]
ticks(t0, 45, 500_000, ev, first=45)
locations(t0, 45, utc(2026, 9, 20, 12, 0, 0, 0), ev=ev)
write("phone_buffer_full",
      "# Android: 45 s of accelerometer before any gyroscope event, then the\n"
      "# gyroscope's 45 s in one batch: the buffer (2048) is full, so the\n"
      "# oldest samples go on unpaired, and gyroscope readings older than\n"
      "# them are dropped as late. One tick, at the end.\n"
      "phone,android,,1\n", ev,
      "finish\nexpect,dropped_late,201,dropped_unpaired,202\n")

# D. Track only (no gyroscope): rows aren't held; sensor events are ignored;
# a fix 2.999 s old counts and 3.000 s doesn't; 29 Feb in a leap year.
t0 = 1_000_000_000
L = lambda t, u: f"location,{t},{u},-33.8567844,151.2152967,4.0,1.50,270.0"
lines = [
    "# Track only: no motion held or written; a tick before any location; a\n",
    "# fix is current while under 3 s old (2.999 s yes, 3.000 s no) and its\n",
    "# time runs on with its age; 29 Feb 2028; a repeated tick ignored; a\n",
    "# location with no time (0, as Android gives) and one dated 2024 aren't\n",
    "# fixes; sensor calls are ignored.\n",
    "phone,android,,0\n",
    f"tick,{t0 - 500_000_000},0\n",
    f"{L(t0, utc(2028, 2, 29, 12, 0, 0, 999))}\n",
    f"accel,{t0 + 100_000_000},0,0,9.8\n",
    f"gyro,{t0 + 100_000_000},0,0,0\n",
    f"tick,{t0 + 1_000_000_000},0\n",
    f"tick,{t0 + 2_999_000_000},0\n",
    f"tick,{t0 + 3_000_000_000},0\n",
    f"tick,{t0 + 3_000_000_000},0\n",
    f"{L(t0 + 4_000_000_000, utc(2028, 2, 29, 23, 59, 59, 0))}\n",
    f"tick,{t0 + 4_500_000_000},0\n",
    f"{L(t0 + 5_000_000_000, 0)}\n",
    f"tick,{t0 + 5_500_000_000},0\n",
    f"{L(t0 + 6_000_000_000, utc(2024, 12, 31, 23, 59, 59, 0))}\n",
    f"tick,{t0 + 6_500_000_000},0\n",
    "finish\n", "expect,dropped_late,0,dropped_unpaired,0\n",
]
os.makedirs(f"{out}/phone_track_only", exist_ok=True)
open(f"{out}/phone_track_only/phone.csv", "w").write("".join(lines))
