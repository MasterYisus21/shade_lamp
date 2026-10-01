// Piezas complementarias: base (lado pared), tapa (lado habitación) y poste del
// bombillo. Cada una es un sólido "escalonado": capas extruidas de anillos 2D,
// construido de forma que la malla quede cerrada.
//
// Encastre: base y tapa llevan un labio que entra en la pantalla con una holgura
// (clearance). La base además tiene un zócalo para el poste y un agujero para el
// cable; el poste es un tubo hueco que sostiene el bombillo.

import earcut from 'earcut';
import { makeProfile, offsetShape } from './profile.js';

const TOL = 0.01; // error de cuerda al muestrear curvas (mm)

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

/** Separación entre la pantalla y la pared (la ocupa la base). */
export const wallGap = (params) => (params.parts && params.parts.enabled ? params.parts.baseThickness : 0);

function validShape(shape) {
  if (shape.type === 'cylinder') return shape.radius > 0.05;
  return shape.width > 0.1 && shape.depth > 0.1;
}

/** Contorno (antihorario) de un perfil, muestreado con tolerancia de cuerda. */
function shapeRing(shape) {
  if (!validShape(shape)) return null;
  const profile = makeProfile(shape);
  const pts = [];
  for (const seg of profile.segments) {
    if (seg.type === 'line') {
      pts.push(seg.x0, seg.y0);
    } else {
      const maxAng = TOL >= seg.r ? Math.PI / 4 : 2 * Math.acos(1 - TOL / seg.r);
      const ang = seg.len / seg.r;
      const n = Math.max(1, Math.ceil(ang / maxAng));
      for (let k = 0; k < n; k++) {
        const a = seg.a0 + (ang * k) / n;
        pts.push(seg.cx + seg.r * Math.cos(a), seg.cy + seg.r * Math.sin(a));
      }
    }
  }
  // Sin puntos colineales: earcut los descartaría y las paredes no coincidirían
  const out = [];
  const n = pts.length / 2;
  for (let k = 0; k < n; k++) {
    const p = (k + n - 1) % n;
    const q = (k + 1) % n;
    const cross = (pts[2 * k] - pts[2 * p]) * (pts[2 * q + 1] - pts[2 * p + 1])
      - (pts[2 * k + 1] - pts[2 * p + 1]) * (pts[2 * q] - pts[2 * p]);
    if (Math.abs(cross) > 1e-9) out.push(pts[2 * k], pts[2 * k + 1]);
  }
  return out;
}

const circleRing = (cx, cy, r) => shapeRing({ type: 'cylinder', radius: r }).map((v, i) => v + (i % 2 ? cy : cx));

/** Acumula triángulos de un sólido hecho de caras horizontales y paredes verticales. */
function solidBuilder() {
  const out = [];
  return {
    /** Cara horizontal a altura h. up = normal hacia +h. */
    face(h, outer, holes, up) {
      const flat = outer.slice();
      const idx = [];
      for (const hole of holes) {
        idx.push(flat.length / 2);
        for (const v of hole) flat.push(v);
      }
      const tris = earcut(flat, idx, 2);
      for (let t = 0; t < tris.length; t += 3) {
        let a = tris[t], b = tris[t + 1], c = tris[t + 2];
        const area = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1])
          - (flat[2 * c] - flat[2 * a]) * (flat[2 * b + 1] - flat[2 * a + 1]);
        if ((area < 0) === up) { const tmp = b; b = c; c = tmp; }
        out.push(flat[2 * a], flat[2 * a + 1], h, flat[2 * b], flat[2 * b + 1], h, flat[2 * c], flat[2 * c + 1], h);
      }
    },
    /** Pared vertical a lo largo de un anillo antihorario. solidInside: el material está dentro del anillo. */
    wall(ring, h0, h1, solidInside) {
      const n = ring.length / 2;
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        let ax = ring[2 * k], ay = ring[2 * k + 1], bx = ring[2 * k2], by = ring[2 * k2 + 1];
        if (!solidInside) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
        out.push(ax, ay, h0, bx, by, h0, bx, by, h1);
        out.push(ax, ay, h0, bx, by, h1, ax, ay, h1);
      }
    },
    result: () => Float32Array.from(out),
  };
}

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
  const capT = { ...DEFAULT_PARTS, ...params.parts }.capThickness;
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

export function buildAllParts(params) {
  return { base: buildBase(params), cap: buildCap(params), post: buildPost(params) };
}
