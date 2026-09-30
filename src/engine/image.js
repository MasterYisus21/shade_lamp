// Carga de imágenes a luminancia (0..255). Lo transparente cuenta como blanco,
// así el resultado no depende del color de la pared.

const MAX_SIDE = 4096;

export function loadImageLuminance(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const isSvg = dataUrl.startsWith('data:image/svg+xml');
      let w = img.naturalWidth || img.width || 1024;
      let h = img.naturalHeight || img.height || 1024;
      // Los SVG se rasterizan al máximo; los mapas de bits solo se reducen si son enormes.
      const scale = isSvg ? MAX_SIDE / Math.max(w, h) : Math.min(1, MAX_SIDE / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const lum = new Uint8Array(w * h);
      for (let i = 0, p = 0; p < lum.length; i += 4, p++) {
        const a = data[i + 3] / 255;
        const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        lum[p] = Math.round(l * a + 255 * (1 - a));
      }
      resolve({ lum, width: w, height: h });
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = dataUrl;
  });
}

/** Imagen de prueba: una cruz negra sobre blanco. */
export function defaultImage(size = 256) {
  const lum = new Uint8Array(size * size).fill(255);
  const a = Math.round(size * 0.45);
  const b = Math.round(size * 0.55);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x >= a && x < b) || (y >= a && y < b)) lum[y * size + x] = 0;
    }
  }
  return { lum, width: size, height: size };
}
