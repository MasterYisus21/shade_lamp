import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { getShapeRadius, getSubpixelValues } from '../utils/geometry.js';

const yieldToEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));

self.onmessage = async function (e) {
  const { type, payload } = e.data;

  try {
    switch (type) {
      case 'CALCULATE_HOLES':
        await handleCalculateHoles(payload);
        break;
      case 'VALIDATE_TRACE':
        await handleValidateTrace(payload);
        break;
      case 'EXPORT_STL':
        await handleExportSTL(payload);
        break;
    }
  } catch (error) {
    self.postMessage({ type: 'ERROR', message: error.message });
  }
};

async function handleCalculateHoles({ params, sourceImgData }) {
  const W = 2048;
  const H = 1024;
  const alphaData = new Uint8ClampedArray(W * H * 4);

  const rot = (params.imgRotation * Math.PI) / 180;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  // Precalculate arc lengths
  const arcLengths = new Float32Array(W);
  let totalPerimeter = 0;
  let prevX = getShapeRadius(0, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius) * Math.sin(0);
  let prevY = -getShapeRadius(0, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius) * Math.cos(0);

  for (let u = 1; u <= W; u++) {
    const uMod = u % W;
    const theta = (uMod / W) * 2 * Math.PI;
    const r = getShapeRadius(theta, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
    const px = r * Math.sin(theta);
    const py = -r * Math.cos(theta);
    const dx = px - prevX;
    const dy = py - prevY;
    totalPerimeter += Math.sqrt(dx * dx + dy * dy);
    if (u < W) arcLengths[u] = totalPerimeter;
    prevX = px;
    prevY = py;
  }

  const targetSpacing = params.supportSpacing / 10;
  const nSupports = Math.max(1, Math.round(totalPerimeter / targetSpacing));
  const adjustedSpacing = totalPerimeter / nSupports;

  for (let v = 0; v < H; v++) {
    if (v > 0 && v % 64 === 0) await yieldToEventLoop();
    const normalizedV = 1.0 - v / H;
    const Z = params.distance - params.height + normalizedV * params.height;

    for (let u = 0; u < W; u++) {
      const normalizedU = u / W;
      const theta = normalizedU * 2 * Math.PI;

      const currentRadius = getShapeRadius(theta, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
      const P_x = currentRadius * Math.sin(theta);
      const P_y = -currentRadius * Math.cos(theta);
      const P_z = Z;

      let isHole = false;
      if (P_z > 0.001) {
        const k = params.distance / P_z;
        const W_x = P_x * k;
        const W_y = P_y * k;

        const tx = W_x - params.imgOffsetX;
        const ty = W_y - params.imgOffsetY;
        
        // Inverse of Euler 'XYZ' rotation:
        // 1. Inverse Z rotation
        let rx_z = tx * cosR + ty * sinR;
        let ry_z = -tx * sinR + ty * cosR;
        
        // 2. Inverse Y rotation (Horizontal flip if imgFlipX is false)
        if (!params.imgFlipX) rx_z = -rx_z;
        
        // 3. Inverse X rotation (Vertical flip if imgFlipY is true)
        if (params.imgFlipY) ry_z = -ry_z;

        const lx = rx_z / (params.imgScaleX || 1);
        const ly = ry_z / (params.imgScaleY || 1);

        let pixelBright = params.bgColor === '#ffffff' ? 255 : 0;
        if (lx >= -0.5 && lx <= 0.5 && ly >= -0.5 && ly <= 0.5) {
          const pX = (lx + 0.5) * sourceImgData.width;
          const pY = (0.5 - ly) * sourceImgData.height;

          const sampled = getSubpixelValues(sourceImgData, pX, pY);
          const bgBright = params.bgColor === '#ffffff' ? 255 : 0;
          pixelBright = sampled.bright * (sampled.alpha / 255) + bgBright * ((255 - sampled.alpha) / 255);
        }
        const isDark = pixelBright < 128;
        isHole = params.invertShadow ? !isDark : isDark;
      }

      if (isHole && params.supportType !== 'none') {
        const arcLength = u === 0 ? 0 : arcLengths[u];
        const zPos = (1.0 - v / H) * params.height;
        const spacing = adjustedSpacing;
        const thickness = params.supportThickness / 10;

        let isSupport = false;

        if (params.supportType === 'vertical' || params.supportType === 'grid') {
          if (Math.abs(arcLength) % spacing < thickness) isSupport = true;
        }
        if (params.supportType === 'horizontal' || params.supportType === 'grid') {
          if (Math.abs(zPos) % spacing < thickness) isSupport = true;
        }
        if (params.supportType === 'diagonal_45' || params.supportType === 'diagonal_cross') {
          const d = arcLength * 0.7071 - zPos * 0.7071;
          if (Math.abs(d) % spacing < thickness) isSupport = true;
        }
        if (params.supportType === 'diagonal_neg45' || params.supportType === 'diagonal_cross') {
          const d = arcLength * 0.7071 + zPos * 0.7071;
          if (Math.abs(d) % spacing < thickness) isSupport = true;
        }

        if (isSupport) {
          isHole = false;
        }

        const rimSize = Math.max(2, Math.floor((10 / 512) * H));
        if (v < rimSize || v > H - rimSize) {
          isHole = false;
        }
      }

      const outIdx = (v * W + u) * 4;
      alphaData[outIdx] = 255;
      alphaData[outIdx + 1] = 255;
      alphaData[outIdx + 2] = 255;
      alphaData[outIdx + 3] = isHole ? 0 : 255;
    }
  }

  self.postMessage({ type: 'CALCULATE_HOLES_COMPLETE', data: alphaData, width: W, height: H });
}


async function handleValidateTrace({ params, alphaDataRaw }) {
  const W = 2048;
  const H = 1024;
  const VW = 512;
  const VH = 512;
  const vData = new Uint8ClampedArray(VW * VH * 4);

  let rFill = 0, gFill = 200, bFill = 255;
  if (params.lightFillColor === 'yellow') { rFill = 255; gFill = 230; bFill = 100; }
  else if (params.lightFillColor === 'white') { rFill = 255; gFill = 255; bFill = 255; }

  const shadowGrid = new Uint8Array(VW * VH);

  for (let y_w = 0; y_w < VH; y_w++) {
    if (y_w > 0 && y_w % 32 === 0) await yieldToEventLoop();
    const Y = (0.5 - y_w / VH) * 100;
    for (let x_w = 0; x_w < VW; x_w++) {
      const X = (x_w / VW - 0.5) * 100;
      const dist2 = X * X + Y * Y;
      if (dist2 === 0) continue;

      let theta = Math.atan2(X / Math.sqrt(dist2), -Y / Math.sqrt(dist2));
      if (theta < 0) theta += 2 * Math.PI;

      const currentRadius = getShapeRadius(theta, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
      const k = currentRadius / Math.sqrt(dist2);
      const Z_cyl = k * params.distance;

      let isSolid = false;
      if (Z_cyl >= params.distance - params.height && Z_cyl <= params.distance) {
        const v_uv = (H * (params.distance - Z_cyl)) / params.height;
        if (v_uv >= 0 && v_uv < H) {
          const u_uv = (theta / (2 * Math.PI)) * W;
          if (u_uv >= 0 && u_uv < W) {
            const aIdx = (Math.floor(v_uv) * W + Math.floor(u_uv)) * 4 + 3;
            if (alphaDataRaw[aIdx] > 128) {
              isSolid = true;
            }
          }
        }
      }
      shadowGrid[y_w * VW + x_w] = isSolid ? 1 : 0;
    }
  }

  for (let y = 1; y < VH - 1; y++) {
    if (y > 0 && y % 32 === 0) await yieldToEventLoop();
    for (let x = 1; x < VW - 1; x++) {
      const idx = y * VW + x;
      const isShadow = shadowGrid[idx];
      const pixelIdx = idx * 4;
      if (!isShadow) {
        const nShadow = shadowGrid[idx - 1] || shadowGrid[idx + 1] || shadowGrid[idx - VW] || shadowGrid[idx + VW];
        vData[pixelIdx] = rFill;
        vData[pixelIdx + 1] = gFill;
        vData[pixelIdx + 2] = bFill;
        if (nShadow) {
          vData[pixelIdx + 3] = 255;
        } else {
          vData[pixelIdx + 3] = 120;
        }
      } else {
        vData[pixelIdx + 3] = 0;
      }
    }
  }

  const tempRaw = new Uint8Array(vData);
  for (let y = 1; y < VH - 1; y++) {
    if (y > 0 && y % 32 === 0) await yieldToEventLoop();
    for (let x = 1; x < VW - 1; x++) {
      const idx = (y * VW + x) * 4;
      let sumAlpha = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sumAlpha += tempRaw[((y + dy) * VW + (x + dx)) * 4 + 3];
        }
      }
      vData[idx + 3] = sumAlpha / 9;
      if (vData[idx + 3] > 0) {
        vData[idx] = Math.max(0, rFill - 20);
        vData[idx + 1] = Math.max(0, gFill - 20);
        vData[idx + 2] = Math.max(0, bFill - 20);
      }
    }
  }

  self.postMessage({ type: 'VALIDATE_TRACE_COMPLETE', data: vData, width: VW, height: VH });
}


async function handleExportSTL({ params, sourceImgData, exportQuality }) {
  // Resolución de celdas del grid UV (no píxeles — cada celda genera hasta 4 quads 3D)
  let nU = 512, nV = 256;
  if (exportQuality === 'low')   { nU = 256;  nV = 128;  }
  if (exportQuality === 'high')  { nU = 1024; nV = 512;  }
  if (exportQuality === 'ultra') { nU = 2048; nV = 1024; }

  const rot = (params.imgRotation * Math.PI) / 180;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const bgBright = params.bgColor === '#ffffff' ? 255 : 0;

  // --- Muestreo de brillo en el punto (fu, fv) del grid UV ---
  const sampleBright = (fu, fv) => {
    if (!sourceImgData) return bgBright;
    const zNorm = 1.0 - fv / nV;
    const Z = params.distance - params.height + zNorm * params.height;
    if (Z <= 0.001) return bgBright;
    const theta = (fu / nU) * 2 * Math.PI;
    const r = getShapeRadius(theta, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
    const k = params.distance / Z;
    const tx = r * Math.sin(theta) * k - params.imgOffsetX;
    const ty = -r * Math.cos(theta) * k - params.imgOffsetY;
    let rx_z = tx * cosR + ty * sinR;
    let ry_z = -tx * sinR + ty * cosR;
    if (!params.imgFlipX) rx_z = -rx_z;
    if (params.imgFlipY)  ry_z = -ry_z;
    const lx = rx_z / (params.imgScaleX || 1);
    const ly = ry_z / (params.imgScaleY || 1);
    if (lx < -0.5 || lx > 0.5 || ly < -0.5 || ly > 0.5) return bgBright;
    const s = getSubpixelValues(sourceImgData,
      (lx + 0.5) * sourceImgData.width,
      (0.5 - ly) * sourceImgData.height);
    return s.bright * (s.alpha / 255) + bgBright * ((255 - s.alpha) / 255);
  };

  // --- Longitudes de arco para puentes estructurales ---
  const arcLengths = new Float32Array(nU);
  let totalPerimeter = 0;
  {
    let px = getShapeRadius(0, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius) * Math.sin(0);
    let py = -getShapeRadius(0, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius) * Math.cos(0);
    for (let u = 1; u <= nU; u++) {
      const t = ((u % nU) / nU) * 2 * Math.PI;
      const r = getShapeRadius(t, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
      const nx = r * Math.sin(t), ny = -r * Math.cos(t);
      totalPerimeter += Math.hypot(nx - px, ny - py);
      if (u < nU) arcLengths[u] = totalPerimeter;
      px = nx; py = ny;
    }
  }
  const nSup = Math.max(1, Math.round(totalPerimeter / (params.supportSpacing / 10)));
  const adjSpc = totalPerimeter / nSup;
  const supThk = params.supportThickness / 10;
  // Borde sólido: ~1 cm en cada extremo para dar estructura a la tapa y al aro
  const rimSize = Math.max(2, Math.round(nV / params.height));

  // --- Paso 1: Grid de sólido/hueco con 4× supersampling ---
  const solid = new Uint8Array(nV * nU);
  for (let v = 0; v < nV; v++) {
    if (v % 64 === 0) {
      self.postMessage({ type: 'EXPORT_PROGRESS', message: `Muestreo ${Math.round(v / nV * 100)}%` });
      await yieldToEventLoop();
    }
    for (let u = 0; u < nU; u++) {
      const avg = (
        sampleBright(u + 0.25, v + 0.25) + sampleBright(u + 0.75, v + 0.25) +
        sampleBright(u + 0.25, v + 0.75) + sampleBright(u + 0.75, v + 0.75)
      ) * 0.25;
      const bright = params.invertShadow ? (255 - avg) : avg;
      let isSolid = bright >= 128;

      // Bordes siempre sólidos (tapa superior + aro inferior)
      if (v < rimSize || v >= nV - rimSize) {
        isSolid = true;
      } else if (!isSolid && params.supportType !== 'none') {
        const aL = arcLengths[u];
        const zP = (1.0 - v / nV) * params.height;
        let isSup = false;
        if ((params.supportType === 'vertical'      || params.supportType === 'grid')           && Math.abs(aL % adjSpc) < supThk) isSup = true;
        if ((params.supportType === 'horizontal'    || params.supportType === 'grid')           && Math.abs(zP % adjSpc) < supThk) isSup = true;
        if ((params.supportType === 'diagonal_45'   || params.supportType === 'diagonal_cross') && Math.abs((aL * 0.7071 - zP * 0.7071) % adjSpc) < supThk) isSup = true;
        if ((params.supportType === 'diagonal_neg45'|| params.supportType === 'diagonal_cross') && Math.abs((aL * 0.7071 + zP * 0.7071) % adjSpc) < supThk) isSup = true;
        if (isSup) isSolid = true;
      }
      solid[v * nU + u] = isSolid ? 1 : 0;
    }
  }

  // --- Helpers de posición 3D ---
  // Devuelven coordenadas en cm; se escalan ×10 → mm al exportar
  const rOuter = (theta) => getShapeRadius(theta, params.shapeType,
    params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);

  const rInner = (theta) => getShapeRadius(theta, params.shapeType,
    Math.max(0.01, params.radius - params.thickness),
    Math.max(0.02, params.boxWidth  - 2 * params.thickness),
    Math.max(0.02, params.boxDepth  - 2 * params.thickness),
    Math.max(0,    params.boxCornerRadius - params.thickness));

  const outerPos = (u, v) => {
    const theta = (((u % nU + nU) % nU) / nU) * 2 * Math.PI;
    const z = params.distance - params.height + (1.0 - Math.max(0, Math.min(nV, v)) / nV) * params.height;
    const r = rOuter(theta);
    return [r * Math.sin(theta), -r * Math.cos(theta), z];
  };

  const innerPos = (u, v) => {
    const theta = (((u % nU + nU) % nU) / nU) * 2 * Math.PI;
    const z = params.distance - params.height + (1.0 - Math.max(0, Math.min(nV, v)) / nV) * params.height;
    const r = rInner(theta);
    return [r * Math.sin(theta), -r * Math.cos(theta), z];
  };

  const getSolid = (u, v) => {
    if (v < 0 || v >= nV) return false;
    return solid[v * nU + ((u % nU + nU) % nU)] === 1;
  };

  // --- Paso 2: Construcción directa de triángulos en 3D ---
  //
  // Cada celda sólida genera:
  //   - 1 quad en pared exterior (normal apuntando hacia afuera)
  //   - 1 quad en pared interior (normal apuntando hacia adentro)
  //   - 0-2 quads de borde horizontal (tapa del hueco, normal ±Z)
  //   - 0-2 quads de borde vertical   (tapa del hueco, normal ±theta)
  //
  // La tapa superior y el aro inferior se añaden al final.
  // El resultado es una malla hermética sin fisuras ni deformaciones.
  //
  // Verificación de winding (regla de la mano derecha):
  //   Pared exterior: tri(oo, o01, o1) → normal (sinθ, -cosθ, 0) = afuera ✓
  //   Pared interior: tri(io, i1, i01) → normal (-sinθ, cosθ, 0) = adentro ✓
  //   Borde inf sólido: tri(o01, i01, i11) → normal (0, 0, -1) = hacia el foco ✓
  //   Borde sup sólido: tri(o01, i11, i01) → normal (0, 0, +1) = hacia la pared ✓
  //   Borde der sólido: tri(o1, o11, i11)  → normal (+cosθ, +sinθ, 0) = +theta ✓
  //   Borde izq sólido: tri(o1, i11, o11)  → normal (-cosθ, -sinθ, 0) = -theta ✓

  const tris = [];
  const tri = (p0, p1, p2) => {
    tris.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
  };

  for (let v = 0; v < nV; v++) {
    if (v % 64 === 0) {
      self.postMessage({ type: 'EXPORT_PROGRESS', message: `Triangulando ${Math.round(v / nV * 100)}%` });
      await yieldToEventLoop();
    }
    for (let u = 0; u < nU; u++) {
      const s  = getSolid(u, v);
      const sD = getSolid(u, v + 1); // celda de abajo
      const sR = getSolid(u + 1, v); // celda de la derecha

      if (s) {
        const oo  = outerPos(u,   v);   const o1  = outerPos(u+1, v);
        const o01 = outerPos(u,   v+1); const o11 = outerPos(u+1, v+1);
        const io  = innerPos(u,   v);   const i1  = innerPos(u+1, v);
        const i01 = innerPos(u,   v+1); const i11 = innerPos(u+1, v+1);

        // Pared exterior (normal hacia afuera)
        tri(oo, o01, o1);   tri(o01, o11, o1);
        // Pared interior (normal hacia adentro — winding invertido)
        tri(io, i1, i01);   tri(i01, i1, i11);

        // Borde horizontal inferior: transición sólido → hueco
        if (!sD) {
          tri(o01, i01, i11);  tri(o01, i11, o11);
        }
        // Borde vertical derecho: transición sólido → hueco
        if (!sR) {
          tri(o1, o11, i11);  tri(o1, i11, i1);
        }
      } else {
        // Celda hueca: si la vecina de abajo/derecha es sólida,
        // generamos el borde desde el lado del hueco (winding invertido)
        if (sD) {
          const o01 = outerPos(u,   v+1); const o11 = outerPos(u+1, v+1);
          const i01 = innerPos(u,   v+1); const i11 = innerPos(u+1, v+1);
          tri(o01, i11, i01);  tri(o01, o11, i11);
        }
        if (sR) {
          const o1  = outerPos(u+1, v);   const o11 = outerPos(u+1, v+1);
          const i1  = innerPos(u+1, v);   const i11 = innerPos(u+1, v+1);
          tri(o1, i11, o11);  tri(o1, i1, i11);
        }
      }
    }
  }

  // --- Paso 3: Tapa superior (Z = distance, lado de la pared) — normal +Z ---
  self.postMessage({ type: 'EXPORT_PROGRESS', message: 'Construyendo tapas...' });
  await yieldToEventLoop();

  for (let u = 0; u < nU; u++) {
    const oa = outerPos(u,   0); const ob = outerPos(u+1, 0);
    const ia = innerPos(u,   0); const ib = innerPos(u+1, 0);
    tri(oa, ob, ib);  tri(oa, ib, ia);
  }

  // Nota: el aro inferior (z = distance-height) ya lo genera el bucle principal
  // cuando v = nV-1 es sólido y sD = getSolid(u, nV) = false (fuera de límites).
  // No se añade aquí para evitar triángulos duplicados coplanares.

  // --- Paso 4: Exportar ---
  self.postMessage({ type: 'EXPORT_PROGRESS', message: 'Exportando STL...' });
  await yieldToEventLoop();

  const posData = new Float32Array(tris);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(posData, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.scale.set(10, 10, 10); // cm → mm
  mesh.updateMatrixWorld(true);

  const exporter = new STLExporter();
  const stlData = exporter.parse(mesh, { binary: true });

  self.postMessage({ type: 'EXPORT_STL_COMPLETE', data: stlData.buffer, exportQuality }, [stlData.buffer]);
}
