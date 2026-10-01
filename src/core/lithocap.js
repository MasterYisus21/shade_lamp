// Tapa litofanía por capas: una cara plana (hacia la habitación) y, del lado del
// bombillo, escalones de grosor según el tono de la imagen. Un aro exterior con el
// grosor completo lleva el labio de encastre y da rigidez. Se imprime acostada,
// con la cara plana sobre la cama y sin soportes.
//
// Método: la imagen se convierte en un campo de tono F (0 = claro … N = oscuro)
// sobre una rejilla. Cada umbral k - 0.5 define la región "nivel ≥ k"; sus
// contornos se trazan con marching triangles sobre el campo lineal por triángulos,
// así los contornos de distintos niveles nunca se cruzan y quedan anidados. Cada
// contorno es una pared vertical entre el escalón k-1 y el k, y cada zona entre un
// contorno y sus hijos es una cara horizontal: la malla queda cerrada.

import { offsetShape } from './profile.js';
import { solidBuilder } from './solid.js';
import { partsLayout, capSettings, capThickness } from './parts.js';

const EXPORT_CELL = 0.1; // mm: por debajo no aporta con boquillas normales
const EXPORT_MAX_SAMPLES = 4e6;
const PREVIEW_CELL = 0.2;
const PREVIEW_MAX_SAMPLES = 250_000;
const NUDGE = 0.01; // separa el campo de los umbrales (evita puntos casi repetidos)

/** Zona de la litofanía: la forma de la tapa reducida hasta dentro del labio + margen. */
export function lithoLayout(params) {
  const L = partsLayout(params);
  const cap = capSettings(params);
  const inset = params.thickness + L.p.clearance + L.p.lipWall + Math.max(0.5, cap.margin);
  const zone = offsetShape(params.shape, inset);
  const ok = !!L.lipInner && (zone.type === 'cylinder'
    ? zone.radius > 2
    : zone.width > 4 && zone.depth > 4);
  return { L, cap, zone: ok ? zone : null };
}

/** Distancia con signo al borde de la zona (positiva dentro). */
function zoneDistance(zone) {
  if (zone.type === 'cylinder') return (x, y) => zone.radius - Math.hypot(x, y);
  const a = zone.width / 2;
  const b = zone.depth / 2;
  const c = Math.max(0, Math.min(zone.cornerRadius, a, b));
  return (x, y) => {
    const qx = Math.abs(x) - (a - c);
    const qy = Math.abs(y) - (b - c);
    const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    return -(out + Math.min(Math.max(qx, qy), 0) - c);
  };
}

const zoneHalf = (zone) => (zone.type === 'cylinder' ? [zone.radius, zone.radius] : [zone.width / 2, zone.depth / 2]);

/**
 * Tono en un punto de la tapa (marco local). La imagen se coloca como la ve
 * alguien desde la habitación: allí la derecha es -x.
 */
function toneSampler(image, cap, N) {
  const W = cap.size;
  const H = (cap.size * image.height) / image.width;
  const t = (cap.rotation * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const { lum, width, height } = image;
  return (x, y) => {
    const dx = -x - cap.offsetX;
    const dy = y - cap.offsetY;
    const a = dx * cos + dy * sin;
    const b = -dx * sin + dy * cos;
    const u = (a / W + 0.5) * width - 0.5;
    const v = (0.5 - b / H) * height - 0.5;
    if (u < -0.5 || v < -0.5 || u > width - 0.5 || v > height - 0.5) return 0; // fuera de la imagen: claro
    const u0 = Math.max(0, Math.min(width - 1, Math.floor(u)));
    const v0 = Math.max(0, Math.min(height - 1, Math.floor(v)));
    const u1 = Math.min(width - 1, u0 + 1);
    const v1 = Math.min(height - 1, v0 + 1);
    const fu = Math.max(0, Math.min(1, u - u0));
    const fv = Math.max(0, Math.min(1, v - v0));
    const top = lum[v0 * width + u0] * (1 - fu) + lum[v0 * width + u1] * fu;
    const bot = lum[v1 * width + u0] * (1 - fu) + lum[v1 * width + u1] * fu;
    const l = (top * (1 - fv) + bot * fv) / 255;
    return (cap.invert ? l : 1 - l) * N;
  };
}

/** Desenfoque gaussiano separable (sigma en celdas). */
function blur(F, nx, ny, sigma) {
  if (sigma < 0.3) return;
  const r = Math.ceil(sigma * 3);
  const kernel = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k++) sum += kernel[k + r] = Math.exp(-(k * k) / (2 * sigma * sigma));
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const tmp = new Float32Array(F.length);
  for (let j = 0; j < ny; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += F[row + Math.min(nx - 1, Math.max(0, i + k))] * kernel[k + r];
      tmp[row + i] = acc;
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[Math.min(ny - 1, Math.max(0, j + k)) * nx + i] * kernel[k + r];
      F[j * nx + i] = acc;
    }
  }
}

/** Campo de tono sobre la rejilla, con la zona exterior forzada al nivel máximo. */
function toneField(params, image, cap, zone, cell) {
  const N = cap.levels;
  const [ax, ay] = zoneHalf(zone);
  const nx = Math.ceil((2 * ax) / cell) + 5;
  const ny = Math.ceil((2 * ay) / cell) + 5;
  const x0 = (-(nx - 1) / 2) * cell;
  const y0 = (-(ny - 1) / 2) * cell;
  const F = new Float32Array(nx * ny);
  const tone = toneSampler(image, cap, N);
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * cell;
    for (let i = 0; i < nx; i++) F[j * nx + i] = tone(x0 + i * cell, y);
  }
  blur(F, nx, ny, (cap.minFeature * 0.35) / cell);

  // Fuera de la zona el campo sube por encima del último umbral: ahí está el aro.
  // Dentro cae en una celda, así el borde del aro sigue la forma de la zona.
  const dist = zoneDistance(zone);
  const slope = N / cell;
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i;
      let f = Math.max(F[idx], N - 0.5 - dist(x0 + i * cell, y) * slope);
      const d = f - Math.floor(f) - 0.5;
      if (Math.abs(d) < NUDGE) f += d < 0 ? -NUDGE - d : NUDGE - d;
      F[idx] = f;
    }
  }
  return { F, nx, ny, x0, y0, cell, N };
}

/** Contornos del umbral t como lazos con la región F ≥ t a la izquierda. */
function traceLevel(grid, t) {
  const { F, nx, ny, x0, y0, cell } = grid;
  const next = new Map();
  const link = (vals, edges) => {
    const a0 = vals[0] >= t;
    const a1 = vals[1] >= t;
    const a2 = vals[2] >= t;
    const n = a0 + a1 + a2;
    if (n === 0 || n === 3) return;
    const flags = [a0, a1, a2];
    const lone = n === 1 ? flags.indexOf(true) : flags.indexOf(false);
    const out = edges[lone];
    const inc = edges[(lone + 2) % 3];
    if (n === 1) next.set(out, inc);
    else next.set(inc, out);
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const p = j * nx + i;
      const v00 = F[p];
      const v10 = F[p + 1];
      const v01 = F[p + nx];
      const v11 = F[p + nx + 1];
      const lo = Math.min(v00, v10, v01, v11);
      const hi = Math.max(v00, v10, v01, v11);
      if (lo >= t || hi < t) continue;
      const h0 = 3 * p;
      const d = 3 * p + 2;
      link([v00, v10, v11], [h0, 3 * (p + 1) + 1, d]);
      link([v00, v11, v01], [d, 3 * (p + nx), h0 + 1]);
    }
  }
  const point = (eid) => {
    const type = eid % 3;
    const p = (eid - type) / 3;
    const i = p % nx;
    const j = (p - i) / nx;
    const ib = type === 1 ? i : i + 1;
    const jb = type === 0 ? j : j + 1;
    const fa = F[j * nx + i];
    const fb = F[jb * nx + ib];
    const f = (t - fa) / (fb - fa);
    return [x0 + (i + (ib - i) * f) * cell, y0 + (j + (jb - j) * f) * cell];
  };
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const pts = [];
    let e = start;
    do {
      seen.add(e);
      const [x, y] = point(e);
      pts.push(x, y);
      e = next.get(e);
    } while (e !== start && e !== undefined);
    loops.push(pts);
  }
  return loops;
}

/** Quita puntos repetidos y colineales (earcut los descartaría y la malla se abriría). */
function cleanLoop(pts) {
  let cur = pts;
  for (;;) {
    const n = cur.length / 2;
    if (n < 3) return cur;
    const out = [];
    for (let k = 0; k < n; k++) {
      const p = (k + n - 1) % n;
      const q = (k + 1) % n;
      const cross = (cur[2 * k] - cur[2 * p]) * (cur[2 * q + 1] - cur[2 * p + 1])
        - (cur[2 * k + 1] - cur[2 * p + 1]) * (cur[2 * q] - cur[2 * p]);
      if (Math.abs(cross) > 1e-12) out.push(cur[2 * k], cur[2 * k + 1]);
    }
    if (out.length === cur.length) return out;
    cur = out;
  }
}

function signedArea(pts) {
  let a = 0;
  const n = pts.length / 2;
  for (let k = 0, p = n - 1; k < n; p = k++) a += pts[2 * p] * pts[2 * k + 1] - pts[2 * k] * pts[2 * p + 1];
  return a / 2;
}

/**
 * Padre de cada lazo (el lazo más pequeño que lo contiene, -1 = la tapa). Rayo
 * hacia -x desde el punto más a la izquierda: el primer contorno que cruza es el
 * padre si lo encierra, o un hermano (y entonces comparten padre).
 */
function nestLoops(loops, grid) {
  const { y0, ny, cell } = grid;
  const rows = Array.from({ length: ny }, () => []);
  const segs = [];
  loops.forEach((loop, li) => {
    const pts = loop.pts;
    const n = pts.length / 2;
    for (let k = 0; k < n; k++) {
      const q = (k + 1) % n;
      const s = segs.length;
      segs.push([pts[2 * k], pts[2 * k + 1], pts[2 * q], pts[2 * q + 1], li]);
      const r0 = Math.max(0, Math.floor((Math.min(pts[2 * k + 1], pts[2 * q + 1]) - y0) / cell));
      const r1 = Math.min(ny - 1, Math.floor((Math.max(pts[2 * k + 1], pts[2 * q + 1]) - y0) / cell));
      for (let r = r0; r <= r1; r++) rows[r].push(s);
    }
  });

  const parent = new Array(loops.length).fill(undefined);
  const resolve = (li) => {
    if (parent[li] !== undefined) return parent[li];
    const pts = loops[li].pts;
    let xp = Infinity;
    let yp = 0;
    for (let k = 0; k < pts.length; k += 2) {
      if (pts[k] < xp) { xp = pts[k]; yp = pts[k + 1]; }
    }
    xp -= cell * 1e-6;
    yp += cell * 3.1e-6;
    const row = Math.floor((yp - y0) / cell);
    let best = -Infinity;
    let hit = null;
    for (const s of rows[Math.max(0, Math.min(ny - 1, row))] || []) {
      const [ax, ay, bx, by, owner] = segs[s];
      if (owner === li || (ay <= yp) === (by <= yp)) continue;
      const x = ax + ((yp - ay) * (bx - ax)) / (by - ay);
      if (x < xp && x > best) { best = x; hit = segs[s]; }
    }
    let result = -1;
    if (hit) {
      const owner = hit[4];
      const inside = (hit[3] - hit[1] < 0) === (loops[owner].area > 0);
      result = inside ? owner : resolve(owner);
    }
    parent[li] = result;
    return result;
  };
  for (let li = 0; li < loops.length; li++) resolve(li);
  return parent;
}

/** Celda de la rejilla: fina al exportar, más gruesa en la vista previa. */
function cellFor(zone, maxSamples, minCell) {
  const [ax, ay] = zoneHalf(zone);
  return Math.max(minCell, Math.sqrt((4 * ax * ay) / maxSamples));
}

/**
 * Tapa litofanía en su propio marco (h = 0 cara plana exterior, escalones y labio
 * hacia +h, que es también su orientación de impresión).
 * @param {{lum: Uint8Array, width: number, height: number}} image
 * @param {{preview?: boolean, rasterSize?: number}} [opts]
 * @returns {{tris: Float32Array, raster: null | {levels: Uint8Array, size: number, half: number, n: number}}}
 */
export function buildLithoCap(params, image, opts = {}) {
  const { L, cap, zone } = lithoLayout(params);
  const { p } = L;
  const N = cap.levels;
  const T = capThickness(params);
  const heightOf = (level) => cap.base + level * cap.step;

  let grid = null;
  let loops = [];
  if (zone && image) {
    const cell = opts.preview
      ? cellFor(zone, PREVIEW_MAX_SAMPLES, PREVIEW_CELL)
      : cellFor(zone, EXPORT_MAX_SAMPLES, EXPORT_CELL);
    grid = toneField(params, image, cap, zone, cell);
    const minArea = Math.PI * (cap.minFeature / 2) ** 2;
    for (let k = 1; k <= N; k++) {
      for (const raw of traceLevel(grid, k - 0.5)) {
        const pts = cleanLoop(raw);
        if (pts.length < 6) continue;
        const area = signedArea(pts);
        // Los detalles diminutos no se imprimen; lo que contienen es aún más pequeño
        if (Math.abs(area) < minArea) continue;
        loops.push({ pts, area, k });
      }
    }
  }

  const b = solidBuilder();
  b.face(0, L.outer, [], false);
  b.wall(L.outer, 0, T, true);
  if (L.lipInner) {
    b.face(T, L.outer, [L.lipOuter], true);
    b.wall(L.lipOuter, T, T + p.lipLength, true);
    b.wall(L.lipInner, T, T + p.lipLength, false);
    b.face(T + p.lipLength, L.lipOuter, [L.lipInner], true);

    const parent = nestLoops(loops, grid || { y0: 0, ny: 1, cell: 1 });
    const children = loops.map(() => []);
    const rootKids = [];
    parent.forEach((q, li) => (q < 0 ? rootKids : children[q]).push(loops[li].pts));

    // Dentro del labio, fuera de toda la litofanía: el aro con el grosor completo
    b.face(T, L.lipInner, rootKids, true);
    loops.forEach((loop, li) => {
      const island = loop.area > 0;
      b.face(heightOf(island ? loop.k : loop.k - 1), loop.pts, children[li], true);
      let ring = loop.pts;
      if (!island) {
        ring = [];
        for (let k = loop.pts.length - 2; k >= 0; k -= 2) ring.push(loop.pts[k], loop.pts[k + 1]);
      }
      b.wall(ring, heightOf(loop.k - 1), heightOf(loop.k), island);
    });
  } else {
    b.face(T, L.outer, [], true);
  }

  return { tris: b.result(), raster: opts.rasterSize ? lithoRaster(params, L, grid, opts.rasterSize) : null };
}

/**
 * Nivel de cada píxel de la tapa (marco local, fila 0 = y mínima) para dibujar
 * cómo se verá encendida. 255 = fuera de la tapa; N = aro o zona más oscura.
 */
function lithoRaster(params, L, grid, size) {
  let half = 0;
  for (let k = 0; k < L.outer.length; k++) half = Math.max(half, Math.abs(L.outer[k]));
  const levels = new Uint8Array(size * size);
  const shape = params.shape;
  const outerDist = zoneDistance(shape);
  const N = capSettings(params).levels;
  for (let py = 0; py < size; py++) {
    const y = -half + ((py + 0.5) / size) * 2 * half;
    for (let px = 0; px < size; px++) {
      const x = -half + ((px + 0.5) / size) * 2 * half;
      let level = 255;
      if (outerDist(x, y) >= 0) {
        level = N;
        if (grid) {
          const gi = (x - grid.x0) / grid.cell;
          const gj = (y - grid.y0) / grid.cell;
          if (gi >= 0 && gj >= 0 && gi < grid.nx - 1 && gj < grid.ny - 1) {
            const i = Math.floor(gi);
            const j = Math.floor(gj);
            const fi = gi - i;
            const fj = gj - j;
            const F = grid.F;
            const r0 = F[j * grid.nx + i] * (1 - fi) + F[j * grid.nx + i + 1] * fi;
            const r1 = F[(j + 1) * grid.nx + i] * (1 - fi) + F[(j + 1) * grid.nx + i + 1] * fi;
            const f = r0 * (1 - fj) + r1 * fj;
            level = Math.max(0, Math.min(N, Math.round(f)));
          }
        }
      }
      levels[py * size + px] = level;
    }
  }
  return { levels, size, half, n: N };
}
