import React, { useMemo, useEffect, useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { getShapeRadius } from './utils/geometry.js';

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
  radius, shapeType, boxWidth, boxDepth, boxCornerRadius, height, thickness, distance, bulbRadius, uploadedImage, imageName,
  imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation,
  imgFlipX, imgFlipY,
  invertShadow, supportType, supportThickness, supportSpacing, 
  calculateTrigger, validateTrigger, resetPulse,
  exportTrigger, exportQuality,
  onCalculateComplete, onValidateComplete, onExportComplete, 
  bgColor, lightFillColor
}) {
  const [wallTex, setWallTex] = useState(null);
  const [sourceImgData, setSourceImgData] = useState(null);
  const [cylinderAlphaMap, setCylinderAlphaMap] = useState(null);
  const [validationMap, setValidationMap] = useState(null);
  
  const defaultTexture = useMemo(() => generateTestTexture(), []);
  
  // Ref to hold alpha array so validation can read it later without recalculating
  const alphaDataRef = useRef(null);
  const workerRef = useRef(null);

  useEffect(() => {
    workerRef.current = new Worker(new URL('./workers/geometryWorker.js', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e) => {
      const { type, data, width, height, message } = e.data;
      if (type === 'CALCULATE_HOLES_COMPLETE') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imgData = new ImageData(data, width, height);
        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        setCylinderAlphaMap(tex);
        alphaDataRef.current = data; // Guardamos el array crudo para el siguiente paso
        if (onCalculateComplete) onCalculateComplete();
      } else if (type === 'VALIDATE_TRACE_COMPLETE') {
        const vCanvas = document.createElement('canvas');
        vCanvas.width = width;
        vCanvas.height = height;
        const vCtx = vCanvas.getContext('2d');
        const imgData = new ImageData(data, width, height);
        vCtx.putImageData(imgData, 0, 0);
        const vTex = new THREE.CanvasTexture(vCanvas);
        setValidationMap(vTex);
        if (onValidateComplete) onValidateComplete();
      } else if (type === 'EXPORT_STL_COMPLETE') {
        const { exportQuality } = e.data;
        const p = paramsRef.current;
        const defaultName = `lamp_${p.imageName}_${p.distance}cm_${p.shapeType}_${exportQuality}`;
        const fileName = window.prompt("Introduce el nombre del archivo STL a exportar:", defaultName);
        if (fileName !== null && fileName.trim() !== "") {
          const safeFileName = fileName.endsWith('.stl') ? fileName : `${fileName}.stl`;
          const blob = new Blob([data], { type: 'text/plain' });
          const link = document.createElement('a');
          link.style.display = 'none';
          link.href = URL.createObjectURL(blob);
          link.download = safeFileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
        if (onExportComplete) onExportComplete();
      } else if (type === 'EXPORT_PROGRESS') {
        console.log(message);
      } else if (type === 'ERROR') {
        console.error("Worker error:", message);
        alert("Error en el cálculo 3D: " + message);
        if (onCalculateComplete) onCalculateComplete();
        if (onValidateComplete) onValidateComplete();
        if (onExportComplete) onExportComplete();
      }
    };
    return () => {
      if (workerRef.current) workerRef.current.terminate();
    };
  }, []);

  const paramsRef = useRef({
    radius, shapeType, boxWidth, boxDepth, boxCornerRadius, height, thickness, distance,
    imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation,
    imgFlipX, imgFlipY, invertShadow,
    supportType, supportThickness, supportSpacing, bgColor, imageName, lightFillColor
  });

  useEffect(() => {
    paramsRef.current = { 
      radius, shapeType, boxWidth, boxDepth, boxCornerRadius, height, thickness, distance, imgOffsetX, imgOffsetY, 
      imgScaleX, imgScaleY, imgRotation, imgFlipX, imgFlipY, invertShadow,
      supportType, supportThickness, supportSpacing, bgColor, imageName, lightFillColor
    };
  }, [radius, shapeType, boxWidth, boxDepth, boxCornerRadius, height, thickness, distance, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation, imgFlipX, imgFlipY, invertShadow, supportType, supportThickness, supportSpacing, bgColor, imageName, lightFillColor]);

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
        let targetW = img.width;
        let targetH = img.height;
        
        const isSvg = uploadedImage.startsWith('data:image/svg+xml');
        const maxSize = Math.max(targetW || 1, targetH || 1);
        
        if (isSvg || maxSize < 2048) {
             const scale = 2048 / maxSize;
             targetW = Math.max(1, Math.floor(targetW * scale));
             targetH = Math.max(1, Math.floor(targetH * scale));
        }

        const c = document.createElement('canvas');
        c.width = targetW;
        c.height = targetH;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, targetW, targetH);
        setSourceImgData(ctx.getImageData(0, 0, targetW, targetH));
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
    if (workerRef.current) {
        workerRef.current.postMessage({
            type: 'CALCULATE_HOLES',
            payload: {
                params: paramsRef.current,
                sourceImgData
            }
        });
    }
  }, [calculateTrigger]); 

  // 2. VALIDATE TRACE (Triggered by Button 2)
  useEffect(() => {
    if (validateTrigger === 0) return;
    if (!alphaDataRef.current) {
        alert("¡Por favor calcula los huecos primero (Paso 1)!");
        if (onValidateComplete) onValidateComplete();
        return;
    }
    
    if (workerRef.current) {
        workerRef.current.postMessage({
            type: 'VALIDATE_TRACE',
            payload: {
                params: paramsRef.current,
                alphaDataRaw: alphaDataRef.current
            }
        });
    }
  }, [validateTrigger]);

  // 3. EXPORT STL GENERATION
  useEffect(() => {
    if (exportTrigger === 0 || !sourceImgData) return;
    if (workerRef.current) {
        workerRef.current.postMessage({
            type: 'EXPORT_STL',
            payload: {
                params: paramsRef.current,
                sourceImgData,
                exportQuality
            }
        });
    }
  }, [exportTrigger]);


  const currentAlphaTest = cylinderAlphaMap ? 0.5 : 0;

  const morphCylinder = (inner) => {
    const geo = new THREE.CylinderGeometry(1, 1, height, 360, 1, true);
    const pos = geo.attributes.position.array;
    const thk = inner ? thickness : 0;
    const w = boxWidth - 2 * thk;
    const d = boxDepth - 2 * thk;
    const cr = Math.max(0, boxCornerRadius - thk);
    const rad = radius - thk;
    for (let i = 0; i < pos.length; i += 3) {
      const bx = pos[i], bz = pos[i+2];
      const dist = Math.sqrt(bx*bx + bz*bz);
      if (dist > 0.001) {
         let th = Math.atan2(bx, bz);
         const R = getShapeRadius(th, shapeType, rad, w, d, cr);
         pos[i] = (bx / dist) * R;
         pos[i+2] = (bz / dist) * R;
      }
    }
    geo.computeVertexNormals();
    return geo;
  };

  const morphBaseCap = () => {
    const geo = new THREE.CylinderGeometry(1, 1, thickness, 360, 1, false);
    const pos = geo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const bx = pos[i], bz = pos[i+2];
      const dist = Math.sqrt(bx*bx + bz*bz);
      if (dist > 0.001) {
         let th = Math.atan2(bx, bz);
         const R = getShapeRadius(th, shapeType, radius, boxWidth, boxDepth, boxCornerRadius);
         pos[i] = (bx / dist) * R;
         pos[i+2] = (bz / dist) * R;
      }
    }
    geo.computeVertexNormals();
    return geo;
  };

  const morphRing = () => {
    const geo = new THREE.RingGeometry(0.5, 1.0, 360);
    const pos = geo.attributes.position.array;
    const thk = thickness;
    const w = boxWidth - 2 * thk;
    const d = boxDepth - 2 * thk;
    const crInner = Math.max(0, boxCornerRadius - thk);
    
    for (let i = 0; i < pos.length; i += 3) {
       const x = pos[i], y = pos[i+1];
       const dist = Math.sqrt(x*x + y*y);
       if (dist > 0.001) {
          const th = Math.atan2(x, -y);
          let R = 1;
          if (dist < 0.75) {
             R = getShapeRadius(th, shapeType, radius - thk, w, d, crInner);
          } else {
             R = getShapeRadius(th, shapeType, radius, boxWidth, boxDepth, boxCornerRadius);
          }
          pos[i] = (x / dist) * R;
          pos[i+1] = (y / dist) * R;
       }
    }
    geo.computeVertexNormals();
    return geo;
  };

  const outerGeo = useMemo(() => morphCylinder(false), [shapeType, radius, boxWidth, boxDepth, boxCornerRadius, height, thickness]);
  const innerGeo = useMemo(() => morphCylinder(true), [shapeType, radius, boxWidth, boxDepth, boxCornerRadius, height, thickness]);
  const capGeo = useMemo(() => morphBaseCap(), [shapeType, radius, boxWidth, boxDepth, boxCornerRadius, thickness]);
  const rimGeo = useMemo(() => morphRing(), [shapeType, radius, boxWidth, boxDepth, boxCornerRadius, thickness]);

  return (
    // Fixed Camera position: Start at Z=-15 looking from the Origin perspective towards the Wall!!
    <Canvas camera={{ position: [15, 10, -15], fov: 45 }}>
      <color attach="background" args={['#0f172a']} />
      
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 0, 0]} intensity={10} color="#c084fc" distance={distance * 2} />
      
      {/* We target looking at the wall (Z=distance) instead of (0,0,0) */}
      <OrbitControls target={[0, 0, distance]} makeDefault />
      <axesHelper args={[15]} />
      <Grid infiniteGrid fadeDistance={40} fadeStrength={5} cellColor="#334155" sectionColor="#475569" position={[0, -Math.max(height, boxWidth/2) - 1, 0]} />

      {/* Origin Light Bulb */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[bulbRadius, 32, 32]} />
        <meshBasicMaterial color="#fff" />
      </mesh>

      {/* The Cylinder */}
      <mesh position={[0, 0, distance - height / 2]} rotation={[Math.PI / 2, 0, 0]} geometry={outerGeo}>
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
      <mesh position={[0, 0, distance - height / 2]} rotation={[Math.PI / 2, 0, 0]} geometry={innerGeo}>
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
      <mesh position={[0, 0, distance - height]} rotation={[0, Math.PI, 0]} geometry={rimGeo}>
        <meshStandardMaterial 
          color={cylinderAlphaMap ? "#b4a9c1" : "#9b51e0"}
          transparent={true}
          opacity={cylinderAlphaMap ? 1 : 0.3} 
          side={THREE.DoubleSide} 
        />
      </mesh>

      {/* Solid Base Cap touching the wall */}
      <mesh position={[0, 0, distance - thickness / 2]} rotation={[Math.PI / 2, 0, 0]} geometry={capGeo}>
        <meshStandardMaterial color="#7e22ce" side={THREE.DoubleSide} />
      </mesh>

      {/* Generic dark Wall - pushed BACK slightly (Z = distance + 0.05) to naturally sit behind the Base Cap and Image plane */}
      <mesh position={[0, 0, distance + 0.05]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={bgColor || "#1e293b"} side={THREE.DoubleSide} />
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
