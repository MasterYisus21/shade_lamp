// Zona para subir la imagen (clic o arrastrar) con miniatura de lo que ve el motor.

import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';

function Thumbnail({ image }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    const scale = Math.min(1, 160 / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(image.height - 1, Math.floor(y / scale));
      for (let x = 0; x < w; x++) {
        const v = image.lum[sy * image.width + Math.min(image.width - 1, Math.floor(x / scale))];
        const o = (y * w + x) * 4;
        out.data[o] = v;
        out.data[o + 1] = v;
        out.data[o + 2] = v;
        out.data[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }, [image]);
  return <canvas ref={ref} className="thumb" />;
}

export default function ImageDrop({ image, name, isCustom, onFile, onRemove }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  const pick = (file) => {
    if (file && file.type.startsWith('image/')) onFile(file);
  };

  return (
    <div
      className={`drop${over ? ' over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
    >
      <div className="drop-thumb">
        <Thumbnail image={image} />
      </div>
      <div className="drop-info">
        <span className="drop-name">{isCustom ? name : 'Imagen de prueba (cruz)'}</span>
        <span className="hint">{image.width} × {image.height} px</span>
        <span className="drop-cta"><ImagePlus size={14} /> {isCustom ? 'Cambiar imagen' : 'Subir o arrastrar imagen'}</span>
      </div>
      {isCustom && (
        <button
          type="button"
          className="drop-remove"
          title="Quitar imagen"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <X size={14} />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }}
      />
    </div>
  );
}
