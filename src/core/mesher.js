// Convierte el campo en una malla cerrada (watertight).
//
// La superficie desenrollada se divide en franjas verticales. En cada franja:
//   1. marching squares extrae los contornos exactos (interpolados) del material,
//      cerrados sobre los bordes de la franja gracias a un relleno de ancho cero;
//   2. los contornos se simplifican (Douglas-Peucker) sin tocar los puntos que
//      comparte con la franja vecina, así no aparecen grietas entre franjas;
//   3. se triangula cada región (earcut) y se mapea a 3D en la cara exterior e
//      interior; los bordes de los contornos generan las paredes de los huecos.
//
// La cara interior se obtiene a lo largo del rayo que sale del bombillo, así las
// paredes de cada hueco apuntan a la luz y el grosor no recorta la sombra.

import earcut from 'earcut';
import { makeProfile, offsetShape } from './profile.js';
import { rowZ } from './field.js';

const ISO = 0.5;

// Todas las coordenadas 2D se ajustan a una rejilla de 1 µm: puntos más cercanos
// se funden en uno y los distintos siguen siéndolo al pasar a float32 en el STL.
const QUANT = 1000;
export const quant = (v) => Math.round(v * QUANT) / QUANT;

/**
 * Extrae los contornos de la franja de columnas [a, b].
 * getField(c, j) devuelve g en la columna global c y la fila j.
 * Devuelve lazos [[s0, z0, s1, z1, ...], ...] con el material a la izquierda.
 */
export function extractLoops(grid, getField, a, b) {
  const rows = grid.rows;
  const nx = b - a + 3; // + columnas de relleno a cada lado
  const ny = rows + 2;
  const colS = grid.colS;

  const xs = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    const c = a + Math.min(Math.max(i - 1, 0), b - a);
    xs[i] = quant(colS[c]);
  }
  const ys = new Float64Array(ny);
  for (let j = 0; j < ny; j++) ys[j] = quant(rowZ(grid, Math.min(Math.max(j - 1, 0), rows - 1)));

  const val = new Float32Array(nx * ny); // relleno = 0
  for (let i = 1; i < nx - 1; i++) {
    const c = a + i - 1;
    for (let j = 1; j < ny - 1; j++) val[j * nx + i] = getField(c, j - 1);
  }

  const next = new Int32Array(nx * ny * 2).fill(-1);
  const starts = [];
  const edges = [0, 0, 0, 0];
  const ins = [false, false, false, false];

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v0 = val[j * nx + i];
      const v1 = val[j * nx + i + 1];
      const v2 = val[(j + 1) * nx + i + 1];
      const v3 = val[(j + 1) * nx + i];
      ins[0] = v0 > ISO;
      ins[1] = v1 > ISO;
      ins[2] = v2 > ISO;
      ins[3] = v3 > ISO;
      if (ins[0] === ins[1] && ins[1] === ins[2] && ins[2] === ins[3]) continue;
      // Aristas en orden antihorario: abajo, derecha, arriba, izquierda
      edges[0] = (j * nx + i) * 2;
      edges[1] = (j * nx + i + 1) * 2 + 1;
      edges[2] = ((j + 1) * nx + i) * 2;
      edges[3] = (j * nx + i) * 2 + 1;
      let exits = 0;
      for (let k = 0; k < 4; k++) if (ins[k] && !ins[(k + 1) & 3]) exits++;
      const connectNext = exits === 2 ? (v0 + v1 + v2 + v3) / 4 > ISO : true;
      for (let k = 0; k < 4; k++) {
        if (!(ins[k] && !ins[(k + 1) & 3])) continue; // arista de salida
        for (let step = 1; step < 4; step++) {
          const m = connectNext ? (k + step) & 3 : (k - step + 4) & 3;
          if (!ins[m] && ins[(m + 1) & 3]) { // arista de entrada
            next[edges[k]] = edges[m];
            starts.push(edges[k]);
            break;
          }
        }
      }
    }
  }

  const sLo = xs[0];
  const sHi = xs[nx - 1];
  const zLo = ys[0];
  const zHi = ys[ny - 1];
  const STEP = 1 / QUANT;

  const edgePoint = (id, out, o) => {
    const vert = id & 1;
    const cellIdx = id >> 1;
    const i = cellIdx % nx;
    const j = (cellIdx - i) / nx;
    const vp = val[j * nx + i];
    if (vert) {
      const vq = val[(j + 1) * nx + i];
      const t = (ISO - vp) / (vq - vp);
      out[o] = xs[i];
      let z = quant(ys[j] + t * (ys[j + 1] - ys[j]));
      if (ys[j] !== ys[j + 1]) {
        if (z === zLo) z = zLo + STEP;
        else if (z === zHi) z = zHi - STEP;
      }
      out[o + 1] = z;
    } else {
      const vq = val[j * nx + i + 1];
      const t = (ISO - vp) / (vq - vp);
      let s = quant(xs[i] + t * (xs[i + 1] - xs[i]));
      // Un punto interior nunca debe caer sobre el borde de la franja: la vecina no lo tendría.
      if (xs[i] !== xs[i + 1]) {
        if (s === sLo) s = sLo + STEP;
        else if (s === sHi) s = sHi - STEP;
      }
      out[o] = s;
      out[o + 1] = ys[j];
    }
  };

  const loops = [];
  const pt = [0, 0];
  for (const start of starts) {
    if (next[start] < 0) continue;
    const coords = [];
    let e = start;
    while (next[e] >= 0) {
      const n = next[e];
      next[e] = -1;
      edgePoint(e, pt, 0);
      const len = coords.length;
      if (len < 2 || coords[len - 2] !== pt[0] || coords[len - 1] !== pt[1]) coords.push(pt[0], pt[1]);
      e = n;
    }
    const clean = removeSpikes(coords);
    if (clean.length >= 6) loops.push(clean);
  }
  return loops;
}

/** Quita puntos repetidos consecutivos y "púas" (A → X → A) de un lazo cerrado. */
function removeSpikes(c) {
  let pts = [];
  for (let i = 0; i < c.length; i += 2) pts.push(i);
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    const out = [];
    const n = pts.length;
    const same = (p, q) => c[p] === c[q] && c[p + 1] === c[q + 1];
    for (let k = 0; k < n; k++) {
      const cur = pts[k];
      const prev = out.length ? out[out.length - 1] : pts[n - 1];
      if (same(prev, cur)) { changed = true; continue; }
      const nxt = pts[(k + 1) % n];
      if (same(prev, nxt)) { changed = true; k++; continue; }
      out.push(cur);
    }
    pts = out;
  }
  const res = [];
  for (const p of pts) res.push(c[p], c[p + 1]);
  return res;
}

function signedArea(c) {
  let a = 0;
  const n = c.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) a += (c[j] - c[i]) * (c[j + 1] + c[i + 1]);
  return a / 2;
}

function borderLines(c, bounds) {
  const { sA, sB, zMin, zMax } = bounds;
  const n = c.length / 2;
  const lines = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const s = c[2 * k];
    const z = c[2 * k + 1];
    let m = 0;
    if (s === sA) m |= 1;
    if (s === sB) m |= 2;
    if (z === zMin) m |= 4;
    if (z === zMax) m |= 8;
    lines[k] = m;
  }
  return lines;
}

/**
 * Quita los puntos intermedios de los tramos rectos sobre un mismo borde (de la
 * franja o de los extremos del tubo). La franja vecina hace exactamente lo mismo.
 */
export function reduceLoop(c, bounds) {
  const lines = borderLines(c, bounds);
  const n = lines.length;
  const out = [];
  for (let k = 0; k < n; k++) {
    const m = lines[k];
    if (m && (m & lines[(k + n - 1) % n] & lines[(k + 1) % n])) continue;
    out.push(c[2 * k], c[2 * k + 1]);
  }
  return out.length >= 6 ? out : [];
}

/** ¿El lazo toca algún borde? (si no, se puede descartar o simplificar libremente) */
export function touchesBorder(c, bounds) {
  return borderLines(c, bounds).some((m) => m !== 0);
}

/**
 * Simplifica (Douglas-Peucker) un lazo ya reducido. Los puntos sobre bordes son
 * fijos, así las franjas vecinas siguen coincidiendo.
 */
export function simplifyLoop(c, bounds, eps) {
  const lines = borderLines(c, bounds);
  const n = lines.length;
  const idx = [];
  for (let k = 0; k < n; k++) idx.push(k);
  if (n < 3) return c;

  const m = idx.length;
  const fixed = [];
  for (let q = 0; q < m; q++) if (lines[idx[q]]) fixed.push(q);
  if (fixed.length === 0) {
    // lazo interior: anclar en el primer punto y el más lejano
    const x0 = c[2 * idx[0]];
    const y0 = c[2 * idx[0] + 1];
    let far = 0;
    let best = -1;
    for (let q = 1; q < m; q++) {
      const d = (c[2 * idx[q]] - x0) ** 2 + (c[2 * idx[q] + 1] - y0) ** 2;
      if (d > best) { best = d; far = q; }
    }
    fixed.push(0, far);
  }

  const mark = new Uint8Array(m);
  for (const f of fixed) mark[f] = 1;
  const eps2 = eps * eps;
  const stack = [];
  for (let f = 0; f < fixed.length; f++) {
    const q0 = fixed[f];
    const q1 = f + 1 < fixed.length ? fixed[f + 1] : fixed[0] + m;
    // Si ambos extremos están sobre la misma línea de borde, el tramo intermedio
    // nunca puede colapsar sobre ese borde: la franja vecina no lo sabría.
    const sameBorder = (lines[idx[q0]] & lines[idx[q1 % m]]) !== 0;
    stack.push(q0, q1, sameBorder ? 1 : 0);
    while (stack.length) {
      const force = stack.pop();
      const hi = stack.pop();
      const lo = stack.pop();
      if (hi - lo < 2) continue;
      const p0 = idx[lo % m];
      const p1 = idx[hi % m];
      const ax = c[2 * p0];
      const ay = c[2 * p0 + 1];
      const dx = c[2 * p1] - ax;
      const dy = c[2 * p1 + 1] - ay;
      const L2 = dx * dx + dy * dy;
      let maxD = -1;
      let maxQ = -1;
      for (let q = lo + 1; q < hi; q++) {
        const p = idx[q % m];
        const px = c[2 * p] - ax;
        const py = c[2 * p + 1] - ay;
        let d2;
        if (L2 > 0) {
          const cr = px * dy - py * dx;
          d2 = (cr * cr) / L2;
        } else {
          d2 = px * px + py * py;
        }
        if (d2 > maxD) { maxD = d2; maxQ = q; }
      }
      if (maxD > eps2 || force) {
        mark[maxQ % m] = 1;
        stack.push(lo, maxQ, 0, maxQ, hi, 0);
      }
    }
  }
  const out = [];
  for (let q = 0; q < m; q++) if (mark[q]) out.push(c[2 * idx[q]], c[2 * idx[q] + 1]);
  // Contorno más pequeño que la tolerancia: se conserva sin simplificar.
  return out.length >= 6 ? out : c;
}

/**
 * ¿Algún par de segmentos de los anillos se cruza o se toca (sin contar los
 * consecutivos de un mismo anillo)? Usa una rejilla espacial.
 */
export function ringsIntersect(rings) {
  const segs = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let total = 0;
  for (let r = 0; r < rings.length; r++) {
    const c = rings[r];
    const n = c.length / 2;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const ax = c[2 * k], ay = c[2 * k + 1], bx = c[2 * k2], by = c[2 * k2 + 1];
      segs.push({ r, k, n, ax, ay, bx, by });
      total += Math.hypot(bx - ax, by - ay);
      if (ax < x0) x0 = ax;
      if (ax > x1) x1 = ax;
      if (ay < y0) y0 = ay;
      if (ay > y1) y1 = ay;
    }
  }
  if (segs.length < 4) return false;
  const h = Math.max(total / segs.length, 1e-6) * 2;
  const nx = Math.min(4096, Math.floor((x1 - x0) / h) + 1);
  const ny = Math.min(4096, Math.floor((y1 - y0) / h) + 1);
  const hx = (x1 - x0) / nx || 1;
  const hy = (y1 - y0) / ny || 1;
  const buckets = new Map();
  const orient = (ax, ay, bx, by, cx, cy) => {
    const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  };
  const onSeg = (ax, ay, bx, by, cx, cy) =>
    Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
  const cross = (p, q) => {
    if (p.r === q.r) {
      if (q.k === (p.k + 1) % p.n || p.k === (q.k + 1) % p.n) return false; // consecutivos
    }
    const o1 = orient(p.ax, p.ay, p.bx, p.by, q.ax, q.ay);
    const o2 = orient(p.ax, p.ay, p.bx, p.by, q.bx, q.by);
    const o3 = orient(q.ax, q.ay, q.bx, q.by, p.ax, p.ay);
    const o4 = orient(q.ax, q.ay, q.bx, q.by, p.bx, p.by);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSeg(p.ax, p.ay, p.bx, p.by, q.ax, q.ay)) return true;
    if (o2 === 0 && onSeg(p.ax, p.ay, p.bx, p.by, q.bx, q.by)) return true;
    if (o3 === 0 && onSeg(q.ax, q.ay, q.bx, q.by, p.ax, p.ay)) return true;
    if (o4 === 0 && onSeg(q.ax, q.ay, q.bx, q.by, p.bx, p.by)) return true;
    return false;
  };
  for (const p of segs) {
    const i0 = Math.max(0, Math.floor((Math.min(p.ax, p.bx) - x0) / hx));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(p.ax, p.bx) - x0) / hx));
    const j0 = Math.max(0, Math.floor((Math.min(p.ay, p.by) - y0) / hy));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(p.ay, p.by) - y0) / hy));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = j * nx + i;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        for (const q of list) if (cross(p, q)) return true;
        list.push(p);
      }
    }
  }
  return false;
}

function pointInLoop(c, x, y) {
  let inside = false;
  const n = c.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = c[i], yi = c[i + 1], xj = c[j], yj = c[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bbox(c) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < c.length; i += 2) {
    if (c[i] < x0) x0 = c[i];
    if (c[i] > x1) x1 = c[i];
    if (c[i + 1] < y0) y0 = c[i + 1];
    if (c[i + 1] > y1) y1 = c[i + 1];
  }
  return [x0, y0, x1, y1];
}

/** Agrupa lazos en polígonos {outer, holes[]}. */
export function groupLoops(loops) {
  const outers = [];
  const holes = [];
  for (const c of loops) {
    const a = signedArea(c);
    if (Math.abs(a) < 1e-12) continue;
    if (a > 0) outers.push({ c, area: a, box: bbox(c), holes: [] });
    else holes.push(c);
  }
  for (const h of holes) {
    const x = h[0];
    const y = h[1];
    let best = null;
    for (const o of outers) {
      const [x0, y0, x1, y1] = o.box;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (best && o.area >= best.area) continue;
      if (pointInLoop(o.c, x, y)) best = o;
    }
    if (best) best.holes.push(h);
  }
  return outers;
}

/**
 * Crea las funciones de mapeo (s, Z) → 3D para las caras exterior e interior.
 */
export function makeSurfaceMap(params, grid) {
  const outer = grid.profile;
  const inner = makeProfile(offsetShape(params.shape, params.thickness));
  const { zMin, zMax } = grid;
  const rimWall = Math.max(params.rimWall, 1e-6);
  const rimRoom = Math.max(params.rimRoom, 1e-6);
  const seam = quant(outer.perimeter);
  // La costura s = P es el mismo punto que s = 0
  const xyAt = (s) => outer.pointAt(s === seam ? 0 : s);

  const outerAt = (s, z, out, o) => {
    const [x, y] = xyAt(s);
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
  };
  const innerAt = (s, z, out, o) => {
    const [x, y] = xyAt(s);
    const lambda = inner.polarRadius(x, y) / Math.hypot(x, y);
    // En la zona de los aros se aplana el extremo para que asiente plano.
    let w = 0;
    if (z > zMax - rimWall) w = (z - (zMax - rimWall)) / rimWall;
    else if (z < zMin + rimRoom) w = (zMin + rimRoom - z) / rimRoom;
    w = w < 0 ? 0 : w > 1 ? 1 : w;
    out[o] = x * lambda;
    out[o + 1] = y * lambda;
    out[o + 2] = z * lambda + (z - z * lambda) * w;
  };
  return { outerAt, innerAt };
}

/**
 * Mallado de las franjas [stripFrom, stripTo). field contiene las columnas
 * desde fieldC0 (orden por columnas). Devuelve Float32Array de triángulos (9 floats c/u).
 */
export function meshStrips(params, grid, field, fieldC0, stripFrom, stripTo, { simplifyTol }) {
  const rows = grid.rows;
  const getField = (c, j) => field[(c - fieldC0) * rows + j];
  const { outerAt, innerAt } = makeSurfaceMap(params, grid);

  let out = new Float32Array(1 << 16);
  let n = 0;
  const ensure = (extra) => {
    if (n + extra <= out.length) return;
    let size = out.length * 2;
    while (size < n + extra) size *= 2;
    const bigger = new Float32Array(size);
    bigger.set(out.subarray(0, n));
    out = bigger;
  };
  const tri = (P, a, b, c) => {
    out[n++] = P[a]; out[n++] = P[a + 1]; out[n++] = P[a + 2];
    out[n++] = P[b]; out[n++] = P[b + 1]; out[n++] = P[b + 2];
    out[n++] = P[c]; out[n++] = P[c + 1]; out[n++] = P[c + 2];
  };

  for (let st = stripFrom; st < stripTo; st++) {
    const a = grid.strips[st];
    const b = grid.strips[st + 1];
    const bounds = { sA: quant(grid.colS[a]), sB: quant(grid.colS[b]), zMin: quant(grid.zMin), zMax: quant(grid.zMax) };
    const minArea = 0.5 * grid.cell * grid.cell;
    const loops = [];
    for (const raw of extractLoops(grid, getField, a, b)) {
      const c = reduceLoop(raw, bounds);
      if (c.length === 0) continue;
      // Contornos interiores más pequeños que media celda: ruido no imprimible
      if (Math.abs(signedArea(c)) < minArea && !touchesBorder(c, bounds)) continue;
      loops.push(c);
    }
    const polys = groupLoops(loops);

    for (const poly of polys) {
      // Simplificar; si la versión simplificada se cruza consigo misma, usar la exacta
      const simple = [poly.c, ...poly.holes].map((c) => simplifyLoop(c, bounds, simplifyTol));
      if (!ringsIntersect(simple)) {
        poly.c = simple[0];
        poly.holes = simple.slice(1);
      }
      const flat = poly.c.slice();
      const holeIdx = [];
      for (const h of poly.holes) {
        holeIdx.push(flat.length / 2);
        for (let k = 0; k < h.length; k++) flat.push(h[k]);
      }
      const nv = flat.length / 2;
      // Coordenadas locales para mejor precisión numérica en earcut
      const local = new Float64Array(flat.length);
      for (let k = 0; k < flat.length; k += 2) {
        local[k] = flat[k] - bounds.sA;
        local[k + 1] = flat[k + 1] - grid.zMin;
      }
      const raw = earcut(local, holeIdx, 2);

      // Vértices con coordenadas idénticas (contornos que se tocan) → un único índice
      const canon = new Int32Array(nv);
      const seen = new Map();
      for (let v = 0; v < nv; v++) {
        const key = flat[2 * v] + ',' + flat[2 * v + 1];
        const first = seen.get(key);
        if (first === undefined) { seen.set(key, v); canon[v] = v; } else canon[v] = first;
      }

      const tris = [];
      const edgeSet = new Set();
      for (let t = 0; t < raw.length; t += 3) {
        let i0 = canon[raw[t]], i1 = canon[raw[t + 1]], i2 = canon[raw[t + 2]];
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;
        const area = (local[2 * i1] - local[2 * i0]) * (local[2 * i2 + 1] - local[2 * i0 + 1])
          - (local[2 * i2] - local[2 * i0]) * (local[2 * i1 + 1] - local[2 * i0 + 1]);
        if (area < 0) { const tmp = i1; i1 = i2; i2 = tmp; }
        tris.push(i0, i1, i2);
        edgeSet.add(i0 * nv + i1).add(i1 * nv + i2).add(i2 * nv + i0);
      }

      const O = new Float64Array(nv * 3);
      const I = new Float64Array(nv * 3);
      for (let v = 0; v < nv; v++) {
        if (canon[v] !== v) continue;
        outerAt(flat[2 * v], flat[2 * v + 1], O, v * 3);
        innerAt(flat[2 * v], flat[2 * v + 1], I, v * 3);
      }

      ensure(tris.length * 6 + tris.length * 18);
      for (let t = 0; t < tris.length; t += 3) {
        const i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
        tri(O, i0 * 3, i1 * 3, i2 * 3);
        tri(I, i0 * 3, i2 * 3, i1 * 3);
      }

      // Paredes laterales: en cada arista del borde de la triangulación (la usa un
      // solo triángulo) salvo las que caen sobre el borde de la franja.
      for (let t = 0; t < tris.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const p = tris[t + e];
          const q = tris[t + ((e + 1) % 3)];
          if (edgeSet.has(q * nv + p)) continue;
          const ps = flat[2 * p], qs = flat[2 * q];
          if (ps === qs && (ps === bounds.sA || ps === bounds.sB)) continue;
          wall(O, I, p * 3, q * 3);
        }
      }
    }
  }
  return out.slice(0, n);

  function wall(Ov, Iv, p, q) {
    // cuadrilátero O(p) O(q) I(q) I(p), normal hacia fuera del material
    out[n++] = Ov[q]; out[n++] = Ov[q + 1]; out[n++] = Ov[q + 2];
    out[n++] = Ov[p]; out[n++] = Ov[p + 1]; out[n++] = Ov[p + 2];
    out[n++] = Iv[p]; out[n++] = Iv[p + 1]; out[n++] = Iv[p + 2];
    out[n++] = Ov[q]; out[n++] = Ov[q + 1]; out[n++] = Ov[q + 2];
    out[n++] = Iv[p]; out[n++] = Iv[p + 1]; out[n++] = Iv[p + 2];
    out[n++] = Iv[q]; out[n++] = Iv[q + 1]; out[n++] = Iv[q + 2];
  }
}
