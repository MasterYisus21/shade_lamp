import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getShapeRadius, getSubpixelValues } from '../utils/geometry.js';
import { contours } from 'd3-contour';

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

  const grid = new Float32Array(W * H);
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
        self.postMessage({ type: 'EXPORT_PROGRESS', message: `Muestreo Subpixel (${Math.round((v/H)*100)}%)` });
        await yieldToEventLoop();
    }

    for (let u = 0; u < W; u++) {
      const b00 = sampleBrightAt(u + 0.25, v + 0.25);
      const b10 = sampleBrightAt(u + 0.75, v + 0.25);
      const b01 = sampleBrightAt(u + 0.25, v + 0.75);
      const b11 = sampleBrightAt(u + 0.75, v + 0.75);
      const avgBright = (b00 + b10 + b01 + b11) * 0.25;

      let pixelVal = params.invertShadow ? (255 - avgBright) : avgBright;

      // Un valor > 128 es sólido (blanco en la máscara original = block shadow)
      // Ajustamos support logic para forzar a 255 si es soporte.
      let isHole = pixelVal < 128;

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

        if (isSupport) pixelVal = 255;
      }

      const rimSize = Math.max(2, Math.floor((10 / 512) * H));
      if (v < rimSize || v > H - rimSize) {
         pixelVal = 255;
      }

      grid[v * W + u] = pixelVal;
    }
  }

  self.postMessage({ type: 'EXPORT_PROGRESS', message: `Extrayendo contornos vectoriales (Marching Squares)` });
  await yieldToEventLoop();

  // El umbral es 128: separa lo sólido de lo hueco con precisión continua
  const contourPaths = contours()
    .size([W, H])
    .thresholds([128])
    (grid);

  if (!contourPaths || contourPaths.length === 0) {
      self.postMessage({ type: 'ERROR', message: "No se encontró geometría sólida."});
      return;
  }

  const multiPolygons = contourPaths[0].coordinates;

  self.postMessage({ type: 'EXPORT_PROGRESS', message: `Triangulando vectores en 2D (Earcut)` });
  await yieldToEventLoop();

  const simplifyRing = (ring) => {
     if(ring.length <= 3) return ring;
     const out = [ring[0]];
     for(let i=1; i<ring.length-1; i++){
        const pPrev = out[out.length-1];
        const pCurr = ring[i];
        const pNext = ring[i+1];
        const area = Math.abs(pPrev[0]*(pCurr[1]-pNext[1]) + pCurr[0]*(pNext[1]-pPrev[1]) + pNext[0]*(pPrev[1]-pCurr[1]));
        if(area > 0.05) { 
           out.push(pCurr);
        }
     }
     out.push(ring[ring.length-1]);
     return out;
  };

  const createPath = (ring) => {
      const path = new THREE.Path();
      const simpleRing = simplifyRing(ring);
      for (let i = 0; i < simpleRing.length; i++) {
        const x = simpleRing[i][0];
        const y = simpleRing[i][1];
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      return path;
  };

  const shapeList = [];
  
  for (const polygon of multiPolygons) {
    if (!polygon || polygon.length === 0) continue;
    
    // Anillo exterior
    const outerRing = simplifyRing(polygon[0]);
    const shape = new THREE.Shape();
    
    for (let i = 0; i < outerRing.length; i++) {
        const x = outerRing[i][0];
        const y = outerRing[i][1];
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }

    // Huecos (anillos interiores)
    for (let h = 1; h < polygon.length; h++) {
        shape.holes.push(createPath(polygon[h]));
    }
    
    shapeList.push(shape);
  }

  // Tesselación extruida de los vectores
  const extrudeSettings = {
    steps: 1,
    depth: params.thickness,
    bevelEnabled: false
  };

  const geometry = new THREE.ExtrudeGeometry(shapeList, extrudeSettings);

  self.postMessage({ type: 'EXPORT_PROGRESS', message: `Envolviendo geometría a 3D Cilíndrico` });
  await yieldToEventLoop();

  const posArr = geometry.attributes.position.array;
  for (let i = 0; i < posArr.length; i += 3) {
    const u = posArr[i];
    const v = posArr[i + 1];
    const z_ext = posArr[i + 2]; 

    const inner = z_ext > (params.thickness * 0.5); 
    
    let u_clamped = Math.max(0, Math.min(W, u));
    let v_clamped = Math.max(0, Math.min(H, v));

    const theta = (u_clamped / W) * 2 * Math.PI;
    const z_norm = 1.0 - (v_clamped / H);
    const z_out = params.distance - params.height + z_norm * params.height;

    const r_outer = getShapeRadius(theta, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
    const r_inner = getShapeRadius(theta, params.shapeType, params.radius - params.thickness, params.boxWidth - 2 * params.thickness, params.boxDepth - 2 * params.thickness, Math.max(0, params.boxCornerRadius - params.thickness));

    const R = inner ? r_inner : r_outer;
    
    posArr[i] = R * Math.sin(theta);
    posArr[i + 1] = -R * Math.cos(theta);
    posArr[i + 2] = z_out; 

    // Rectificar el borde base en Y/Z (rim)
    const isBoundary = Math.abs(z_out - params.distance) < 0.01 || Math.abs(z_out - (params.distance - params.height)) < 0.01;
    if (inner && !isBoundary) {
         posArr[i + 2] = z_out * (r_inner / r_outer);
    }
  }

  geometry.computeVertexNormals();

  const shadeMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

  const baseGeo = new THREE.CylinderGeometry(1, 1, params.thickness, W, 1, false);
  const basePos = baseGeo.attributes.position.array;
  for (let i = 0; i < basePos.length; i += 3) {
    const bx = basePos[i], bz = basePos[i + 2];
    const dist = Math.sqrt(bx * bx + bz * bz);
    if (dist > 0.001) {
      let th = Math.atan2(bx, bz);
      const R = getShapeRadius(th, params.shapeType, params.radius, params.boxWidth, params.boxDepth, params.boxCornerRadius);
      basePos[i] = (bx / dist) * R;
      basePos[i + 2] = (bz / dist) * R;
    }
  }
  baseGeo.computeVertexNormals();

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
  const stlData = exporter.parse(group, { binary: true });

  self.postMessage({ type: 'EXPORT_STL_COMPLETE', data: stlData.buffer, exportQuality }, [stlData.buffer]);
}
