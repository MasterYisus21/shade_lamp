// Proyectos: archivo .shadelamp (JSON con los ajustes y las imágenes en PNG) y
// autoguardado en IndexedDB para recuperar el diseño si el navegador recarga la
// pestaña (p. ej. Chrome la descarta en segundo plano para liberar memoria).

import { loadImageLuminance, InputError, MAX_SIDE } from './image';

export const PROJECT_EXT = '.shadelamp';
const APP_ID = 'shade_lamp';
const VERSION = 1;
// Un proyecto con dos imágenes de 4096 px rara vez pasa de unos pocos MB
export const MAX_PROJECT_MB = 100;
const MAX_NAME = 80;

const FILE_TYPES = [{ description: 'Shade Lamp', accept: { 'application/json': [PROJECT_EXT] } }];

/** El selector de archivos nativo (Chrome, Edge) permite volver a guardar sobre el mismo archivo. */
export const canPickFiles = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

// ───────────── Ajustes ─────────────

/**
 * Copia de `saved` con solo valores válidos; lo que falte o no sirva se toma de
 * `defaults` (mismo orden de claves, así JSON.stringify sirve para comparar).
 * Un archivo puede venir de cualquiera: los números se limitan a los mismos
 * rangos que la interfaz para que no se pueda pedir una pieza gigante que cuelgue
 * el navegador.
 * @param {object} rules por clave: { min, max, int } para números, { oneOf } para
 *   textos y un objeto de reglas para los ajustes anidados
 */
export function sanitizeSettings(saved, defaults, rules = {}) {
  const src = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const pick = (value, def, rule = {}) => {
    if (typeof def === 'number') {
      if (!Number.isFinite(value)) return def;
      const v = rule.int ? Math.round(value) : value;
      return Math.min(rule.max ?? Infinity, Math.max(rule.min ?? -Infinity, v));
    }
    if (typeof def === 'boolean') return typeof value === 'boolean' ? value : def;
    if (typeof def === 'string') return typeof value === 'string' && (!rule.oneOf || rule.oneOf.includes(value)) ? value : def;
    if (def && typeof def === 'object') return sanitizeSettings(value, def, rule);
    return def;
  };
  return Object.fromEntries(Object.entries(defaults).map(([key, def]) => [key, pick(src[key], def, rules[key])]));
}

/**
 * Nombre apto para archivos: sin rutas («../»), caracteres reservados ni de
 * control, que acabarían en los nombres del STL y dentro del ZIP.
 */
export function safeName(name) {
  const clean = String(name ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    .replace(/^[\s._]+|[\s.]+$/g, '')
    .slice(0, MAX_NAME);
  return clean || null;
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

const PNG_PREFIX = 'data:image/png;base64,';

/** Solo PNG en base64: se decodifica aquí (sin fetch) y se carga como cualquier imagen. */
async function pngToImage(dataUrl, onProgress) {
  if (!dataUrl.startsWith(PNG_PREFIX)) throw new InputError('badProject');
  let binary;
  try {
    binary = atob(dataUrl.slice(PNG_PREFIX.length));
  } catch {
    throw new InputError('badProject');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return loadImageLuminance(new File([bytes], 'image.png', { type: 'image/png' }), onProgress);
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
  if (file.size > MAX_PROJECT_MB * 1e6) throw new InputError('projectTooLarge', { max: MAX_PROJECT_MB });
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new InputError('badProject');
  }
  if (!data || data.app !== APP_ID || !data.settings || typeof data.settings !== 'object') throw new InputError('badProject');
  if (Number(data.version) > VERSION) throw new InputError('newerProject');
  const unpack = async (entry, from, to) => {
    if (!entry || typeof entry.png !== 'string') return null;
    const image = await pngToImage(entry.png, (p) => onProgress(from + (to - from) * (p / 0.8)));
    return { name: safeName(entry.name), image };
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
      const ok = img && img.lum instanceof Uint8Array && Number.isInteger(img.width) && Number.isInteger(img.height)
        && img.width > 0 && img.height > 0 && img.width <= MAX_SIDE && img.height <= MAX_SIDE
        && img.lum.length === img.width * img.height;
      return ok ? { name: safeName(entry.name), image: img } : null;
    };
    return state && state.settings ? { state, wall: valid(wall), cap: valid(cap) } : null;
  } catch (err) {
    console.warn('No se pudo leer el autoguardado:', err);
    return null;
  }
}
