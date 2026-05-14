/**
 * Binary STL writer (from scratch).
 *
 * Format:
 *   bytes 0..79     : 80-byte header (free text, ignored by readers)
 *   bytes 80..83    : uint32 little-endian: triangle count
 *   per triangle (50 bytes):
 *     12 bytes : float32[3] normal (x,y,z), little-endian
 *     12 bytes : float32[3] vertex 1
 *     12 bytes : float32[3] vertex 2
 *     12 bytes : float32[3] vertex 3
 *      2 bytes : uint16 attribute byte count (we set 0)
 *
 * Total file size = 84 + 50 * triangleCount.
 */

import type { Mesh } from './mesh-generator';

export function meshToBinaryStl(mesh: Mesh, headerText = 'lithophane-app'): ArrayBuffer {
  const triCount = mesh.triangleCount;
  const buf = new ArrayBuffer(84 + 50 * triCount);
  const view = new DataView(buf);

  // Header (80 bytes ASCII, padded with zeros)
  for (let i = 0; i < Math.min(80, headerText.length); i++) {
    view.setUint8(i, headerText.charCodeAt(i) & 0x7f);
  }

  view.setUint32(80, triCount, true);

  let offset = 84;
  const pos = mesh.positions;
  const idx = mesh.indices;

  // Reusable scratch for normal computation
  const ax = 0, ay = 1, az = 2;

  for (let t = 0; t < triCount; t++) {
    const i0 = idx[t * 3 + 0] * 3;
    const i1 = idx[t * 3 + 1] * 3;
    const i2 = idx[t * 3 + 2] * 3;

    const v0x = pos[i0], v0y = pos[i0 + 1], v0z = pos[i0 + 2];
    const v1x = pos[i1], v1y = pos[i1 + 1], v1z = pos[i1 + 2];
    const v2x = pos[i2], v2y = pos[i2 + 1], v2z = pos[i2 + 2];

    // Edge vectors
    const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
    const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;

    // Cross product e1 x e2
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len; ny /= len; nz /= len;
    } else {
      // Degenerate triangle — emit a zero normal; trimesh tolerates this and many
      // tools recompute normals on import anyway.
      nx = 0; ny = 0; nz = 0;
    }

    // Suppress unused-var lints
    void ax; void ay; void az;

    view.setFloat32(offset + 0,  nx, true);
    view.setFloat32(offset + 4,  ny, true);
    view.setFloat32(offset + 8,  nz, true);
    view.setFloat32(offset + 12, v0x, true);
    view.setFloat32(offset + 16, v0y, true);
    view.setFloat32(offset + 20, v0z, true);
    view.setFloat32(offset + 24, v1x, true);
    view.setFloat32(offset + 28, v1y, true);
    view.setFloat32(offset + 32, v1z, true);
    view.setFloat32(offset + 36, v2x, true);
    view.setFloat32(offset + 40, v2y, true);
    view.setFloat32(offset + 44, v2z, true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return buf;
}

/**
 * Quick sanity check that a buffer "looks like" a valid binary STL we wrote.
 * Returns null on success, an error message otherwise.
 */
export function validateBinaryStlBuffer(buf: ArrayBuffer): string | null {
  if (buf.byteLength < 84) return `file too small: ${buf.byteLength} bytes`;
  const view = new DataView(buf);
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + 50 * triCount;
  if (buf.byteLength !== expectedSize) {
    return `size mismatch: file=${buf.byteLength}, expected=${expectedSize} for ${triCount} triangles`;
  }
  // Check all floats are finite
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    for (let f = 0; f < 12; f++) {
      const v = view.getFloat32(offset + f * 4, true);
      if (!Number.isFinite(v)) return `non-finite float at triangle ${t} field ${f}`;
    }
    offset += 50;
  }
  return null;
}
