// Bootstrap and wiring: splash -> app, connection -> scene / HUD, controls -> connection.
import * as THREE from 'three';
import { Connection } from './net/connection.js';
import { Transmitter, bindKeyboard } from './controls/transmitter.js';
import { AppPanel, renderKeyLegend } from './controls/app-panel.js';
import { Stage } from './scene/stage.js';
import { buildStreet } from './scene/street.js';
import { createRobot } from './scene/robot.js';
import { TrashLayer } from './scene/trash.js';
import { AimHelper } from './scene/aim-helper.js';
import { Telemetry } from './hud/telemetry.js';
import { SerialMonitor } from './hud/serial-monitor.js';
import { MissionCard, CompletionDialog, confirmDialog } from './hud/mission.js';
import { Minimap } from './hud/minimap.js';
import { Toasts, describeEvent } from './hud/toasts.js';

const $ = (selector) => document.querySelector(selector);

const dom = {
  shell: $('#shell'),
  splash: $('#splash'),
  start: $('#start'),
  splashStatus: $('#splash-status'),
  lost: $('#lost'),
  lostDetail: $('#lost-detail'),
  viewport: $('#viewport'),
  webglError: $('#webgl-error'),
  hudToggle: $('#hud-toggle'),
  hudClose: $('#hud-close'),
  reset: $('#reset'),
  cameraButtons: [...document.querySelectorAll('[data-camera]')],
};

// The mission card and toasts sit below the top bar, which wraps on narrow screens.
const topbar = $('.topbar');
new ResizeObserver(() => dom.viewport.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`)).observe(topbar);

// ------------------------------------------------------------------ services
const connection = new Connection();
const isBluetoothUp = () => connection.isOpen && connection.latest?.connected === true;
const transmitter = new Transmitter({ connection, isConnected: isBluetoothUp });
const panel = new AppPanel($('#app-panel'), { transmitter, connection });
renderKeyLegend($('#key-legend'));

const telemetry = new Telemetry($('#telemetry'));
const serial = new SerialMonitor($('#serial'));
const minimap = new Minimap($('#minimap'));
const missionCard = new MissionCard($('#mission-card'));
const toasts = new Toasts($('#toasts'));
const completion = new CompletionDialog({ onPlayAgain: () => requestReset({ ask: false }) });

let stage = null;
try {
  stage = new Stage(dom.viewport);
} catch (error) {
  console.error('[ecokar] WebGL is unavailable', error);
  dom.webglError.hidden = false;
}

// ------------------------------------------------------------- world lifecycle
let world = null;
let lastRender = null;

function disposeWorld() {
  if (!world) return;
  world.aim.dispose();
  world.trash.dispose();
  stage.scene.remove(world.robot.root);
  world.robot.dispose();
  stage.scene.remove(world.street.group);
  world.street.dispose();
  world = null;
}

function buildWorld(hello) {
  if (!stage) return;
  disposeWorld();
  const street = buildStreet(hello.world);
  stage.scene.add(street.group);
  const robot = createRobot(hello.robot);
  stage.scene.add(robot.root);
  stage.setGripperCamera(robot.wristCamera);
  world = { hello, street, robot, trash: new TrashLayer(stage.scene), aim: new AimHelper(stage.scene) };
  selfTested = false;
}

connection.on('hello', (hello) => {
  try {
    buildWorld(hello);
  } catch (error) {
    console.error('[ecokar] could not build the scene', error);
  }
  minimap.setWorld(hello.world);
  transmitter.setRepeat(hello.protocol.repeat_ms);
  serial.clear(); // a new hello means a new simulation (first load or reconnect)
  dom.lost.hidden = true;
});

connection.on('status', ({ phase, attempt, retryInMs }) => {
  if (phase === 'closed') {
    dom.lost.hidden = false;
    dom.lostDetail.textContent =
      retryInMs !== undefined ? `Intento ${attempt}, próximo en ${Math.max(1, Math.round(retryInMs / 1000))} s` : '';
    transmitter.releaseAll({ send: false });
    panel.setLinkState({ socketOpen: false, btConnected: false });
  } else if (phase === 'failed') {
    // the in-browser engine died: there is nothing to retry (see the "engine" handler below)
    transmitter.releaseAll({ send: false });
    panel.setLinkState({ socketOpen: false, btConnected: false });
  } else if (phase === 'open') {
    panel.setLinkState({ socketOpen: true, btConnected: false });
  }
});

connection.on('state', (state) => {
  panel.setLinkState({ socketOpen: true, btConnected: state.connected });
  panel.setBattery(state.battery.percent);
  telemetry.update(state);
  missionCard.update(state);
  if (!state.connected) transmitter.releaseAll({ send: false });
});

connection.on('serial', (message) => serial.add(message.line, message.t));

connection.on('event', (event) => {
  if (event.name === 'mission_complete') {
    completion.show(event.data);
    return;
  }
  const toast = describeEvent(event, connection.hello?.world);
  if (toast) toasts.show(toast.text, { tone: toast.tone });
});

connection.on('discontinuity', () => {
  toasts.clear();
  completion.hide();
});

transmitter.on('tx', (_data, ticker) => telemetry.setTicker(ticker));

// ---------------------------------------------------------------- frame loop
const graspWorld = new THREE.Vector3();
let selfTested = false;
let lastMapDraw = 0;
const DEFAULT_FOLLOW = { x: -4.5, z: 0, yaw: 0, grasp: null };

function onFrame(dt, time) {
  const render = connection.sample();
  if (!world || !render) {
    stage.follow(dt, DEFAULT_FOLLOW);
    return;
  }
  lastRender = render;
  world.robot.apply(render, dt, time);
  world.robot.setBluetooth(render.connected);
  world.trash.apply(render.trash);
  world.robot.getGraspWorld(graspWorld);
  const readyId = world.aim.update(graspWorld, render.trash, render.arm.opening_m);
  telemetry.setReady(readyId !== null);
  stage.follow(dt, { x: render.robot.x, z: render.robot.z, yaw: render.robot.yaw, grasp: graspWorld });

  if (time - lastMapDraw > 0.033) {
    lastMapDraw = time;
    minimap.draw(render);
  }
  if (!selfTested) {
    selfTested = true;
    const error = graspWorld.distanceTo(new THREE.Vector3(...render.arm.grasp_point));
    console.info('[ecokar] grasp error', error);
    if (error > 0.003) console.warn('[ecokar] rendered grasp point differs from the backend by more than 3 mm');
  }
}
stage?.onFrame(onFrame);

// ------------------------------------------------------------------- controls
const isBlocked = () =>
  !dom.splash.hidden || panel.isModalOpen || !dom.lost.hidden || document.querySelector('dialog[open]') !== null;

function setCamera(mode) {
  stage?.setMode(mode);
}

function syncCameraButtons(mode) {
  for (const button of dom.cameraButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.camera === mode));
  }
}
for (const button of dom.cameraButtons) {
  button.addEventListener('click', () => setCamera(button.dataset.camera));
}
stage?.onModeChange(syncCameraButtons);

async function requestReset({ ask = true } = {}) {
  const mission = connection.latest?.mission;
  const inProgress = mission && mission.elapsed_s > 0 && !mission.complete;
  if (ask && inProgress) {
    const confirmed = await confirmDialog({
      title: '¿Reiniciar la misión?',
      message: 'Se perderán los residuos recogidos, el tiempo y la distancia de esta misión.',
      confirmLabel: 'Reiniciar misión',
    });
    if (!confirmed) return;
  }
  transmitter.releaseAll();
  serial.clear(); // the firmware prints its banner again after the reset
  connection.send({ type: 'reset' });
}
dom.reset.addEventListener('click', () => requestReset());

function setHud(open) {
  dom.shell.dataset.hud = open ? 'open' : 'closed';
  dom.hudToggle.setAttribute('aria-pressed', String(open));
}
const toggleHud = () => setHud(dom.shell.dataset.hud !== 'open');
setHud(window.matchMedia('(min-width: 1280px)').matches);
dom.hudToggle.addEventListener('click', toggleHud);
dom.hudClose.addEventListener('click', () => setHud(false));

bindKeyboard(transmitter, {
  isBlocked,
  onCamera: setCamera,
  onReset: () => requestReset(),
  onToggleHud: toggleHud,
});

// -------------------------------------------------------------------- splash
let splashClosed = false;
dom.start.addEventListener('click', () => {
  if (splashClosed || engineState === 'loading' || engineState === 'error') return;
  splashClosed = true;
  document.body.classList.remove('is-splash');
  dom.shell.inert = false;
  dom.splash.classList.add('is-leaving');
  const finish = () => {
    if (dom.splash.hidden) return;
    dom.splash.hidden = true;
    document.querySelector('[data-action="connect"]')?.focus({ preventScroll: true });
  };
  dom.splash.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 1000);
  stage?.playIntro(1.6);
});

// ------------------------------------------------------------ engine loading
// The in-browser (Pyodide) engine needs a few seconds to download and start. While it loads, the
// start button is disabled and shows the progress; it turns back into "Comenzar" once the hello
// frame has arrived. With the WebSocket engine the event arrives at once and nothing changes.
const START_LABEL = 'Comenzar';
const LOADING_LABELS = {
  'loading-runtime': 'Cargando el motor de simulación…',
  'loading-core': 'Preparando EcoKar…',
  starting: 'Preparando EcoKar…',
};
const LOAD_ERROR = 'No se pudo cargar el simulador. Revisa tu conexión a internet y recarga la página.';
let engineState = 'idle'; // idle | loading | ready | error

function showFatalError(message) {
  // after the splash is gone the only overlay left is the "lost" one: reuse it, without retry text
  dom.lost.querySelector('.spinner').hidden = true;
  dom.lost.querySelector('.lost-title').textContent = message;
  dom.lostDetail.textContent = '';
  dom.lost.hidden = false;
}

connection.on('engine', ({ state, stage }) => {
  engineState = state;
  const loading = state === 'loading';
  const label = LOADING_LABELS[stage] ?? LOADING_LABELS['loading-runtime'];
  dom.start.disabled = loading || state === 'error';
  dom.start.classList.toggle('is-loading', loading);
  dom.start.textContent = loading ? label : START_LABEL;
  // visually hidden live region: announces the progress, and shows the error text when it fails
  dom.splashStatus.classList.toggle('visually-hidden', state !== 'error');
  dom.splashStatus.textContent = loading ? label : state === 'error' ? LOAD_ERROR : '';
  if (state === 'ready' && !splashClosed) dom.start.focus({ preventScroll: true });
  if (state === 'error' && splashClosed) showFatalError(LOAD_ERROR);
});

connection.connect();
dom.start.focus({ preventScroll: true });

// --------------------------------------------------------- debugging surface
/** Backend kinematics (docs/protocol.md section 3, kinematics.py) in plain JS. */
function expectedGrasp(spec, pose, arm) {
  const t1 = THREE.MathUtils.degToRad(arm.shoulder_deg);
  const t2 = THREE.MathUtils.degToRad(arm.elbow_deg);
  const radial = spec.l1 * Math.cos(t1) + spec.l2 * Math.cos(t2) + spec.grasp_offset[0];
  const height = spec.l1 * Math.sin(t1) + spec.l2 * Math.sin(t2) + spec.grasp_offset[1];
  const baseX = pose.x + spec.arm_mount[0] * Math.cos(pose.yaw);
  const baseZ = pose.z - spec.arm_mount[0] * Math.sin(pose.yaw);
  const heading = pose.yaw + THREE.MathUtils.degToRad(arm.base_deg);
  return new THREE.Vector3(
    baseX + radial * Math.cos(heading),
    spec.plate_y + spec.shoulder_height + height,
    baseZ - radial * Math.sin(heading),
  );
}

window.__ecokar = {
  get state() {
    return connection.latest;
  },
  get hello() {
    return connection.hello;
  },
  get stage() {
    return stage;
  },
  get connection() {
    return connection;
  },
  /** World position of the grasp point as currently rendered. */
  renderedGraspPoint() {
    return world ? world.robot.getGraspWorld(new THREE.Vector3()) : null;
  },
  /** Distance (m) between the rendered grasp point and the interpolated backend one. */
  graspError() {
    if (!world || !lastRender) return null;
    return world.robot.getGraspWorld(new THREE.Vector3()).distanceTo(new THREE.Vector3(...lastRender.arm.grasp_point));
  },
  /** Same, against the newest state received (differs while the robot moves: the view lags ~100 ms). */
  graspErrorLatest() {
    const latest = connection.latest;
    if (!world || !latest) return null;
    return world.robot.getGraspWorld(new THREE.Vector3()).distanceTo(new THREE.Vector3(...latest.arm.grasp_point));
  },
  /** Pose a throwaway robot at random joint values and compare with the backend formula. */
  selfTest(samples = 300) {
    const spec = connection.hello?.robot;
    if (!spec) return null;
    const robot = createRobot(spec);
    const root = new THREE.Scene();
    root.add(robot.root);
    const [bMin, bMax] = spec.limits.base_deg;
    const [sMin, sMax] = spec.limits.shoulder_deg;
    const [eMin, eMax] = spec.limits.elbow_deg;
    let worst = 0;
    for (let i = 0; i < samples; i++) {
      const pose = { x: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 5, yaw: (Math.random() - 0.5) * 12 };
      const arm = {
        base_deg: bMin + Math.random() * (bMax - bMin),
        shoulder_deg: sMin + Math.random() * (sMax - sMin),
        elbow_deg: eMin + Math.random() * (eMax - eMin),
        gripper_deg: 40,
        opening_m: 0.03,
      };
      robot.apply({ robot: pose, arm, drive: { left_pwm: 0, right_pwm: 0 } }, 0, 0);
      const rendered = robot.getGraspWorld(new THREE.Vector3());
      worst = Math.max(worst, rendered.distanceTo(expectedGrasp(spec, pose, arm)));
    }
    robot.dispose();
    return { samples, worstErrorMeters: worst };
  },
  /** Fixed free camera for inspection: lookAt([x,y,z], [x,y,z], fov); call lookAt(null) to release it. */
  lookAt(position, target, fov = 50) {
    if (!stage) return;
    if (!position) {
      stage.debugPose = null;
      return;
    }
    stage.debugPose = { position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) };
    stage.cameras.chase.fov = fov;
    stage.cameras.chase.updateProjectionMatrix();
  },
  stats() {
    if (!stage) return null;
    const { render, memory } = stage.renderer.info;
    return { drawCalls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures };
  },
};
