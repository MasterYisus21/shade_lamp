import React, { useMemo, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';
import { LIGHT_COLORS, WALL_COLORS, PART_COLORS } from './theme';

// La escena trabaja en cm; la malla del motor viene en mm (escala 0.1).
// Bombillo en el origen, pared en Z = distancia.

function useTrisGeometry(tris) {
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

function useWallTexture(wall, lightFillColor, wallTone) {
  const texture = useMemo(() => {
    if (!wall) return null;
    const { mask, size } = wall;
    const [r, g, b] = (LIGHT_COLORS[lightFillColor] || LIGHT_COLORS.warm).rgb;
    const lightWall = wallTone === 'light';
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const o = i * 4;
        if (!mask[i]) {
          // Pared clara: la sombra oscurece la pared, desvaneciéndose hacia los bordes
          if (lightWall) {
            const dx = (x + 0.5) / size - 0.5;
            const dy = (y + 0.5) / size - 0.5;
            const fall = Math.max(0, 1 - (dx * dx + dy * dy) * 4);
            data[o] = 18;
            data[o + 1] = 20;
            data[o + 2] = 24;
            data[o + 3] = Math.round(190 * fall * fall);
          }
          continue;
        }
        // Borde brillante: píxel con luz junto a uno en sombra
        const edge = (x > 0 && !mask[i - 1]) || (x < size - 1 && !mask[i + 1]) ||
          (y > 0 && !mask[i - size]) || (y < size - 1 && !mask[i + size]);
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = edge ? 255 : lightWall ? 90 : 150;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, [wall, lightFillColor, wallTone]);
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

/** Lleva la cámara a la vista inicial cada vez que cambia resetKey. */
function CameraRig({ resetKey, target, size }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    // Encuadra la lámpara y el dibujo de la pared desde el lado de la habitación
    const k = Math.max(1, size / 10);
    camera.position.set(14 * k, 9 * k, target[2] - 30 * k);
    camera.lookAt(...target);
    if (controls) {
      controls.target.set(...target);
      controls.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, controls]);
  return null;
}

export default function Scene({
  lampTris,
  parts,
  wall,
  showWall,
  image,
  imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation, imgFlipX, imgFlipY,
  distance, height, bulbRadius, sceneSize, viewSize = sceneSize, exploded,
  visible = { shade: true, base: true, cap: true, post: true },
  wallTone = 'dark', lightFillColor, resetKey = 0,
}) {
  const lampGeo = useTrisGeometry(lampTris);
  const baseGeo = useTrisGeometry(parts?.base);
  const capGeo = useTrisGeometry(parts?.cap);
  const postGeo = useTrisGeometry(parts?.post);
  const wallTex = useWallTexture(wall, lightFillColor, wallTone);
  const imageTex = useImageTexture(image);
  const wallHalfCm = wall ? wall.half / 10 : 0;
  const showShadow = showWall && wallTex;
  // Vista separada: la pantalla y la tapa se alejan de la base hacia la habitación
  const ex = exploded ? Math.max(4, height * 0.6) : 0;
  const OFFSET = { shade: -ex, base: 0, post: 0, cap: -2 * ex };
  const meshes = [['shade', lampGeo], ['base', baseGeo], ['cap', capGeo], ['post', postGeo]];

  return (
    <Canvas camera={{ position: [14, 9, -23], fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={['#0d1014']} />

      <hemisphereLight args={['#f4efe6', '#20242b', 0.9]} />
      <directionalLight position={[-25, 35, -40]} intensity={1.4} />
      <directionalLight position={[30, -10, -20]} intensity={0.35} />
      <pointLight position={[0, 0, 0]} intensity={10} color="#ffd9a0" distance={distance * 3} />

      <OrbitControls target={[0, 0, distance]} makeDefault enableDamping dampingFactor={0.1} />
      <CameraRig resetKey={resetKey} target={[0, 0, distance]} size={viewSize} />
      <Grid
        infiniteGrid
        fadeDistance={90}
        fadeStrength={4}
        cellSize={1}
        sectionSize={10}
        cellColor="#1c2129"
        sectionColor="#2a313b"
        position={[0, -sceneSize - 1, 0]}
      />

      {/* Bombillo */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[bulbRadius, 32, 32]} />
        <meshBasicMaterial color="#fff6e5" />
      </mesh>

      {/* Pantalla, base, tapa y poste: las mismas mallas que se exportan */}
      {meshes.map(([kind, geo]) => geo && visible[kind] && (
        <mesh key={kind} geometry={geo} scale={0.1} position={[0, 0, OFFSET[kind]]}>
          <meshStandardMaterial color={PART_COLORS[kind]} roughness={0.75} metalness={0} />
        </mesh>
      ))}

      {/* Pared */}
      <mesh position={[0, 0, distance + 0.05]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={WALL_COLORS[wallTone] || WALL_COLORS.dark} roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {/* Imagen original sobre la pared (referencia, cuando no se muestra la luz) */}
      {imageTex && !showShadow && (
        <mesh
          position={[imgOffsetX, imgOffsetY, distance + 0.02]}
          // Igual que el motor: primero se refleja la imagen en su propio eje (escala
          // negativa), luego se rota, y el giro de 180° en Y la orienta hacia la habitación.
          rotation={[0, Math.PI, (imgRotation * Math.PI) / 180]}
          scale={[imgFlipX ? -imgScaleX : imgScaleX, imgFlipY ? -imgScaleY : imgScaleY, 1]}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={imageTex}
            transparent
            opacity={0.9}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Luz proyectada calculada desde la geometría real */}
      {showShadow && (
        <mesh position={[0, 0, distance - 0.01]}>
          <planeGeometry args={[wallHalfCm * 2, wallHalfCm * 2]} />
          <meshBasicMaterial map={wallTex} transparent depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}

      <Line points={[[0, 0, 0], [0, 0, distance]]} color="#5b6472" lineWidth={1} dashed dashSize={0.4} gapSize={0.3} />
    </Canvas>
  );
}
