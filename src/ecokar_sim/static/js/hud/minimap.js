// Top-down 2D map of the street: static layer cached, dynamic layer drawn per call.

const PADDING = 0.6; // metres around the road
const COLORS = {
  road: '#4A4F55',
  curb: '#9C978C',
  sidewalk: '#B9B4A8',
  car: '#B23A34',
  cone: '#F26A1B',
  crate: '#38A438',
  ground: '#FFFFFF',
  held: '#8DF18D',
  deposited: '#38A438',
  robot: '#F5C400',
  robotEdge: '#1A1A5A',
};

export class Minimap {
  constructor(host) {
    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Mapa';
    header.append(title);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Mapa cenital de la calle con el robot y los residuos');
    host.replaceChildren(header, this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.world = null;
    this.layer = null;
    this.scale = 1;
    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(this.canvas);
  }

  setWorld(world) {
    this.world = world;
    this.#resize();
  }

  #resize() {
    if (!this.world) return;
    const road = this.world.road;
    const spanX = road.x_max - road.x_min + PADDING * 2;
    const spanZ = road.z_max - road.z_min + PADDING * 2;
    const cssWidth = this.canvas.clientWidth || 200;
    const cssHeight = Math.round((cssWidth * spanZ) / spanX);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * ratio);
    this.canvas.height = Math.round(cssHeight * ratio);
    this.scale = this.canvas.width / spanX;
    this.origin = { x: road.x_min - PADDING, z: road.z_min - PADDING };
    this.#drawStaticLayer();
  }

  #toPixel(x, z) {
    return [(x - this.origin.x) * this.scale, (z - this.origin.z) * this.scale];
  }

  #drawStaticLayer() {
    const { road, obstacles = [], crate } = this.world;
    const layer = document.createElement('canvas');
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const g = layer.getContext('2d');
    g.fillStyle = COLORS.sidewalk;
    g.fillRect(0, 0, layer.width, layer.height);
    const [x0, z0] = this.#toPixel(road.x_min, road.z_min);
    const [x1, z1] = this.#toPixel(road.x_max, road.z_max);
    g.fillStyle = COLORS.road;
    g.fillRect(x0, z0, x1 - x0, z1 - z0);
    g.strokeStyle = COLORS.curb;
    g.lineWidth = Math.max(2, this.scale * 0.1);
    g.strokeRect(x0, z0, x1 - x0, z1 - z0);
    g.setLineDash([this.scale * 0.5, this.scale * 0.4]);
    g.strokeStyle = '#E8C547';
    g.lineWidth = Math.max(1, this.scale * 0.06);
    const [, zc] = this.#toPixel(0, (road.z_min + road.z_max) / 2);
    g.beginPath();
    g.moveTo(x0, zc);
    g.lineTo(x1, zc);
    g.stroke();
    g.setLineDash([]);

    for (const obstacle of obstacles) {
      const [px, pz] = this.#toPixel(obstacle.x, obstacle.z);
      g.save();
      g.translate(px, pz);
      g.rotate(-obstacle.yaw);
      if (obstacle.kind === 'cone') {
        g.fillStyle = COLORS.cone;
        g.beginPath();
        g.arc(0, 0, Math.max(3, obstacle.w * this.scale * 0.5), 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = COLORS.car;
        g.fillRect((-obstacle.w * this.scale) / 2, (-obstacle.d * this.scale) / 2, obstacle.w * this.scale, obstacle.d * this.scale);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect((-obstacle.w * this.scale) / 2 + obstacle.w * this.scale * 0.58, (-obstacle.d * this.scale) / 2 + 2, obstacle.w * this.scale * 0.22, obstacle.d * this.scale - 4);
      }
      g.restore();
    }
    if (crate) {
      const [px, pz] = this.#toPixel(crate.x, crate.z);
      g.save();
      g.translate(px, pz);
      g.rotate(-crate.yaw);
      const size = Math.max(7, crate.w * this.scale);
      g.fillStyle = COLORS.crate;
      g.fillRect(-size / 2, -size / 2, size, size);
      g.strokeStyle = '#FFFFFF';
      g.lineWidth = 1.5;
      g.strokeRect(-size / 2 + 2, -size / 2 + 2, size - 4, size - 4);
      g.restore();
    }
    this.layer = layer;
  }

  /** Draw the dynamic layer for a render state. */
  draw(state) {
    if (!this.layer) return;
    const g = this.ctx;
    g.drawImage(this.layer, 0, 0);
    const dot = Math.max(2.5, this.scale * 0.07);
    for (const item of state.trash) {
      const [px, pz] = this.#toPixel(item.x, item.z);
      g.fillStyle = item.state === 'held' ? COLORS.held : item.state === 'deposited' ? COLORS.deposited : COLORS.ground;
      g.beginPath();
      g.arc(px, pz, item.state === 'held' ? dot * 1.3 : dot, 0, Math.PI * 2);
      g.fill();
      if (item.state === 'ground') {
        g.strokeStyle = 'rgba(26,26,90,0.55)';
        g.lineWidth = 1;
        g.stroke();
      }
    }

    const { robot, arm } = state;
    const [rx, rz] = this.#toPixel(robot.x, robot.z);
    g.save();
    g.translate(rx, rz);
    g.rotate(-robot.yaw);
    const size = Math.max(7, this.scale * 0.3);
    g.fillStyle = COLORS.robot;
    g.strokeStyle = COLORS.robotEdge;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(size, 0);
    g.lineTo(-size * 0.7, size * 0.62);
    g.lineTo(-size * 0.45, 0);
    g.lineTo(-size * 0.7, -size * 0.62);
    g.closePath();
    g.fill();
    g.stroke();
    // arm heading tick, relative to the chassis
    g.rotate((arm.base_deg * Math.PI) / 180 * -1);
    g.strokeStyle = COLORS.held;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(size * 0.2, 0);
    g.lineTo(size * 1.5, 0);
    g.stroke();
    g.restore();
  }
}
