// Lado del hilo principal: vista previa en vivo y exportación en paralelo.

import { planForQuality, resolveQuality, writeBinaryStl } from '../core/engine.js';
import { buildBase, buildCap, buildPost } from '../core/parts.js';

const PART_BUILDERS = { base: buildBase, cap: buildCap, post: buildPost };

/** STL de una pieza complementaria (ya en su orientación de impresión). */
export function exportPartStl(params, kind) {
  return writeBinaryStl(PART_BUILDERS[kind](params), `shade_lamp ${kind}`);
}

const newWorker = () => new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' });

/**
 * Vista previa: un worker dedicado. Si llegan peticiones mientras calcula, solo
 * se conserva la última (así la vista sigue al deslizador sin acumular trabajo).
 */
export function createPreviewEngine(onResult, onError) {
  const worker = newWorker();
  let busy = false;
  let pending = null;
  let nextId = 1;

  const send = (req) => {
    busy = true;
    worker.postMessage({ type: 'preview', id: nextId++, ...req });
  };

  worker.onmessage = (e) => {
    const msg = e.data;
    busy = false;
    if (msg.type === 'preview') onResult(msg);
    else if (msg.type === 'error') onError(msg.message);
    if (pending) {
      const req = pending;
      pending = null;
      send(req);
    }
  };

  return {
    setImage(image) {
      worker.postMessage({ type: 'setImage', image });
    },
    request(params, withWall) {
      const req = { params, withWall };
      if (busy) pending = req;
      else send(req);
    },
    dispose() {
      worker.terminate();
    },
  };
}

/**
 * Genera el STL usando varios workers en paralelo (uno por núcleo libre).
 * @returns {Promise<{buffer: ArrayBuffer, triangles: number, cell: number, coarsened: boolean, ms: number}>}
 */
export async function exportStl(params, image, qualityName, onProgress) {
  const t0 = performance.now();
  const q = resolveQuality(params, qualityName);
  const grid = planForQuality(params, q);
  const nStrips = grid.strips.length - 1;
  const cores = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  const nTasks = Math.min(nStrips, cores * 4);
  const tasks = [];
  for (let k = 0; k < nTasks; k++) {
    const from = Math.floor((k * nStrips) / nTasks);
    const to = Math.floor(((k + 1) * nStrips) / nTasks);
    if (to > from) tasks.push({ id: tasks.length, stripFrom: from, stripTo: to });
  }

  const results = new Array(tasks.length);
  const workers = Array.from({ length: Math.min(cores, tasks.length) }, newWorker);
  let done = 0;
  let cursor = 0;
  try {
    await new Promise((resolve, reject) => {
      const feed = (w) => {
        if (cursor >= tasks.length) return;
        const t = tasks[cursor++];
        w.postMessage({ type: 'chunk', params, image, quality: q, ...t });
      };
      for (const w of workers) {
        w.onmessage = (e) => {
          const msg = e.data;
          if (msg.type === 'error') {
            reject(new Error(msg.message));
            return;
          }
          results[msg.id] = msg.tris;
          done++;
          if (onProgress) onProgress(done / tasks.length);
          if (done === tasks.length) resolve();
          else feed(w);
        };
        w.onerror = (err) => reject(new Error(err.message || 'Error en el worker'));
        feed(w);
      }
    });
  } finally {
    for (const w of workers) w.terminate();
  }

  const buffer = writeBinaryStl(results);
  const triangles = results.reduce((a, r) => a + r.length / 9, 0);
  return { buffer, triangles, cell: q.cell, coarsened: q.coarsened, ms: performance.now() - t0 };
}
