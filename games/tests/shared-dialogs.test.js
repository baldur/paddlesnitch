// The games' gamepad driving of dialogs (shared/dialogs.js): only what's showing can be pressed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { activeElement: null };
const { gamepadDialogs } = await import('../shared/dialogs.js');
const { BUTTON } = await import('../shared/input.js');

// A button in a dialog, inside a hidden step or not.
const button = (name, hidden = false) => ({
  name, disabled: false, clicked: 0,
  closest: (sel) => (sel === '[hidden]' && hidden ? {} : null),
  click() { this.clicked++; },
  focus() { document.activeElement = this; },
});

test("A presses the first button that's showing, never one in a hidden step", () => {
  const hiddenRace = button('Time Trial Loop', true);
  const done = button('Done');
  const dialog = { open: true, querySelectorAll: () => [hiddenRace, done] };
  document.activeElement = null;
  assert.equal(gamepadDialogs([dialog], new Set([BUTTON.A])), true);
  assert.equal(hiddenRace.clicked, 0, 'the hidden race button is left alone');
  assert.equal(done.clicked, 1);
});

test('a dialog with nothing showing to press hands the pad back to the game', () => {
  const dialog = { open: true, querySelectorAll: () => [button('Hidden', true)] };
  assert.equal(gamepadDialogs([dialog], new Set([BUTTON.A])), false);
  assert.equal(gamepadDialogs([{ open: false }], new Set([BUTTON.A])), false, 'none open: the same');
});
