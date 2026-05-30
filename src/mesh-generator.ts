/**
 * Mesh generator: luminance buffer -> closed (watertight) triangle mesh.
 *
 * Layout convention:
 *   - The lithophane lies in the X/Y plane, image rows along Y, columns along X.
 *   - +Z points "out the front" (where the image relief lives).
 *   - The back plate is at z = 0; the front surface is at minZ <= z <= maxZ.
 *   - Brightness 1.0 (white) -> minZ; Brightness 0 (black) -> maxZ.
 *
 * Triangle winding: counter-clockwise when viewed from outside the solid
 * (right-hand rule), so the cross product points OUT of the print.
 *
 * Output: a flat positions array (xyz, xyz, ...) and an indices array — the
 * format BufferGeometry expects, and easy to feed straight into the STL writer.
 */

export type MeshParams = {
  widthMm: number;        // physical width (X span of the heightmap)
  minThicknessMm: number; // brightest pixels (z floor for the relief)
  maxThicknessMm: number; // darkest pixels (z ceiling for the relief)
  borderMm: number;       // flat border around the heightmap at z=maxZ
};

export type Heightmap = {
  width: number;          // grid columns
  height: number;         // grid rows
  data: Float32Array;     // luminance 0..1, row-major
};

export type Mesh = {
  positions: Float32Array; // length = vertexCount * 3
  indices: Uint32Array;    // length = triangleCount * 3
  vertexCount: number;
  triangleCount: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
};

/**
 * Map a luminance sample to its relief Z.
 *
 * Brightness 1.0 -> minZ; brightness 0.0 -> maxZ.
 *
 * When there is a border, the OUTERMOST ring of heightmap vertices is clamped
 * to minZ. Reason: the bordered mesh places an "inner ring" of vertices at maxZ
 * directly above each heightmap-edge vertex. If a dark edge pixel pushed its
 * relief all the way to maxZ, those two vertices would become coincident —
 * producing zero-area inner-wall triangles and welded-but-separate vertices
 * that break manifoldness in slicers. Clamping the 1-pixel border ring to minZ
 * guarantees every inner wall has height (maxZ - minZ) > 0. Visually this is a
 * clean frame transition; without a border the clamp is not applied.
 */
function reliefZ(
  lum: number, i: number, j: number, W: number, H: number,
  borderMm: number, minZ: number, maxZ: number,
): number {
  if (borderMm > 0 && (i === 0 || i === W - 1 || j === 0 || j === H - 1)) {
    return minZ;
  }
  return minZ + (1 - lum) * (maxZ - minZ);
}

/**
 * Build a closed prism: front follows the heightmap, back is a flat plate,
 * side walls connect them. With borderMm > 0, the heightmap is inset into a
 * flat border at maxZ.
 */
export function buildMesh(h: Heightmap, p: MeshParams): Mesh {
  const W = h.width;
  const H = h.height;
  if (W < 2 || H < 2) throw new Error('Heightmap must be at least 2x2');

  // Pixel spacing so that widthMm IS the heightmap extent (not the cell-pitch sum).
  const pixelMm = p.widthMm / (W - 1);
  const innerWMm = (W - 1) * pixelMm; // = widthMm
  const innerHMm = (H - 1) * pixelMm;
  const borderMm = Math.max(0, p.borderMm);
  const totalWMm = innerWMm + 2 * borderMm;
  const totalHMm = innerHMm + 2 * borderMm;
  const minZ = p.minThicknessMm;
  const maxZ = p.maxThicknessMm;

  const positions: number[] = [];
  const indices: number[] = [];

  // ---------- 1) Front grid (heightmap) ----------
  // Image row 0 sits at the TOP of the print (high Y). i,j layout:
  //   x = borderMm + i * pixelMm
  //   y = borderMm + (H-1-j) * pixelMm
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = borderMm + i * pixelMm;
      const y = borderMm + (H - 1 - j) * pixelMm;
      const z = reliefZ(h.data[j * W + i], i, j, W, H, borderMm, minZ, maxZ);
      positions.push(x, y, z);
    }
  }
  const gridIdx = (i: number, j: number) => j * W + i;

  // Front-face triangulation. With y = (H-1-j)*pixelMm, increasing j -> smaller y.
  // For quad (i, j) -> (i+1, j+1):
  //   v00 = (i, j)     upper-left  (high y)
  //   v10 = (i+1, j)   upper-right
  //   v01 = (i, j+1)   lower-left
  //   v11 = (i+1, j+1) lower-right
  // CCW from +Z (looking AT the print front): LL -> LR -> UR -> UL.
  // Triangles producing +Z normal:
  //   (v00, v01, v11)  and  (v00, v11, v10)
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const v00 = gridIdx(i, j);
      const v10 = gridIdx(i + 1, j);
      const v01 = gridIdx(i, j + 1);
      const v11 = gridIdx(i + 1, j + 1);
      indices.push(v00, v01, v11);
      indices.push(v00, v11, v10);
    }
  }

  // ---------- 2) Heightmap perimeter walk ----------
  // CW order from +Z view (top-left -> top-right -> bottom-right -> bottom-left).
  // We build a single array of grid-perimeter vertex indices, walked once.
  // This is reused for both the side walls and the no-border back plate.
  type Edge = { i: number; j: number };
  const perim: Edge[] = [];
  for (let i = 0; i < W; i++)     perim.push({ i, j: 0 });        // top edge L->R
  for (let j = 1; j < H; j++)     perim.push({ i: W - 1, j });    // right edge T->B
  for (let i = W - 2; i >= 0; i--) perim.push({ i, j: H - 1 });    // bottom R->L
  for (let j = H - 2; j >= 1; j--) perim.push({ i: 0, j });        // left B->T
  const PN = perim.length; // = 2*(W + H) - 4

  if (borderMm === 0) {
    // ============ NO BORDER: perimeter ring at z=0 IS the back plate boundary ============

    // 2a) Perimeter ring at z=0 (one vertex per perim entry, same x/y, z=0)
    const ringStart = positions.length / 3;
    for (const e of perim) {
      const x = e.i * pixelMm;
      const y = (H - 1 - e.j) * pixelMm;
      positions.push(x, y, 0);
    }
    const ring = (k: number) => ringStart + ((k % PN) + PN) % PN;

    // 2b) Center vertex for back-plate fan
    const centerIdx = positions.length / 3;
    positions.push(innerWMm / 2, innerHMm / 2, 0);

    // 2c) Back plate fan (normal -Z).
    // perim is CW from +Z view => CCW from -Z view. Fanning (center, ring[k], ring[k+1])
    // gives -Z normal (verified analytically).
    for (let k = 0; k < PN; k++) {
      indices.push(centerIdx, ring(k), ring(k + 1));
    }

    // 2d) Side walls (outward-facing).
    // For each perim segment k:
    //   a_top = grid(perim[k]),    b_top = grid(perim[k+1])
    //   a_bot = ring(k),           b_bot = ring(k+1)
    // CCW from outside (e.g. for +Y wall viewed from +Y, with +X right, +Z up):
    //   a_bot, b_bot, b_top, a_top
    // Triangles:
    //   (a_bot, b_bot, b_top) and (a_bot, b_top, a_top)
    // To get outward normal at every wall, equivalent expression:
    //   (a_top, b_top, b_bot) and (a_top, b_bot, a_bot)  <-- same orientation
    for (let k = 0; k < PN; k++) {
      const a_top = gridIdx(perim[k].i, perim[k].j);
      const b_top = gridIdx(perim[(k + 1) % PN].i, perim[(k + 1) % PN].j);
      const a_bot = ring(k);
      const b_bot = ring(k + 1);
      indices.push(a_top, b_top, b_bot);
      indices.push(a_top, b_bot, a_bot);
    }
  } else {
    // ============ WITH BORDER ============

    // 2a) Inner top ring (z=maxZ) along the heightmap perimeter
    const innerRingStart = positions.length / 3;
    for (const e of perim) {
      const x = borderMm + e.i * pixelMm;
      const y = borderMm + (H - 1 - e.j) * pixelMm;
      positions.push(x, y, maxZ);
    }
    const innerRing = (k: number) => innerRingStart + ((k % PN) + PN) % PN;

    // 2b) Outer box: 4 back-plate corners (z=0) and 4 top corners (z=maxZ)
    const BL = positions.length / 3; positions.push(0, 0, 0);
    const BR = positions.length / 3; positions.push(totalWMm, 0, 0);
    const TR = positions.length / 3; positions.push(totalWMm, totalHMm, 0);
    const TL = positions.length / 3; positions.push(0, totalHMm, 0);
    const BL_T = positions.length / 3; positions.push(0, 0, maxZ);
    const BR_T = positions.length / 3; positions.push(totalWMm, 0, maxZ);
    const TR_T = positions.length / 3; positions.push(totalWMm, totalHMm, maxZ);
    const TL_T = positions.length / 3; positions.push(0, totalHMm, maxZ);

    // 2c) Back plate (normal -Z): BL, TL, TR  and  BL, TR, BR
    indices.push(BL, TL, TR);
    indices.push(BL, TR, BR);

    // 2d) Outer side walls (each face outward-normal).
    // Winding chosen so the cross product points OUT of the print, AND so each
    // wall's boundary edges traverse opposite to the back plate and border top.
    // -Y wall (y=0). Normal -Y.
    indices.push(BL, BR, BR_T);
    indices.push(BL, BR_T, BL_T);
    // +X wall (x=totalW). Normal +X.
    indices.push(BR, TR, TR_T);
    indices.push(BR, TR_T, BR_T);
    // +Y wall (y=totalH). Normal +Y.
    indices.push(TR, TL, TL_T);
    indices.push(TR, TL_T, TR_T);
    // -X wall (x=0). Normal -X.
    indices.push(TL, BL, BL_T);
    indices.push(TL, BL_T, TL_T);

    // 2e) Border top surface (z=maxZ): a flat ring connecting outer corners
    //     (BL_T, BR_T, TR_T, TL_T) to the inner ring (innerRing[0..PN-1]).
    //
    // perim layout reminder (CW from +Z):
    //   k=0           => grid(0, 0)        = inner top-LEFT corner
    //   k=W-1         => grid(W-1, 0)      = inner top-RIGHT corner
    //   k=W+H-2       => grid(W-1, H-1)    = inner bottom-RIGHT corner
    //   k=2W+H-3      => grid(0, H-1)      = inner bottom-LEFT corner
    //
    // For the TOP strip (between TL_T and TR_T, over inner ring k=0..W-1):
    //   Need normal +Z. Fan from TL_T over consecutive inner-ring pairs.
    //   Verified: (TL_T, innerRing(k), innerRing(k+1)) has +Z normal because the
    //   inner ring is CW from +Z, so traversing it with TL_T to the "north" gives
    //   triangles wound CCW from +Z.
    //
    // For each side we fan from the outer corner at its START to the outer corner at
    // its END; the corner triangle closes the gap.

    const innerCount = PN;

    // top side: k = 0..W-2 fan from TL_T; then close to TR_T
    for (let k = 0; k < W - 1; k++) {
      indices.push(TL_T, innerRing(k), innerRing(k + 1));
    }
    indices.push(TL_T, innerRing(W - 1), TR_T);

    // right side: k = W-1..W+H-3 fan from TR_T; then close to BR_T
    const rightEnd = W - 1 + (H - 1);
    for (let k = W - 1; k < rightEnd; k++) {
      indices.push(TR_T, innerRing(k), innerRing(k + 1));
    }
    indices.push(TR_T, innerRing(rightEnd), BR_T);

    // bottom side: k = rightEnd..rightEnd+W-2 fan from BR_T; close to BL_T
    const bottomEnd = rightEnd + (W - 1);
    for (let k = rightEnd; k < bottomEnd; k++) {
      indices.push(BR_T, innerRing(k), innerRing(k + 1));
    }
    indices.push(BR_T, innerRing(bottomEnd), BL_T);

    // left side: k = bottomEnd..innerCount-1 then wraps to 0
    for (let k = bottomEnd; k < innerCount; k++) {
      indices.push(BL_T, innerRing(k), innerRing(k + 1));
    }
    indices.push(BL_T, innerRing(innerCount), TL_T); // innerRing(innerCount)==innerRing(0)

    // 2f) Inner side walls (heightmap edge -> inner top ring), outward-facing.
    // Same orientation as the no-border side walls but with a_bot at z=maxZ (inner ring)
    // rather than z=0 (back plate). Inner walls FACE OUTWARD toward the border (i.e.
    // +Y for the top edge, +X for the right edge, etc.).
    for (let k = 0; k < PN; k++) {
      const a_top = gridIdx(perim[k].i, perim[k].j);
      const b_top = gridIdx(perim[(k + 1) % PN].i, perim[(k + 1) % PN].j);
      const a_bot = innerRing(k);
      const b_bot = innerRing(k + 1);
      indices.push(a_top, b_top, b_bot);
      indices.push(a_top, b_bot, a_bot);
    }
  }

  // ---------- Bounding box ----------
  let minX = Infinity, minY = Infinity, minZ_ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ_ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ_) minZ_ = z; if (z > maxZ_) maxZ_ = z;
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    bbox: { min: [minX, minY, minZ_], max: [maxX, maxY, maxZ_] },
  };
}

// Write one watertight box (8 verts, 12 tris) into pre-allocated arrays.
// Vertex layout matches the original base box convention (ylo < yhi).
function appendBox(
  pos: Float32Array, idx: Uint32Array,
  vStart: number, iStart: number,
  xa: number, xb: number,
  ylo: number, yhi: number,
  zlo: number, zhi: number,
): void {
  const p = vStart * 3;
  pos[p+ 0]=xa; pos[p+ 1]=ylo; pos[p+ 2]=zlo;
  pos[p+ 3]=xa; pos[p+ 4]=ylo; pos[p+ 5]=zhi;
  pos[p+ 6]=xb; pos[p+ 7]=ylo; pos[p+ 8]=zlo;
  pos[p+ 9]=xb; pos[p+10]=ylo; pos[p+11]=zhi;
  pos[p+12]=xa; pos[p+13]=yhi; pos[p+14]=zlo;
  pos[p+15]=xa; pos[p+16]=yhi; pos[p+17]=zhi;
  pos[p+18]=xb; pos[p+19]=yhi; pos[p+20]=zlo;
  pos[p+21]=xb; pos[p+22]=yhi; pos[p+23]=zhi;
  const tris = [
    4,5,6, 6,5,7,  // +Y face (yhi)
    0,2,1, 2,3,1,  // -Y face (ylo)
    0,4,2, 2,4,6,  // -Z face (zlo)
    1,3,5, 3,7,5,  // +Z face (zhi)
    0,1,4, 1,5,4,  // -X face (xa)
    2,6,3, 6,7,3,  // +X face (xb)
  ];
  for (let i = 0; i < 36; i++) idx[iStart + i] = vStart + tris[i];
}

/**
 * Append a stand base to an existing panel mesh so the print can stand
 * upright without tipping.
 *
 * tabWidthMm = 0  → solid full-width box (default).
 * tabWidthMm > 0  → three narrow breakaway tabs (left / centre / right),
 *                   each tabWidthMm wide in X, same height and depth as the
 *                   solid base. Falls back to solid if the panel is too narrow
 *                   to fit three tabs with any gap between them.
 *
 * Appends vertices after the front-grid block so updateFrontZ is unaffected.
 */
export function addBaseMesh(
  panel: Mesh,
  baseHeightMm = 3,
  baseExtendMm = 10,
  tabWidthMm = 0,
): Mesh {
  const x0 = panel.bbox.min[0];
  const x1 = panel.bbox.max[0];
  const yt = panel.bbox.max[1];
  const yb = yt - baseHeightMm;
  const zlo = -baseExtendMm;
  const zhi = panel.bbox.max[2] + baseExtendMm;

  const useTabs = tabWidthMm > 0 && tabWidthMm * 3 < (x1 - x0);

  const boxCount = useTabs ? 3 : 1;
  const newVC = panel.vertexCount + 8 * boxCount;
  const newTC = panel.triangleCount + 12 * boxCount;
  const newPos = new Float32Array(newVC * 3);
  const newIdx = new Uint32Array(newTC * 3);
  newPos.set(panel.positions);
  newIdx.set(panel.indices);

  if (!useTabs) {
    appendBox(newPos, newIdx, panel.vertexCount, panel.triangleCount * 3,
      x0, x1, yb, yt, zlo, zhi);
  } else {
    const cx = (x0 + x1) / 2;
    const hw = tabWidthMm / 2;
    const tabs: Array<[number, number]> = [
      [x0,        x0 + tabWidthMm],
      [cx - hw,   cx + hw        ],
      [x1 - tabWidthMm, x1       ],
    ];
    let vOff = panel.vertexCount;
    let iOff = panel.triangleCount * 3;
    for (const [xa, xb] of tabs) {
      appendBox(newPos, newIdx, vOff, iOff, xa, xb, yb, yt, zlo, zhi);
      vOff += 8;
      iOff += 36;
    }
  }

  return {
    positions: newPos,
    indices: newIdx,
    vertexCount: newVC,
    triangleCount: newTC,
    bbox: {
      min: [x0, panel.bbox.min[1], zlo],
      max: [x1, yt, zhi],
    },
  };
}

/**
 * Hot-path Z update: rewrites only the front-grid Z coordinates given a new
 * luminance buffer and thickness range. Mesh structure is untouched.
 */
export function updateFrontZ(
  positions: Float32Array,
  h: Heightmap,
  borderMm: number,
  _pixelMm: number,
  minZ: number,
  maxZ: number,
): void {
  // The front grid occupies the first W*H vertices in the buffer (see buildMesh).
  // Uses the exact same reliefZ() mapping as buildMesh so the hot path and the
  // cold path can never disagree about geometry.
  const W = h.width, H = h.height;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const idx = (j * W + i) * 3;
      positions[idx + 2] = reliefZ(h.data[j * W + i], i, j, W, H, borderMm, minZ, maxZ);
    }
  }
}
