// Worker del motor: vista previa (malla completa en borrador + sombra en la pared),
// trozos de la exportación STL y piezas complementarias.

import {
  buildFull,
  buildChunk,
  resolveQuality,
  toPrintFrame,
  wallLightMap,
  wallHalfExtent,
  writeBinaryStl,
} from '../core/engine.js';
import { partToWorld } from '../core/parts.js';
import { buildPiece, PIECE_KINDS } from '../core/pieces.js';

const PREVIEW_MAX_SAMPLES = 400_000;
const WALL_SIZE = 512;
const CAP_RASTER = 256;

let image = null;
let capImage = null;
let capImageVersion = 0;
// La litofanía solo depende de la forma, las piezas y su imagen: se reutiliza
// mientras se mueven otros controles (imagen de la pared, bombillo…).
let capCache = { key: null, piece: null };

function previewPiece(params, kind) {
  if (kind !== 'cap') return buildPiece(params, kind, null);
  const key = `${capImageVersion}|${JSON.stringify([params.shape, params.thickness, params.parts])}`;
  if (capCache.key !== key) {
    capCache = { key, piece: buildPiece(params, 'cap', capImage, { preview: true, rasterSize: CAP_RASTER }) };
  }
  return capCache.piece;
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'setImage') {
      image = msg.image;
      return;
    }
    if (msg.type === 'setCapImage') {
      capImage = msg.image;
      capImageVersion++;
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
      let parts = null;
      let capRaster = null;
      if (msg.params.parts && msg.params.parts.enabled) {
        parts = {};
        for (const kind of PIECE_KINDS) {
          const piece = previewPiece(msg.params, kind);
          parts[kind] = partToWorld(piece.tris, kind, msg.params);
          transfer.push(parts[kind].buffer);
          if (kind === 'cap') capRaster = piece.raster;
        }
      }
      self.postMessage(
        { type: 'preview', id: msg.id, tris, wall, parts, capRaster, stats: { cell: q.cell, triangles: tris.length / 9, ms: performance.now() - t0 } },
        transfer,
      );
      return;
    }
    if (msg.type === 'chunk') {
      const tris = toPrintFrame(buildChunk(msg.params, msg.image, msg.quality, msg.stripFrom, msg.stripTo), msg.params);
      self.postMessage({ type: 'chunk', id: msg.id, tris }, [tris.buffer]);
      return;
    }
    if (msg.type === 'part') {
      const { tris } = buildPiece(msg.params, msg.kind, msg.capImage);
      const buffer = writeBinaryStl(tris, `shade_lamp ${msg.kind}`);
      self.postMessage({ type: 'part', id: msg.id, buffer }, [buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err && err.message ? err.message : String(err) });
  }
};
