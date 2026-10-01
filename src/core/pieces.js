// Construcción de cada pieza complementaria según su tipo y, para la tapa, su modo.

import { buildBase, buildCap, buildPost, capSettings } from './parts.js';
import { buildLithoCap } from './lithocap.js';

export const PIECE_KINDS = ['base', 'cap', 'post'];

/**
 * @param {'base' | 'cap' | 'post'} kind
 * @param {{lum: Uint8Array, width: number, height: number} | null} capImage imagen de la litofanía
 * @param {{preview?: boolean, rasterSize?: number}} [opts]
 * @returns {{tris: Float32Array, raster: object | null}}
 */
export function buildPiece(params, kind, capImage, opts = {}) {
  if (kind === 'cap' && capSettings(params).mode === 'litho') return buildLithoCap(params, capImage, opts);
  const builder = { base: buildBase, cap: buildCap, post: buildPost }[kind];
  return { tris: builder(params), raster: null };
}
