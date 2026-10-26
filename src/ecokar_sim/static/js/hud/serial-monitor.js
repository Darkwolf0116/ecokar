// Serial console of the Arduino Mega: what Serial.println() would print over USB at 115200 baud.

const MAX_LINES = 80;

function stamp(t) {
  const total = Math.max(0, t);
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function toneOf(line) {
  if (line.startsWith('[SEG]') || line.startsWith('[BRAZO] Límite')) return 'warning';
  if (line.startsWith('[BT]')) return 'info';
  return 'plain';
}

export class SerialMonitor {
  constructor(host) {
    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Monitor serie, 115200 baudios';
    this.clearButton = document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.className = 'link-button';
    this.clearButton.textContent = 'Limpiar';
    this.clearButton.addEventListener('click', () => this.clear());
    header.append(title, this.clearButton);

    this.log = document.createElement('div');
    this.log.className = 'serial-log';
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'off');
    this.log.setAttribute('aria-label', 'Líneas del monitor serie');
    this.log.tabIndex = 0;
    host.replaceChildren(header, this.log);
    this.pending = [];
    this.scheduled = false;
  }

  /** Queue a line; the DOM is touched at most once per animation frame. */
  add(line, t = 0) {
    this.pending.push({ line, t });
    if (!this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => this.#flush());
    }
  }

  #flush() {
    this.scheduled = false;
    const log = this.log;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 28;
    const fragment = document.createDocumentFragment();
    for (const { line, t } of this.pending) {
      const row = document.createElement('div');
      row.className = 'serial-line';
      row.dataset.tone = toneOf(line);
      const time = document.createElement('span');
      time.className = 'serial-time';
      time.textContent = stamp(t);
      const text = document.createElement('span');
      text.textContent = line;
      row.append(time, text);
      fragment.append(row);
    }
    this.pending.length = 0;
    log.append(fragment);
    while (log.childElementCount > MAX_LINES) log.firstElementChild.remove();
    if (stick) log.scrollTop = log.scrollHeight;
  }

  clear() {
    this.pending.length = 0;
    this.log.replaceChildren();
  }
}
