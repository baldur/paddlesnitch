#!/usr/bin/env python3
"""Enrol a tracker's key so it can be added to an account.

Reads `IDENT <deviceId> <uniqueId> <publicKey>` from the tracker over USB and
prints the enrolment record(s) as `<deviceId>\t<json>` lines -- one for the ID it
uses now, and one for its unique ID if that differs (what it comes back as after
a factory reset). enroll.sh writes them to the bucket.

  enroll.py                 read from the tracker on /dev/cu.usbmodem*
  enroll.py --line 'IDENT …' parse a line instead (for tests)
"""
import base64, datetime, glob, json, re, sys, time

ID = re.compile(r'^[0-9A-F]{8}$')

def records(line, now=None):
    parts = line.strip().split()
    if len(parts) != 4 or parts[0] != 'IDENT':
        raise ValueError('not an IDENT line: %r' % line)
    _, dev, uid, key = parts
    if not ID.match(dev) or not ID.match(uid):
        raise ValueError('bad device id in %r' % line)
    if key == '-':
        raise ValueError('the tracker could not make or read its key')
    der = base64.b64decode(key, validate=True)
    # SPKI header of an uncompressed P-256 key: the server refuses anything else.
    if len(der) != 91 or not der.startswith(bytes.fromhex('3059301306072a8648ce3d020106082a8648ce3d030107034200')):
        raise ValueError('not a P-256 public key')
    at = now or datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    rec = json.dumps({'publicKey': key, 'enrolledAt': at, 'via': 'cable'}, separators=(',', ':'))
    return [(i, rec) for i in dict.fromkeys([dev, uid])]

def read_ident(timeout=60):
    import serial
    ports = glob.glob('/dev/cu.usbmodem*')
    if not ports:
        raise SystemExit('no /dev/cu.usbmodem* port -- is the tracker plugged in?')
    s = serial.Serial(ports[0], 115200, timeout=0.5)   # opening it restarts the tracker
    end, buf = time.time() + timeout, b''
    next_ask = time.time() + 3
    while time.time() < end:
        if time.time() >= next_ask:           # keep asking until it has booted
            s.write(b'IDENT\n'); s.flush(); next_ask = time.time() + 3
        buf += s.read(4096)
        for raw in buf.split(b'\n'):
            line = raw.decode(errors='replace').strip()
            if line.startswith('IDENT ') and len(line.split()) == 4:
                s.close()
                return line
        buf = buf[-2048:]
    s.close()
    raise SystemExit('the tracker never answered IDENT (firmware older than 0.19.1?)')

if __name__ == '__main__':
    line = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == '--line' else read_ident()
    try:
        for dev, rec in records(line):
            print('%s\t%s' % (dev, rec))
    except ValueError as e:
        raise SystemExit(str(e))
