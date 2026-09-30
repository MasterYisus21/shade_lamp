// Worker del motor: vista previa (malla completa en borrador + sombra en la pared)
// y trozos de la exportación STL.

import {
  buildFull,
  buildChunk,
  resolveQuality,
  toPrintFrame,
  wallLightMap,
  wallHalfExtent,
} from '../core/engine.js';

const PREVIEW_MAX_SAMPLES = 400_000;
const WALL_SIZE = 512;

let image = null;

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'setImage') {
      image = msg.image;
      return;
    }
    if (msg.type === 'preview') {
      const t0 = performance.now();
      const q = resolveQuality(msg.params, 'draft', PREVIEW_MAX_SAMPLES);
      const { grid, field, tris } = buildFull(msg.params, image, q);
      let wall = null;
      if (msg.withWall) {
        const half = wallHalfExtent(msg.params);
        wall = { mask: wallLightMap(msg.params, grid, field, WALL_SIZE, half), size: WALL_SIZE, half };
      }
      const transfer = [tris.buffer];
      if (wall) transfer.push(wall.mask.buffer);
      self.postMessage(
        { type: 'preview', id: msg.id, tris, wall, stats: { cell: q.cell, triangles: tris.length / 9, ms: performance.now() - t0 } },
        transfer,
      );
      return;
    }
    if (msg.type === 'chunk') {
      const tris = toPrintFrame(buildChunk(msg.params, msg.image, msg.quality, msg.stripFrom, msg.stripTo), msg.params);
      self.postMessage({ type: 'chunk', id: msg.id, tris }, [tris.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err && err.message ? err.message : String(err) });
  }
};
