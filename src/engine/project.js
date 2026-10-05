// Proyectos: archivo .shadelamp (JSON con los ajustes y las imágenes en PNG) y
// autoguardado en IndexedDB para recuperar el diseño si el navegador recarga la
// pestaña (p. ej. Chrome la descarta en segundo plano para liberar memoria).

import { loadImageLuminance } from './image';

export const PROJECT_EXT = '.shadelamp';
const APP_ID = 'shade_lamp';
const VERSION = 1;

const FILE_TYPES = [{ description: 'Shade Lamp', accept: { 'application/json': [PROJECT_EXT] } }];

/** El selector de archivos nativo (Chrome, Edge) permite volver a guardar sobre el mismo archivo. */
export const canPickFiles = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

// ───────────── Ajustes ─────────────

/**
 * Copia de `saved` con solo valores válidos; lo que falte o no sirva se toma de
 * `defaults` (mismo orden de claves, así JSON.stringify sirve para comparar).
 * @param {object} choices valores permitidos de los ajustes de texto
 */
export function sanitizeSettings(saved, defaults, choices = {}) {
  const src = saved && typeof saved === 'object' ? saved : {};
  const pick = (value, def, allowed) => {
    if (typeof def === 'number') return Number.isFinite(value) ? value : def;
    if (typeof def === 'boolean') return typeof value === 'boolean' ? value : def;
    if (typeof def === 'string') return typeof value === 'string' && (!allowed || allowed.includes(value)) ? value : def;
    if (def && typeof def === 'object') return sanitizeSettings(value, def, allowed);
    return def;
  };
  return Object.fromEntries(Object.entries(defaults).map(([key, def]) => [key, pick(src[key], def, choices[key])]));
}

// ───────────── Imágenes ─────────────

/** Luminancia → PNG en escala de grises (sin pérdida). */
function imageToPng(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(image.width, image.height);
  const d = out.data;
  for (let p = 0, i = 0; p < image.lum.length; p++, i += 4) {
    d[i] = image.lum[p];
    d[i + 1] = image.lum[p];
    d[i + 2] = image.lum[p];
    d[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG'))), 'image/png');
  });
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

async function pngToImage(dataUrl, onProgress) {
  const blob = await (await fetch(dataUrl)).blob();
  return loadImageLuminance(new File([blob], 'image.png', { type: 'image/png' }), onProgress);
}

// ───────────── Archivo .shadelamp ─────────────

/**
 * @param {{ settings: object, wall: {name, image}|null, cap: {name, image}|null }} project
 *   wall/cap son null cuando se usa la imagen de prueba
 * @returns {Promise<Blob>}
 */
export async function serializeProject({ settings, wall, cap }) {
  const packImage = async (entry) => (entry ? { name: entry.name, png: await blobToDataUrl(await imageToPng(entry.image)) } : null);
  const data = {
    app: APP_ID,
    version: VERSION,
    savedAt: new Date().toISOString(),
    settings,
    images: { wall: await packImage(wall), cap: await packImage(cap) },
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/**
 * Lee un archivo de proyecto. Los ajustes vuelven sin validar (ver sanitizeSettings).
 * @param {(progress: number) => void} [onProgress] 0..0.85
 */
export async function parseProject(file, onProgress = () => {}) {
  const data = JSON.parse(await file.text());
  if (!data || data.app !== APP_ID || typeof data.settings !== 'object') throw new Error('not a project');
  const unpack = async (entry, from, to) => {
    if (!entry || typeof entry.png !== 'string' || !entry.png.startsWith('data:image/')) return null;
    const image = await pngToImage(entry.png, (p) => onProgress(from + (to - from) * (p / 0.8)));
    return { name: String(entry.name || ''), image };
  };
  onProgress(0.05);
  const wall = await unpack(data.images?.wall, 0.05, 0.45);
  const cap = await unpack(data.images?.cap, 0.45, 0.85);
  return { settings: data.settings, wall, cap };
}

/** El usuario cerró el selector de archivos sin elegir. */
export const isAbort = (err) => err && err.name === 'AbortError';

/**
 * Dónde guardar. Con el selector nativo se pide la ubicación solo la primera
 * vez; después se escribe sobre el mismo archivo. Debe llamarse al principio del
 * clic (el navegador exige un gesto reciente del usuario).
 * @returns {Promise<FileSystemFileHandle|null>} null = descarga normal
 */
export async function pickSaveTarget(handle, suggestedName) {
  if (!canPickFiles) return null;
  if (handle) {
    const ok = (await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted'
      || (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
    if (ok) return handle;
  }
  return window.showSaveFilePicker({ suggestedName, types: FILE_TYPES });
}

export async function writeToHandle(handle, blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** @returns {Promise<{file: File, handle: FileSystemFileHandle}>} */
export async function pickProjectFile() {
  const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
  return { file: await handle.getFile(), handle };
}

export const projectBaseName = (fileName) => fileName.replace(/\.(shadelamp|json)$/i, '');

// ───────────── Autoguardado (IndexedDB) ─────────────

const DB_NAME = 'shade_lamp';
const STORE = 'autosave';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function run(mode, action) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/**
 * Guarda una parte del proyecto: 'state' (ajustes, nombre…) o una imagen
 * ('wall', 'cap'). Las imágenes van aparte para no reescribirlas con cada ajuste.
 * Los errores se ignoran: el autoguardado es una ayuda, no la copia principal.
 */
export function autosavePut(key, value) {
  return run('readwrite', (store) => store.put(value, key)).catch((err) => {
    console.warn('Autoguardado no disponible:', err);
  });
}

/** @returns {Promise<{state?: object, wall?: object|null, cap?: object|null}|null>} */
export async function autosaveLoad() {
  try {
    const [state, wall, cap] = await Promise.all(['state', 'wall', 'cap'].map((key) => run('readonly', (store) => store.get(key))));
    const valid = (entry) => {
      const img = entry && entry.image;
      return img && img.lum instanceof Uint8Array && img.lum.length === img.width * img.height ? entry : null;
    };
    return state && state.settings ? { state, wall: valid(wall), cap: valid(cap) } : null;
  } catch (err) {
    console.warn('No se pudo leer el autoguardado:', err);
    return null;
  }
}
