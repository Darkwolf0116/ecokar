// Transient notices (top-centre, at most three, 2.6 s each) and the event-to-text mapping.

const LIFETIME_MS = 2600;
const MAX_TOASTS = 3;

const KIND_NAME = {
  bottle: { noun: 'Botella', grasped: 'sujetada', deposited: 'depositada' },
  can: { noun: 'Lata', grasped: 'sujetada', deposited: 'depositada' },
  paper: { noun: 'Papel', grasped: 'sujetado', deposited: 'depositado' },
};

const JOINT_LIMIT = {
  base: 'Límite de la base',
  shoulder: 'Límite del hombro',
  elbow: 'Límite del codo',
  gripper: 'Límite de la pinza',
};

/**
 * Map a server event to a toast, or null when the event has no toast.
 * `world` is `hello.world` (needed to name the obstacle of a collision).
 */
export function describeEvent(event, world) {
  const data = event.data ?? {};
  switch (event.name) {
    case 'grasp': {
      const kind = KIND_NAME[data.kind] ?? KIND_NAME.paper;
      return { text: `${kind.noun} ${kind.grasped}`, tone: 'success' };
    }
    case 'release':
      return { text: 'Residuo soltado', tone: 'info' };
    case 'deposit': {
      const kind = KIND_NAME[data.kind] ?? KIND_NAME.paper;
      return {
        text: `${kind.noun} ${kind.deposited} en el contenedor (${data.deposited} de ${data.total})`,
        tone: 'success',
      };
    }
    case 'collision': {
      let what = 'obstáculo';
      if (data.with === 'road') what = 'bordillo';
      else if (data.with === 'crate') what = 'contenedor';
      else {
        const obstacle = world?.obstacles?.find((item) => item.id === data.with);
        what = obstacle?.kind === 'cone' ? 'cono' : obstacle?.kind === 'car' ? 'vehículo estacionado' : 'obstáculo';
      }
      return { text: `Choque: ${what}`, tone: 'warning' };
    }
    case 'limit': {
      if (data.reason === 'ground') return { text: 'La pinza tocó el suelo', tone: 'warning' };
      if (data.reason === 'coupling') return { text: 'Acople mecánico: ajusta hombro y codo', tone: 'warning' };
      return { text: JOINT_LIMIT[data.joint] ?? 'Límite de la articulación', tone: 'warning' };
    }
    default:
      return null;
  }
}

export class Toasts {
  constructor(host) {
    this.host = host;
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
  }

  show(text, { tone = 'info' } = {}) {
    // the same notice twice in a row refreshes instead of stacking
    const last = this.host.lastElementChild;
    if (last && last.dataset.text === text) {
      clearTimeout(Number(last.dataset.timer));
      last.dataset.timer = String(setTimeout(() => last.remove(), LIFETIME_MS));
      return;
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.tone = tone;
    toast.dataset.text = text;
    toast.textContent = text;
    this.host.append(toast);
    while (this.host.children.length > MAX_TOASTS) this.host.firstElementChild.remove();
    toast.dataset.timer = String(setTimeout(() => toast.remove(), LIFETIME_MS));
  }

  clear() {
    this.host.replaceChildren();
  }
}
