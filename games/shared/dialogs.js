import { BUTTON } from './input.js';

export function openDialog(dialog) {
  dialog.returnValue = '';
  dialog.showModal();
}

// Lets a gamepad drive whichever of `dialogs` is open: d-pad moves focus between
// its buttons and inputs (e.g. radios) that are showing, A or Start presses.
// Returns false if no dialog is open, or the open one has nothing to press, so
// the caller can treat the buttons as game input instead. (Hidden ones are
// skipped: a hidden step's button pressed by A once took a player off to a race.)
export function gamepadDialogs(dialogs, pressed) {
  const dialog = dialogs.find((d) => d.open);
  if (!dialog) return false;
  const buttons = [...dialog.querySelectorAll('button, input')].filter((b) => !b.closest('[hidden]') && !b.disabled);
  if (!buttons.length) return false;
  const i = buttons.indexOf(document.activeElement);
  if (pressed.has(BUTTON.DOWN)) buttons[(i + 1) % buttons.length].focus();
  if (pressed.has(BUTTON.UP)) buttons[(i - 1 + buttons.length) % buttons.length].focus();
  if (pressed.has(BUTTON.A) || pressed.has(BUTTON.START)) (buttons[i] ?? buttons[0]).click();
  return true;
}

// Wires a "Sound on/off" toggle button and the M key to the shared audio mute.
export function soundToggle(button, { isMuted, setMuted }) {
  const render = () => {
    button.textContent = isMuted() ? 'Sound off' : 'Sound on';
    button.setAttribute('aria-pressed', String(!isMuted()));
  };
  const toggle = () => { setMuted(!isMuted()); render(); };
  button.addEventListener('click', toggle);
  addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) toggle(); });
  render();
}
