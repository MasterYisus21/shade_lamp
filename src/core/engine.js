// Orquestación del motor: calidad, malla completa, validación de sombra y STL.

import { planGrid, computeField } from './field.js';
import { meshStrips } from './mesher.js';
import { makeAngleToArc } from './profile.js';
import { wallGap, partsLayout } from './parts.js';

// cell: tamaño de celda de muestreo (mm); chordTol: error máx. de cuerda en curvas;
// simplifyTol: desviación máx. al simplificar contornos (mm).
export const QUALITY = {
  draft: { cell: 0.6, chordTol: 0.05, simplifyTol: 0.05, label: 'Borrador' },
  low: { cell: 0.3, chordTol: 0.03, simplifyTol: 0.03, label: 'Baja' },
  medium: { cell: 0.15, chordTol: 0.02, simplifyTol: 0.015, label: 'Media' },
  high: { cell: 0.1, chordTol: 0.01, simplifyTol: 0.01, label: 'Alta' },
  ultra: { cell: 0.05, chordTol: 0.005, simplifyTol: 0.005, label: 'Ultra' },
};

const MAX_SAMPLES = 60e6;

/** Ajusta la celda para no exceder un número de muestras. */
export function resolveQuality(params, quality, maxSamples = MAX_SAMPLES) {
  const q = { ...QUALITY[quality] };
  const grid0 = planGrid(params, { cell: 1, chordTol: q.chordTol });
  const areaSamples = grid0.perimeter * params.height;
  const minCell = Math.sqrt(areaSamples / maxSamples);
  q.coarsened = minCell > q.cell;
  if (q.coarsened) q.cell = minCell;
  return q;
}

export function planForQuality(params, q) {
  return planGrid(params, { cell: q.cell, chordTol: q.chordTol });
}

/** Malla completa en un solo hilo (vista previa y pruebas). */
export function buildFull(params, image, q) {
  const grid = planForQuality(params, q);
  const field = computeField(params, grid, image, 0, grid.nCols - 1);
  const tris = meshStrips(params, grid, field, 0, 0, grid.strips.length - 1, q);
  return { grid, field, tris };
}

/** Malla de un rango de franjas (lo ejecuta cada worker en la exportación). */
export function buildChunk(params, image, q, stripFrom, stripTo) {
  const grid = planForQuality(params, q);
  const c0 = grid.strips[stripFrom];
  const c1 = grid.strips[stripTo];
  const field = computeField(params, grid, image, c0, c1);
  return meshStrips(params, grid, field, c0, stripFrom, stripTo, q);
}

/**
 * Traza la luz sobre la pared usando el mismo campo con el que se genera la malla.
 * Devuelve una máscara size×size (255 = luz) que cubre [-half, half]² mm, fila 0 abajo
 * (Y = -half), igual que DataTexture de three.js.
 */
export function wallLightMap(params, grid, field, size, half) {
  const mask = new Uint8Array(size * size);
  const profile = grid.profile;
  const toArc = makeAngleToArc(profile);
  const { rows, zMin, dz, colS, nCols } = grid;
  const D = params.distance;
  const N = nCols - 1;
  // El poste (si existe) tapa los rayos que salen hacia la pared casi en el eje
  const postK = params.parts && params.parts.enabled
    ? partsLayout(params).p.postOuterRadius / Math.max(params.bulbRadius || 0, 1e-3)
    : 0;

  const colAt = (s) => {
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (colS[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo + (s - colS[lo]) / (colS[hi] - colS[lo]);
  };

  for (let py = 0; py < size; py++) {
    const Y = -half + ((py + 0.5) / size) * 2 * half;
    for (let px = 0; px < size; px++) {
      const X = -half + ((px + 0.5) / size) * 2 * half;
      const rho = Math.hypot(X, Y);
      if (rho < 1e-9) continue;
      const ro = profile.polarRadius(X, Y);
      if (rho <= ro) continue; // detrás de la base de la lámpara
      if (rho / D < postK) continue; // sombra del poste
      const Z = (D * ro) / rho;
      const fr = (Z - zMin) / dz;
      if (fr < 0 || fr > rows - 1) continue;
      const fc = colAt(toArc(X, Y));
      const c0 = Math.min(Math.floor(fc), N - 1);
      const r0 = Math.min(Math.floor(fr), rows - 2);
      const tc = fc - c0;
      const tr = fr - r0;
      const f00 = field[c0 * rows + r0];
      const f01 = field[c0 * rows + r0 + 1];
      const f10 = field[(c0 + 1) * rows + r0];
      const f11 = field[(c0 + 1) * rows + r0 + 1];
      const g = (f00 + (f01 - f00) * tr) * (1 - tc) + (f10 + (f11 - f10) * tr) * tc;
      if (g <= 0.5) mask[py * size + px] = 255;
    }
  }
  return mask;
}

/** Semilado de la pared que conviene mostrar para la imagen actual (mm). */
export function wallHalfExtent(params) {
  const im = params.image;
  const r = Math.hypot(Math.abs(im.offsetX) + im.scaleX / 2, Math.abs(im.offsetY) + im.scaleY / 2);
  return Math.min(1000, Math.max(r * 1.05, 50));
}

/**
 * Lleva la malla al marco de impresión: extremo del lado de la pared en Z = 0 y
 * la pantalla hacia +Z (rotación de 180° sobre X, conserva la orientación).
 */
export function toPrintFrame(tris, params) {
  const out = new Float32Array(tris.length);
  const D = params.distance - wallGap(params);
  for (let i = 0; i < tris.length; i += 3) {
    out[i] = tris[i];
    out[i + 1] = -tris[i + 1];
    out[i + 2] = D - tris[i + 2];
  }
  return out;
}

/** STL binario a partir de una lista de triángulos (9 floats por triángulo). */
export function writeBinaryStl(chunks, header = 'shade_lamp') {
  const list = Array.isArray(chunks) ? chunks : [chunks];
  let triCount = 0;
  for (const c of list) triCount += c.length / 9;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  for (let i = 0; i < Math.min(80, header.length); i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, triCount, true);
  let o = 84;
  for (const t of list) {
    for (let i = 0; i < t.length; i += 9) {
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
      const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      view.setFloat32(o, nx, true);
      view.setFloat32(o + 4, ny, true);
      view.setFloat32(o + 8, nz, true);
      o += 12;
      for (let k = 0; k < 9; k++) {
        view.setFloat32(o, t[i + k], true);
        o += 4;
      }
      view.setUint16(o, 0, true);
      o += 2;
    }
  }
  return buf;
}
