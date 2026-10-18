// Adaptive resolution for the WebGL renderer, which has no GPU timer to ask
// (phones don't expose one). Instead it watches frame times: well under 60 fps
// means the GPU is behind, so draw fewer pixels (down to half); a steady 60 or
// better for a while, creep back up. If a raise makes frames slow again
// straight away, that level becomes the ceiling, so it doesn't see-saw.
// Fixed targets, not the screen's own rate: browsers deliver frames unevenly
// (an early 8 ms frame next to a late 25 ms one), so a rate learnt from the
// quickest frames halved the resolution at a smooth 60 fps.

const MIN = 0.5;
const SLOW_MS = 22; // under about 45 fps: behind
const FAST_MS = 17.5; // about 57 fps or better: room to spare
const SETTLE_MS = 1500; // after a change, before judging again
const RAISE_AFTER_MS = 4000; // keeping up this long before a raise
const RAISE_HELD_MS = 4000; // a drop sooner than this after a raise undoes it for good

export function createPacer() {
  let scale = 1;
  let ceiling = 1;
  let smooth = null; // smoothed frame time, ms
  let clock = 0;
  let settled = 0;
  let raisedAt = -Infinity;
  let beforeRaise = 1;

  return {
    get scale() { return scale; },
    get frameMs() { return smooth ?? 0; },

    // ms: time since the previous frame.
    tick(ms) {
      if (!(ms > 0) || ms > 250) return scale; // a hidden tab or a stall, not the GPU
      clock += ms;
      settled += ms;
      smooth = smooth === null ? ms : smooth + (ms - smooth) * 0.1;
      if (settled < SETTLE_MS) return scale;
      if (smooth > SLOW_MS && scale > MIN) {
        if (clock - raisedAt < RAISE_HELD_MS) ceiling = beforeRaise;
        scale = Math.max(MIN, Math.min(scale * 0.85, ceiling));
        settled = 0;
      } else if (smooth < FAST_MS && scale < ceiling && settled > RAISE_AFTER_MS) {
        beforeRaise = scale;
        scale = Math.min(ceiling, scale * 1.1);
        raisedAt = clock;
        settled = 0;
      }
      return scale;
    },
  };
}
