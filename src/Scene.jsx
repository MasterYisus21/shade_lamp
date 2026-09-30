import React, { useMemo, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';

// La escena trabaja en cm; la malla del motor viene en mm (escala 0.1).
// Bombillo en el origen, pared en Z = distancia.

const LIGHT_COLORS = {
  yellow: [255, 230, 100],
  white: [255, 255, 255],
  blue: [0, 200, 255],
};

function useLampGeometry(tris) {
  const geometry = useMemo(() => {
    if (!tris || tris.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tris, 3));
    g.computeVertexNormals();
    return g;
  }, [tris]);
  useEffect(() => () => geometry && geometry.dispose(), [geometry]);
  return geometry;
}

function useWallTexture(wall, lightFillColor) {
  const texture = useMemo(() => {
    if (!wall) return null;
    const { mask, size } = wall;
    const [r, g, b] = LIGHT_COLORS[lightFillColor] || LIGHT_COLORS.yellow;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (!mask[i]) continue;
        // Borde brillante: píxel con luz junto a uno en sombra
        const edge = (x > 0 && !mask[i - 1]) || (x < size - 1 && !mask[i + 1]) ||
          (y > 0 && !mask[i - size]) || (y < size - 1 && !mask[i + size]);
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = edge ? 255 : 150;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, [wall, lightFillColor]);
  useEffect(() => () => texture && texture.dispose(), [texture]);
  return texture;
}

function useImageTexture(image) {
  const texture = useMemo(() => {
    if (!image) return null;
    // Solo es una referencia visual: basta con 1024 px de lado
    const step = Math.max(1, Math.ceil(Math.max(image.width, image.height) / 1024));
    const width = Math.ceil(image.width / step);
    const height = Math.ceil(image.height / step);
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const src = (image.height - 1 - Math.min(image.height - 1, y * step)) * image.width; // DataTexture: fila 0 abajo
      for (let x = 0; x < width; x++) {
        const v = image.lum[src + Math.min(image.width - 1, x * step)];
        const o = (y * width + x) * 4;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, [image]);
  useEffect(() => () => texture && texture.dispose(), [texture]);
  return texture;
}

export default function Scene({
  lampTris,
  wall,
  showWall,
  image,
  imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation, imgFlipX, imgFlipY,
  distance, height, bulbRadius, sceneSize,
  bgColor, lightFillColor,
}) {
  const lampGeo = useLampGeometry(lampTris);
  const wallTex = useWallTexture(wall, lightFillColor);
  const imageTex = useImageTexture(image);
  const wallHalfCm = wall ? wall.half / 10 : 0;
  const showShadow = showWall && wallTex;

  return (
    <Canvas camera={{ position: [15, 10, -15], fov: 45 }}>
      <color attach="background" args={['#0f172a']} />

      <ambientLight intensity={0.6} />
      <directionalLight position={[-20, 30, -30]} intensity={1.2} />
      <pointLight position={[0, 0, 0]} intensity={8} color="#fff4d6" distance={distance * 3} />

      <OrbitControls target={[0, 0, distance]} makeDefault />
      <axesHelper args={[15]} />
      <Grid infiniteGrid fadeDistance={60} fadeStrength={5} cellColor="#334155" sectionColor="#475569" position={[0, -sceneSize - 1, 0]} />

      {/* Bombillo */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[bulbRadius, 32, 32]} />
        <meshBasicMaterial color="#fff" />
      </mesh>

      {/* Pantalla: la misma malla que se exporta (en calidad borrador) */}
      {lampGeo && (
        <mesh geometry={lampGeo} scale={0.1}>
          <meshStandardMaterial color="#c9bfdc" roughness={0.6} metalness={0.05} />
        </mesh>
      )}

      {/* Pared */}
      <mesh position={[0, 0, distance + 0.05]}>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial color={bgColor || '#1e293b'} side={THREE.DoubleSide} />
      </mesh>

      {/* Imagen original sobre la pared (referencia) */}
      {imageTex && (
        <mesh
          position={[imgOffsetX, imgOffsetY, distance + 0.02]}
          rotation={[imgFlipY ? Math.PI : 0, imgFlipX ? 0 : Math.PI, (imgRotation * Math.PI) / 180]}
          scale={[imgScaleX, imgScaleY, 1]}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={imageTex} transparent opacity={showShadow ? 0.18 : 0.9} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Luz proyectada calculada desde la geometría real */}
      {showShadow && (
        <mesh position={[0, 0, distance - 0.01]}>
          <planeGeometry args={[wallHalfCm * 2, wallHalfCm * 2]} />
          <meshBasicMaterial map={wallTex} transparent depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}

      <Line points={[[0, 0, 0], [0, 0, distance]]} color="rgba(255,255,255,0.2)" lineWidth={1} dashed />
      <Line
        points={[[0, 0, distance - height], [0, 0, distance]]}
        color="rgba(192,132,252,0.35)"
        lineWidth={1}
        dashed
      />
    </Canvas>
  );
}
