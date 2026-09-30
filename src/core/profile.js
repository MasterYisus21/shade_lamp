// Perfil (sección transversal) de la pantalla, parametrizado por longitud de arco.
// Todas las medidas en mm. El perfil empieza en (0, -b) (costura abajo) y recorre
// en sentido antihorario visto desde +Z.

const TAU = Math.PI * 2;

function roundedRectSegments(width, depth, cornerRadius) {
  const a = width / 2;
  const b = depth / 2;
  const c = Math.max(0, Math.min(cornerRadius, a, b));
  const ax = a - c;
  const by = b - c;
  const quarter = (c * Math.PI) / 2;
  const raw = [
    { type: 'line', x0: 0, y0: -b, x1: ax, y1: -b },
    { type: 'arc', cx: ax, cy: -by, r: c, a0: -Math.PI / 2, len: quarter },
    { type: 'line', x0: a, y0: -by, x1: a, y1: by },
    { type: 'arc', cx: ax, cy: by, r: c, a0: 0, len: quarter },
    { type: 'line', x0: ax, y0: b, x1: -ax, y1: b },
    { type: 'arc', cx: -ax, cy: by, r: c, a0: Math.PI / 2, len: quarter },
    { type: 'line', x0: -a, y0: by, x1: -a, y1: -by },
    { type: 'arc', cx: -ax, cy: -by, r: c, a0: Math.PI, len: quarter },
    { type: 'line', x0: -ax, y0: -b, x1: 0, y1: -b },
  ];
  for (const seg of raw) {
    if (seg.type === 'line') seg.len = Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);
  }
  return raw.filter((seg) => seg.len > 1e-9);
}

/**
 * @param {{type:'cylinder', radius:number} | {type:'box', width:number, depth:number, cornerRadius:number}} shape
 */
export function makeProfile(shape) {
  const segments = shape.type === 'cylinder'
    ? [{ type: 'arc', cx: 0, cy: 0, r: shape.radius, a0: -Math.PI / 2, len: TAU * shape.radius }]
    : roundedRectSegments(shape.width, shape.depth, shape.cornerRadius);

  let acc = 0;
  for (const seg of segments) {
    seg.s0 = acc;
    acc += seg.len;
  }
  const perimeter = acc;

  const findSegment = (s) => {
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].s0 <= s) lo = mid;
      else hi = mid - 1;
    }
    return segments[lo];
  };

  /** Punto del perfil en la longitud de arco s (con envoltura periódica). */
  const pointAt = (s) => {
    let t = s;
    if (t >= perimeter || t < 0) t = t - Math.floor(t / perimeter) * perimeter;
    if (t >= perimeter) t = 0;
    const seg = findSegment(t);
    const d = t - seg.s0;
    if (seg.type === 'line') {
      const f = d / seg.len;
      return [seg.x0 + (seg.x1 - seg.x0) * f, seg.y0 + (seg.y1 - seg.y0) * f];
    }
    const ang = seg.a0 + d / seg.r;
    return [seg.cx + seg.r * Math.cos(ang), seg.cy + seg.r * Math.sin(ang)];
  };

  /** Distancia desde el origen hasta el perfil en la dirección (dx, dy). */
  const polarRadius = shape.type === 'cylinder'
    ? () => shape.radius
    : (dx, dy) => polarRadiusRoundedRect(dx, dy, shape.width / 2, shape.depth / 2, shape.cornerRadius);

  return { shape, segments, perimeter, pointAt, polarRadius };
}

function polarRadiusRoundedRect(dx, dy, a, b, cr) {
  const c = Math.max(0, Math.min(cr, a, b));
  const len = Math.hypot(dx, dy);
  const vx = Math.abs(dx) / len;
  const vy = Math.abs(dy) / len;
  const tx = vx > 1e-15 ? a / vx : Infinity;
  const ty = vy > 1e-15 ? b / vy : Infinity;
  if (tx <= ty) {
    if (tx * vy <= b - c + 1e-12) return tx;
  } else if (ty * vx <= a - c + 1e-12) {
    return ty;
  }
  // Intersección con el arco de esquina (centro (a-c, b-c), radio c)
  const cx = a - c;
  const cy = b - c;
  const B = vx * cx + vy * cy;
  const C = cx * cx + cy * cy - c * c;
  const disc = B * B - C;
  return B + Math.sqrt(Math.max(0, disc));
}

/** Perfil interior desplazado hacia dentro un grosor t. */
export function offsetShape(shape, t) {
  if (shape.type === 'cylinder') return { type: 'cylinder', radius: shape.radius - t };
  return {
    type: 'box',
    width: shape.width - 2 * t,
    depth: shape.depth - 2 * t,
    cornerRadius: Math.max(0, shape.cornerRadius - t),
  };
}

/**
 * Tabla para invertir el perfil: dado un ángulo polar devuelve la longitud de arco.
 * El perfil es convexo y rodea el origen, así que el ángulo es monótono con s.
 */
export function makeAngleToArc(profile, samples = 8192) {
  const psi = new Float64Array(samples + 1);
  const arc = new Float64Array(samples + 1);
  for (let k = 0; k <= samples; k++) {
    const s = (k / samples) * profile.perimeter;
    const [x, y] = k === samples ? profile.pointAt(0) : profile.pointAt(s);
    let a = Math.atan2(y, x) + Math.PI / 2;
    a -= Math.floor(a / TAU) * TAU;
    if (k === samples) a = TAU;
    else if (k === 0) a = 0;
    psi[k] = a;
    arc[k] = s;
  }
  return (dx, dy) => {
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    a -= Math.floor(a / TAU) * TAU;
    let lo = 0;
    let hi = samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (psi[mid] <= a) lo = mid;
      else hi = mid;
    }
    const span = psi[hi] - psi[lo];
    const f = span > 0 ? (a - psi[lo]) / span : 0;
    return arc[lo] + (arc[hi] - arc[lo]) * f;
  };
}
