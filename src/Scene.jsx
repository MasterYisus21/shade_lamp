import React, { useMemo, useEffect, useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const getSubpixelValues = (img, x, y) => {
  let x0 = Math.floor(x);
  let y0 = Math.floor(y);
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  if (x0 < 0 || x1 >= img.width || y0 < 0 || y1 >= img.height) return { alpha: 0, bright: 255 };
  
  let dx = x - x0;
  let dy = y - y0;
  
  const getP = (px, py) => {
     let i = (py * img.width + px) * 4;
     let a = img.data[i+3];
     let b = (img.data[i] + img.data[i+1] + img.data[i+2]) / 3;
     return { a, b };
  };

  let p00 = getP(x0, y0), p10 = getP(x1, y0);
  let p01 = getP(x0, y1), p11 = getP(x1, y1);
  
  let aTop = p00.a * (1 - dx) + p10.a * dx;
  let aBot = p01.a * (1 - dx) + p11.a * dx;
  let alpha = aTop * (1 - dy) + aBot * dy;

  let bTop = p00.b * (1 - dx) + p10.b * dx;
  let bBot = p01.b * (1 - dx) + p11.b * dx;
  let bright = bTop * (1 - dy) + bBot * dy;

  return { alpha, bright };
};

const generateTestTexture = () => {
  const size = 20;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const idx = (i * size + j) * 4;
      const isBlack = (i > 8 && i < 12) || (j > 8 && j < 12);
      const color = isBlack ? 0 : 255;
      data[idx] = color;
      data[idx + 1] = color;
      data[idx + 2] = color;
      data[idx + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
};

export default function Scene({ 
  radius, height, thickness, distance, bulbRadius, uploadedImage,
  imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation,
  imgFlipX, imgFlipY,
  invertShadow, supportType, supportThickness, supportSpacing, 
  calculateTrigger, validateTrigger, resetPulse,
  exportTrigger, exportQuality, onExportComplete
}) {
  const [wallTex, setWallTex] = useState(null);
  const [sourceImgData, setSourceImgData] = useState(null);
  const [cylinderAlphaMap, setCylinderAlphaMap] = useState(null);
  const [validationMap, setValidationMap] = useState(null);
  
  const defaultTexture = useMemo(() => generateTestTexture(), []);
  
  // Ref to hold alpha array so validation can read it later without recalculating
  const alphaDataRef = useRef(null);

  const paramsRef = useRef({
    radius, height, thickness, distance,
    imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation,
    imgFlipX, imgFlipY, invertShadow,
    supportType, supportThickness, supportSpacing
  });

  useEffect(() => {
    paramsRef.current = { 
      radius, height, thickness, distance, imgOffsetX, imgOffsetY, 
      imgScaleX, imgScaleY, imgRotation, imgFlipX, imgFlipY, invertShadow,
      supportType, supportThickness, supportSpacing
    };
  }, [radius, height, thickness, distance, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation, imgFlipX, imgFlipY, invertShadow, supportType, supportThickness, supportSpacing]);

  // Handle Reset 
  useEffect(() => {
    if (resetPulse > 0) {
      setCylinderAlphaMap(null);
      setValidationMap(null);
      alphaDataRef.current = null;
    }
  }, [resetPulse]);

  // Texture Loader
  useEffect(() => {
    if (uploadedImage) {
      new THREE.TextureLoader().load(uploadedImage, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        setWallTex(tex);
      });
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        setSourceImgData(ctx.getImageData(0, 0, c.width, c.height));
      };
      img.src = uploadedImage;
    } else {
      setWallTex(defaultTexture);
      const c = document.createElement('canvas');
      c.width = 20; 
      c.height = 20;
      const ctx = c.getContext('2d');
      const imgData = ctx.createImageData(20, 20);
      imgData.data.set(defaultTexture.image.data);
      setSourceImgData(imgData);
    }
  }, [uploadedImage, defaultTexture]);

  // 1. CALCULATE HOLES (Triggered by Button 1)
  useEffect(() => {
    if (calculateTrigger === 0 || !sourceImgData) return;
    console.log("Processing ray-casted geometry & mesh supports...");

    const p = paramsRef.current;
    
    // GENERATE HOLES ALPHA MAP WITH GRID SUPPORTS
    const W = 1024;
    const H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const alphaData = ctx.createImageData(W, H);
    
    const rot = p.imgRotation * Math.PI / 180;
    const cosR = Math.cos(-rot);
    const sinR = Math.sin(-rot);

    for (let v = 0; v < H; v++) {
      const normalizedV = 1.0 - (v / H); 
      const Z = (p.distance - p.height) + (normalizedV * p.height);
      
      for (let u = 0; u < W; u++) {
        const normalizedU = u / W;
        const theta = normalizedU * 2 * Math.PI;
        
        const P_x = p.radius * Math.sin(theta);
        const P_y = -p.radius * Math.cos(theta);
        const P_z = Z;
        
        let isHole = false;
        if (P_z > 0.001) { 
           const k = p.distance / P_z;
           const W_x = P_x * k;
           const W_y = P_y * k;
           
           const tx = W_x - p.imgOffsetX;
           const ty = W_y - p.imgOffsetY;
           const rx = tx * cosR - ty * sinR;
           const ry = tx * sinR + ty * cosR;
           const lx = rx / (p.imgScaleX || 1);
           const ly = ry / (p.imgScaleY || 1);
           
           if (lx >= -0.5 && lx <= 0.5 && ly >= -0.5 && ly <= 0.5) {
              const finalLx = p.imgFlipX ? lx : -lx;
              const finalLy = p.imgFlipY ? -ly : ly;
              const pX = (finalLx + 0.5) * sourceImgData.width;
              const pY = (0.5 - finalLy) * sourceImgData.height;
              
              const sampled = getSubpixelValues(sourceImgData, pX, pY);
              if (sampled.alpha < 128) {
                 isHole = p.invertShadow ? true : false;
              } else {
                 const isDark = sampled.bright < 128;
                 isHole = p.invertShadow ? !isDark : isDark;
              }
           }
        }
        
        if (isHole && p.supportType !== 'none') {
           const arcLength = (u / W) * (2 * Math.PI * p.radius);
           const zPos = (1.0 - (v / H)) * p.height; 
           const spacing = p.supportSpacing / 10;
           const thickness = p.supportThickness / 10;
           
           let isSupport = false;

           if (p.supportType === 'vertical' || p.supportType === 'grid') {
               if (Math.abs(arcLength) % spacing < thickness) isSupport = true;
           }
           if (p.supportType === 'horizontal' || p.supportType === 'grid') {
               if (Math.abs(zPos) % spacing < thickness) isSupport = true;
           }
           if (p.supportType === 'diagonal_45' || p.supportType === 'diagonal_cross') {
               const d = (arcLength * 0.7071 - zPos * 0.7071);
               if (Math.abs(d) % spacing < thickness) isSupport = true;
           }
           if (p.supportType === 'diagonal_neg45' || p.supportType === 'diagonal_cross') {
               const d = (arcLength * 0.7071 + zPos * 0.7071);
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
        alphaData.data[outIdx] = 255;
        alphaData.data[outIdx+1] = 255;
        alphaData.data[outIdx+2] = 255;
        alphaData.data[outIdx+3] = isHole ? 0 : 255; 
      }
    }

    ctx.putImageData(alphaData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    setCylinderAlphaMap(tex);
    
    alphaDataRef.current = alphaData; // Save for validation step
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculateTrigger]); 

  // 2. VALIDATE TRACE (Triggered by Button 2)
  useEffect(() => {
    if (validateTrigger === 0 || !alphaDataRef.current) {
        if (!alphaDataRef.current && validateTrigger > 0) {
            alert("Please calculate holes first!");
        }
        return;
    }
    
    console.log("Generating forward ray-trace blueprint...");
    const p = paramsRef.current;
    const alphaData = alphaDataRef.current;
    const W = 1024;
    const H = 512;

    const VW = 512;
    const VH = 512;
    const vCanvas = document.createElement('canvas');
    vCanvas.width = VW;
    vCanvas.height = VH;
    const vCtx = vCanvas.getContext('2d');
    const vData = vCtx.createImageData(VW, VH);
    
    // 0 = Light, 1 = Solid Shadow
    const shadowGrid = new Uint8Array(VW * VH);

    for (let y_w = 0; y_w < VH; y_w++) {
      for (let x_w = 0; x_w < VW; x_w++) {
        const X = ((x_w / VW) - 0.5) * 100;
        const Y = (0.5 - (y_w / VH)) * 100;
        
        const dist2 = X*X + Y*Y;
        if (dist2 === 0) continue;
        
        const k = p.radius / Math.sqrt(dist2);
        const Z_cyl = k * p.distance;
        
        let isSolid = false;
        if (Z_cyl >= p.distance - p.height && Z_cyl <= p.distance) {
           const v_uv = H * (p.distance - Z_cyl) / p.height;
           if (v_uv >= 0 && v_uv < H) {
              const X_cyl = k * X;
              const Y_cyl = k * Y;
              let theta = Math.atan2(X_cyl / p.radius, -Y_cyl / p.radius);
              if (theta < 0) theta += 2 * Math.PI;
              const u_uv = (theta / (2 * Math.PI)) * W;
              
              if (u_uv >= 0 && u_uv < W) {
                const aIdx = (Math.floor(v_uv) * W + Math.floor(u_uv)) * 4 + 3;
                if (alphaData.data[aIdx] > 128) {
                   isSolid = true;
                }
              }
           }
        }
        shadowGrid[y_w * VW + x_w] = isSolid ? 1 : 0;
      }
    }

    // Edge Detection for Blue Contour
    for (let y = 1; y < VH - 1; y++) {
      for (let x = 1; x < VW - 1; x++) {
         const idx = y * VW + x;
         const isShadow = shadowGrid[idx];
         if (!isShadow) {
           // check neighbors
           const nShadow = shadowGrid[idx - 1] || shadowGrid[idx + 1] || shadowGrid[idx - VW] || shadowGrid[idx + VW];
           const pixelIdx = idx * 4;
           if (nShadow) {
              vData.data[pixelIdx] = 0;     // R
              vData.data[pixelIdx+1] = 200; // G
              vData.data[pixelIdx+2] = 255; // B
              vData.data[pixelIdx+3] = 255; // A (Neon Blue Edge)
           } else {
              vData.data[pixelIdx+3] = 0;   // Transparent
           }
         } else {
           vData.data[idx * 4 + 3] = 0; 
         }
      }
    }

    // Box Blur the edge detection for smoother contour line preview
    const tempRaw = new Uint8Array(vData.data);
    for (let y = 1; y < VH - 1; y++) {
      for (let x = 1; x < VW - 1; x++) {
         const idx = (y * VW + x) * 4;
         let sumAlpha = 0;
         for(let dy=-1; dy<=1; dy++) {
            for(let dx=-1; dx<=1; dx++) {
               sumAlpha += tempRaw[((y+dy) * VW + (x+dx)) * 4 + 3];
            }
         }
         vData.data[idx+3] = sumAlpha / 9;
         // Recolor based on blurred alpha
         if (vData.data[idx+3] > 0) {
            vData.data[idx] = 0;
            vData.data[idx+1] = 160;
            vData.data[idx+2] = 255;
         }
      }
    }

    vCtx.putImageData(vData, 0, 0);
    const vTex = new THREE.CanvasTexture(vCanvas);
    setValidationMap(vTex);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validateTrigger]);

  // 3. EXPORT STL GENERATION
  useEffect(() => {
    if (exportTrigger === 0) return;
    
    // We run in a small timeout to let React render the loading UI
    setTimeout(() => {
      try {
        console.log("Generating STL with quality:", exportQuality);
        const p = paramsRef.current;
        let W = 512, H = 256;
        if (exportQuality === 'low') { W = 256; H = 128; }
        if (exportQuality === 'high') { W = 1024; H = 512; }
        
        // --- STEP 1: Compute Solid Grid ---
        const grid = new Uint8Array(W * H);
        const rot = p.imgRotation * Math.PI / 180;
        const cosR = Math.cos(-rot);
        const sinR = Math.sin(-rot);
        
        for (let v = 0; v < H; v++) {
          const normalizedV = 1.0 - (v / H); 
          const Z = (p.distance - p.height) + (normalizedV * p.height);
          
          for (let u = 0; u < W; u++) {
            const normalizedU = u / W;
            const theta = normalizedU * 2 * Math.PI;
            const P_x = p.radius * Math.sin(theta);
            const P_y = -p.radius * Math.cos(theta);
            const P_z = Z;
            
            let isHole = false;
            if (P_z > 0.001 && sourceImgData) { 
               const k = p.distance / P_z;
               const tx = (P_x * k) - p.imgOffsetX;
               const ty = (P_y * k) - p.imgOffsetY;
               const rx = tx * cosR - ty * sinR;
               const ry = tx * sinR + ty * cosR;
               const lx = rx / (p.imgScaleX || 1);
               const ly = ry / (p.imgScaleY || 1);
               
               if (lx >= -0.5 && lx <= 0.5 && ly >= -0.5 && ly <= 0.5) {
                  const finalLx = p.imgFlipX ? lx : -lx;
                  const finalLy = p.imgFlipY ? -ly : ly;
                  const pX = (finalLx + 0.5) * sourceImgData.width;
                  const pY = (0.5 - finalLy) * sourceImgData.height;
                  const sampled = getSubpixelValues(sourceImgData, pX, pY);
                  if (sampled.alpha < 128) {
                     isHole = p.invertShadow ? true : false;
                  } else {
                     const isDark = sampled.bright < 128;
                     isHole = p.invertShadow ? !isDark : isDark;
                  }
               }
            }
            
            if (isHole && p.supportType !== 'none') {
               const arcLength = (u / W) * (2 * Math.PI * p.radius);
               const zPos = (1.0 - (v / H)) * p.height; 
               const spacing = p.supportSpacing / 10;
               const thickness = p.supportThickness / 10;
               
               let isSupport = false;

               if (p.supportType === 'vertical' || p.supportType === 'grid') {
                   if (Math.abs(arcLength) % spacing < thickness) isSupport = true;
               }
               if (p.supportType === 'horizontal' || p.supportType === 'grid') {
                   if (Math.abs(zPos) % spacing < thickness) isSupport = true;
               }
               if (p.supportType === 'diagonal_45' || p.supportType === 'diagonal_cross') {
                   const d = (arcLength * 0.7071 - zPos * 0.7071);
                   if (Math.abs(d) % spacing < thickness) isSupport = true;
               }
               if (p.supportType === 'diagonal_neg45' || p.supportType === 'diagonal_cross') {
                   const d = (arcLength * 0.7071 + zPos * 0.7071);
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
            
            grid[v * W + u] = isHole ? 0 : 1;
          }
        }

        // --- STEP 2: Voxel Mesh Generation ---
        const vertices = [];
        
        const pushQuad = (p1, p2, p3, p4) => {
           // Triangle 1: p1, p2, p3
           vertices.push(...p1, ...p2, ...p3);
           // Triangle 2: p1, p3, p4
           vertices.push(...p1, ...p3, ...p4);
        };

        const getPos = (th, r, z_out) => {
           let z = z_out;
           if (r < p.radius) {
              // Ensure the absolute top and bottom base-caps remain flat
              const isBoundary = Math.abs(z_out - (p.distance)) < 0.01 || Math.abs(z_out - (p.distance - p.height)) < 0.01;
              if (!isBoundary) {
                  z = z_out * (r / p.radius);
              }
           }
           return [r * Math.sin(th), -r * Math.cos(th), z];
        };
        const isSolid = (u_idx, v_idx) => {
           if (v_idx < 0 || v_idx >= H) return false;
           let wrapU = u_idx % W;
           if (wrapU < 0) wrapU += W;
           return grid[v_idx * W + wrapU] === 1;
        };

        const rIn = p.radius - p.thickness;
        const rOut = p.radius;

        for (let v = 0; v < H; v++) {
           const v1 = 1.0 - (v / H);
           const v2 = 1.0 - ((v + 1) / H);
           const z_bot = (p.distance - p.height) + (v1 * p.height); // larger Z
           const z_top = (p.distance - p.height) + (v2 * p.height); // smaller Z

           for (let u = 0; u < W; u++) {
              if (grid[v * W + u] === 0) continue; // Skip holes

              const theta1 = (u / W) * 2 * Math.PI;
              const theta2 = ((u + 1) / W) * 2 * Math.PI;

              // Outer Face (+r)
              pushQuad(
                 getPos(theta1, rOut, z_bot),
                 getPos(theta1, rOut, z_top),
                 getPos(theta2, rOut, z_top),
                 getPos(theta2, rOut, z_bot)
              );

              // Inner Face (-r)
              pushQuad(
                 getPos(theta2, rIn, z_bot),
                 getPos(theta2, rIn, z_top),
                 getPos(theta1, rIn, z_top),
                 getPos(theta1, rIn, z_bot)
              );

              // Bottom face (+z) -> v decreased
              if (!isSolid(u, v - 1)) {
                 pushQuad(
                    getPos(theta1, rOut, z_bot),
                    getPos(theta2, rOut, z_bot),
                    getPos(theta2, rIn, z_bot),
                    getPos(theta1, rIn, z_bot)
                 );
              }

              // Top face (-z) -> v increased
              if (!isSolid(u, v + 1)) {
                 pushQuad(
                    getPos(theta1, rIn, z_top),
                    getPos(theta2, rIn, z_top),
                    getPos(theta2, rOut, z_top),
                    getPos(theta1, rOut, z_top)
                 );
              }

              // Left Face (-theta) -> u decreased
              if (!isSolid(u - 1, v)) {
                 pushQuad(
                    getPos(theta1, rIn, z_top),
                    getPos(theta1, rOut, z_top),
                    getPos(theta1, rOut, z_bot),
                    getPos(theta1, rIn, z_bot)
                 );
              }

              // Right Face (+theta) -> u increased
              if (!isSolid(u + 1, v)) {
                 pushQuad(
                    getPos(theta2, rIn, z_bot),
                    getPos(theta2, rOut, z_bot),
                    getPos(theta2, rOut, z_top),
                    getPos(theta2, rIn, z_top)
                 );
              }
           }
        }

        const unmergedGeo = new THREE.BufferGeometry();
        unmergedGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        const geometry = BufferGeometryUtils.mergeVertices(unmergedGeo, 0.0001);
        
        const posAttribute = geometry.getAttribute('position');
        const indices = geometry.getIndex();

        // 3D Anti-Aliasing: Laplacian Smoothing over the Voxel Mesh
        if (indices && exportQuality !== 'low') {
            const posArray = posAttribute.array;
            const vertexCount = posAttribute.count;
            
            const constraints = new Array(vertexCount);
            const zTopLimit = p.distance - p.height;
            const zBotLimit = p.distance;
            
            for(let i=0; i<vertexCount; i++) {
                const x = posArray[i*3];
                const y = posArray[i*3+1];
                const z = posArray[i*3+2];
                const r = Math.sqrt(x*x + y*y);
                
                let isBoundaryZ = false;
                let fixedZ = z;
                if (Math.abs(z - zTopLimit) < 0.01) { isBoundaryZ = true; fixedZ = zTopLimit; }
                if (Math.abs(z - zBotLimit) < 0.01) { isBoundaryZ = true; fixedZ = zBotLimit; }

                constraints[i] = { r, isBoundaryZ, fixedZ };
            }

            const neighbors = new Array(vertexCount).fill(null).map(() => []);
            const idxArray = indices.array;
            for(let i=0; i<idxArray.length; i+=3) {
                const a = idxArray[i], b = idxArray[i+1], c = idxArray[i+2];
                neighbors[a].push(b, c);
                neighbors[b].push(a, c);
                neighbors[c].push(a, b);
            }
            
            const smoothingIter = exportQuality === 'high' ? 8 : 4;
            const newPos = new Float32Array(posArray.length);
            
            for (let iter=0; iter<smoothingIter; iter++) {
                for(let i=0; i<vertexCount; i++) {
                    const nbrs = [...new Set(neighbors[i])];
                    if (nbrs.length === 0) {
                       newPos[i*3] = posArray[i*3];
                       newPos[i*3+1] = posArray[i*3+1];
                       newPos[i*3+2] = posArray[i*3+2];
                       continue;
                    }
                    let sumX = 0, sumY = 0, sumZ = 0;
                    for(let j=0; j<nbrs.length; j++) {
                        let ni = nbrs[j];
                        sumX += posArray[ni*3];
                        sumY += posArray[ni*3+1];
                        sumZ += posArray[ni*3+2];
                    }
                    let avgX = sumX / nbrs.length;
                    let avgY = sumY / nbrs.length;
                    let avgZ = sumZ / nbrs.length;

                    const c = constraints[i];
                    const dist = Math.sqrt(avgX*avgX + avgY*avgY);
                    if (dist > 0.0001) {
                        avgX = (avgX / dist) * c.r;
                        avgY = (avgY / dist) * c.r;
                    }

                    if (c.isBoundaryZ) {
                        avgZ = c.fixedZ;
                    }

                    newPos[i*3] = avgX;
                    newPos[i*3+1] = avgY;
                    newPos[i*3+2] = avgZ;
                }
                posArray.set(newPos);
            }
        }

        geometry.computeVertexNormals();
        
        const shadeMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

        // --- STEP 3: Generate Base Cap Mesh ---
        const baseGeo = new THREE.CylinderGeometry(p.radius, p.radius, p.thickness, 128);
        const baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshBasicMaterial());
        baseMesh.rotation.set(Math.PI / 2, 0, 0);
        baseMesh.position.set(0, 0, p.distance - p.thickness / 2);
        
        // Ensure matrices are computed before export
        baseMesh.updateMatrixWorld(true);
        shadeMesh.updateMatrixWorld(true);

        const group = new THREE.Group();
        group.add(shadeMesh);
        group.add(baseMesh);
        
        // CORRECTION: Convert to Millimeters correctly (1cm = 10mm). 
        // 3D Slicers assume coordinates are natively mm.
        group.scale.set(10, 10, 10);
        group.updateMatrixWorld(true);

        // Export via STLExporter
        const exporter = new STLExporter();
        const stlString = exporter.parse(group);
        
        const blob = new Blob([stlString], { type: 'text/plain' });
        const link = document.createElement('a');
        link.style.display = 'none';
        link.href = URL.createObjectURL(blob);
        link.download = 'lampara_sombra.stl';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

      } catch (err) {
         console.error("Error generating STL:", err);
         alert("Hubo un error exportando el archivo: " + err.message);
      } finally {
         if (onExportComplete) onExportComplete();
      }
    }, 150);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportTrigger]);


  const currentAlphaTest = cylinderAlphaMap ? 0.5 : 0;

  return (
    // Fixed Camera position: Start at Z=-15 looking from the Origin perspective towards the Wall!!
    <Canvas camera={{ position: [15, 10, -15], fov: 45 }}>
      <color attach="background" args={['#0f172a']} />
      
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 0, 0]} intensity={10} color="#c084fc" distance={distance * 2} />
      
      {/* We target looking at the wall (Z=distance) instead of (0,0,0) */}
      <OrbitControls target={[0, 0, distance]} makeDefault />
      <axesHelper args={[15]} />
      <Grid infiniteGrid fadeDistance={40} fadeStrength={5} cellColor="#334155" sectionColor="#475569" position={[0, -Math.max(height, radius) - 1, 0]} />

      {/* Origin Light Bulb */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[bulbRadius, 32, 32]} />
        <meshBasicMaterial color="#fff" />
      </mesh>

      {/* The Cylinder */}
      <mesh position={[0, 0, distance - height / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius, radius, height, 128, 1, true]} />
        <meshStandardMaterial 
          color={cylinderAlphaMap ? "#b4a9c1" : "#9b51e0"} 
          transparent={true}
          opacity={cylinderAlphaMap ? 1 : 0.3} 
          alphaMap={cylinderAlphaMap}
          alphaTest={currentAlphaTest}
          side={THREE.DoubleSide} 
        />
      </mesh>
      
      {/* Inner Wall of Cylinder */}
      <mesh position={[0, 0, distance - height / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius - thickness, radius - thickness, height, 128, 1, true]} />
        <meshStandardMaterial 
          color={cylinderAlphaMap ? "#e2dff5" : "#c084fc"} 
          transparent={true}
          opacity={cylinderAlphaMap ? 1 : 0.15} 
          alphaMap={cylinderAlphaMap}
          alphaTest={currentAlphaTest}
          side={THREE.DoubleSide} 
        />
      </mesh>

      {/* Top Cap Rim to seal the visual gap between Inner and Outer cylinders */}
      <mesh position={[0, 0, distance - height]} rotation={[0, Math.PI, 0]}>
        <ringGeometry args={[radius - thickness, radius, 128]} />
        <meshStandardMaterial 
          color={cylinderAlphaMap ? "#b4a9c1" : "#9b51e0"}
          transparent={true}
          opacity={cylinderAlphaMap ? 1 : 0.3} 
          side={THREE.DoubleSide} 
        />
      </mesh>

      {/* Solid Base Cap touching the wall */}
      <mesh position={[0, 0, distance - thickness / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius, radius, thickness, 128]} />
        <meshStandardMaterial color="#7e22ce" side={THREE.DoubleSide} />
      </mesh>

      {/* Generic dark Wall - pushed BACK slightly (Z = distance + 0.05) to naturally sit behind the Base Cap and Image plane */}
      <mesh position={[0, 0, distance + 0.05]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#1e293b" side={THREE.DoubleSide} />
      </mesh>

      {/* 1 Meter Reference Bounds on the Wall */}
      <Line
        points={[
          [-50, -50, distance + 0.04],
          [50, -50, distance + 0.04],
          [50, 50, distance + 0.04],
          [-50, 50, distance + 0.04],
          [-50, -50, distance + 0.04]
        ]}
        color="rgba(192, 132, 252, 0.5)"
        lineWidth={2}
        dashed={true}
      />

      {/* Original Image Box Plane */}
      {/* Plane is rotated to face the camera (-Z) normally, and flip vars invert this per axis */}
      <mesh 
        position={[imgOffsetX, imgOffsetY, distance]} 
        rotation={[imgFlipY ? Math.PI : 0, imgFlipX ? 0 : Math.PI, imgRotation * Math.PI / 180]}
        scale={[imgScaleX, imgScaleY, 1]}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial 
          map={wallTex} 
          transparent={true}
          opacity={cylinderAlphaMap ? 0.3 : 1.0} 
          depthWrite={false}
          color="#ffffff"
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Blue Contour Validation Overlay */}
      {validationMap && (
        <mesh position={[0, 0, distance - 0.01]}>
          <planeGeometry args={[100, 100]} />
          <meshBasicMaterial 
            map={validationMap} 
            transparent={true} 
            side={THREE.DoubleSide}
            depthTest={false}
          />
        </mesh>
      )}
      
      <Line
        points={[[0, 0, 0], [0, 0, distance]]}
        color="rgba(255,255,255,0.2)"
        lineWidth={1}
        dashed={true}
      />
    </Canvas>
  );
}
