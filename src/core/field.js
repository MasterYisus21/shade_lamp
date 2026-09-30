// Malla de muestreo sobre la superficie de la pantalla y campo "sólido/hueco".
//
// Coordenadas del mundo (mm): bombillo en el origen, pared en Z = distance.
// La pantalla ocupa Z ∈ [distance - height, distance]; el extremo Z = distance
// toca la pared. La superficie se desenrolla en 2D como (s, Z), donde s es la
// longitud de arco sobre el perfil.
//
// El campo g(s, Z) ∈ [0, 1] vale > 0.5 donde hay material. Las rampas son de
// una celda de ancho para que marching squares ubique los bordes con precisión.

import { makeProfile } from './profile.js';

export function planGrid(params, { cell, chordTol = 0.01, maxStripLen = 40 }) {
  const profile = makeProfile(params.shape);
  const P = profile.perimeter;

  const colS = [];
  const stripStarts = [];
  const minGap = cell * 0.4;
  for (const seg of profile.segments) {
    const n = Math.max(1, Math.ceil(seg.len / cell));
    const step = seg.len / n;
    let maxLen = maxStripLen;
    if (seg.type === 'arc') {
      // Longitud máxima de arco para que la cuerda no se separe más de chordTol.
      const r = seg.r;
      const ang = chordTol >= r ? Math.PI / 2 : 2 * Math.acos(1 - chordTol / r);
      maxLen = Math.min(maxLen, r * ang);
    }
    const colsPerStrip = Math.max(1, Math.floor(maxLen / step + 1e-9));
    for (let k = 0; k < n; k++) {
      const s = seg.s0 + k * step;
      // Segmentos diminutos (p. ej. un lado casi nulo de la caja) no crean columnas pegadas
      if (colS.length && s - colS[colS.length - 1] < minGap) continue;
      if (k % colsPerStrip === 0 || stripStarts.length === 0) stripStarts.push(colS.length);
      colS.push(s);
    }
  }
  if (colS.length > 1 && P - colS[colS.length - 1] < minGap) {
    colS.pop();
    if (stripStarts[stripStarts.length - 1] === colS.length) stripStarts.pop();
  }
  const N = colS.length; // la columna N es la costura (s = P ≡ 0)
  colS.push(P);
  stripStarts.push(N);

  const colX = new Float64Array(N + 1);
  const colY = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    const [x, y] = profile.pointAt(colS[i]);
    colX[i] = x;
    colY[i] = y;
  }
  colX[N] = colX[0];
  colY[N] = colY[0];

  const zMax = params.distance;
  const zMin = params.distance - params.height;
  const rows = Math.max(2, Math.ceil(params.height / cell) + 1);
  const dz = params.height / (rows - 1);

  return {
    profile,
    perimeter: P,
    cell,
    colS: Float64Array.from(colS),
    colX,
    colY,
    nCols: N + 1,
    rows,
    zMin,
    zMax,
    dz,
    strips: Int32Array.from(stripStarts), // límites de franja (índices de columna)
  };
}

export function rowZ(grid, j) {
  return j === grid.rows - 1 ? grid.zMax : grid.zMin + j * grid.dz;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Crea la función que evalúa el campo g en un punto de la superficie exterior.
 * @param image {lum: Uint8Array, width, height} luminancia 0..255 (fondo transparente = blanco)
 */
export function makeFieldSampler(params, grid, image) {
  const { distance: D } = params;
  const img = params.image;
  const rot = (img.rotation * Math.PI) / 180;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const invSX = 1 / (img.scaleX || 1);
  const invSY = 1 / (img.scaleY || 1);
  const { lum, width: iw, height: ih } = image;
  const cell = grid.cell;
  const P = grid.perimeter;

  const rimWall = params.rimWall;
  const rimRoom = params.rimRoom;
  const zMax = grid.zMax;
  const zMin = grid.zMin;

  const br = params.bridges;
  const bridgeType = br ? br.type : 'none';
  const halfW = br ? br.width / 2 : 0;
  const spacing = br ? Math.max(br.spacing, br.width * 2) : 1;
  const periodS = P / Math.max(1, Math.round(P / spacing));
  const periodD = P / Math.max(1, Math.round(P / (spacing * Math.SQRT2)));
  const useV = bridgeType === 'vertical' || bridgeType === 'grid';
  const useH = bridgeType === 'horizontal' || bridgeType === 'grid';
  const useD1 = bridgeType === 'diagonal_45' || bridgeType === 'diagonal_cross';
  const useD2 = bridgeType === 'diagonal_neg45' || bridgeType === 'diagonal_cross';

  const lumAt = (px, py) => {
    // Bilineal con centros de píxel en enteros y borde extendido.
    const fx = px < 0 ? 0 : px > iw - 1 ? iw - 1 : px;
    const fy = py < 0 ? 0 : py > ih - 1 ? ih - 1 : py;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = x0 + 1 < iw ? x0 + 1 : x0;
    const y1 = y0 + 1 < ih ? y0 + 1 : y0;
    const tx = fx - x0;
    const ty = fy - y0;
    const a = lum[y0 * iw + x0];
    const b = lum[y0 * iw + x1];
    const c = lum[y1 * iw + x0];
    const d = lum[y1 * iw + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };

  const periodicDist = (q, period) => {
    let m = q - Math.floor(q / period) * period;
    if (m > period - m) m = period - m;
    return m;
  };

  /** g en la columna (s, x, y) y altura Z. */
  return (s, x, y, Z) => {
    let g;
    if (Z <= 1e-6) {
      g = 1; // detrás del plano del bombillo: la luz nunca llega a la pared
    } else {
      const k = D / Z;
      const tx = x * k - img.offsetX;
      const ty = y * k - img.offsetY;
      const lx = (tx * cosR - ty * sinR) * invSX;
      const ly = (tx * sinR + ty * cosR) * invSY;
      if (lx < -0.5 || lx > 0.5 || ly < -0.5 || ly > 0.5) {
        g = 1; // fuera de la imagen: sombra
      } else {
        const fx = img.flipX ? lx : -lx;
        const fy = img.flipY ? -ly : ly;
        const v = lumAt((fx + 0.5) * iw - 0.5, (0.5 - fy) * ih - 0.5) / 255;
        g = img.invert ? 1 - v : v;
      }
    }

    // Aros sólidos en ambos extremos.
    if (rimWall > 0) g = Math.max(g, clamp01(0.5 + (rimWall - (zMax - Z)) / cell));
    if (rimRoom > 0) g = Math.max(g, clamp01(0.5 + (rimRoom - (Z - zMin)) / cell));

    if (bridgeType !== 'none' && g < 1) {
      const v = zMax - Z; // distancia desde la pared a lo largo del eje
      let d = Infinity;
      if (useV) d = Math.min(d, periodicDist(s, periodS));
      if (useH) d = Math.min(d, periodicDist(v, spacing));
      if (useD1) d = Math.min(d, periodicDist(s - v, periodD) / Math.SQRT2);
      if (useD2) d = Math.min(d, periodicDist(s + v, periodD) / Math.SQRT2);
      g = Math.max(g, clamp01(0.5 + (halfW - d) / cell));
    }
    return g;
  };
}

/**
 * Evalúa el campo para las columnas [c0, c1] (inclusive). Orden por columnas:
 * field[(c - c0) * rows + j].
 */
export function computeField(params, grid, image, c0, c1) {
  const sample = makeFieldSampler(params, grid, image);
  const { rows } = grid;
  const out = new Float32Array((c1 - c0 + 1) * rows);
  const N = grid.nCols - 1;
  // Ninguna muestra queda a menos de delta del umbral: así cada punto de contorno
  // está al menos ~2 µm de cualquier muestra y dos puntos distintos nunca se
  // funden al redondear (el borde se desplaza como mucho un 2 % de celda).
  const delta = Math.min(0.1, Math.max(0.002 / grid.cell, 1e-4));
  const lo = Math.fround(0.5 - delta);
  const hi = Math.fround(0.5 + delta);
  for (let c = c0; c <= c1; c++) {
    const s = c === N ? 0 : grid.colS[c];
    const x = grid.colX[c];
    const y = grid.colY[c];
    const base = (c - c0) * rows;
    for (let j = 0; j < rows; j++) {
      let v = Math.fround(sample(s, x, y, rowZ(grid, j)));
      if (v > lo && v < hi) v = v > 0.5 ? hi : lo;
      out[base + j] = v;
    }
  }
  return out;
}
