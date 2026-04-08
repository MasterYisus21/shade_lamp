import React, { useMemo, useEffect, useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';

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
  invertShadow, calculateTrigger, validateTrigger, resetPulse
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
    invertShadow
  });

  useEffect(() => {
    paramsRef.current = { radius, height, thickness, distance, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation, invertShadow };
  }, [radius, height, thickness, distance, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation, invertShadow]);

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
              const pX = Math.floor((lx + 0.5) * sourceImgData.width);
              const pY = Math.floor((0.5 - ly) * sourceImgData.height);
              
              if (pX >= 0 && pX < sourceImgData.width && pY >= 0 && pY < sourceImgData.height) {
                 const idx = (pY * sourceImgData.width + pX) * 4;
                 const brightness = (sourceImgData.data[idx] + sourceImgData.data[idx+1] + sourceImgData.data[idx+2]) / 3;
                 const alpha = sourceImgData.data[idx+3];
                 
                 if (alpha < 128) {
                    isHole = p.invertShadow ? true : false;
                 } else {
                    const isDark = brightness < 128;
                    isHole = p.invertShadow ? !isDark : isDark;
                 }
              }
           }
        }
        
        // SUPPORT GRID: Overwrite hole state if on a grid line
        // A thin grid every ~20 pixels (approx 1mm)
        if (isHole) {
           const gridSpacing = 20;
           if (u % gridSpacing < 2 || v % gridSpacing < 2) {
               isHole = false; // Turn back into solid plastic
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

    vCtx.putImageData(vData, 0, 0);
    const vTex = new THREE.CanvasTexture(vCanvas);
    setValidationMap(vTex);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validateTrigger]);


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
        <cylinderGeometry args={[radius, radius, height, 64, 1, true]} />
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
        <cylinderGeometry args={[radius - thickness, radius - thickness, height, 64, 1, true]} />
        <meshStandardMaterial 
          color={cylinderAlphaMap ? "#e2dff5" : "#c084fc"} 
          transparent={true}
          opacity={cylinderAlphaMap ? 1 : 0.15} 
          alphaMap={cylinderAlphaMap}
          alphaTest={currentAlphaTest}
          side={THREE.DoubleSide} 
        />
      </mesh>

      {/* Solid Base Cap touching the wall */}
      <mesh position={[0, 0, distance - thickness / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius, radius, thickness, 64]} />
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
      {/* It sits perfectly ON the wall facing the bulb */}
      <mesh 
        position={[imgOffsetX, imgOffsetY, distance]} 
        rotation={[0, 0, imgRotation * Math.PI / 180]}
        scale={[imgScaleX, imgScaleY, 1]}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial 
          map={wallTex} 
          transparent={true}
          opacity={cylinderAlphaMap ? 0.3 : 1.0} 
          depthWrite={false}
          color="#ffffff"
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
