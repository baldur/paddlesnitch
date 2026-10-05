#!/usr/bin/env python3
"""Bench checks for a tracker on USB (docs/features/release-testing.md).

    tools/bench.sh status        start-up report: version, Bluetooth, stack headroom
    tools/bench.sh put-fixture   write a 10-minute test recording to the card
                                 (bench build only: needs PUTFILE), stamped "now"
    tools/bench.sh sync          ask for a sync; check upload + compression + headroom
    tools/bench.sh log [secs]    print everything the tracker says (default 60 s)

Opening the port restarts the tracker; every command waits for it to start.
Each check prints PASS or FAIL with the evidence, and the exit code is non-zero
if any check failed.
"""
import datetime
import glob
import os
import re
import sys
import time

import serial

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, 'fixtures')
MIN_HEADROOM = 7000          # bytes of uplink stack left after a sync
failed = False


def check(ok, what, evidence=''):
    global failed
    failed |= not ok
    print(f"  {'PASS' if ok else 'FAIL'}  {what}{('  — ' + evidence) if evidence else ''}")


def port():
    ports = sorted(glob.glob('/dev/cu.usbmodem*'))
    if not ports:
        sys.exit('No tracker on USB (/dev/cu.usbmodem*). Plug it in.')
    return ports[0]


class Tracker:
    def __init__(self):
        self.s = serial.Serial()
        self.s.port, self.s.baudrate, self.s.timeout = port(), 115200, 0.2
        self.s.dtr = self.s.rts = False
        self.s.open()
        self.buf = b''

    def read(self, secs, until=None):
        """Read for up to `secs`, stopping early once `until` (a regex) matches."""
        end = time.time() + secs
        while time.time() < end:
            c = self.s.read(4096)
            if c:
                self.buf += c
            if until and re.search(until, self.buf):
                return True
        return False

    def boot(self):
        """Opening the port restarts the tracker: wait for it to finish starting."""
        self.read(40, rb'sync: stack headroom')
        return self.text()

    def cmd(self, line, secs=5, until=None):
        self.buf = b''
        self.s.write((line + '\n').encode())
        self.read(secs, until)
        return self.text()

    def text(self):
        return self.buf.decode(errors='replace')


def status():
    t = Tracker()
    out = t.boot()
    fw = re.search(r'bring-up \(fw ([^)]+)\)', out)
    check(bool(fw), 'starts up', f"firmware {fw.group(1)}" if fw else 'no start-up banner in 40 s')
    check('Guru Meditation' not in out, 'no crash while starting')
    ble = re.search(r'BLE: advertising as (\S+)', out)
    print(f"  info  Bluetooth: {'advertising as ' + ble.group(1) if ble else 'off in this build'}")
    head = re.search(r'stack headroom (\d+)', out)
    check(bool(head) and int(head.group(1)) >= MIN_HEADROOM, f'uplink stack headroom ≥ {MIN_HEADROOM} B',
          f"{head.group(1)} B" if head else 'no sync seen')
    st = t.cmd('STATUS', 3)
    for k in ('device', 'wifi', 'claimed', 'sessions on device'):
        m = re.search(rf'^{k}\s+(.*)$', st, re.M)
        if m:
            print(f"  info  {k}: {m.group(1).strip()}")


def stamped_fixture():
    """The fixture with its date moved to now, so each run is a new recording."""
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    lines = open(os.path.join(FIXTURES, 'bench_track.csv')).read().splitlines()
    hdr = lines[0].split(',')
    ti, di, ui = hdr.index('timestamp'), hdr.index('utc_date'), hdr.index('utc_time')
    first = datetime.datetime.strptime(lines[1].split(',')[ti], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
    shift = now - first
    out = [lines[0]]
    for l in lines[1:]:
        f = l.split(',')
        t = datetime.datetime.strptime(f[ti], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc) + shift
        f[ti], f[di], f[ui] = t.strftime('%Y-%m-%dT%H:%M:%SZ'), t.strftime('%Y-%m-%d'), t.strftime('%H:%M:%S')
        out.append(','.join(f))
    base = 'track_' + now.strftime('%Y%m%d_%H%M%S')
    motion = open(os.path.join(FIXTURES, 'bench_track_i10.csv'), 'rb').read()
    return base, ('\n'.join(out) + '\n').encode(), motion


def put(t, name, data):
    """PUTFILE: send 1 KB at a time and wait for the ACK byte (0x06) after each;
    the USB serial link drops bytes if the host runs ahead."""
    t.cmd(f'PUTFILE {name} {len(data)}', 10, rb'<<<PUT (READY|ERR)[^>]*>>>')
    if b'<<<PUT READY' not in t.buf:
        return False, 'no READY (is this the bench build? flash with tools/flash.sh -e tracker-bench)'
    t.buf = b''
    for i in range(0, len(data), 1024):
        t.s.write(data[i:i + 1024])
        end = time.time() + 10
        while time.time() < end:
            c = t.s.read(256)
            if c:
                t.buf += c
                if b'\x06' in c:
                    break
        else:
            return False, f'no acknowledgement at byte {i}'
    t.read(30, rb'<<<PUT (OK|ERR)[^>]*>>>')
    m = re.search(rb'<<<PUT (OK|ERR)([^>]*)>>>', t.buf)
    return bool(m and m.group(1) == b'OK'), (m.group(0).decode() if m else 'no answer')


def put_fixture():
    t = Tracker()
    t.boot()
    # Let the start-up sync finish switching WiFi off (a few seconds with
    # Bluetooth on): a PUTFILE sent during that loses its first block.
    t.read(12)
    base, track, motion = stamped_fixture()
    for name, data in ((base + '.csv', track), (base + '_i10.csv', motion)):
        ok, ev = put(t, name, data)
        if not ok:
            t.read(8)                      # let the tracker give up on the partial file
            ok, ev = put(t, name, data)    # one retry
        check(ok, f'wrote {name} ({len(data)} B)', ev)
    print(f"  info  recording on the card: {base}  (WiFi sync takes it within 5 minutes)")


def sync():
    t = Tracker()
    # Opening the port restarts the tracker, and it syncs as it starts -- that
    # start-up sync usually IS the upload, so check it together with the one
    # asked for.
    started = t.boot()
    out = started + t.cmd('SYNC', 120, rb'sync: stack headroom \d+')
    counts = [int(n) for n in re.findall(r'sync: (\d+) file\(s\) accepted', out)]
    accepted = re.search(r'sync: (\d+) file\(s\) accepted', out)
    sent = re.findall(r'(\S+): sent (\d+) B for (\d+) B \(([\d.]+)x\)', out)
    check(bool(accepted), 'sync ran', f'{sum(counts)} file(s) uploaded' if counts else 'no sync result in 120 s')
    for name, s, raw, ratio in sent:
        check(float(ratio) >= 1.5, f'{name} compressed', f'{int(raw)//1024} KB sent as {int(s)//1024} KB ({ratio}x)')
    if accepted and not sent:
        print('  info  nothing was waiting to upload (run put-fixture first)')
    bad = re.findall(r'-> HTTP (\d+)', out)
    check(not [c for c in bad if c not in ('201', '202')], 'no failed uploads', ', '.join(sorted(set(bad))) or 'none')
    heads = [int(h) for h in re.findall(r'stack headroom (\d+)', out)]
    check(bool(heads) and min(heads) >= MIN_HEADROOM, f'uplink stack headroom ≥ {MIN_HEADROOM} B',
          f"{min(heads)} B (lowest)" if heads else 'not reported')
    check('Guru Meditation' not in out, 'no crash during the sync')


def log(secs=60):
    t = Tracker()
    end = time.time() + secs
    while time.time() < end:
        c = t.s.read(4096)
        if c:
            sys.stdout.write(c.decode(errors='replace'))
            sys.stdout.flush()


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'status':
        status()
    elif cmd == 'put-fixture':
        put_fixture()
    elif cmd == 'sync':
        sync()
    elif cmd == 'log':
        log(float(sys.argv[2]) if len(sys.argv) > 2 else 60)
    else:
        sys.exit(__doc__)
    sys.exit(1 if failed else 0)
