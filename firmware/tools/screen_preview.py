#!/usr/bin/env python3
"""Preview OLED screens in the terminal before flashing them.

Renders a 128x64 monochrome framebuffer using Unicode quadrant blocks, so four
pixels pack into one character: full fidelity at 64x32 characters. The drawing
primitives mirror u8g2's, so a scene prototyped here ports across almost line
for line.
"""
import math, sys

W, H = 128, 64
QUAD = " ▗▖▄▝▐▞▟▘▚▌▙▀▜▛█"   # index = tl*8 + tr*4 + bl*2 + br


class FB:
    def __init__(self):
        self.px = [[0] * W for _ in range(H)]

    def pixel(self, x, y, v=1):
        x, y = int(x), int(y)
        if 0 <= x < W and 0 <= y < H:
            self.px[y][x] = v

    def hline(self, x, y, w):
        for i in range(int(w)):
            self.pixel(x + i, y)

    def vline(self, x, y, h):
        for i in range(int(h)):
            self.pixel(x, y + i)

    def box(self, x, y, w, h):
        for j in range(int(h)):
            self.hline(x, y + j, w)

    def frame(self, x, y, w, h):
        self.hline(x, y, w); self.hline(x, y + h - 1, w)
        self.vline(x, y, h); self.vline(x + w - 1, y, h)

    def line(self, x0, y0, x1, y1):
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.pixel(x0, y0)
            if x0 == x1 and y0 == y1: break
            e2 = 2 * err
            if e2 >= dy: err += dy; x0 += sx
            if e2 <= dx: err += dx; y0 += sy

    def disc(self, cx, cy, r):
        for y in range(int(cy - r), int(cy + r + 1)):
            for x in range(int(cx - r), int(cx + r + 1)):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.pixel(x, y)

    def render(self):
        out = []
        for y in range(0, H, 2):
            row = []
            for x in range(0, W, 2):
                tl = self.px[y][x]
                tr = self.px[y][x + 1] if x + 1 < W else 0
                bl = self.px[y + 1][x] if y + 1 < H else 0
                br = self.px[y + 1][x + 1] if y + 1 < H and x + 1 < W else 0
                row.append(QUAD[tl * 8 + tr * 4 + bl * 2 + br])
            out.append("".join(row))
        return "\n".join(out)


# --- minimal 3x5 font, enough to judge composition ------------------------
F35 = {
 "A":(0b11111,0b00101,0b11111),"B":(0b11111,0b10101,0b01010),"C":(0b01110,0b10001,0b10001),
 "D":(0b11111,0b10001,0b01110),"E":(0b11111,0b10101,0b10001),"F":(0b11111,0b00101,0b00001),
 "G":(0b01110,0b10001,0b11101),"H":(0b11111,0b00100,0b11111),"I":(0b10001,0b11111,0b10001),
 "J":(0b01000,0b10000,0b01111),"K":(0b11111,0b00100,0b11011),"L":(0b11111,0b10000,0b10000),
 "M":(0b11111,0b00010,0b11111),"N":(0b11111,0b00110,0b11111),"O":(0b01110,0b10001,0b01110),
 "P":(0b11111,0b00101,0b00010),"Q":(0b01110,0b11001,0b11110),"R":(0b11111,0b00101,0b11010),
 "S":(0b10010,0b10101,0b01001),"T":(0b00001,0b11111,0b00001),"U":(0b01111,0b10000,0b01111),
 "V":(0b00111,0b11000,0b00111),"W":(0b11111,0b01000,0b11111),"X":(0b11011,0b00100,0b11011),
 "Y":(0b00011,0b11100,0b00011),"Z":(0b11001,0b10101,0b10011),
 "0":(0b01110,0b10001,0b01110),"1":(0b10010,0b11111,0b10000),"2":(0b11001,0b10101,0b10010),
 "3":(0b10001,0b10101,0b01010),"4":(0b00111,0b00100,0b11111),"5":(0b10111,0b10101,0b01001),
 "6":(0b01110,0b10101,0b01001),"7":(0b00001,0b11101,0b00011),"8":(0b01010,0b10101,0b01010),
 "9":(0b10010,0b10101,0b01110),
 " ":(0,0,0),".":(0,0b10000,0),"-":(0b00100,0b00100,0b00100),":":(0,0b01010,0),
 "%":(0b11001,0b00100,0b10011),"/":(0b11000,0b00100,0b00011),
}

def text35(fb, x, y, s):
    """Draw `s` with its top-left at (x, y). Preview approximation of a 6x10 font."""
    cx = x
    for ch in s.upper():
        cols = F35.get(ch, F35[" "])
        for ci, col in enumerate(cols):
            for r in range(5):
                if col >> r & 1:
                    fb.pixel(cx + ci, y + r)
        cx += 4
    return cx


def _old_scene(n, status, sub=""):
    """The boot/loading screen: a kayak on moving water, with a status line."""
    fb = FB()
    WL = 43                                   # waterline

    # --- sky is empty on purpose: contrast is the only thing this panel has.
    bob = math.sin(n * 0.30) * 1.0
    hy  = WL - 3 + bob

    # Wake behind the boat, drawn first so the hull sits on top of it.
    for i in range(6):
        wx = 20 - (n * 2 + i * 9) % 34
        fb.hline(wx, WL + 2 + (i % 2), 4)

    kayak(fb, 38, hy, (n % 10) / 10)

    # --- water: one solid line plus ripples scrolling left (we move forward)
    fb.hline(0, WL, W)
    for i in range(12):
        rx = (i * 11 - n * 3) % (W + 12) - 6
        fb.hline(rx, WL + 3 + (i % 3) * 2, 4)
        if i % 2 == 0:
            fb.hline(rx + 5, WL + 6 + (i % 2) * 2, 2)

    # --- status band
    fb.hline(0, 52, W)
    text35(fb, 2, 56, status)
    if sub:
        text35(fb, W - 2 - len(sub) * 4, 56, sub)
    return fb


def kayak(fb, x, wl, stroke, bob):
    """Sleek side-on kayak sitting in the water at `wl`."""
    L = 58
    y = wl - 1 + bob
    # Hull: a long shallow lens, tips at bow and stern. Only the top half really
    # shows -- the waterline cuts it -- which is what makes it read as floating.
    for i in range(L):
        t = i / (L - 1)
        h = 2.4 * math.sin(math.pi * t) ** 0.55          # deck height above water
        rise = 2.6 * (abs(t - 0.5) * 2) ** 3             # upswept bow and stern
        top = y - h - rise
        fb.vline(x + i, top, max(1, round(y - top)))

    # Paddler: head, torso. Small enough not to fight the hull for attention.
    px = x + L * 0.46
    fb.disc(px, y - 13, 2)
    fb.line(px, y - 10, px, y - 4)

    # Paddle sweeps through a full stroke cycle; blades dip either side.
    ang = math.sin(stroke * 2 * math.pi) * 0.85
    dx, dy = math.cos(ang) * 11, math.sin(ang) * 11
    fb.line(px - dx, y - 9 - dy, px + dx, y - 9 + dy)
    for sgn in (-1, 1):
        bx, by = px + sgn * dx, y - 9 + sgn * dy
        fb.line(bx - 1, by - 2, bx + 1, by + 2)


def scene(n, status, sub=""):
    fb = FB()
    WL = 42
    bob = math.sin(n * 0.28) * 1.0

    kayak(fb, 35, WL, (n % 10) / 10, bob)

    # Water: one line, and sparse dashes scrolling left so the boat reads as
    # moving forward. Kept sparse -- dense ripples turn into visual noise.
    fb.hline(0, WL, W)
    for i in range(6):
        rx = (i * 23 - n * 4) % (W + 20) - 10
        fb.hline(rx, WL + 4, 6)
        fb.hline(rx + 12, WL + 7, 4)

    # Status band
    fb.hline(0, 52, W)
    text35(fb, 2, 56, status)
    if sub:
        text35(fb, W - 2 - len(sub) * 4, 56, sub)
    return fb


if __name__ == "__main__":
    import time
    if sys.argv[1:2] == ["--animate"]:
        status = sys.argv[2] if len(sys.argv) > 2 else "CONNECTING"
        try:
            n = 0
            while True:
                sys.stdout.write("\033[H\033[J" + scene(n, status).render() + "\n")
                sys.stdout.flush(); n += 1; time.sleep(0.12)
        except KeyboardInterrupt:
            pass
    else:
        status = sys.argv[1] if len(sys.argv) > 1 else "CONNECTING"
        frames = [int(a) for a in sys.argv[2:]] or [0, 3, 5, 8]
        for n in frames:
            print(f"-- frame {n} " + "-" * 48)
            print(scene(n, status).render())
