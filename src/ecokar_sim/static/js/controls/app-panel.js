// Phone replica of the MIT App Inventor screen "EcoKar2" (the real controller of the robot).
// Original texts and table order are kept on purpose: students see the same app they use.

const ASSETS = '/static/assets';

const LOCOMOTION = [
  { letter: 'A', image: 'arrow-up', name: 'Avanzar' },
  { letter: 'B', image: 'arrow-down', name: 'Retroceder' },
  { letter: 'C', image: 'arrow-left', name: 'Girar a la izquierda' },
  { letter: 'D', image: 'arrow-right', name: 'Girar a la derecha' },
];

const ARM = [
  { letter: 'E', text: 'SUBIR', name: 'Subir el antebrazo' },
  { letter: 'F', text: 'BAJAR', name: 'Bajar el antebrazo' },
  { letter: 'G', text: 'GIRAR BASE +', name: 'Girar la base a la izquierda' },
  { letter: 'H', text: 'GIRAR BASE -', name: 'Girar la base a la derecha' },
  { letter: 'I', text: 'ADELANTE', name: 'Extender el brazo hacia adelante' },
  { letter: 'J', text: 'ATRÁS', name: 'Recoger el brazo hacia atrás' },
  { letter: 'K', text: 'ABRIR GRIPPER', name: 'Abrir el gripper' },
  { letter: 'L', text: 'CERRAR GRIPPER', name: 'Cerrar el gripper' },
];

const DEVICES = [
  { address: '98:D3:31:F5:2A:17', name: 'HC-05', paired: true },
  { address: '00:21:13:00:4B:9C', name: 'HC-06', paired: false },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) node.append(child);
  return node;
}

function svg(markup, className) {
  const wrapper = document.createElementNS(SVG_NS, 'svg');
  wrapper.setAttribute('viewBox', '0 0 24 24');
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.setAttribute('focusable', 'false');
  if (className) wrapper.setAttribute('class', className);
  wrapper.innerHTML = markup;
  return wrapper;
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export class AppPanel {
  /**
   * @param {HTMLElement} host container for the phone
   * @param {{transmitter: import('./transmitter.js').Transmitter, connection: import('../net/connection.js').Connection}} deps
   */
  constructor(host, { transmitter, connection }) {
    this.host = host;
    this.transmitter = transmitter;
    this.connection = connection;
    this.phase = 'idle'; // idle | connecting | connected
    this.socketOpen = false;
    this.buttons = new Map();
    this.timers = { connect: null, deadline: null };
    this.render();
    this.refresh();
    this.tickClock();
    setInterval(() => this.tickClock(), 15000);
    transmitter.on('change', (letter, pressed) => this.setPressed(letter, pressed));
  }

  // ------------------------------------------------------------------ rendering
  render() {
    const connectButton = el('button', { type: 'button', class: 'pill', 'data-action': 'connect', text: 'Conectar' });
    const disconnectButton = el('button', { type: 'button', class: 'pill', 'data-action': 'disconnect', text: 'Desconectar' });
    this.connectButton = connectButton;
    this.disconnectButton = disconnectButton;
    connectButton.addEventListener('click', () => this.openPicker());
    disconnectButton.addEventListener('click', () => this.disconnect());

    this.chip = el('p', { class: 'link-chip', role: 'status', 'aria-live': 'polite' });
    this.hint = el('p', { class: 'link-hint', text: 'Conecta el módulo HC-05 para habilitar los controles.' });

    const locoGrid = el('div', { class: 'loco-grid' });
    for (const item of LOCOMOTION) {
      const button = el(
        'button',
        { type: 'button', class: 'ctl ctl-image', 'data-letter': item.letter, 'aria-label': `${item.name} (letra ${item.letter})`, 'aria-disabled': 'true' },
        el('img', { src: `${ASSETS}/${item.image}.jpg`, alt: '', draggable: 'false' }),
        el('span', { class: 'badge', 'aria-hidden': 'true', text: item.letter }),
      );
      this.#bindControl(button, item.letter);
      locoGrid.append(button);
    }

    const armGrid = el('div', { class: 'arm-grid' });
    for (const item of ARM) {
      const button = el(
        'button',
        { type: 'button', class: 'ctl ctl-text', 'data-letter': item.letter, 'aria-label': `${item.name} (letra ${item.letter})`, 'aria-disabled': 'true' },
        el('span', { class: 'ctl-label', 'aria-hidden': 'true', text: item.text }),
        el('span', { class: 'badge', 'aria-hidden': 'true', text: item.letter }),
      );
      this.#bindControl(button, item.letter);
      armGrid.append(button);
    }

    this.clock = el('span', { class: 'status-clock' });
    this.bluetoothIcon = svg(
      '<path fill="currentColor" d="M12.8 2.5v7.4L8.6 5.7 7.3 7l4.9 5-4.9 5 1.3 1.3 4.2-4.2v7.4l5.6-5.6-4.1-4.1 4.1-4.1-5.6-5.6zm1.7 3.6 1.5 1.5-1.5 1.5V6.1zm0 8.1 1.5 1.5-1.5 1.5v-3z"/>',
      'status-icon status-bluetooth',
    );
    this.bluetoothIcon.setAttribute('hidden', '');
    this.batteryFill = document.createElementNS(SVG_NS, 'rect');
    this.batteryFill.setAttribute('x', '6');
    this.batteryFill.setAttribute('y', '7.5');
    this.batteryFill.setAttribute('height', '9');
    this.batteryFill.setAttribute('rx', '1');
    this.batteryIcon = svg(
      '<rect x="4.5" y="6" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="19.2" y="10" width="2" height="4" rx="0.8" fill="currentColor"/>',
      'status-icon status-battery',
    );
    this.batteryIcon.append(this.batteryFill);
    this.batteryIcon.insertAdjacentHTML('beforeend', '<title>Batería</title>');
    this.batteryFill.setAttribute('fill', 'currentColor');
    const signal = svg('<path fill="currentColor" d="M2 20h3v-4H2v4zm5 0h3v-8H7v8zm5 0h3V8h-3v12zm5 0h3V4h-3v16z"/>', 'status-icon');

    const statusBar = el('div', { class: 'status-bar' }, this.clock, el('span', { class: 'status-icons' }, this.bluetoothIcon, signal, this.batteryIcon));
    const actionBar = el('div', { class: 'action-bar' }, el('span', { class: 'action-title', text: 'EcoKar' }));

    const body = el(
      'div',
      { class: 'app-body' },
      el('h2', { class: 'app-title', text: 'Controles de Ecokar' }),
      el('div', { class: 'connect-row' }, connectButton, disconnectButton),
      this.chip,
      this.hint,
      el('h3', { class: 'band', text: 'Locomoción' }),
      locoGrid,
      el('h3', { class: 'band', text: 'Brazo Robótico' }),
      el('img', { class: 'arm-illustration', src: `${ASSETS}/arm-illustration.png`, alt: 'Ilustración de un brazo robótico', draggable: 'false' }),
      armGrid,
    );
    this.body = body;

    this.picker = this.#buildPicker();
    const screen = el('div', { class: 'phone-screen' }, statusBar, actionBar, body, this.picker);
    this.screen = screen;
    this.host.replaceChildren(
      el('div', { class: 'phone', role: 'group', 'aria-label': 'Réplica de la app de control EcoKar' }, el('div', { class: 'phone-bezel' }, screen)),
    );
  }

  #buildPicker() {
    const title = el('h3', { id: 'picker-title', class: 'picker-title', text: 'Dispositivos Bluetooth' });
    const list = el('ul', { class: 'picker-list' });
    for (const device of DEVICES) {
      const label = `${device.address} ${device.name}${device.paired ? '' : ' (sin emparejar)'}`;
      const button = el('button', { type: 'button', class: 'picker-item', text: label, disabled: !device.paired, 'aria-disabled': String(!device.paired) });
      if (device.paired) button.addEventListener('click', () => this.selectDevice(device));
      list.append(el('li', {}, button));
    }
    const cancel = el('button', { type: 'button', class: 'picker-cancel', text: 'Cancelar' });
    cancel.addEventListener('click', () => this.closePicker());
    const sheet = el('div', { class: 'picker-sheet' }, title, list, cancel);
    const picker = el('div', { class: 'picker', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'picker-title', hidden: true }, sheet);
    picker.addEventListener('keydown', (event) => this.#pickerKeydown(event));
    picker.addEventListener('pointerdown', (event) => {
      if (event.target === picker) this.closePicker();
    });
    return picker;
  }

  #bindControl(button, letter) {
    this.buttons.set(letter, button);
    const isDisabled = () => button.getAttribute('aria-disabled') === 'true';
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      if (isDisabled()) return;
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // capture can fail when the pointer is already gone; the release handlers still run
      }
      this.transmitter.press(letter, `ptr:${event.pointerId}`);
    });
    const release = (event) => this.transmitter.release(letter, `ptr:${event.pointerId}`);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    button.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && !isDisabled()) {
        event.preventDefault();
        this.transmitter.press(letter, 'focus');
      }
    });
    button.addEventListener('keyup', (event) => {
      if (event.key === 'Enter' || event.key === ' ') this.transmitter.release(letter, 'focus');
    });
    button.addEventListener('blur', () => this.transmitter.release(letter, 'focus'));
  }

  // ----------------------------------------------------------------------- state
  /** Pressed look for a button (pointer, focus or keyboard). */
  setPressed(letter, pressed) {
    this.buttons.get(letter)?.classList.toggle('is-pressed', pressed);
  }

  setLinkState({ socketOpen, btConnected }) {
    const key = `${socketOpen}|${btConnected}`;
    if (key === this.lastLinkKey) return;
    this.lastLinkKey = key;
    this.socketOpen = socketOpen;
    if (btConnected && this.phase !== 'connected') this.#setPhase('connected');
    else if (!btConnected && this.phase === 'connected') this.#setPhase('idle');
    else if (!socketOpen && this.phase === 'connecting') this.#setPhase('idle');
    this.refresh();
  }

  setBattery(percent) {
    const clamped = Math.round(Math.max(0, Math.min(100, percent)));
    if (clamped === this.lastBattery) return;
    this.lastBattery = clamped;
    this.batteryFill.setAttribute('width', String((clamped / 100) * 11));
    this.batteryFill.setAttribute('fill', clamped < 20 ? '#E5484D' : 'currentColor');
  }

  #setPhase(phase) {
    this.phase = phase;
    clearTimeout(this.timers.deadline);
    if (phase !== 'connecting') clearTimeout(this.timers.connect);
    if (phase !== 'connected') this.transmitter.releaseAll({ send: false });
    this.refresh();
  }

  refresh() {
    const connected = this.phase === 'connected';
    const connecting = this.phase === 'connecting';
    for (const button of this.buttons.values()) button.setAttribute('aria-disabled', String(!connected));
    this.body.classList.toggle('is-linked', connected);
    this.hint.hidden = connected;
    const text = connected ? 'Conectado a HC-05' : connecting ? 'Conectando…' : 'Sin conexión';
    if (this.chip.textContent !== text) this.chip.textContent = text;
    this.chip.dataset.state = this.phase;
    this.#setDisabled(this.connectButton, connected || connecting || !this.socketOpen);
    this.#setDisabled(this.disconnectButton, !connected);
    this.bluetoothIcon.toggleAttribute('hidden', !connected);
  }

  #setDisabled(button, disabled) {
    button.setAttribute('aria-disabled', String(disabled));
    button.tabIndex = disabled ? -1 : 0;
  }

  tickClock() {
    this.clock.textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // ---------------------------------------------------------------------- actions
  openPicker() {
    if (this.connectButton.getAttribute('aria-disabled') === 'true') return;
    this.picker.hidden = false;
    this.body.inert = true;
    this.screen.dataset.modal = 'open';
    this.picker.querySelector('.picker-item:not([disabled])')?.focus();
  }

  closePicker({ restoreFocus = true } = {}) {
    if (this.picker.hidden) return;
    this.picker.hidden = true;
    this.body.inert = false;
    delete this.screen.dataset.modal;
    if (restoreFocus) this.connectButton.focus();
  }

  get isModalOpen() {
    return !this.picker.hidden;
  }

  selectDevice() {
    this.closePicker({ restoreFocus: false });
    this.#setPhase('connecting');
    this.timers.connect = setTimeout(() => {
      this.connection.send({ type: 'bt_connect' });
      this.timers.deadline = setTimeout(() => {
        if (this.phase === 'connecting') this.#setPhase('idle');
      }, 3000);
    }, 700);
  }

  disconnect() {
    if (this.disconnectButton.getAttribute('aria-disabled') === 'true') return;
    this.transmitter.releaseAll({ send: false });
    this.connection.send({ type: 'bt_disconnect' });
    this.#setPhase('idle');
  }

  #pickerKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closePicker();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...this.picker.querySelectorAll(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/** Compact keyboard legend shown under the phone. */
export function renderKeyLegend(host) {
  const row = (keys, text, letters) =>
    el(
      'div',
      { class: 'legend-row' },
      el('dt', {}, ...keys.map((key) => el('kbd', { text: key }))),
      el('dd', {}, text, letters ? el('span', { class: 'legend-letters', text: ` (${letters})` }) : ''),
    );
  const details = el(
    'details',
    { class: 'legend-details' },
    el('summary', { class: 'legend-summary', text: 'Atajos de teclado' }),
    el(
      'dl',
      { class: 'legend' },
      row(['W', 'A', 'S', 'D'], 'Avanzar, girar a la izquierda, retroceder y girar a la derecha (también las flechas)', 'A, C, B, D'),
      row(['R', 'F'], 'Subir y bajar el antebrazo', 'E, F'),
      row(['T', 'G'], 'Brazo adelante y atrás', 'I, J'),
      row(['Q', 'E'], 'Girar la base a la izquierda y a la derecha', 'G, H'),
      row(['Z', 'X'], 'Abrir y cerrar el gripper', 'K, L'),
      row(['1', '2', '3'], 'Cámara orbital, de seguimiento y de pinza'),
      row(['N'], 'Reiniciar la misión'),
      row(['H'], 'Mostrar u ocultar la telemetría'),
    ),
  );
  details.open = window.innerHeight >= 1000;
  host.replaceChildren(details);
}
