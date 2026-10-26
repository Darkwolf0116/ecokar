// Faithful port of the App Inventor "Clock" dead-man logic plus the keyboard map.
//   press   -> send the letter at once and keep re-sending every repeat_ms while held
//   release -> send "S" (stops everything in firmware) followed by any letters still held
import { Emitter } from '../net/connection.js';

export const BUTTON_LETTERS = 'ABCDEFGHIJKL'.split('');

/** Keyboard map: key (lowercase `KeyboardEvent.key`) to Bluetooth letter. */
export const KEY_TO_LETTER = {
  w: 'A', arrowup: 'A',
  s: 'B', arrowdown: 'B',
  a: 'C', arrowleft: 'C',
  d: 'D', arrowright: 'D',
  r: 'E', // SUBIR
  f: 'F', // BAJAR
  q: 'G', // GIRAR BASE +
  e: 'H', // GIRAR BASE -
  t: 'I', // ADELANTE
  g: 'J', // ATRAS
  z: 'K', // ABRIR GRIPPER
  x: 'L', // CERRAR GRIPPER
};

const TICKER_LENGTH = 12;

export class Transmitter extends Emitter {
  /**
   * @param {{connection: import('../net/connection.js').Connection, isConnected: () => boolean}} options
   * `isConnected` reports the simulated Bluetooth link (state.connected).
   */
  constructor({ connection, isConnected }) {
    super();
    this.connection = connection;
    this.isConnected = isConnected;
    this.repeatMs = 100;
    this.held = new Map(); // letter -> Set of input sources (pointer, key, ...)
    this.timer = null;
    this.ticker = [];
  }

  setRepeat(ms) {
    if (Number.isFinite(ms) && ms > 0) this.repeatMs = ms;
    if (this.timer !== null) {
      this.#stopTimer();
      this.#startTimer();
    }
  }

  isHeld(letter) {
    return this.held.has(letter);
  }

  heldLetters() {
    return [...this.held.keys()].join('');
  }

  press(letter, source = 'ui') {
    if (!BUTTON_LETTERS.includes(letter) || !this.isConnected()) return false;
    let sources = this.held.get(letter);
    const alreadyHeld = sources !== undefined && sources.size > 0;
    if (!sources) {
      sources = new Set();
      this.held.set(letter, sources);
    }
    sources.add(source);
    if (alreadyHeld) return true;
    this.#send(letter);
    this.#startTimer();
    this.emit('change', letter, true);
    return true;
  }

  release(letter, source = 'ui') {
    const sources = this.held.get(letter);
    if (!sources) return;
    sources.delete(source);
    if (sources.size > 0) return;
    this.held.delete(letter);
    this.#send(`S${this.heldLetters()}`);
    if (this.held.size === 0) this.#stopTimer();
    this.emit('change', letter, false);
  }

  /** Release everything. `send: false` is for a link that is already gone. */
  releaseAll({ send = true } = {}) {
    if (this.held.size === 0) return;
    const letters = [...this.held.keys()];
    this.held.clear();
    this.#stopTimer();
    if (send) this.#send('S');
    for (const letter of letters) this.emit('change', letter, false);
  }

  #send(data) {
    if (!this.connection.send({ type: 'tx', data })) return;
    for (const char of data) this.ticker.push(char);
    if (this.ticker.length > TICKER_LENGTH) this.ticker.splice(0, this.ticker.length - TICKER_LENGTH);
    this.emit('tx', data, this.ticker);
  }

  #startTimer() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      if (this.held.size === 0 || !this.isConnected()) {
        this.#stopTimer();
        return;
      }
      this.#send(this.heldLetters());
    }, this.repeatMs);
  }

  #stopTimer() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * Keyboard bindings. `isBlocked()` is true while a modal or the splash is open.
 * Mirrors presses on the on-screen buttons through the transmitter's "change" event.
 */
export function bindKeyboard(transmitter, { isBlocked, onCamera, onReset, onToggleHud }) {
  const down = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target) || isBlocked()) return;
    const key = event.key.toLowerCase();
    const letter = KEY_TO_LETTER[key];
    if (letter) {
      event.preventDefault();
      if (!event.repeat) transmitter.press(letter, `key:${key}`);
      return;
    }
    if (event.repeat) return;
    if (key === '1') onCamera('orbital');
    else if (key === '2') onCamera('chase');
    else if (key === '3') onCamera('gripper');
    else if (key === 'n' || key === 'backspace') {
      event.preventDefault();
      onReset();
    } else if (key === 'h') onToggleHud?.();
  };
  const up = (event) => {
    const key = event.key.toLowerCase();
    const letter = KEY_TO_LETTER[key];
    if (letter) transmitter.release(letter, `key:${key}`);
  };
  const releaseAll = () => transmitter.releaseAll();
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseAll();
  });
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', releaseAll);
  };
}
