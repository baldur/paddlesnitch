// Drawings of the tracker's 128x64 screen for the setup guide.
//
// Positions and fonts are copied from the firmware (firmware/src/ui.cpp,
// netcfg.cpp, tutorial.cpp), so a drawing looks like the real screen. Text in
// ‹angle quotes› is an example value (a code, a network name, a time); every
// other piece of text must appear in the firmware source, which
// tracker-screens.test.ts checks. So when the firmware's wording changes, the
// test fails here instead of the guide quietly showing a screen that no longer
// exists.

// u8g2 fonts the firmware uses, by the size we draw them at (px):
//   s = 5x8, m = 6x10, l = helvB12 (bold), code = logisoso20, xl = logisoso24.
export type ScreenFont = 's' | 'm' | 'l' | 'code' | 'xl'

export type ScreenEl =
  | { text: string; x: number; y: number; font: ScreenFont; align?: 'center' | 'right'; invert?: boolean }
  | { hline: number }
  | { box: [number, number, number, number] }      // filled
  | { frame: [number, number, number, number] }    // outline
  | { disc: [number, number, number]; filled: boolean }
  | { qr: [number, number, number] }               // x, y, size: a stand-in pattern, not a real code
  | { topRow: { fix: boolean; bars: number; pct: number } }
  | { battery: number }                            // the small badge, top right

export type TrackerScreen = { label: string; els: ScreenEl[] }

const battery = (pct = 80): ScreenEl => ({ battery: pct })

// The menu layout from drawMenuFrame: rows at y0 + i*step, highlight bar 13 px.
function menu(opts: string[], sel: number, title?: string): ScreenEl[] {
  const step = opts.length >= 4 ? 13 : 14
  const y0 = title ? (opts.length >= 4 ? 21 : 26) : 20
  const els: ScreenEl[] = []
  if (title) els.push({ text: title, x: 0, y: 8, font: 's' }, { hline: 11 })
  opts.forEach((o, i) => {
    const y = y0 + i * step
    if (i === sel) els.push({ box: [0, y - 10, 128, 13] })
    els.push({ text: o, x: 6, y, font: 'm', invert: i === sel })
  })
  return els
}

// The gesture lesson (drawTutorial): four practice boxes, a hint, three dots.
function lesson(prompt: string, hint: string, done: number): ScreenEl[] {
  const els: ScreenEl[] = [{ text: prompt, x: 64, y: 11, font: 'm', align: 'center' }, { hline: 15 }]
  const x0 = (128 - (4 * 22 + 3 * 6)) / 2
  for (let i = 0; i < 4; i++) {
    const x = x0 + i * 28
    els.push(i === 1 ? { frame: [x, 24, 22, 18] } : { frame: [x + 6, 30, 10, 6] })
  }
  els.push({ text: hint, x: 64, y: 54, font: 's', align: 'center' })
  for (let i = 0; i < 3; i++) els.push({ disc: [54 + i * 10, 61, 2], filled: i < done })
  return els
}

export const SCREENS = {
  splash: { label: 'Starting up', els: [{ text: 'paddlesnitch', x: 64, y: 36, font: 'm', align: 'center' }] },

  noWifi: { label: 'A new tracker starting setup', els: [
    { text: 'No wifi configured', x: 0, y: 11, font: 'm' },
    { text: 'Starting setup...', x: 0, y: 27, font: 'm' },
  ] },

  joinWifi: { label: 'Setup: scan the code to join the tracker’s own WiFi', els: [
    { qr: [0, 3, 58] },
    { text: 'SCAN or', x: 62, y: 10, font: 's' },
    { text: 'join wifi', x: 62, y: 20, font: 's' },
    { text: '‹PT-9C8›', x: 62, y: 32, font: 's' },
    { text: '‹qmkgpnex›', x: 62, y: 42, font: 's' },
    { text: '‹192.168.4.1›', x: 62, y: 56, font: 's' },
  ] },

  joining: { label: 'Joining your WiFi', els: [
    { text: 'Joining wifi:', x: 0, y: 11, font: 'm' },
    { text: '‹YourWiFi›', x: 0, y: 27, font: 'm' },
  ] },

  connected: { label: 'Connected, not yet on an account', els: [
    { text: 'WiFi connected', x: 0, y: 11, font: 'm' },
    { text: '‹192.168.1.23›', x: 0, y: 27, font: 'm' },
    { text: 'Account: not linked', x: 0, y: 43, font: 'm' },
  ] },

  linkQr: { label: 'The code to add the tracker to your account', els: [{ qr: [39, 7, 50] }] },

  linkCode: { label: 'The same code as characters (tap to switch)', els: [
    { text: 'Link this tracker', x: 0, y: 10, font: 'm' },
    { hline: 13 },
    { text: '‹K7P2QM›', x: 2, y: 40, font: 'code' },
    { text: 'paddlesnitch.com/l/', x: 0, y: 54, font: 's' },
    { text: 'tap = show QR', x: 0, y: 63, font: 's' },
    battery(),
  ] },

  lessonTap: { label: 'The lesson, first step', els: lesson('TAP to move', 'tap a few times', 0) },
  lessonHold: { label: 'The lesson, second step', els: lesson('HOLD to select', 'hold until it fills', 1) },
  lessonBack: { label: 'The lesson, third step', els: lesson('DOUBLE-TAP goes back', 'two quick taps', 2) },
  lessonReady: { label: 'The end of the lesson', els: [
    { text: 'Ready?', x: 64, y: 11, font: 'm', align: 'center' }, { hline: 15 },
    { text: 'tap moves  hold selects', x: 64, y: 31, font: 's', align: 'center' },
    { text: 'double-tap goes back', x: 64, y: 42, font: 's', align: 'center' },
    { text: 'hold to start', x: 64, y: 60, font: 'm', align: 'center' },
  ] },

  menu: { label: 'The menu', els: [...menu(['Track', 'Sync', 'Settings'], 0), battery()] },

  trackSearching: { label: 'Track, looking for GPS', els: [
    { topRow: { fix: false, bars: 1, pct: 80 } },
    { text: '--', x: 0, y: 40, font: 'xl' }, { text: 'km/h', x: 32, y: 40, font: 'm' },
    { text: '--', x: 128, y: 28, font: 'l', align: 'right' }, { text: 'spm', x: 128, y: 38, font: 's', align: 'right' },
    { text: 'Acquiring GPS...', x: 0, y: 63, font: 'm' },
  ] },

  trackRecording: { label: 'Track, recording', els: [
    { topRow: { fix: true, bars: 4, pct: 72 } },
    { text: '‹8.4›', x: 0, y: 40, font: 'xl' }, { text: 'km/h', x: 50, y: 40, font: 'm' },
    { text: '--', x: 128, y: 28, font: 'l', align: 'right' }, { text: 'spm', x: 128, y: 38, font: 's', align: 'right' },
    { text: '‹12:34›', x: 0, y: 51, font: 'm' }, { text: '‹1.76 km›', x: 128, y: 51, font: 'm', align: 'right' },
    { disc: [3, 60, 3], filled: true },
    { text: 'REC', x: 9, y: 63, font: 's' }, { text: 'hold to stop', x: 128, y: 63, font: 's', align: 'right' },
  ] },

  stop: { label: 'Stopping', els: [
    { topRow: { fix: true, bars: 4, pct: 72 } },
    { text: 'Stop?', x: 0, y: 34, font: 'l' },
    { text: 'HOLD to stop', x: 0, y: 52, font: 'm' },
    { text: 'double-tap = keep going', x: 0, y: 62, font: 's' },
  ] },

  sync: { label: 'Sync', els: [
    { text: 'Sync', x: 0, y: 10, font: 'm' }, { hline: 13 },
    { text: 'on device ‹3›', x: 0, y: 28, font: 'm' },
    { text: 'uploaded  ‹2›', x: 0, y: 40, font: 'm' },
    { text: 'pending   ‹1›', x: 0, y: 52, font: 'm' },
    { text: '‹1/2›', x: 0, y: 63, font: 's' }, { text: 'SYNC NOW', x: 128, y: 63, font: 's', align: 'right' },
    battery(),
  ] },

  updated: { label: 'After an update', els: [
    { text: 'Updated to ‹0.16.3›', x: 0, y: 12, font: 'm' }, { hline: 15 },
    { text: '‹Stopping a recording now›', x: 0, y: 30, font: 's' },
    { text: '‹really stops it›', x: 0, y: 40, font: 's' },
    { text: 'any button = ok', x: 0, y: 62, font: 'm' },
    battery(),
  ] },

  settings: { label: 'Settings', els: [...menu(['Nerd mode', 'Network', 'How to use', 'Factory reset'], 1, 'Settings'), battery()] },

  network: { label: 'Settings > Network', els: [
    { text: 'Settings > Network', x: 0, y: 8, font: 's' }, { hline: 11 },
    { text: '‹YourWiFi›', x: 0, y: 26, font: 'm' },
    { text: 'idle - connects to sync', x: 0, y: 38, font: 's' },
    { text: 'CHANGE NETWORK', x: 0, y: 50, font: 's' },
    battery(),
  ] },

  reset: { label: 'Factory reset', els: [
    { text: 'Factory reset?', x: 0, y: 12, font: 'm' }, { hline: 15 },
    { text: 'clears wifi, account link', x: 0, y: 27, font: 's' },
    { text: 'KEEPS paddles on the card', x: 0, y: 37, font: 's' },
    { text: 'HOLD to reset', x: 0, y: 53, font: 'm' },
    { text: 'double-tap to cancel', x: 0, y: 63, font: 's' },
    battery(),
  ] },

  setupTimedOut: { label: 'Setup timed out', els: [
    { text: 'Paddle tracker', x: 0, y: 10, font: 'm' }, { hline: 13 },
    { text: 'Not linked', x: 0, y: 32, font: 'l' },
    { text: 'Hold BOOT', x: 0, y: 47, font: 'm' },
    { text: 'id ‹435C09C8›', x: 0, y: 62, font: 's' },
    battery(),
  ] },
} satisfies Record<string, TrackerScreen>

export type ScreenName = keyof typeof SCREENS

// The text a test must find in the firmware: everything outside ‹example› values.
export function literalFragments(text: string): string[] {
  return text.split(/‹[^›]*›/).map(s => s.trim()).filter(Boolean)
}

// What to show on the page: the example values without their marks.
export const shown = (text: string) => text.replace(/[‹›]/g, '')
