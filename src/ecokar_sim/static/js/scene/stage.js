// Renderer, lights, sky, fog, the three cameras and the render loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { configureTextures } from './textures.js';

const HORIZON = '#DCEBF2';
const ZENITH = '#6FA8DC';

// Sun comes from behind the default chase camera so the street ahead is lit and shadows fall forward.
const SUN_DIRECTION = new THREE.Vector3(-0.5, 1.0, 0.35).normalize();
const CHASE_FOV = 52;
const SHADOW_HALF_EXTENT = 2.5;
const SHADOW_MAP_SIZE = 2048;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/** Critically damped spring step (exact solution); mutates `current` and `velocity`. */
function damp(current, velocity, target, omega, dt) {
  for (const axis of ['x', 'y', 'z']) {
    const x = current[axis] - target[axis];
    const exp = Math.exp(-omega * dt);
    const temp = (velocity[axis] + omega * x) * dt;
    current[axis] = target[axis] + (x + temp) * exp;
    velocity[axis] = (velocity[axis] - omega * temp) * exp;
  }
}

function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(ZENITH) },
      horizon: { value: new THREE.Color(HORIZON) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      varying vec3 vDirection;
      void main() {
        float h = clamp(vDirection.y, 0.0, 1.0);
        vec3 color = mix(horizon, zenith, pow(h, 0.5));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.name = 'sky';
  return sky;
}

export class Stage {
  /** @param {HTMLElement} host element that will contain the canvas */
  constructor(host) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.prepend(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    configureTextures({ anisotropy: this.renderer.capabilities.getMaxAnisotropy() });

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(HORIZON, 30, 170);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    this.sky = createSky();
    this.scene.add(this.sky);
    this.#buildLights();

    this.cameras = {
      orbital: new THREE.PerspectiveCamera(50, 1, 0.02, 400),
      chase: new THREE.PerspectiveCamera(58, 1, 0.02, 400),
    };
    this.cameras.chase.fov = 64; // wide while establishing, eased to 58 by the intro
    this.gripperCamera = null;
    this.mode = 'chase';
    this.listeners = new Set();
    this.frameCallbacks = new Set();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.controls = new OrbitControls(this.cameras.orbital, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.35;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.rotateSpeed = 0.7;
    this.controls.enabled = false;
    this.canvas.style.touchAction = 'pan-y';

    this.chasePos = new THREE.Vector3();
    this.chaseVel = new THREE.Vector3();
    this.lookPos = new THREE.Vector3();
    this.lookVel = new THREE.Vector3();
    this.debugPose = null;
    this.intro = null; // { t, duration, resolve }
    this.establishing = true; // holds the high shot until playIntro()
    this.focus = new THREE.Vector3(-4.5, 0, 0);
    this.lastFollow = null;

    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._estPos = new THREE.Vector3();
    this._estLook = new THREE.Vector3();
    this._snap = new THREE.Vector3();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();

    this.canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop((now) => this.#tick(now));
  }

  #buildLights() {
    this.hemisphere = new THREE.HemisphereLight(0xcfe6ff, 0x8a7d6b, 0.75);
    this.scene.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight(0xfff0d6, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -SHADOW_HALF_EXTENT;
    shadowCamera.right = SHADOW_HALF_EXTENT;
    shadowCamera.top = SHADOW_HALF_EXTENT;
    shadowCamera.bottom = -SHADOW_HALF_EXTENT;
    shadowCamera.near = 1;
    shadowCamera.far = 45;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.01;
    this.scene.add(this.sun, this.sun.target);

    // shadowless fill that keeps the far city and the shaded facades readable
    this.fill = new THREE.DirectionalLight(0xbfd6ff, 0.9);
    this.fill.position.set(0.45, 0.5, -0.8).multiplyScalar(40);
    this.scene.add(this.fill);
  }

  get activeCamera() {
    if (this.debugPose) return this.cameras.chase;
    if (this.mode === 'orbital') return this.cameras.orbital;
    if (this.mode === 'gripper' && this.gripperCamera) return this.gripperCamera;
    return this.cameras.chase;
  }

  setGripperCamera(camera) {
    this.gripperCamera = camera;
    this.resize();
  }

  onFrame(callback) {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  onModeChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  setMode(mode) {
    // Any explicit camera choice releases the debug free camera.
    this.debugPose = null;
    if (!['orbital', 'chase', 'gripper'].includes(mode) || mode === this.mode) return;
    if (this.intro || this.establishing) return;
    const previous = this.mode;
    this.mode = mode;
    this.controls.enabled = mode === 'orbital';
    this.canvas.style.touchAction = mode === 'orbital' ? 'none' : 'pan-y';
    if (mode === 'orbital') {
      const orbital = this.cameras.orbital;
      const source = this.cameras.chase;
      orbital.position.copy(previous === 'chase' ? source.position : this.#orbitalStart());
      this.controls.target.copy(this.#orbitTarget());
      this.controls.update();
    } else if (mode === 'chase' && this.lastFollow) {
      this.#chaseGoal(this.lastFollow, this.chasePos, this.lookPos);
      this.chaseVel.set(0, 0, 0);
      this.lookVel.set(0, 0, 0);
    }
    for (const listener of this.listeners) listener(mode);
  }

  /** Dolly from a high establishing shot down to the chase camera. */
  playIntro(duration = 1.6) {
    return new Promise((resolve) => {
      this.establishing = false;
      if (this.reducedMotion) {
        this.intro = null;
        this.cameras.chase.fov = CHASE_FOV;
        this.cameras.chase.updateProjectionMatrix();
        this.#snapChase();
        resolve();
        return;
      }
      this.intro = { t: 0, duration, resolve };
    });
  }

  #orbitTarget() {
    return this._snap.set(this.focus.x, 0.1, this.focus.z).clone();
  }

  #orbitalStart() {
    const { x, z } = this.focus;
    return new THREE.Vector3(x - 1.1, 0.9, z + 1.3);
  }

  #chaseGoal(follow, outPosition, outLook) {
    const forward = this._forward.set(Math.cos(follow.yaw), 0, -Math.sin(follow.yaw));
    outPosition.set(follow.x - forward.x * 0.9, 0.45, follow.z - forward.z * 0.9);
    const ahead = this._estLook.set(follow.x + forward.x * 0.18, 0.1, follow.z + forward.z * 0.18);
    if (follow.grasp) outLook.copy(ahead).lerp(follow.grasp, 0.55);
    else outLook.copy(ahead);
    return outLook;
  }

  #snapChase() {
    if (!this.lastFollow) return;
    this.#chaseGoal(this.lastFollow, this.chasePos, this.lookPos);
    this.chaseVel.set(0, 0, 0);
    this.lookVel.set(0, 0, 0);
  }

  /**
   * High shot above the road, slightly ahead of the robot. It stays over the street (clear of the
   * trees and the buildings that line it) so the straight dolly down to the chase camera is unobstructed.
   */
  #establishingPose(follow, outPosition, outLook) {
    outPosition.set(follow.x - 0.1, 9.5, follow.z + 3.0);
    outLook.set(follow.x + 3.5, 0.2, follow.z - 0.2);
  }

  /**
   * Per frame: move the sun's shadow window, the sky and the active camera.
   * `follow` = { x, z, yaw, grasp: Vector3 } of the robot as rendered.
   */
  follow(dt, follow) {
    this.lastFollow = follow;
    this.focus.set(follow.x, 0, follow.z);

    // shadow window follows the robot, snapped to shadow-map texels so edges do not shimmer
    const texel = (SHADOW_HALF_EXTENT * 2) / SHADOW_MAP_SIZE;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIRECTION).normalize();
    const up = new THREE.Vector3().crossVectors(SUN_DIRECTION, right).normalize();
    const px = Math.round(this.focus.dot(right) / texel) * texel;
    const py = Math.round(this.focus.dot(up) / texel) * texel;
    const pz = this.focus.dot(SUN_DIRECTION);
    const snapped = right.multiplyScalar(px).addScaledVector(up, py).addScaledVector(SUN_DIRECTION, pz);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(SUN_DIRECTION, 22);
    this.sun.target.updateMatrixWorld();

    this.#updateCamera(dt, follow);
    this.activeCamera.getWorldPosition(this.sky.position);
  }

  #updateCamera(dt, follow) {
    const chase = this.cameras.chase;
    if (this.debugPose) {
      // inspection aid (window.__ecokar.lookAt): a fixed free camera
      chase.position.copy(this.debugPose.position);
      chase.lookAt(this.debugPose.target);
      return;
    }
    if (this.establishing) {
      this.#establishingPose(follow, this.chasePos, this.lookPos);
      chase.position.copy(this.chasePos);
      chase.lookAt(this.lookPos);
      return;
    }
    if (this.intro) {
      this.intro.t += dt / this.intro.duration;
      const u = easeOutCubic(Math.min(1, this.intro.t));
      this.#establishingPose(follow, this._estPos, this._snap);
      const lookFrom = this._snap.clone();
      this.#chaseGoal(follow, this._desiredPos, this._desiredLook);
      chase.position.lerpVectors(this._estPos, this._desiredPos, u);
      const look = lookFrom.lerp(this._desiredLook, u);
      chase.lookAt(look);
      chase.fov = 64 + (CHASE_FOV - 64) * u;
      chase.updateProjectionMatrix();
      this.chasePos.copy(chase.position);
      this.lookPos.copy(look);
      if (this.intro.t >= 1) {
        const { resolve } = this.intro;
        this.intro = null;
        this.chaseReady = true;
        this.chaseVel.set(0, 0, 0);
        this.lookVel.set(0, 0, 0);
        resolve();
      }
      return;
    }

    if (this.mode === 'orbital') {
      const target = this.controls.target;
      const goal = this._desiredLook.set(follow.x, 0.1, follow.z);
      const step = this._estPos.copy(goal).sub(target).multiplyScalar(1 - Math.exp(-10 * dt));
      target.add(step);
      this.cameras.orbital.position.add(step);
      this.controls.update();
    } else {
      this.#chaseGoal(follow, this._desiredPos, this._desiredLook);
      if (!this.chaseReady) {
        this.chasePos.copy(this._desiredPos);
        this.lookPos.copy(this._desiredLook);
        this.chaseVel.set(0, 0, 0);
        this.lookVel.set(0, 0, 0);
        this.chaseReady = true;
      }
      damp(this.chasePos, this.chaseVel, this._desiredPos, 7, dt);
      damp(this.lookPos, this.lookVel, this._desiredLook, 10, dt);
      chase.position.copy(this.chasePos);
      chase.lookAt(this.lookPos);
    }
  }

  resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    for (const camera of [this.cameras.orbital, this.cameras.chase, this.gripperCamera]) {
      if (!camera) continue;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
  }

  #tick(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    for (const callback of this.frameCallbacks) callback(dt, now / 1000);
    this.renderer.render(this.scene, this.activeCamera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
