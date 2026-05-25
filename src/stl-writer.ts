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

  // Vertical-orientation transform: rotate the flat XY-plane lithophane so it
  // stands upright for printing. Mesh coords: X=width, Y=height, Z=thickness.
  // After transform: X=width, Y=thickness, Z=height (image stands on build plate).
  // Transform: (x, y, z) -> (x, z, maxY - y).  Det = +1, so winding is preserved.
  const maxY = mesh.bbox.max[1];

  for (let t = 0; t < triCount; t++) {
    const i0 = idx[t * 3 + 0] * 3;
    const i1 = idx[t * 3 + 1] * 3;
    const i2 = idx[t * 3 + 2] * 3;

    const v0x = pos[i0],     v0y = pos[i0 + 2], v0z = maxY - pos[i0 + 1];
    const v1x = pos[i1],     v1y = pos[i1 + 2], v1z = maxY - pos[i1 + 1];
    const v2x = pos[i2],     v2y = pos[i2 + 2], v2z = maxY - pos[i2 + 1];

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
 * Append a watertight rectangular base box to an existing binary STL buffer.
 * The box is in post-transform (STL/slicer) coordinates where Z is the build
 * direction, so the base sits flat on the build plate (Z=0..baseHeightMm) and
 * extends baseExtendMm beyond the panel on both the front and back (Y axis).
 * This lets the panel stand upright without tipping during printing.
 */
export function appendBaseSolidToStl(
  stlBuf: ArrayBuffer,
  mesh: Mesh,
  baseHeightMm = 3,
  baseExtendMm = 10,
): ArrayBuffer {
  // Map mesh bbox to STL space: STL X = mesh X, STL Y = mesh Z, STL Z = maxY - mesh Y.
  const x0 = mesh.bbox.min[0];
  const x1 = mesh.bbox.max[0];
  const y0 = -baseExtendMm;                      // behind panel back face
  const y1 = mesh.bbox.max[2] + baseExtendMm;    // in front of panel peak
  const z0 = 0;
  const z1 = baseHeightMm;

  // 12 triangles (6 faces × 2), CCW winding for outward normals.
  // Each row: [nx,ny,nz, v0x,v0y,v0z, v1x,v1y,v1z, v2x,v2y,v2z]
  const tris: number[][] = [
    [0,0,-1, x0,y0,z0, x0,y1,z0, x1,y0,z0],  // bottom T1
    [0,0,-1, x1,y0,z0, x0,y1,z0, x1,y1,z0],  // bottom T2
    [0,0, 1, x0,y0,z1, x1,y0,z1, x0,y1,z1],  // top T1
    [0,0, 1, x1,y0,z1, x1,y1,z1, x0,y1,z1],  // top T2
    [0,-1,0, x0,y0,z0, x1,y0,z0, x0,y0,z1],  // back T1
    [0,-1,0, x1,y0,z0, x1,y0,z1, x0,y0,z1],  // back T2
    [0, 1,0, x0,y1,z0, x0,y1,z1, x1,y1,z0],  // front T1
    [0, 1,0, x1,y1,z0, x0,y1,z1, x1,y1,z1],  // front T2
    [-1,0,0, x0,y0,z0, x0,y0,z1, x0,y1,z0],  // left T1
    [-1,0,0, x0,y0,z1, x0,y1,z1, x0,y1,z0],  // left T2
    [ 1,0,0, x1,y0,z0, x1,y1,z0, x1,y0,z1],  // right T1
    [ 1,0,0, x1,y0,z1, x1,y1,z0, x1,y1,z1],  // right T2
  ];

  const existingTriCount = new DataView(stlBuf).getUint32(80, true);
  const newTriCount = existingTriCount + tris.length;
  const newBuf = new ArrayBuffer(84 + 50 * newTriCount);

  // Copy header + existing triangles verbatim
  new Uint8Array(newBuf).set(new Uint8Array(stlBuf));
  // Update triangle count
  new DataView(newBuf).setUint32(80, newTriCount, true);

  const view = new DataView(newBuf);
  let offset = 84 + 50 * existingTriCount;
  for (const t of tris) {
    for (let i = 0; i < 12; i++) view.setFloat32(offset + i * 4, t[i], true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return newBuf;
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
