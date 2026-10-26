// Live telemetry: L298N, the three steppers, the SG90 gripper, the HC-05 link and the TX ticker.

const decimal = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('es', { maximumFractionDigits: 0 });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Write text only when it changed (keeps the DOM quiet at 30 Hz). */
function put(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function arrow() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('class', 'jog');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M5 1.5 9 7.5H1z" fill="currentColor"/>';
  return svg;
}

function section(title) {
  const wrapper = el('section', 'tele-section');
  wrapper.append(el('h3', 'tele-title', title));
  return wrapper;
}

function row(label) {
  const wrapper = el('div', 'tele-row');
  const name = el('span', 'tele-label', label);
  const value = el('span', 'tele-value');
  wrapper.append(name, value);
  return { wrapper, name, value };
}

export class Telemetry {
  constructor(host) {
    this.cache = {};
    const title = el('h2', 'panel-title', 'Telemetría');

    // ---- Driver L298N
    const driver = section('Driver L298N');
    this.pwm = {};
    for (const channel of ['ENA', 'ENB']) {
      const wrapper = el('div', 'pwm');
      const label = el('span', 'tele-label', channel);
      const bar = el('div', 'bar');
      bar.setAttribute('role', 'meter');
      bar.setAttribute('aria-label', `PWM ${channel}`);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '255');
      const fill = el('div', 'bar-fill');
      bar.append(fill);
      const value = el('span', 'tele-value pwm-value', '0');
      const direction = el('span', 'tele-note', 'libre');
      wrapper.append(label, bar, value, direction);
      driver.append(wrapper);
      this.pwm[channel] = { bar, fill, value, direction };
    }
    const pins = el('div', 'pins');
    this.leds = {};
    for (const [name, pin] of [['IN1', 'D22'], ['IN2', 'D23'], ['IN3', 'D24'], ['IN4', 'D25']]) {
      const item = el('span', 'pin');
      const dot = el('span', 'pin-dot');
      item.append(dot, el('span', 'pin-name', name), el('span', 'pin-id', pin));
      pins.append(item);
      this.leds[name] = dot;
    }
    driver.append(pins);
    const command = row('Último comando');
    this.command = command.value;
    driver.append(command.wrapper);

    // ---- Brazo EEZYbotARM
    const arm = section('Brazo EEZYbotARM');
    this.joints = {};
    for (const [key, label] of [['base', 'Base'], ['shoulder', 'Hombro'], ['elbow', 'Codo']]) {
      const r = row(label);
      const angle = el('span', 'angle', '0,0°');
      const steps = el('span', 'tele-note', '0 pasos');
      const jog = arrow();
      jog.dataset.dir = '0';
      jog.dataset.joint = key;
      r.value.append(angle, steps, jog);
      arm.append(r.wrapper);
      this.joints[key] = { angle, steps, jog };
    }

    // ---- Gripper SG90
    const gripper = section('Gripper SG90');
    const angleRow = row('Ángulo');
    this.gripperAngle = angleRow.value;
    const openingRow = row('Apertura');
    this.gripperOpening = openingRow.value;
    this.ready = el('p', 'ready-chip', 'Listo para sujetar');
    this.ready.hidden = true;
    this.held = el('p', 'tele-note held-note', 'Sin residuo');
    gripper.append(angleRow.wrapper, openingRow.wrapper, this.held, this.ready);

    // ---- HC-05
    const link = section('HC-05');
    const statusRow = row('Estado');
    this.linkStatus = statusRow.value;
    const baudRow = row('Velocidad');
    put(baudRow.value, '9600 baudios');
    const tickerRow = row('TX');
    this.ticker = el('span', 'ticker');
    this.ticker.setAttribute('aria-label', 'Últimos caracteres transmitidos');
    tickerRow.value.append(this.ticker);
    link.append(statusRow.wrapper, baudRow.wrapper, tickerRow.wrapper);

    const grid = el('div', 'tele-grid');
    grid.append(driver, arm, gripper, link);
    host.replaceChildren(title, grid);
  }

  update(state) {
    const { drive, arm, connected } = state;
    const { pins } = drive;

    for (const [channel, in1, in2] of [['ENA', pins.IN1, pins.IN2], ['ENB', pins.IN3, pins.IN4]]) {
      const view = this.pwm[channel];
      const value = pins[channel];
      if (this.cache[channel] !== value) {
        this.cache[channel] = value;
        view.fill.style.transform = `scaleX(${(value / 255).toFixed(3)})`;
        view.bar.setAttribute('aria-valuenow', String(value));
        put(view.value, String(value));
      }
      put(view.direction, in1 && !in2 ? 'adelante' : !in1 && in2 ? 'atrás' : 'libre');
    }
    for (const name of ['IN1', 'IN2', 'IN3', 'IN4']) {
      const on = pins[name] ? '1' : '0';
      if (this.leds[name].dataset.on !== on) this.leds[name].dataset.on = on;
    }
    put(this.command, drive.command);

    for (const joint of ['base', 'shoulder', 'elbow']) {
      const view = this.joints[joint];
      put(view.angle, `${decimal.format(arm[`${joint}_deg`])}°`);
      put(view.steps, `${integer.format(arm.steps[joint])} pasos`);
      const dir = String(arm.jog[joint] ?? 0);
      if (view.jog.dataset.dir !== dir) view.jog.dataset.dir = dir;
    }
    put(this.gripperAngle, `${decimal.format(arm.gripper_deg)}°`);
    put(this.gripperOpening, `${decimal.format(arm.opening_m * 1000)} mm`);
    put(this.held, arm.held ? `Sujeta ${arm.held}` : 'Sin residuo');
    put(this.linkStatus, connected ? 'Conectado' : 'Desconectado');
    this.linkStatus.dataset.on = connected ? '1' : '0';
  }

  setReady(isReady) {
    if (this.ready.hidden === !isReady) return;
    this.ready.hidden = !isReady;
  }

  setTicker(chars) {
    const key = chars.join('');
    if (this.cache.ticker === key) return;
    this.cache.ticker = key;
    this.ticker.replaceChildren(
      ...chars.map((char) => {
        const span = el('span', char === 'S' ? 'tx-char tx-stop' : 'tx-char', char);
        return span;
      }),
    );
  }
}
