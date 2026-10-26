// Link to the simulation: a tiny event bus, the state interpolation buffer and two interchangeable
// transports that carry the same message protocol (docs/protocol.md section 3):
//   * 'server'  - the FastAPI WebSocket (/ws), with reconnect and backoff. Used by `make run`.
//   * 'pyodide' - the same Python core in a Web Worker (pyodide-worker.js). Used by the static
//                 build (Vercel), which cannot hold WebSockets.
// Engine choice: `?engine=server|pyodide` in the URL, else /static/build.json (written by
// scripts/build_web.py) saying "pyodide", else the WebSocket server.

export class Emitter {
  constructor() {
    this.handlers = new Map();
  }

  on(name, handler) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(handler);
    return () => this.handlers.get(name)?.delete(handler);
  }

  emit(name, ...args) {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(...args);
      } catch (error) {
        console.error(`[ecokar] handler for "${name}" failed`, error);
      }
    }
  }
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Shortest-arc interpolation for angles in radians (yaw is continuous, never normalised). */
export function lerpAngle(a, b, t) {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

function blend(a, b, alpha) {
  const trash = b.trash.map((target) => {
    const source = (a.trash.find((item) => item.id === target.id)) ?? target;
    return {
      id: target.id,
      kind: target.kind,
      state: source.state,
      x: lerp(source.x, target.x, alpha),
      y: lerp(source.y, target.y, alpha),
      z: lerp(source.z, target.z, alpha),
      yaw: lerpAngle(source.yaw, target.yaw, alpha),
    };
  });
  return {
    t: lerp(a.t, b.t, alpha),
    connected: b.connected,
    robot: {
      x: lerp(a.robot.x, b.robot.x, alpha),
      z: lerp(a.robot.z, b.robot.z, alpha),
      yaw: lerpAngle(a.robot.yaw, b.robot.yaw, alpha),
      v: b.robot.v,
      omega: b.robot.omega,
    },
    drive: {
      ...b.drive,
      left_pwm: lerp(a.drive.left_pwm, b.drive.left_pwm, alpha),
      right_pwm: lerp(a.drive.right_pwm, b.drive.right_pwm, alpha),
    },
    arm: {
      ...b.arm,
      base_deg: lerp(a.arm.base_deg, b.arm.base_deg, alpha),
      shoulder_deg: lerp(a.arm.shoulder_deg, b.arm.shoulder_deg, alpha),
      elbow_deg: lerp(a.arm.elbow_deg, b.arm.elbow_deg, alpha),
      gripper_deg: lerp(a.arm.gripper_deg, b.arm.gripper_deg, alpha),
      opening_m: lerp(a.arm.opening_m, b.arm.opening_m, alpha),
      grasp_point: a.arm.grasp_point.map((value, i) => lerp(value, b.arm.grasp_point[i], alpha)),
      held: a.arm.held,
    },
    trash,
    mission: b.mission,
    battery: b.battery,
  };
}

const MAX_BUFFER = 40;

const WORKER_URL = new URL('./pyodide-worker.js', import.meta.url);
const BUILD_INFO_URL = '/static/build.json';

/**
 * Which engine to use: the `?engine=` override, else what /static/build.json says, else the
 * WebSocket server (the local `make run` case, and any failure to read the file).
 * @returns {Promise<'server' | 'pyodide'>}
 */
export async function detectEngine(search = location.search) {
  const forced = new URLSearchParams(search).get('engine');
  if (forced === 'server' || forced === 'pyodide') return forced;
  try {
    const response = await fetch(BUILD_INFO_URL, { cache: 'no-store' });
    if (response.ok && (await response.json())?.engine === 'pyodide') return 'pyodide';
  } catch {
    // no readable build.json: not a static build
  }
  return 'server';
}

// ------------------------------------------------------------------ transports
// A transport carries text frames. The Connection hands it a `sink` with the callbacks it may
// call: open(), message(text), close() (link lost, retry makes sense), progress(stage) and
// fail(error) (cannot work at all, retrying is pointless).

/** The FastAPI WebSocket. */
class SocketTransport {
  reconnects = true;

  constructor(url, sink) {
    this.url = url;
    this.sink = sink;
    this.socket = null;
  }

  get isOpen() {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  get isActive() {
    return this.socket !== null && this.socket.readyState <= WebSocket.OPEN;
  }

  start() {
    if (this.isActive) return;
    let socket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      console.error('[ecokar] cannot open WebSocket', error);
      this.sink.close();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => this.sink.open());
    socket.addEventListener('message', (event) => this.sink.message(event.data));
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.sink.close();
    });
    socket.addEventListener('error', () => {
      // a "close" event always follows; nothing else to do here
    });
  }

  send(text) {
    if (!this.isOpen) return false;
    this.socket.send(text);
    return true;
  }
}

/** The Python core running in a Web Worker through Pyodide. */
class WorkerTransport {
  reconnects = false;

  constructor(sink) {
    this.sink = sink;
    this.worker = null;
    this.ready = false;
    this.failed = false;
  }

  get isOpen() {
    return this.ready;
  }

  get isActive() {
    return this.worker !== null;
  }

  start() {
    if (this.worker) return;
    let worker;
    try {
      worker = new Worker(WORKER_URL);
    } catch (error) {
      this.#fail(error);
      return;
    }
    this.worker = worker;
    worker.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data === 'string') {
        this.sink.message(data);
      } else if (data?.kind === 'progress') {
        this.sink.progress(data.stage);
      } else if (data?.kind === 'ready') {
        this.ready = true;
        this.sink.open();
      } else if (data?.kind === 'error') {
        this.#fail(new Error(`${data.stage}: ${data.message}`));
      }
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      this.#fail(new Error(event.message || 'worker error'));
    });
    worker.addEventListener('messageerror', () => this.#fail(new Error('worker message error')));
  }

  send(text) {
    if (!this.ready) return false;
    this.worker.postMessage(text);
    return true;
  }

  close() {
    this.ready = false;
    this.worker?.terminate();
    this.worker = null;
  }

  #fail(error) {
    if (this.failed) return;
    this.failed = true;
    this.close();
    console.error('[ecokar] the in-browser engine failed', error);
    this.sink.fail(error);
  }
}

export class Connection extends Emitter {
  /**
   * @param {{url?: string, interpolationDelay?: number, engine?: 'server' | 'pyodide'}} options
   * `interpolationDelay` is how far behind the newest state the renderer runs (seconds).
   * `engine` skips the detection (see {@link detectEngine}).
   *
   * Events: hello, state, serial, event, discontinuity, `status` ({phase, attempt, ...}) and
   * `engine` ({engine, state: 'loading' | 'ready' | 'error', stage}) for the loading UI.
   */
  constructor({ url, interpolationDelay = 0.1, engine = null } = {}) {
    super();
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = url ?? `${scheme}://${location.host}/ws`;
    this.delay = interpolationDelay;
    this.engine = engine; // 'server' | 'pyodide'; null until detected
    this.detection = null;
    this.transport = null;
    this.attempt = 0;
    this.timer = null;
    this.hello = null;
    this.latest = null;
    this.buffer = [];
    this.offset = null; // client clock minus simulation clock, seconds
    this.phase = 'closed';
    this.wasOpen = false;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.phase === 'closed') this.connect();
    });
  }

  get isOpen() {
    return this.transport !== null && this.transport.isOpen;
  }

  /** Pick the engine (once) and open its transport. Safe to call again to retry a WebSocket. */
  async connect() {
    clearTimeout(this.timer);
    if (this.engine === null) {
      this.detection ??= detectEngine();
      const engine = await this.detection;
      if (this.engine === null) {
        this.engine = engine;
        if (engine === 'pyodide') this.#setEngine('loading', 'loading-runtime');
        else this.#setEngine('ready');
      }
    }
    this.transport ??= this.#createTransport();
    if (this.transport.isActive || this.phase === 'failed') return;
    this.#setPhase('connecting');
    this.transport.start();
  }

  /** Send a JSON message; returns false when the link is not open. */
  send(message) {
    if (!this.isOpen) return false;
    return this.transport.send(JSON.stringify(message));
  }

  #createTransport() {
    const sink = {
      open: () => {
        this.attempt = 0;
        this.wasOpen = true;
        this.#setPhase('open');
      },
      message: (text) => this.#onMessage(text),
      close: () => this.#scheduleReconnect(),
      progress: (stage) => this.#setEngine('loading', stage),
      fail: () => {
        this.#setPhase('failed');
        this.#setEngine('error');
      },
    };
    return this.engine === 'pyodide' ? new WorkerTransport(sink) : new SocketTransport(this.url, sink);
  }

  #setPhase(phase, extra = {}) {
    this.phase = phase;
    this.emit('status', { phase, attempt: this.attempt, ...extra });
  }

  #setEngine(state, stage = null) {
    this.emit('engine', { engine: this.engine, state, stage });
  }

  #scheduleReconnect() {
    if (!this.transport.reconnects) return;
    const base = Math.min(5000, 400 * 1.7 ** this.attempt);
    const delay = Math.round(base * (0.85 + Math.random() * 0.3));
    this.attempt += 1;
    this.#setPhase('closed', { retryInMs: delay });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  #onMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    switch (message?.type) {
      case 'hello':
        this.hello = message;
        this.buffer.length = 0;
        this.offset = null;
        if (this.engine === 'pyodide') this.#setEngine('ready');
        this.emit('hello', message);
        break;
      case 'state':
        this.latest = message;
        this.#push(message, performance.now());
        this.emit('state', message);
        break;
      case 'serial':
        this.emit('serial', message);
        break;
      case 'event':
        this.emit('event', message);
        break;
      default:
        break;
    }
  }

  #push(state, receivedMs) {
    const buffer = this.buffer;
    const last = buffer[buffer.length - 1];
    if (last && state.t < last.t - 0.25) {
      // the simulation was reset: do not sweep the robot across the street
      buffer.length = 0;
      this.offset = null;
      this.emit('discontinuity');
    }
    const sample = receivedMs / 1000 - state.t;
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.01;
    buffer.push(state);
    if (buffer.length > MAX_BUFFER) buffer.shift();
  }

  /** Interpolated state for "now" (a render-state object), or null before the first state. */
  sample(nowMs = performance.now()) {
    const buffer = this.buffer;
    if (buffer.length === 0) return null;
    const renderTime = nowMs / 1000 - (this.offset ?? 0) - this.delay;
    const newest = buffer[buffer.length - 1];
    if (buffer.length === 1 || renderTime <= buffer[0].t) return blend(buffer[0], buffer[0], 0);
    if (renderTime >= newest.t) return blend(newest, newest, 0);
    let i = buffer.length - 2;
    while (i > 0 && buffer[i].t > renderTime) i -= 1;
    const a = buffer[i];
    const b = buffer[i + 1];
    const span = b.t - a.t;
    const alpha = span > 1e-6 ? (renderTime - a.t) / span : 1;
    if (i > 4) buffer.splice(0, i - 2);
    return blend(a, b, Math.min(1, Math.max(0, alpha)));
  }
}
