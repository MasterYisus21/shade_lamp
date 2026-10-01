// Sólidos "escalonados": caras horizontales y paredes verticales a partir de
// anillos 2D (contornos muestreados). Lo usan las piezas complementarias.

import earcut from 'earcut';
import { makeProfile } from './profile.js';

const TOL = 0.01; // error de cuerda al muestrear curvas (mm)

function validShape(shape) {
  if (shape.type === 'cylinder') return shape.radius > 0.05;
  return shape.width > 0.1 && shape.depth > 0.1;
}

/** Contorno (antihorario) de un perfil, muestreado con tolerancia de cuerda. */
export function shapeRing(shape) {
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

export const circleRing = (cx, cy, r) => shapeRing({ type: 'cylinder', radius: r }).map((v, i) => v + (i % 2 ? cy : cx));

/** Acumula triángulos de un sólido hecho de caras horizontales y paredes verticales. */
export function solidBuilder() {
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
