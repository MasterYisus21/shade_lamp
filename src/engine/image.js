// Carga de imágenes a luminancia (0..255). Lo transparente cuenta como blanco,
// así el resultado no depende del color de la pared.

export const MAX_SIDE = 4096;
const CHUNK = 1 << 20; // píxeles convertidos antes de ceder el hilo a la interfaz
// Límites de entrada: evitan que una imagen enorme agote la memoria de la pestaña
export const MAX_IMAGE_MB = 50;
const MAX_PIXELS = 100e6; // ~100 megapíxeles (el navegador la descomprime entera antes de reducirla)

/** Error de entrada con una clave de traducción (limits.*) y sus valores. */
export class InputError extends Error {
  constructor(code, vars = {}) {
    super(code);
    this.name = 'InputError';
    this.code = code;
    this.vars = vars;
  }
}

/**
 * Cede el hilo principal para que la interfaz pinte (barra de progreso). El
 * temporizador cubre las pestañas ocultas, donde requestAnimationFrame se pausa.
 */
export const nextFrame = () => new Promise((resolve) => {
  const timer = setTimeout(resolve, 50);
  requestAnimationFrame(() => setTimeout(() => { clearTimeout(timer); resolve(); }, 0));
});

function decode(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = src;
  });
}

/**
 * @param {File} file
 * @param {(progress: number, stage: string) => void} [onProgress] progreso 0..1 y
 *   etapa ('read' | 'raster' | 'prepare' | 'gray', claves de loading.* en i18n)
 */
export async function loadImageLuminance(file, onProgress = () => {}) {
  if (file.size > MAX_IMAGE_MB * 1e6) throw new InputError('imageTooLarge', { max: MAX_IMAGE_MB });
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  const url = URL.createObjectURL(file);
  try {
    onProgress(0.05, 'read');
    await nextFrame();
    const img = await decode(url);

    let w = img.naturalWidth || img.width || 1024;
    let h = img.naturalHeight || img.height || 1024;
    // Los SVG se rasterizan a MAX_SIDE, su tamaño declarado no importa
    if (!isSvg && w * h > MAX_PIXELS) throw new InputError('imagePixels', { mp: Math.round(MAX_PIXELS / 1e6) });
    // Los SVG se rasterizan al máximo; los mapas de bits solo se reducen si son enormes.
    const scale = isSvg ? MAX_SIDE / Math.max(w, h) : Math.min(1, MAX_SIDE / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));

    onProgress(0.2, isSvg ? 'raster' : 'prepare');
    await nextFrame();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const lum = new Uint8Array(w * h);
    for (let start = 0; start < lum.length; start += CHUNK) {
      onProgress(0.35 + 0.45 * (start / lum.length), 'gray');
      await nextFrame();
      const end = Math.min(lum.length, start + CHUNK);
      for (let p = start, i = start * 4; p < end; i += 4, p++) {
        const a = data[i + 3] / 255;
        const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        lum[p] = Math.round(l * a + 255 * (1 - a));
      }
    }
    onProgress(0.8, 'gray');
    return { lum, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
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

/** Logo de prueba para la tapa: una estrella con degradado (muestra los tonos). */
export function defaultCapImage(size = 256) {
  const lum = new Uint8Array(size * size).fill(255);
  const star = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? 0.2 : 0.46;
    star.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = star.length - 1; i < star.length; j = i++) {
      const [xi, yi] = star[i];
      const [xj, yj] = star[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      // De negro arriba a gris claro abajo
      if (inside(u, v)) lum[y * size + x] = Math.round(220 * Math.min(1, Math.max(0, (v - 0.04) / 0.8)));
    }
  }
  return { lum, width: size, height: size };
}
