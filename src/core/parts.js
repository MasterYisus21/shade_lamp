// Piezas complementarias: base (lado pared), tapa (lado habitación) y poste del
// bombillo. Cada una es un sólido "escalonado": capas extruidas de anillos 2D,
// construido de forma que la malla quede cerrada.
//
// Encastre: base y tapa llevan un labio que entra en la pantalla con una holgura
// (clearance). La base además tiene un zócalo para el poste y un agujero para el
// cable; el poste es un tubo hueco que sostiene el bombillo.

import { makeProfile, offsetShape } from './profile.js';
import { shapeRing, circleRing, solidBuilder } from './solid.js';

export const DEFAULT_PARTS = {
  enabled: true,
  baseThickness: 3,
  capThickness: 2,
  clearance: 0.2,
  lipLength: 5,
  lipWall: 1.6,
  postOuterRadius: 3,
  cableRadius: 2,
  socketHeight: 8,
  socketWall: 2,
  screwHoleRadius: 2,
};

/**
 * Tapa: 'plain' es un disco liso; 'litho' una litofanía por capas (ver lithocap.js).
 * Litofanía: base + levels escalones de step mm; size, offsetX/Y (mm) y rotation (°)
 * colocan la imagen vista desde la habitación; margin es la zona segura entre el
 * labio y la litofanía; minFeature, el detalle más pequeño que se conserva.
 */
export const DEFAULT_CAP = {
  mode: 'plain',
  size: 40,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  invert: false,
  levels: 6,
  base: 0.6,
  step: 0.4,
  margin: 2,
  minFeature: 0.8,
};

export const capSettings = (params) => ({ ...DEFAULT_CAP, ...(params.parts && params.parts.cap) });

/** Grosor total de la tapa (mm): el disco liso o el aro de la litofanía. */
export function capThickness(params) {
  const cap = capSettings(params);
  if (cap.mode === 'litho') return cap.base + cap.levels * cap.step;
  return { ...DEFAULT_PARTS, ...params.parts }.capThickness;
}

/** Separación entre la pantalla y la pared (la ocupa la base). */
export const wallGap = (params) => (params.parts && params.parts.enabled ? params.parts.baseThickness : 0);

/** Geometría y medidas derivadas de los parámetros (todo en mm). */
export function partsLayout(params) {
  const p = { ...DEFAULT_PARTS, ...params.parts };
  const t = params.thickness;
  const c = p.clearance;
  const lipOuterShape = offsetShape(params.shape, t + c);
  const lipInnerShape = offsetShape(params.shape, t + c + p.lipWall);
  const outer = shapeRing(params.shape);
  const lipOuter = shapeRing(lipOuterShape);
  const lipInner = shapeRing(lipInnerShape);

  const socketInnerR = p.postOuterRadius + c;
  const socketOuterR = socketInnerR + p.socketWall;
  const cableR = Math.min(p.cableRadius, p.postOuterRadius - 0.8);

  // El poste va desde la base hasta tocar el bombillo
  const zMax = params.distance - p.baseThickness; // cara interior de la base
  const bulbR = params.bulbRadius || 0;
  const postLength = zMax - bulbR;
  const socketHeight = Math.max(1, Math.min(p.socketHeight, postLength - 2));

  // Agujeros para tornillos entre el zócalo y el labio, sobre el eje X
  let screws = [];
  if (lipInner) {
    const lipInnerX = makeProfile(lipInnerShape).polarRadius(1, 0);
    const d = (socketOuterR + lipInnerX) / 2;
    if (d - p.screwHoleRadius - 1.5 > socketOuterR && d + p.screwHoleRadius + 1.5 < lipInnerX) {
      screws = [circleRing(d, 0, p.screwHoleRadius), circleRing(-d, 0, p.screwHoleRadius)];
    }
  }
  const innerOk = !!lipInner && socketOuterR + 1 < Math.min(
    makeProfile(lipInnerShape).polarRadius(1, 0),
    makeProfile(lipInnerShape).polarRadius(0, 1),
  );
  return { p, outer, lipOuter, lipInner, socketInnerR, socketOuterR, cableR, postLength, socketHeight, screws, innerOk, zMax };
}

/**
 * Base en su propio marco (h = 0 contra la pared, labio y zócalo hacia +h).
 * Es también su orientación de impresión.
 */
export function buildBase(params) {
  const L = partsLayout(params);
  const { p } = L;
  const b = solidBuilder();
  const T = p.baseThickness;
  const cable = circleRing(0, 0, L.cableR);
  const socketIn = circleRing(0, 0, L.socketInnerR);
  const socketOut = circleRing(0, 0, L.socketOuterR);

  b.face(0, L.outer, [cable, ...L.screws], false);
  b.wall(L.outer, 0, T, true);
  b.wall(cable, 0, T, false);
  for (const s of L.screws) b.wall(s, 0, T, false);

  if (L.innerOk) {
    // Cara superior del disco: anillo exterior, zona entre labio y zócalo, fondo del zócalo
    b.face(T, L.outer, [L.lipOuter], true);
    b.face(T, L.lipInner, [socketOut, ...L.screws], true);
    b.face(T, socketIn, [cable], true);
    // Labio
    b.wall(L.lipOuter, T, T + p.lipLength, true);
    b.wall(L.lipInner, T, T + p.lipLength, false);
    b.face(T + p.lipLength, L.lipOuter, [L.lipInner], true);
    // Zócalo del poste
    b.wall(socketOut, T, T + L.socketHeight, true);
    b.wall(socketIn, T, T + L.socketHeight, false);
    b.face(T + L.socketHeight, socketOut, [socketIn], true);
  } else {
    // Lámpara demasiado pequeña para labio y zócalo: disco simple
    b.face(T, L.outer, [cable, ...L.screws], true);
  }
  return b.result();
}

/** Tapa en su propio marco (h = 0 cara exterior, labio hacia +h). */
export function buildCap(params) {
  const L = partsLayout(params);
  const { p } = L;
  const b = solidBuilder();
  const T = p.capThickness;
  b.face(0, L.outer, [], false);
  b.wall(L.outer, 0, T, true);
  if (L.lipInner) {
    b.face(T, L.outer, [L.lipOuter], true);
    b.face(T, L.lipInner, [], true);
    b.wall(L.lipOuter, T, T + p.lipLength, true);
    b.wall(L.lipInner, T, T + p.lipLength, false);
    b.face(T + p.lipLength, L.lipOuter, [L.lipInner], true);
  } else {
    b.face(T, L.outer, [], true);
  }
  return b.result();
}

/** Poste hueco en su propio marco (h = 0 apoyado en la base). */
export function buildPost(params) {
  const L = partsLayout(params);
  const b = solidBuilder();
  const outer = circleRing(0, 0, L.p.postOuterRadius);
  const inner = circleRing(0, 0, L.cableR);
  const H = Math.max(1, L.postLength);
  b.face(0, outer, [inner], false);
  b.face(H, outer, [inner], true);
  b.wall(outer, 0, H, true);
  b.wall(inner, 0, H, false);
  return b.result();
}

/**
 * Lleva una pieza de su marco local al mundo (bombillo en el origen, pared en
 * Z = distance). Base y poste giran 180° sobre X (conserva la orientación).
 */
export function partToWorld(tris, kind, params) {
  const out = new Float32Array(tris.length);
  const D = params.distance;
  const gap = wallGap(params);
  const zMin = D - gap - params.height;
  const capT = capThickness(params);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], h = tris[i + 2];
    if (kind === 'cap') {
      out[i] = x; out[i + 1] = y; out[i + 2] = zMin - capT + h;
    } else {
      const top = kind === 'base' ? D : D - gap;
      out[i] = x; out[i + 1] = -y; out[i + 2] = top - h;
    }
  }
  return out;
}

/** Base, tapa lisa y poste (la tapa litofanía se construye en lithocap.js). */
export function buildAllParts(params) {
  return { base: buildBase(params), cap: buildCap(params), post: buildPost(params) };
}
