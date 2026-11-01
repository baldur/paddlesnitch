// Keyboard, gamepad, touch and tilt → paddle strokes, rudder and lean.
// Strokes are discrete events; rudder and lean are held amounts in -1..1.
//
// On a phone held sideways, the phone is your body: turning it like a
// steering wheel shifts your weight that way (lean), from the motion sensors.
// Pushing one side of it away from you works the rudder (the gyroscope: push
// the right side forward to go left). Each touch strokes on its side of the
// screen, a thumb swiped down takes a back stroke on its side, and sliding a
// finger that's down sideways works the rudder too.
// The phone's angle comes from the fused orientation sensor where there is
// one (steady, and blind to the jolt of each tap), else from the raw
// accelerometer. Without either (no permission, or a page not served over
// HTTPS on iOS), touch play keeps you upright automatically: see `assist`.
import { BUTTON } from '../shared/input.js';

// The one place to change the key layout.
export const KEYS = {
  strokeLeft: 'ArrowLeft',
  strokeRight: 'ArrowRight',
  back: 'ArrowDown', // held: the stroke keys take back strokes
  leanLeft: 'KeyA',
  leanRight: 'KeyD',
  rudderLeft: 'KeyQ',
  rudderRight: 'KeyE',
};

const PAD = { LB: 4, RB: 5, LT: 6, RT: 7 };
const DEADZONE = 0.15;
const KEY_LEAN_RATE = 5; // keyboard lean eases in and out so taps can be gentle
// Tuned against a simulated player who reacts slowly (up to 0.6 s),
// over-corrects and has wandering hands: a twitchier setting has them
// over-correcting into ever bigger wobbles. Hands off, the club and racing
// boats still go over.
export const TILT_FULL = 0.7; // radians of phone turn (about 40 degrees) for a full lean
const TILT_DEAD = 0.03;
export const TILT_REFLEX = 0.45; // lean against the roll rate, as your hips would: see main.js
export const TILT_SETTLE = 15; // seconds for a new way of holding the phone to become level
const DRAG_FULL = 0.14; // share of the screen width to slide for full rudder
// A touch is a forward stroke when the finger lifts, slides sideways (to
// steer) or stays down TAP_WAIT ms; slid down SWIPE_DOWN of the screen's
// height first, it's a back stroke.
const TAP_WAIT = 150;
const SWIPE_DOWN = 0.05;
// Pushing a side of the phone forward: how far it's turned (radians, about the
// screen's upright axis) before the rudder starts, and for full rudder. Where
// you hold it becomes straight ahead again over TWIST_SETTLE seconds, so the
// gyroscope's slow drift (and a change of grip) doesn't leave you turning.
export const TWIST_DEAD = 0.05; // about 3 degrees
export const TWIST_FULL = 0.35; // about 20 degrees
export const TWIST_SETTLE = 30;

export class Controls {
  #held = new Set();
  #strokes = [];
  #keyLean = 0;
  #prev = new Map(); // gamepad index -> previous pressed state per button
  #pad = null;
  #touching = false;
  #fingers = new Map(); // pointerId -> x where it came down
  #touches = new Map(); // pointerId -> { side, x, y, at } until its stroke is taken
  #dragRudder = 0;
  #tilt = { on: false, zero: null, flip: 1, lean: 0, at: null, fused: null };
  #twist = { angle: 0, at: null };
  // What the sensors are doing, for the #tilt readout in main.js.
  debug = { permission: 'not asked', orientations: 0, motions: 0, source: 'none', beta: null, gamma: null, accel: null, turn: null, zero: null, twist: null };

  constructor(target) {
    addEventListener('keydown', (e) => {
      if (Object.values(KEYS).flat().includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      const back = this.#held.has(KEYS.back) ? 'back-' : '';
      if (e.code === KEYS.strokeLeft) this.#strokes.push(`${back}left`);
      if (e.code === KEYS.strokeRight) this.#strokes.push(`${back}right`);
      this.#held.add(e.code);
    });
    addEventListener('keyup', (e) => this.#held.delete(e.code));
    addEventListener('blur', () => this.#held.clear());

    // A touch anywhere (the button that started the race, too) means touch play:
    // balance help before the first tap on the water.
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.#touching = true; });

    // Touch: tap the left or right half of the screen to stroke on that side,
    // swipe down for a back stroke; slide a finger that's down to steer.
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.#touching = true;
      const rect = target.getBoundingClientRect();
      const side = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
      this.#touches.set(e.pointerId, { side, x: e.clientX, y: e.clientY, at: performance.now(), height: rect.height });
      this.#fingers.set(e.pointerId, e.clientX);
    });
    target.addEventListener('pointermove', (e) => {
      const t = this.#touches.get(e.pointerId);
      if (t) {
        const [dx, dy] = [e.clientX - t.x, e.clientY - t.y];
        if (dy > t.height * SWIPE_DOWN && dy > Math.abs(dx)) this.#touchStroke(e.pointerId, `back-${t.side}`);
        else if (Math.abs(dx) > 8) this.#touchStroke(e.pointerId, t.side);
      }
      if (!this.#fingers.has(e.pointerId)) return;
      const dx = e.clientX - this.#fingers.get(e.pointerId);
      const full = target.getBoundingClientRect().width * DRAG_FULL;
      this.#dragRudder = clamp(Math.sign(dx) * Math.max(0, Math.abs(dx) - 8) / full);
    });
    const lift = (e) => {
      const t = this.#touches.get(e.pointerId);
      if (t) this.#touchStroke(e.pointerId, t.side);
      this.#fingers.delete(e.pointerId);
      if (!this.#fingers.size) this.#dragRudder = 0;
    };
    target.addEventListener('pointerup', lift);
    target.addEventListener('pointercancel', lift);
  }

  // Starts reading the motion sensors. Call it from a tap or click: iOS asks
  // for permission, and only allows asking in response to one.
  async enableTilt() {
    if (this.#tilt.on) return;
    if (!window.DeviceOrientationEvent) {
      this.debug.permission = 'no DeviceOrientationEvent in this browser';
      return;
    }
    try {
      if (DeviceOrientationEvent.requestPermission) {
        this.debug.permission = 'asking';
        this.debug.permission = await DeviceOrientationEvent.requestPermission();
        if (this.debug.permission !== 'granted') return;
      } else {
        this.debug.permission = 'none needed';
      }
    } catch (err) {
      this.debug.permission = `error: ${err.message}`;
      return;
    }
    this.#tilt.on = true;
    addEventListener('deviceorientation', (e) => this.#orientation(e));
    addEventListener('devicemotion', (e) => this.#motion(e));
  }

  // Whatever way the phone is held right now counts as level.
  calibrate() {
    this.#tilt.zero = null;
    this.#twist.angle = 0;
  }

  // True while tilt is working: a sensor reading has arrived recently.
  get tilting() {
    return this.#tilt.on && this.#tilt.at !== null && performance.now() - this.#tilt.at < 1000;
  }

  // The rudder as last taken, for the HUD.
  rudder = 0;

  // Touch play without tilt: main.js should balance the boat for the player.
  get assist() {
    return this.#touching && !this.tilting && !this.#pad;
  }

  get tiltLean() {
    return this.tilting ? this.#tilt.lean : null;
  }

  // Which way is up, in the phone's own axes (x right, y up the screen held
  // upright, z out of it), from its orientation angles.
  #orientation(e) {
    this.debug.orientations++;
    this.debug.beta = e.beta;
    this.debug.gamma = e.gamma;
    if (e.beta == null || e.gamma == null) return;
    this.debug.source = 'orientation';
    const b = (e.beta * Math.PI) / 180;
    const g = (e.gamma * Math.PI) / 180;
    this.#tilt.fused = performance.now();
    this.#up(-Math.cos(b) * Math.sin(g), Math.sin(b), true);
  }

  // The same from the accelerometer, which also feels every jolt: only used
  // when there's no orientation sensor.
  #motion(e) {
    this.#twisted(e.rotationRate, e.interval);
    const g = e.accelerationIncludingGravity;
    this.debug.motions++;
    this.debug.accel = g && [g.x, g.y, g.z];
    if (g?.x == null || performance.now() - (this.#tilt.fused ?? -Infinity) < 500) return;
    this.debug.source = 'accelerometer';
    this.#up(g.x / 9.81, g.y / 9.81, false);
  }

  #up(x, y, trusted) {
    // Into screen axes (x right, y up), whichever way round the phone is.
    const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
    const sx = x * Math.cos(angle) - y * Math.sin(angle);
    const sy = x * Math.sin(angle) + y * Math.cos(angle);
    if (Math.hypot(sx, sy) < 0.25) return; // lying flat: no wheel to read
    const t = this.#tilt;
    // Browsers disagree on the sign of accelerometer readings; held up in
    // front of you, "up" should point up the screen.
    if (t.zero === null) t.flip = trusted || sy >= 0 ? 1 : -1;
    const turn = Math.atan2(-sx * t.flip, sy * t.flip); // clockwise is positive
    const now = performance.now();
    if (t.zero === null) t.zero = turn;
    let d = Math.atan2(Math.sin(turn - t.zero), Math.cos(turn - t.zero));
    // Level slowly follows how you hold the phone, so a change of grip
    // doesn't leave you leaning for the rest of the race.
    t.zero += d * Math.min(1, (now - (t.at ?? now)) / 1000 / TILT_SETTLE);
    d = Math.atan2(Math.sin(turn - t.zero), Math.cos(turn - t.zero));
    this.debug.turn = turn;
    this.debug.zero = t.zero;
    // As in the boat: when it dips to the right, lean away from it by turning
    // the phone anticlockwise. Clockwise shifts your weight right.
    const target = clamp(Math.sign(d) * Math.max(0, Math.abs(d) - TILT_DEAD) / TILT_FULL);
    t.lean += (target - t.lean) * 0.5; // sensors are noisy: smooth a little
    t.at = now;
  }

  #touchStroke(id, stroke) {
    this.#touches.delete(id);
    this.#strokes.push(stroke);
  }

  // The gyroscope: how far the phone has been turned about the screen's upright
  // axis, as pushing one side of it away from you does.
  #twisted(rate, interval) {
    if (rate?.alpha == null || rate?.beta == null) return;
    const now = performance.now();
    const t = this.#twist;
    // Browsers give the interval in ms (the spec) or, on older ones, seconds.
    const dt = t.at === null ? 0 : Math.min(0.1, (now - t.at) / 1000 || (interval > 1 ? interval / 1000 : interval) || 0);
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    t.angle = stepTwist(t.angle, twistRate(rate, angle), dt);
    t.at = now;
    this.debug.twist = t.angle;
  }

  // The rudder from pushing a side of the phone forward, while the gyroscope works.
  get twistRudder() {
    return this.#twist.at !== null && performance.now() - this.#twist.at < 1000 ? twistRudder(this.#twist.angle) : 0;
  }

  // Once per animation frame: reads gamepads. Returns buttons newly pressed, for menus.
  poll(dt) {
    const pressed = new Set();
    this.#pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean) ?? null; // Firefox on Android has none
    if (this.#pad) {
      const prev = this.#prev.get(this.#pad.index) ?? [];
      const now = this.#pad.buttons.map((b) => b.value > 0.5 || b.pressed);
      now.forEach((down, i) => { if (down && !prev[i]) pressed.add(i); });
      this.#prev.set(this.#pad.index, now);
      if (pressed.has(PAD.LT)) this.#strokes.push('left');
      if (pressed.has(PAD.RT)) this.#strokes.push('right');
      if (pressed.has(PAD.LB)) this.#strokes.push('back-left');
      if (pressed.has(PAD.RB)) this.#strokes.push('back-right');
    }
    const target = (this.#held.has(KEYS.leanRight) ? 1 : 0) - (this.#held.has(KEYS.leanLeft) ? 1 : 0);
    const step = KEY_LEAN_RATE * dt;
    this.#keyLean += Math.max(-step, Math.min(step, target - this.#keyLean));
    return pressed;
  }

  // Everything since the last call: strokes are consumed, held inputs sampled.
  take() {
    const axis = (i) => {
      const v = this.#pad?.axes[i] ?? 0;
      return Math.abs(v) > DEADZONE ? v : 0;
    };
    const keyRudder = (this.#held.has(KEYS.rudderRight) ? 1 : 0) - (this.#held.has(KEYS.rudderLeft) ? 1 : 0);
    // A thumb held still is a forward stroke once it's clearly not a swipe.
    const now = performance.now();
    for (const [id, t] of this.#touches) if (now - t.at >= TAP_WAIT) this.#touchStroke(id, t.side);
    const strokes = this.#strokes;
    this.#strokes = [];
    const rest = axis(0) + this.#dragRudder + this.twistRudder;
    this.rudder = clamp(keyRudder + rest);
    return {
      strokes,
      rudder: this.rudder,
      // Without Q and E (a scull takes them for looking round): the stick, a slid finger, the phone's twist.
      rudderNoKeys: clamp(rest),
      lean: clamp(this.#keyLean + axis(2) + (this.tilting ? this.#tilt.lean : 0)),
    };
  }

  clear() {
    this.#strokes = [];
    this.#touches.clear();
  }

  rumble(strength = 0.4, duration = 60) {
    if (this.#pad?.vibrationActuator) {
      this.#pad.vibrationActuator.playEffect('dual-rumble', {
        duration, strongMagnitude: strength, weakMagnitude: strength * 0.5,
      }).catch(() => {});
    } else if (this.#touching) {
      navigator.vibrate?.(Math.round(duration / 3));
    }
  }
}

export { BUTTON };

// How fast the phone is turning about the screen's upright axis (radians a
// second; positive when its right side moves away from you), from the
// gyroscope's rates (degrees a second) and the screen's angle. Browsers give
// alpha about the phone's x axis (across it, held upright), beta about y (along
// it) and gamma about z (out of the screen), as the spec now says; its older
// wording (alpha about z) is wrong for every browser. The screen's upright axis
// is the phone's y held upright, and its x in landscape.
export function twistRate({ alpha, beta }, screenAngle = 0) {
  const a = (screenAngle * Math.PI) / 180;
  return ((alpha * Math.sin(a) + beta * Math.cos(a)) * Math.PI) / 180;
}

// One reading: the twist so far, turned by `rate` for `dt` seconds, easing
// back towards straight ahead over TWIST_SETTLE seconds.
export function stepTwist(angle, rate, dt) {
  return (angle + rate * dt) * (1 - Math.min(1, dt / TWIST_SETTLE));
}

// The rudder for a twist: the right side pushed forward (positive) turns left.
export function twistRudder(angle) {
  return 0 - clamp(Math.sign(angle) * Math.max(0, Math.abs(angle) - TWIST_DEAD) / (TWIST_FULL - TWIST_DEAD));
}

function clamp(v) {
  return Math.max(-1, Math.min(1, v));
}
