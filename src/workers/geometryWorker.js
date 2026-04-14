import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  let W = 1024, H = 512;
  if (exportQuality === 'low') { W = 512; H = 256; }
  if (exportQuality === 'high') { W = 2048; H = 1024; }
  if (exportQuality === 'ultra') { W = 4096; H = 2048; }

  const grid = new Uint8Array(W * H);
  const rot = (params.imgRotation * Math.PI) / 180;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

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

  const sampleBrightAt = (su, sv) => {
    const bgBright = params.bgColor === '#ffffff' ? 255 : 0;
    const nV = 1.0 - sv / H;
    const Z = params.distance - params.height + nV * params.height;
    if (Z <= 0.001 || !sourceImgData) return bgBright;
    const theta = (su / W) * 2 * Math.PI;
    const cr = getShapeRadius(theta, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
    const Px = cr * Math.sin(theta);
    const Py = -cr * Math.cos(theta);
    const k = params.distance / Z;
    const tx = Px * k - params.imgOffsetX;
    const ty = Py * k - params.imgOffsetY;
    
    // Inverse of Euler 'XYZ' rotation:
    let rx_z = tx * cosR + ty * sinR;
    let ry_z = -tx * sinR + ty * cosR;
    
    if (!params.imgFlipX) rx_z = -rx_z;
    if (params.imgFlipY) ry_z = -ry_z;

    const lx = rx_z / (params.imgScaleX || 1);
    const ly = ry_z / (params.imgScaleY || 1);
    
    if (lx < -0.5 || lx > 0.5 || ly < -0.5 || ly > 0.5) return bgBright;
    
    const pX = (lx + 0.5) * sourceImgData.width;
    const pY = (0.5 - ly) * sourceImgData.height;
    const s = getSubpixelValues(sourceImgData, pX, pY);
    return s.bright * (s.alpha / 255) + bgBright * ((255 - s.alpha) / 255);
  };

  for (let v = 0; v < H; v++) {
    if (v > 0 && v % 32 === 0) {
        self.postMessage({ type: 'EXPORT_PROGRESS', message: `Muestreo de Vóxeles (${Math.round((v/H)*100)}%)` });
        await yieldToEventLoop();
    }

    for (let u = 0; u < W; u++) {
      const b00 = sampleBrightAt(u + 0.25, v + 0.25);
      const b10 = sampleBrightAt(u + 0.75, v + 0.25);
      const b01 = sampleBrightAt(u + 0.25, v + 0.75);
      const b11 = sampleBrightAt(u + 0.75, v + 0.75);
      const avgBright = (b00 + b10 + b01 + b11) * 0.25;

      let isHole = false;
      const isDark = avgBright < 128;
      isHole = params.invertShadow ? !isDark : isDark;

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

        if (isSupport) isHole = false;

        const rimSize = Math.max(2, Math.floor((10 / 512) * H));
        if (v < rimSize || v > H - rimSize) isHole = false;
      }

      grid[v * W + u] = isHole ? 0 : 1;
    }
  }

  const isSolid = (u_idx, v_idx) => {
    if (v_idx < 0 || v_idx >= H) return false;
    let wrapU = u_idx % W;
    if (wrapU < 0) wrapU += W;
    return grid[v_idx * W + wrapU] === 1;
  };

  const bounds = new Uint8Array(W * (H + 1));
  const pinned = new Uint8Array(W * (H + 1));

  for (let v = 0; v <= H; v++) {
    if (v % 64 === 0) await yieldToEventLoop();
    for (let u = 0; u < W; u++) {
      const tl = isSolid(u - 1, v - 1) ? 1 : 0;
      const tr = isSolid(u, v - 1) ? 1 : 0;
      const bl = isSolid(u - 1, v) ? 1 : 0;
      const br = isSolid(u, v) ? 1 : 0;
      const solidCount = tl + tr + bl + br;
      if (solidCount === 0 || solidCount === 4) continue;
      bounds[v * W + u] = 1;
      if (solidCount !== 2) {
        pinned[v * W + u] = 1;
      }
    }
  }

  const dispU = new Float32Array(W * (H + 1));
  const dispV = new Float32Array(W * (H + 1));
  const smoothIters = exportQuality === 'high' ? 12 : exportQuality === 'medium' ? 6 : 3;

  for (let iter = 0; iter < smoothIters; iter++) {
    self.postMessage({ type: 'EXPORT_PROGRESS', message: `Suavizando de bordes (Paso ${iter+1}/${smoothIters})` });
    await yieldToEventLoop();
    const tempU = new Float32Array(dispU);
    const tempV = new Float32Array(dispV);
    for (let v = 0; v <= H; v++) {
      for (let u = 0; u < W; u++) {
        if (!bounds[v * W + u] || pinned[v * W + u]) continue;
        let sumU = 0, sumV = 0, count = 0;
        const checkNeighbor = (nu, nv) => {
          if (nv >= 0 && nv <= H) {
            let wu = nu % W;
            if (wu < 0) wu += W;
            if (bounds[nv * W + wu]) {
              sumU += (nu - u) + dispU[nv * W + wu];
              sumV += (nv - v) + dispV[nv * W + wu];
              count++;
            }
          }
        };
        checkNeighbor(u - 1, v);
        checkNeighbor(u + 1, v);
        checkNeighbor(u, v - 1);
        checkNeighbor(u, v + 1);
        if (count > 0) {
          tempU[v * W + u] = sumU / count;
          if (v > 0 && v < H) tempV[v * W + u] = sumV / count;
        }
      }
    }
    dispU.set(tempU);
    dispV.set(tempV);
  }

  self.postMessage({ type: 'EXPORT_PROGRESS', message: `Desplegando Malla 3D` });
  
  let faceCount = 0;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      if (grid[v * W + u] === 0) continue;
      faceCount += 2; // Outer
      faceCount += 2; // Inner
      if (!isSolid(u, v - 1)) faceCount += 2; // Bottom
      if (!isSolid(u, v + 1)) faceCount += 2; // Top
      if (!isSolid(u - 1, v)) faceCount += 2; // Left
      if (!isSolid(u + 1, v)) faceCount += 2; // Right
    }
  }

  const vertices = new Float32Array(faceCount * 3 * 3);
  let vIdx = 0;

  const pushQuad = (p1, p2, p3, p4) => {
    vertices[vIdx++] = p1[0]; vertices[vIdx++] = p1[1]; vertices[vIdx++] = p1[2];
    vertices[vIdx++] = p2[0]; vertices[vIdx++] = p2[1]; vertices[vIdx++] = p2[2];
    vertices[vIdx++] = p3[0]; vertices[vIdx++] = p3[1]; vertices[vIdx++] = p3[2];

    vertices[vIdx++] = p1[0]; vertices[vIdx++] = p1[1]; vertices[vIdx++] = p1[2];
    vertices[vIdx++] = p3[0]; vertices[vIdx++] = p3[1]; vertices[vIdx++] = p3[2];
    vertices[vIdx++] = p4[0]; vertices[vIdx++] = p4[1]; vertices[vIdx++] = p4[2];
  };

  const getPosInner = (th, z_out) => {
    let r = getShapeRadius(th, params.shapeType, params.radius - params.thickness, params.boxWidth - 2 * params.thickness, params.boxDepth - 2 * params.thickness, Math.max(0, params.boxCornerRadius - params.thickness));
    let R_out = getShapeRadius(th, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
    let z = z_out;
    const isBoundary = Math.abs(z_out - params.distance) < 0.01 || Math.abs(z_out - (params.distance - params.height)) < 0.01;
    if (!isBoundary) z = z_out * (r / R_out);
    return [r * Math.sin(th), -r * Math.cos(th), z];
  };

  const getPosOuter = (th, z_out) => {
    let r = getShapeRadius(th, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
    return [r * Math.sin(th), -r * Math.cos(th), z_out];
  };

  const getVoxelCorner = (u, v, inner) => {
    let wrapU = u % W;
    if (wrapU < 0) wrapU += W;
    let final_u = u + dispU[v * W + wrapU];
    let final_v = v + dispV[v * W + wrapU];
    const theta = (final_u / W) * 2 * Math.PI;
    const z_norm = 1.0 - final_v / H;
    const z_out = params.distance - params.height + z_norm * params.height;
    if (inner) return getPosInner(theta, z_out);
    return getPosOuter(theta, z_out);
  };

  const getOuter = (u, v) => getVoxelCorner(u, v, false);
  const getInner = (u, v) => getVoxelCorner(u, v, true);

  for (let v = 0; v < H; v++) {
    if (v > 0 && v % 64 === 0) await yieldToEventLoop();
    for (let u = 0; u < W; u++) {
      if (grid[v * W + u] === 0) continue;

      pushQuad(getOuter(u, v), getOuter(u, v + 1), getOuter(u + 1, v + 1), getOuter(u + 1, v));
      pushQuad(getInner(u + 1, v), getInner(u + 1, v + 1), getInner(u, v + 1), getInner(u, v));

      if (!isSolid(u, v - 1)) pushQuad(getOuter(u, v), getOuter(u + 1, v), getInner(u + 1, v), getInner(u, v));
      if (!isSolid(u, v + 1)) pushQuad(getInner(u, v + 1), getInner(u + 1, v + 1), getOuter(u + 1, v + 1), getOuter(u, v + 1));
      if (!isSolid(u - 1, v)) pushQuad(getInner(u, v + 1), getOuter(u, v + 1), getOuter(u, v), getInner(u, v));
      if (!isSolid(u + 1, v)) pushQuad(getInner(u + 1, v), getOuter(u + 1, v), getOuter(u + 1, v + 1), getInner(u + 1, v + 1));
    }
  }

  self.postMessage({ type: 'EXPORT_PROGRESS', message: `Construyendo Malla Final y exportando STL` });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  // Not using mergeVertices! STLExporter will compute triangle normals natively.
  
  const shadeMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

  const baseGeo = new THREE.CylinderGeometry(1, 1, params.thickness, W, 1, false);
  const posArr = baseGeo.attributes.position.array;
  for (let i = 0; i < posArr.length; i += 3) {
    const bx = posArr[i], bz = posArr[i + 2];
    const dist = Math.sqrt(bx * bx + bz * bz);
    if (dist > 0.001) {
      let th = Math.atan2(bx, bz);
      const R = getShapeRadius(th, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
      posArr[i] = (bx / dist) * R;
      posArr[i + 2] = (bz / dist) * R;
    }
  }

  const baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshBasicMaterial());
  baseMesh.rotation.set(Math.PI / 2, 0, 0);
  baseMesh.position.set(0, 0, params.distance - params.thickness / 2);

  baseMesh.updateMatrixWorld(true);
  shadeMesh.updateMatrixWorld(true);

  const group = new THREE.Group();
  group.add(shadeMesh);
  group.add(baseMesh);

  group.scale.set(10, 10, 10);
  group.updateMatrixWorld(true);

  const exporter = new STLExporter();
  // Using binary: true saves 90% file size and returns a DataView
  const stlData = exporter.parse(group, { binary: true });

  // Transfer the buffer over to the main thread with zero-copy
  self.postMessage({ type: 'EXPORT_STL_COMPLETE', data: stlData.buffer }, [stlData.buffer]);
}
