// Mission card, "restart?" confirmation and the completion dialog.

const decimal1 = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const decimal2 = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NBSP = ' ';

export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const formatMeters = (meters) => `${decimal1.format(meters)}${NBSP}m`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function put(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function stat(label) {
  const wrapper = el('div', 'stat');
  const name = el('dt', 'stat-label', label);
  const value = el('dd', 'stat-value');
  wrapper.append(name, value);
  return { wrapper, value };
}

export class MissionCard {
  constructor(host) {
    host.setAttribute('aria-label', 'Misión');
    const heading = el('h2', 'mission-heading', 'Residuos depositados');
    this.big = el('p', 'mission-big');
    this.big.setAttribute('aria-live', 'polite');
    const list = el('dl', 'stats');
    const collected = stat('Recogidos');
    const time = stat('Tiempo');
    const distance = stat('Distancia');
    this.collected = collected.value;
    this.time = time.value;
    this.distance = distance.value;
    list.append(collected.wrapper, time.wrapper, distance.wrapper);

    const battery = el('div', 'battery');
    battery.append(el('span', 'stat-label', 'Batería LiPo 2S'));
    const meter = el('div', 'battery-meter');
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', 'Carga de la batería');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    this.batteryMeter = meter;
    this.batteryFill = el('div', 'battery-fill');
    meter.append(this.batteryFill);
    this.voltage = el('span', 'stat-value battery-voltage');
    this.percent = el('span', 'stat-value battery-percent');
    battery.append(meter, this.voltage, this.percent);

    host.replaceChildren(heading, this.big, list, battery);
    this.update({
      mission: { total: 0, collected: 0, deposited: 0, elapsed_s: 0, distance_m: 0 },
      battery: { voltage: 8.4, percent: 100 },
    });
  }

  update({ mission, battery }) {
    put(this.big, `${mission.deposited} de ${mission.total}`);
    put(this.collected, String(mission.collected));
    put(this.time, formatClock(mission.elapsed_s));
    put(this.distance, formatMeters(mission.distance_m));
    const percent = Math.round(battery.percent);
    put(this.voltage, `${decimal2.format(battery.voltage)}${NBSP}V`);
    put(this.percent, `${percent}${NBSP}%`);
    this.batteryMeter.setAttribute('aria-valuenow', String(percent));
    this.batteryFill.style.transform = `scaleX(${(Math.max(0, Math.min(100, battery.percent)) / 100).toFixed(3)})`;
    this.batteryFill.dataset.level = percent < 20 ? 'low' : percent < 50 ? 'mid' : 'ok';
  }
}

/** Promise-based confirmation using the native <dialog> (focus trap and Escape for free). */
export function confirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancelar' }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', 'dialog');
    dialog.setAttribute('aria-labelledby', 'confirm-title');
    const form = el('form', 'dialog-body');
    form.method = 'dialog';
    const heading = el('h2', 'dialog-title', title);
    heading.id = 'confirm-title';
    const text = el('p', 'dialog-text', message);
    const actions = el('div', 'dialog-actions');
    const cancel = el('button', 'btn btn-quiet', cancelLabel);
    cancel.type = 'submit';
    cancel.value = 'cancel';
    const confirm = el('button', 'btn btn-primary', confirmLabel);
    confirm.type = 'submit';
    confirm.value = 'confirm';
    actions.append(cancel, confirm);
    form.append(heading, text, actions);
    dialog.append(form);
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'confirm';
      dialog.remove();
      resolve(confirmed);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

export class CompletionDialog {
  constructor({ onPlayAgain }) {
    this.dialog = el('dialog', 'dialog dialog-complete');
    this.dialog.setAttribute('aria-labelledby', 'complete-title');
    const form = el('form', 'dialog-body');
    form.method = 'dialog';
    const logo = el('img', 'dialog-logo');
    logo.src = '/static/assets/ecokar-logo.png';
    logo.alt = 'Logotipo de EcoKar';
    const title = el('h2', 'dialog-title', 'Misión completada');
    title.id = 'complete-title';
    this.summary = el('dl', 'complete-stats');
    const timeStat = stat('Tiempo');
    const distanceStat = stat('Distancia');
    this.time = timeStat.value;
    this.distance = distanceStat.value;
    this.summary.append(timeStat.wrapper, distanceStat.wrapper);
    const again = el('button', 'btn btn-primary', 'Jugar de nuevo');
    again.type = 'submit';
    again.value = 'again';
    form.append(logo, title, this.summary, again);
    this.dialog.append(form);
    this.dialog.addEventListener('close', () => {
      if (this.dialog.returnValue === 'again') onPlayAgain();
    });
    document.body.append(this.dialog);
  }

  show({ elapsed_s, distance_m }) {
    put(this.time, formatClock(elapsed_s));
    put(this.distance, formatMeters(distance_m));
    this.dialog.returnValue = '';
    if (!this.dialog.open) this.dialog.showModal();
  }

  hide() {
    if (this.dialog.open) {
      this.dialog.returnValue = '';
      this.dialog.close();
    }
  }
}
