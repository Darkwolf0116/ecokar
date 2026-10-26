// Procedural CanvasTextures: nothing is downloaded, everything is drawn at load time.
import * as THREE from 'three';
import { mulberry32, TAU } from './geometry.js';

const FONT = 'Lexend, system-ui, sans-serif';
let maxAnisotropy = 4;

export function configureTextures({ anisotropy }) {
  maxAnisotropy = Math.max(1, Math.min(8, anisotropy));
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d', { willReadFrequently: true })];
}

function toTexture(canvas, { repeat = true, srgb = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/** Redraw a texture once the Lexend font is available (canvas text uses it). */
function redrawWhenFontsReady(texture, redraw) {
  if (!document.fonts) return;
  document.fonts
    .load(`700 48px Lexend`)
    .then(() => {
      redraw();
      texture.needsUpdate = true;
    })
    .catch(() => {});
}

function grain(g, x, y, w, h, amplitude, rnd) {
  const image = g.getImageData(x, y, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rnd() - 0.5) * amplitude;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  g.putImageData(image, x, y);
}

/** Run `draw(dx, dy)` at the offsets needed so a feature at (x, y, r) wraps around a tile. */
function wrapped(size, x, y, r, draw) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
      draw(ox, oy);
    }
  }
}

// --------------------------------------------------------------------------- asphalt
export function asphaltTexture() {
  const S = 1024;
  const [canvas, g] = makeCanvas(S, S);
  const rnd = mulberry32(11);
  g.fillStyle = '#4A4F55';
  g.fillRect(0, 0, S, S);

  for (let i = 0; i < 150; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 30 + rnd() * 130;
    const light = rnd() < 0.5;
    const alpha = 0.04 + rnd() * 0.06;
    wrapped(S, x, y, r, (ox, oy) => {
      const gradient = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gradient.addColorStop(0, light ? `rgba(128,134,142,${alpha})` : `rgba(18,20,24,${alpha})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gradient;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    });
  }

  grain(g, 0, 0, S, S, 22, rnd);

  for (let i = 0; i < 11000; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const radius = 0.5 + rnd() * rnd() * 1.6;
    g.fillStyle =
      rnd() < 0.55
        ? `rgba(160,166,172,${0.12 + rnd() * 0.26})`
        : `rgba(22,24,28,${0.18 + rnd() * 0.32})`;
    wrapped(S, x, y, radius, (ox, oy) => {
      g.beginPath();
      g.arc(x + ox, y + oy, radius, 0, TAU);
      g.fill();
    });
  }

  g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    let x = rnd() * S;
    let y = rnd() * S;
    g.strokeStyle = 'rgba(14,15,18,0.55)';
    g.lineWidth = 1 + rnd() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 14; s++) {
      x += (rnd() - 0.3) * 38;
      y += (rnd() - 0.5) * 30;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    wrapped(S, x, y, 90, (ox, oy) => {
      g.fillStyle = 'rgba(20,22,26,0.12)';
      g.beginPath();
      g.ellipse(x + ox, y + oy, 40 + rnd() * 50, 16 + rnd() * 22, rnd() * 3, 0, TAU);
      g.fill();
    });
  }
  return toTexture(canvas);
}

// ------------------------------------------------------------------------- sidewalk
/** 1 m x 1 m of paving: 2 x 2 tiles of 0.5 m. */
export function sidewalkTexture() {
  const S = 512;
  const [canvas, g] = makeCanvas(S, S);
  const rnd = mulberry32(23);
  const tile = S / 2;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const tone = 168 + Math.round((rnd() - 0.5) * 14);
      g.fillStyle = `rgb(${tone + 12},${tone + 7},${tone - 4})`;
      g.fillRect(tx * tile, ty * tile, tile, tile);
    }
  }
  grain(g, 0, 0, S, S, 20, rnd);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 14 + rnd() * 40;
    wrapped(S, x, y, r, (ox, oy) => {
      g.fillStyle = `rgba(70,62,50,${0.03 + rnd() * 0.05})`;
      g.beginPath();
      g.arc(x + ox, y + oy, r, 0, TAU);
      g.fill();
    });
  }
  g.fillStyle = '#85816f';
  for (const p of [0, tile]) {
    g.fillRect(p - 2, 0, 4, S);
    g.fillRect(0, p - 2, S, 4);
  }
  g.fillRect(S - 2, 0, 2, S);
  g.fillRect(0, S - 2, S, 2);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (const p of [0, tile]) {
    g.fillRect(p + 2, 0, 1, S);
    g.fillRect(0, p + 2, S, 1);
  }
  return toTexture(canvas);
}

/** Neutral concrete used for curbs and the far ground. */
export function concreteTexture(base = '#9C978C') {
  const S = 256;
  const [canvas, g] = makeCanvas(S, S);
  const rnd = mulberry32(37);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  grain(g, 0, 0, S, S, 26, rnd);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(40,36,30,${0.08 + rnd() * 0.18})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  return toTexture(canvas);
}

// ---------------------------------------------------------------------------- paint
/** Worn white road paint: alpha holes scuffed out of a solid colour. */
export function paintTexture(color = '#F2F0E8') {
  const S = 512; // 1 m per tile, about 2 mm per texel
  const [canvas, g] = makeCanvas(S, S);
  const rnd = mulberry32(51);
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1500; i++) {
    const r = 0.6 + rnd() * rnd() * rnd() * 3.6;
    const x = rnd() * S;
    const y = rnd() * S;
    const alpha = 0.25 + rnd() * 0.6;
    wrapped(S, x, y, r, (ox, oy) => {
      g.fillStyle = `rgba(0,0,0,${alpha})`;
      g.beginPath();
      g.arc(x + ox, y + oy, r, 0, TAU);
      g.fill();
    });
  }
  // soft scuffs where tyres have worn the paint
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const rx = 14 + rnd() * 60;
    const ry = 5 + rnd() * 20;
    const angle = rnd() * 3;
    wrapped(S, x, y, rx, (ox, oy) => {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(angle);
      g.scale(1, ry / rx);
      const gradient = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      gradient.addColorStop(0, `rgba(0,0,0,${0.25 + rnd() * 0.3})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gradient;
      g.fillRect(-rx, -rx, rx * 2, rx * 2);
      g.restore();
    });
  }
  return toTexture(canvas);
}

/** Soft dark blob used as a baked contact shadow under objects outside the sun's shadow window. */
export function contactShadowTexture() {
  const S = 128;
  const [canvas, g] = makeCanvas(S, S);
  const gradient = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, S, S);
  return toTexture(canvas, { repeat: false });
}

export function manholeTexture() {
  const S = 256;
  const [canvas, g] = makeCanvas(S, S);
  const rnd = mulberry32(61);
  g.fillStyle = '#34363a';
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  g.strokeStyle = '#1b1c1f';
  g.lineWidth = 5;
  for (const r of [112, 86, 60]) {
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();
  }
  g.strokeStyle = '#4a4c51';
  g.lineWidth = 3;
  for (let a = 0; a < 16; a++) {
    g.save();
    g.rotate((a * TAU) / 16);
    g.beginPath();
    g.moveTo(14, 0);
    g.lineTo(84, 0);
    g.stroke();
    g.restore();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  grain(g, 0, 0, S, S, 22, rnd);
  g.fillStyle = 'rgba(122,70,40,0.22)';
  for (let i = 0; i < 30; i++) g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 6, 2 + rnd() * 6);
  return toTexture(canvas, { repeat: false });
}

// -------------------------------------------------------------------------- facades
export const FACADE_VARIANTS = [
  { name: 'ocre', wall: '#D9A441', trim: '#F1E6C8', base: '#8A5A2B', accent: '#2F5D50', style: 'grille' },
  { name: 'terracota', wall: '#C4693D', trim: '#EFE2CF', base: '#6E3B24', accent: '#2C6E6A', style: 'shutters' },
  { name: 'turquesa', wall: '#3E8E8A', trim: '#E8EFE6', base: '#26524F', accent: '#C4693D', style: 'arched' },
  { name: 'amarillo', wall: '#EAD98B', trim: '#FBF6E4', base: '#9C7F3C', accent: '#3E6E9C', style: 'grille' },
  { name: 'azul', wall: '#7FB3D5', trim: '#F3F3EE', base: '#3F6E8F', accent: '#B8493B', style: 'shutters' },
  { name: 'blanco', wall: '#EDE8DC', trim: '#C9604A', base: '#A64B35', accent: '#2E5E8A', style: 'arched' },
];

const BAY_W = 640; // 4 m
const BAY_H = 512; // 3.2 m

function glassPath(left, top, w, h, arched) {
  const path = new Path2D();
  if (arched) {
    path.moveTo(left, top + h);
    path.lineTo(left, top + w / 2);
    path.arc(left + w / 2, top + w / 2, w / 2, Math.PI, 0, false);
    path.lineTo(left + w, top + h);
  } else {
    path.rect(left, top, w, h);
  }
  path.closePath();
  return path;
}

function drawWindow(g, v, rnd) {
  const cx = BAY_W / 2;
  const w = 168;
  const h = 252;
  const left = cx - w / 2;
  const top = 120;
  const arched = v.style === 'arched';

  // shutters sit behind the frame
  if (v.style === 'shutters') {
    for (const side of [-1, 1]) {
      const sx = side < 0 ? left - 16 - 84 : left + w + 16;
      g.fillStyle = v.accent;
      g.fillRect(sx, top - 6, 84, h + 12);
      g.strokeStyle = 'rgba(0,0,0,0.32)';
      g.lineWidth = 2;
      for (let y = top + 4; y < top + h + 4; y += 11) {
        g.beginPath();
        g.moveTo(sx + 6, y);
        g.lineTo(sx + 78, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(side < 0 ? sx + 80 : sx, top - 6, 4, h + 12);
    }
  }

  // outer frame
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(left - 18, top - 16, w + 36, h + 36);
  g.fillStyle = v.trim;
  g.fill(glassPath(left - 16, top - 16, w + 32, h + 32, arched));

  // glass
  const glass = glassPath(left, top, w, h, arched);
  const gradient = g.createLinearGradient(left, top, left + w, top + h);
  gradient.addColorStop(0, '#2b4660');
  gradient.addColorStop(0.55, '#16293a');
  gradient.addColorStop(1, '#0e1a26');
  g.fillStyle = gradient;
  g.fill(glass);
  g.save();
  g.clip(glass);
  g.fillStyle = 'rgba(190,215,238,0.16)';
  g.beginPath();
  g.moveTo(left, top + h * 0.6);
  g.lineTo(left + w * 0.62, top);
  g.lineTo(left + w * 0.86, top);
  g.lineTo(left, top + h * 0.86);
  g.fill();
  // a curtain pulled to one side
  g.fillStyle = rnd() < 0.5 ? 'rgba(235,225,200,0.78)' : 'rgba(196,105,61,0.7)';
  g.fillRect(left, top, w * 0.3, h);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = left + 8; x < left + w * 0.3; x += 12) g.fillRect(x, top, 2, h);
  g.restore();

  // muntins
  g.fillStyle = v.trim;
  g.fillRect(cx - 3, top, 6, h);
  g.fillRect(left, top + h * 0.4, w, 6);

  // iron grille
  if (v.style !== 'shutters') {
    g.save();
    g.clip(glass);
    g.strokeStyle = '#141416';
    g.lineWidth = 3;
    for (let x = left + 12; x < left + w; x += 17) {
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, top + h);
      g.stroke();
    }
    g.lineWidth = 5;
    for (const y of [top + 14, top + h * 0.5, top + h - 14]) {
      g.beginPath();
      g.moveTo(left, y);
      g.lineTo(left + w, y);
      g.stroke();
    }
    g.lineWidth = 3;
    for (const y of [top + h * 0.25, top + h * 0.75]) {
      g.beginPath();
      g.arc(cx, y, 20, 0, TAU);
      g.stroke();
    }
    g.restore();
  }

  // sill and hood
  g.fillStyle = v.trim;
  g.fillRect(left - 28, top + h + 16, w + 56, 13);
  g.fillStyle = 'rgba(0,0,0,0.34)';
  g.fillRect(left - 28, top + h + 29, w + 56, 6);
  if (!arched) {
    g.fillStyle = v.trim;
    g.fillRect(left - 28, top - 34, w + 56, 16);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(left - 28, top - 18, w + 56, 3);
  } else {
    g.strokeStyle = v.trim;
    g.lineWidth = 12;
    g.beginPath();
    g.arc(cx, top + w / 2, w / 2 + 22, Math.PI, 0, false);
    g.stroke();
  }
}

function drawBay(g, oy, v, ground, rnd) {
  g.save();
  g.translate(0, oy);
  g.beginPath();
  g.rect(0, 0, BAY_W, BAY_H);
  g.clip();

  g.fillStyle = v.wall;
  g.fillRect(0, 0, BAY_W, BAY_H);

  // plaster mottling (wraps horizontally so bays tile)
  for (let i = 0; i < 46; i++) {
    const x = rnd() * BAY_W;
    const y = rnd() * BAY_H;
    const r = 24 + rnd() * 90;
    const light = rnd() < 0.5;
    const alpha = 0.05 + rnd() * 0.09;
    for (const ox of [-BAY_W, 0, BAY_W]) {
      if (x + ox + r < 0 || x + ox - r > BAY_W) continue;
      const gradient = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      gradient.addColorStop(0, light ? `rgba(255,255,255,${alpha})` : `rgba(40,25,10,${alpha})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gradient;
      g.fillRect(x + ox - r, y - r, r * 2, r * 2);
    }
  }

  // rain streaks under the window sill
  for (let i = 0; i < 9; i++) {
    const x = 230 + rnd() * 180;
    const gradient = g.createLinearGradient(0, 400, 0, BAY_H);
    gradient.addColorStop(0, 'rgba(45,30,16,0.16)');
    gradient.addColorStop(1, 'rgba(45,30,16,0)');
    g.fillStyle = gradient;
    g.fillRect(x, 400, 2 + rnd() * 5, BAY_H - 400);
  }

  // peeled patches that expose the plaster underneath
  for (let i = 0; i < 12; i++) {
    const x = rnd() * BAY_W;
    const y = ground ? 300 + rnd() * 140 : 60 + rnd() * 420;
    g.fillStyle = rnd() < 0.5 ? 'rgba(206,176,138,0.45)' : 'rgba(150,92,62,0.35)';
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) g.lineTo(x + (rnd() - 0.2) * 34, y + (rnd() - 0.5) * 22);
    g.closePath();
    g.fill();
  }

  drawWindow(g, v, rnd);

  if (ground) {
    // damp stain and painted base band
    const gradient = g.createLinearGradient(0, BAY_H - 150, 0, BAY_H);
    gradient.addColorStop(0, 'rgba(60,40,20,0)');
    gradient.addColorStop(1, 'rgba(60,40,20,0.3)');
    g.fillStyle = gradient;
    g.fillRect(0, BAY_H - 150, BAY_W, 150);
    g.fillStyle = v.base;
    g.fillRect(0, BAY_H - 72, BAY_W, 72);
    g.fillStyle = v.trim;
    g.fillRect(0, BAY_H - 76, BAY_W, 5);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, BAY_H - 71, BAY_W, 5);
  }
  g.restore();
}

/** One texture per facade colour: ground-floor bay on the lower half, upper bay on the top half. */
export function facadeTexture(variantIndex) {
  const v = FACADE_VARIANTS[variantIndex % FACADE_VARIANTS.length];
  const [canvas, g] = makeCanvas(BAY_W, BAY_H * 2);
  const rnd = mulberry32(100 + variantIndex * 17);
  drawBay(g, 0, v, false, rnd);
  drawBay(g, BAY_H, v, true, rnd);
  for (const oy of [0, BAY_H]) grain(g, 0, oy, BAY_W, BAY_H, 16, rnd);
  const texture = toTexture(canvas);
  return texture;
}

export function doorTexture() {
  const W = 256;
  const H = 468;
  const [canvas, g] = makeCanvas(W, H);
  const rnd = mulberry32(77);
  g.fillStyle = '#E4DAC4';
  g.fillRect(0, 0, W, H);
  grain(g, 0, 0, W, H, 16, rnd);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(14, 22, W - 28, H - 22);
  g.fillStyle = '#EFE7D4';
  g.fillRect(18, 26, W - 36, H - 26);
  // arched door leaf
  const left = 44;
  const right = W - 44;
  const top = 58;
  g.fillStyle = '#4b2e1c';
  g.beginPath();
  g.moveTo(left, H);
  g.lineTo(left, top + 64);
  g.arc(W / 2, top + 64, 84, Math.PI, 0, false);
  g.lineTo(right, H);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.38)';
  g.lineWidth = 3;
  for (let x = left + 22; x < right; x += 22) {
    g.beginPath();
    g.moveTo(x, top + 40);
    g.lineTo(x, H);
    g.stroke();
  }
  g.fillStyle = '#c7a24a';
  g.beginPath();
  g.arc(right - 18, 296, 6, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(left, H - 20, right - left, 20);
  return toTexture(canvas, { repeat: false });
}

export function shutterTexture() {
  const W = 512;
  const H = 440;
  const [canvas, g] = makeCanvas(W, H);
  const rnd = mulberry32(88);
  g.fillStyle = '#3a3d42';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#9aa3ab';
  g.fillRect(24, 28, W - 48, H - 28);
  g.strokeStyle = 'rgba(40,46,52,0.5)';
  g.lineWidth = 3;
  for (let y = 36; y < H; y += 12) {
    g.beginPath();
    g.moveTo(24, y);
    g.lineTo(W - 24, y);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(24, y + 4);
    g.lineTo(W - 24, y + 4);
    g.stroke();
    g.strokeStyle = 'rgba(40,46,52,0.5)';
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(140,76,40,${0.08 + rnd() * 0.18})`;
    g.fillRect(24 + rnd() * (W - 48), 28 + rnd() * (H - 28), 10 + rnd() * 40, 3 + rnd() * 8);
  }
  g.fillStyle = '#212327';
  g.fillRect(W / 2 - 24, H - 46, 48, 10);
  grain(g, 0, 0, W, H, 14, rnd);
  return toTexture(canvas, { repeat: false });
}

export function corrugatedTexture(color = '#8c9298') {
  const S = 256;
  const [canvas, g] = makeCanvas(S, S);
  const rnd = mulberry32(93);
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  const ridge = S / 8;
  for (let i = 0; i < 8; i++) {
    const gradient = g.createLinearGradient(i * ridge, 0, (i + 1) * ridge, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = gradient;
    g.fillRect(i * ridge, 0, ridge, S);
  }
  grain(g, 0, 0, S, S, 20, rnd);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(150,78,40,${0.06 + rnd() * 0.16})`;
    g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 14, 4 + rnd() * 24);
  }
  return toTexture(canvas);
}

// --------------------------------------------------------------------------- crate
function drawRecycle(g, cx, cy, R, color) {
  const corners = [0, 1, 2].map((i) => {
    const a = -Math.PI / 2 + (i * TAU) / 3;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  });
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineJoin = 'round';
  g.lineCap = 'butt';
  g.lineWidth = R * 0.3;
  for (let i = 0; i < 3; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 3];
    const c = corners[(i + 2) % 3];
    const p0 = lerp(a, b, 0.34);
    const p2 = lerp(b, c, 0.12);
    g.beginPath();
    g.moveTo(p0[0], p0[1]);
    g.lineTo(b[0], b[1]);
    g.lineTo(p2[0], p2[1]);
    g.stroke();
    const dx = c[0] - b[0];
    const dy = c[1] - b[1];
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const hw = R * 0.3;
    const hl = R * 0.34;
    g.beginPath();
    g.moveTo(p2[0] - uy * hw, p2[1] + ux * hw);
    g.lineTo(p2[0] + ux * hl, p2[1] + uy * hl);
    g.lineTo(p2[0] + uy * hw, p2[1] - ux * hw);
    g.closePath();
    g.fill();
  }
}

/** White recycle symbol and the "EcoKar" wordmark on a transparent background. */
export function crateDecalTexture() {
  const W = 640;
  const H = 200;
  const [canvas, g] = makeCanvas(W, H);
  const draw = () => {
    g.clearRect(0, 0, W, H);
    drawRecycle(g, 112, 108, 78, '#FFFFFF');
    g.fillStyle = '#FFFFFF';
    g.font = `700 104px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillText('EcoKar', 220, 104);
  };
  draw();
  const texture = toTexture(canvas, { repeat: false });
  redrawWhenFontsReady(texture, draw);
  return texture;
}

// ------------------------------------------------------------------ PCB silkscreen
export function labelTexture(lines, { width = 256, height = 128, bg = '#1F5FA8', fg = '#EAF2FF', size = 28, weight = 600, align = 'center' } = {}) {
  const [canvas, g] = makeCanvas(width, height);
  const draw = () => {
    g.fillStyle = bg;
    g.fillRect(0, 0, width, height);
    g.fillStyle = fg;
    g.font = `${weight} ${size}px ${FONT}`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    const x = align === 'center' ? width / 2 : align === 'left' ? size * 0.6 : width - size * 0.6;
    const lineHeight = size * 1.25;
    const top = height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => g.fillText(line, x, top + i * lineHeight));
  };
  draw();
  const texture = toTexture(canvas, { repeat: false });
  redrawWhenFontsReady(texture, draw);
  return texture;
}

export function bottleLabelTexture() {
  const W = 256;
  const H = 128;
  const [canvas, g] = makeCanvas(W, H);
  g.fillStyle = '#F4F7F2';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#2E7BC4';
  g.fillRect(0, 0, W, 34);
  g.fillRect(0, H - 22, W, 22);
  g.fillStyle = '#5AB1E8';
  g.beginPath();
  g.moveTo(0, 62);
  for (let x = 0; x <= W; x += 8) g.lineTo(x, 62 + Math.sin((x / W) * TAU * 3) * 10);
  g.lineTo(W, 100);
  g.lineTo(0, 100);
  g.closePath();
  g.fill();
  return toTexture(canvas, { repeat: false });
}

export function treadTexture() {
  const W = 128;
  const H = 64;
  const [canvas, g] = makeCanvas(W, H);
  g.fillStyle = '#202024';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#6b6b72';
  g.lineWidth = 7;
  for (let x = -H; x < W + H; x += 24) {
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + H / 2, H / 2);
    g.lineTo(x, 0);
    g.stroke();
  }
  return toTexture(canvas, { srgb: false });
}
