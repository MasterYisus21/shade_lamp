// Verificación del motor sin navegador: node scripts/check-mesh.mjs [calidad]
// Comprueba que la malla sea cerrada (cada arista compartida por exactamente dos
// triángulos con sentidos opuestos) y que el volumen sea positivo.

import { buildFull, QUALITY, resolveQuality, writeBinaryStl, toPrintFrame, wallLightMap, buildChunk } from '../src/core/engine.js';
import { planGrid } from '../src/core/field.js';
import { buildAllParts, partsLayout, DEFAULT_PARTS } from '../src/core/parts.js';
import { makeProfile, offsetShape } from '../src/core/profile.js';

const quality = process.argv[2] || 'medium';

function makeImage(kind, size = 512) {
  const lum = new Uint8Array(size * size).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size - 0.5;
      const v = y / size - 0.5;
      let ink = false;
      if (kind === 'cross') ink = Math.abs(u) < 0.08 || Math.abs(v) < 0.08;
      if (kind === 'rings') {
        const r = Math.hypot(u, v);
        ink = (r > 0.1 && r < 0.2) || (r > 0.3 && r < 0.4) || (Math.abs(u - 0.3) < 0.03 && Math.abs(v + 0.3) < 0.03);
      }
      if (kind === 'blobs') {
        const f = Math.sin(u * 40) * Math.cos(v * 33) + Math.sin((u + v) * 25);
        ink = f > 0.6;
      }
      if (ink) lum[y * size + x] = 0;
    }
  }
  return { lum, width: size, height: size };
}

function baseParams(overrides = {}) {
  return {
    shape: { type: 'cylinder', radius: 30 },
    thickness: 2,
    height: 100,
    distance: 70,
    rimWall: 2,
    rimRoom: 2,
    image: { offsetX: 0, offsetY: 0, scaleX: 400, scaleY: 400, rotation: 0, flipX: false, flipY: false, invert: false },
    bridges: { type: 'none', width: 1, spacing: 20 },
    ...overrides,
  };
}

function checkManifold(tris) {
  const bits = new Uint32Array(tris.buffer, tris.byteOffset, tris.length);
  const key = (i) => `${bits[i]},${bits[i + 1]},${bits[i + 2]}`;
  const directed = new Map();
  let degenerate = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const k = [key(t), key(t + 3), key(t + 6)];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) { degenerate++; continue; }
    for (let e = 0; e < 3; e++) {
      const dk = k[e] + '>' + k[(e + 1) % 3];
      directed.set(dk, (directed.get(dk) || 0) + 1);
    }
  }
  // bad: aristas abiertas (sin su pareja en sentido contrario) → agujero en la malla
  // pinch: aristas cerradas pero compartidas por más de dos caras (no-manifold leve)
  let bad = 0;
  let pinch = 0;
  const samples = [];
  for (const [dk, count] of directed) {
    const [a, b] = dk.split('>');
    const back = directed.get(b + '>' + a) || 0;
    if (count !== back) {
      bad++;
      if (samples.length < 3) samples.push(`${dk} x${count} back x${back}`);
    } else if (count > 1) {
      pinch++;
    }
  }
  let vol = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.subarray(t, t + 9);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return { bad, pinch, degenerate, vol, samples };
}

const cases = [
  ['cilindro + cruz', baseParams(), 'cross'],
  ['cilindro + anillos (islas)', baseParams({ image: { ...baseParams().image, scaleX: 300, scaleY: 300 } }), 'rings'],
  ['cilindro + manchas + rejilla', baseParams({ bridges: { type: 'grid', width: 1, spacing: 15 } }), 'blobs'],
  ['cilindro invertido + malla cruzada', baseParams({ image: { ...baseParams().image, invert: true, rotation: 30 }, bridges: { type: 'diagonal_cross', width: 0.8, spacing: 12 } }), 'rings'],
  ['caja redondeada', baseParams({ shape: { type: 'box', width: 150, depth: 100, cornerRadius: 20 } }), 'blobs'],
  ['caja esquinas vivas', baseParams({ shape: { type: 'box', width: 80, depth: 60, cornerRadius: 0 } }), 'rings'],
];

let failed = 0;
for (const [name, params, kind] of cases) {
  const image = makeImage(kind);
  const q = resolveQuality(params, quality);
  const t0 = performance.now();
  const { grid, field, tris } = buildFull(params, image, q);
  const ms = performance.now() - t0;
  const r = checkManifold(tris);
  const nTris = tris.length / 9;
  const mb = (84 + nTris * 50) / 1e6;
  const ok = r.bad === 0 && r.vol > 0;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'ERR'} ${name}: ${grid.nCols}x${grid.rows} muestras, ${grid.strips.length - 1} franjas, ${nTris} triángulos (${mb.toFixed(1)} MB), ` +
    `vol=${(r.vol / 1000).toFixed(1)} cm³, aristas abiertas=${r.bad}, pellizcos=${r.pinch}, degenerados=${r.degenerate}, ${ms.toFixed(0)} ms`);
  if (r.samples.length) console.log('    ', r.samples.join('\n     '));

  // La malla por trozos debe ser idéntica a la completa (así trabajan los workers)
  if (name === 'caja redondeada') {
    const g = planGrid(params, q);
    const S = g.strips.length - 1;
    const cut = [0, Math.floor(S / 3), Math.floor((2 * S) / 3), S];
    const parts = [];
    for (let i = 0; i < 3; i++) parts.push(buildChunk(params, image, q, cut[i], cut[i + 1]));
    const merged = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { merged.set(p, o); o += p.length; }
    const rc = checkManifold(merged);
    const same = merged.length === tris.length;
    console.log(`    por trozos: ${same ? 'mismo tamaño' : 'DISTINTO'}, aristas malas=${rc.bad}`);
    if (!same || rc.bad) failed++;
  }
  if (name === 'cilindro + cruz') {
    const mask = wallLightMap(params, grid, field, 256, 300);
    let lit = 0;
    for (const v of mask) if (v) lit++;
    console.log(`    validación: ${lit} de ${mask.length} píxeles con luz`);
    const stl = writeBinaryStl(toPrintFrame(tris, params));
    console.log(`    STL binario: ${(stl.byteLength / 1e6).toFixed(2)} MB`);
  }
}
// Piezas complementarias (base, tapa, poste)
const partShapes = [
  ['cilindro', { type: 'cylinder', radius: 30 }],
  ['caja redondeada', { type: 'box', width: 150, depth: 100, cornerRadius: 20 }],
  ['caja esquinas vivas', { type: 'box', width: 80, depth: 60, cornerRadius: 0 }],
  ['cilindro diminuto', { type: 'cylinder', radius: 8 }],
];
for (const [name, shape] of partShapes) {
  const params = baseParams({ shape, bulbRadius: 10, parts: { ...DEFAULT_PARTS }, rimWall: 6, rimRoom: 6 });
  const parts = buildAllParts(params);
  const report = [];
  for (const [kind, tris] of Object.entries(parts)) {
    const r = checkManifold(tris);
    const ok = r.bad === 0 && r.pinch === 0 && r.vol > 0;
    if (!ok) failed++;
    report.push(`${kind} ${ok ? 'OK' : 'ERR'} (${(r.vol / 1000).toFixed(1)} cm³, abiertas=${r.bad})`);
  }
  // El labio debe quedar dentro de la cara interior de la pantalla con la holgura pedida
  const L = partsLayout(params);
  let minGap = Infinity;
  const inner = offsetShape(shape, params.thickness);
  if (L.lipOuter) {
    const innerProfile = makeProfile(inner);
    for (let i = 0; i < L.lipOuter.length; i += 2) {
      const x = L.lipOuter[i], y = L.lipOuter[i + 1];
      minGap = Math.min(minGap, innerProfile.polarRadius(x, y) - Math.hypot(x, y));
    }
  }
  const fitOk = !L.lipOuter || minGap > 0.1;
  if (!fitOk) failed++;
  const shade = buildFull(params, makeImage('cross'), resolveQuality(params, 'draft')).tris;
  const rs = checkManifold(shade);
  if (rs.bad) failed++;
  console.log(`${fitOk ? 'OK ' : 'ERR'} piezas ${name}: ${report.join(', ')}, holgura mín. labio=${minGap.toFixed(3)} mm, pantalla abiertas=${rs.bad}`);
}

// Batería aleatoria (semilla fija) para cazar casos límite
const fuzz = Number(process.argv[3] || 0);
let pinched = 0;
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const images = { cross: makeImage('cross'), rings: makeImage('rings'), blobs: makeImage('blobs') };
for (let k = 0; k < fuzz; k++) {
  const shape = rnd() < 0.5
    ? { type: 'cylinder', radius: 10 + rnd() * 60 }
    : { type: 'box', width: 20 + rnd() * 150, depth: 20 + rnd() * 150, cornerRadius: rnd() < 0.3 ? 0 : rnd() * 40 };
  const height = 50 + rnd() * 150;
  const params = baseParams({
    shape,
    height,
    distance: height * (0.3 + rnd() * 0.65),
    thickness: 1 + rnd() * 4,
    image: {
      offsetX: (rnd() - 0.5) * 200, offsetY: (rnd() - 0.5) * 200,
      scaleX: 100 + rnd() * 800, scaleY: 100 + rnd() * 800, rotation: rnd() * 360 - 180,
      flipX: rnd() < 0.5, flipY: rnd() < 0.5, invert: rnd() < 0.5,
    },
    bridges: { type: pick(['none', 'vertical', 'horizontal', 'diagonal_45', 'diagonal_neg45', 'grid', 'diagonal_cross']), width: 0.4 + rnd() * 1.2, spacing: 3 + rnd() * 40 },
  });
  const qual = pick(['draft', 'low', 'medium', 'high']);
  const kind = pick(Object.keys(images));
  const q = resolveQuality(params, qual, 4e6);
  const { tris } = buildFull(params, images[kind], q);
  const r = checkManifold(tris);
  const ok = r.bad === 0 && r.vol > 0;
  if (r.pinch) pinched++;
  if (!ok) {
    failed++;
    console.log(`ERR fuzz #${k} ${qual} ${kind}: aristas abiertas=${r.bad} vol=${r.vol.toFixed(0)}`, JSON.stringify(params));
  }
}
if (fuzz) console.log(`fuzz: ${fuzz} casos aleatorios revisados, ${pinched} con pellizcos (malla cerrada, no-manifold leve)`);

console.log(failed ? `\n${failed} caso(s) con errores` : '\nTodo correcto');
process.exit(failed ? 1 : 0);
