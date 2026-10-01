// Vista de la tapa litofanía encendida, como la ve alguien desde la habitación.

import React, { useEffect, useRef } from 'react';
import { lithoBrightness } from '../theme';

export default function CapGlow({ raster, step, rgb }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !raster) return;
    const { levels, size } = raster;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(size, size);
    const shade = Array.from({ length: raster.n + 1 }, (_, l) => lithoBrightness(l, step));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // El ráster está en el marco de la tapa (fila 0 abajo); desde la habitación la derecha es -x
        const level = levels[(size - 1 - y) * size + (size - 1 - x)];
        const o = (y * size + x) * 4;
        if (level === 255) continue;
        const b = shade[level];
        out.data[o] = rgb[0] * b;
        out.data[o + 1] = rgb[1] * b;
        out.data[o + 2] = rgb[2] * b;
        out.data[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }, [raster, step, rgb]);
  return <canvas ref={ref} className="cap-glow" />;
}
