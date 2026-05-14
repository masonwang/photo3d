/**
 * Headless pipeline test.
 *
 * Generates a synthetic heightmap (a Gaussian bump on a flat plate),
 * runs it through the mesh generator and STL writer, and writes
 * test_output.stl to disk. Performs in-process structural checks; for
 * topological checks (watertight, winding) see verify_stl.py.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildMesh } from '../src/mesh-generator.ts';
import { meshToBinaryStl, validateBinaryStlBuffer } from '../src/stl-writer.ts';
import { rgbaToLuminance, resampleRgba } from '../src/image-processor.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeBumpHeightmap(W, H) {
  const data = new Float32Array(W * H);
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const sigma = Math.min(W, H) / 4;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const dx = i - cx, dy = j - cy;
      const v = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      data[j * W + i] = v;
    }
  }
  return { width: W, height: H, data };
}

const W = 60, H = 80;
const heightmap = makeBumpHeightmap(W, H);

const widthMm = 60;
const minThicknessMm = 0.8;
const maxThicknessMm = 3.0;
const borderMm = 2;

const cases = [
  { label: 'no border',   border: 0 },
  { label: 'with border', border: borderMm },
];

let allOk = true;

for (const c of cases) {
  const mesh = buildMesh(heightmap, {
    widthMm,
    minThicknessMm,
    maxThicknessMm,
    borderMm: c.border,
  });
  const buf = meshToBinaryStl(mesh, `test ${c.label}`);
  const err = validateBinaryStlBuffer(buf);

  console.log(`\n=== ${c.label} ===`);
  console.log(`  vertices : ${mesh.vertexCount}`);
  console.log(`  triangles: ${mesh.triangleCount}`);
  console.log(`  bbox min : ${mesh.bbox.min.map(n => n.toFixed(2)).join(', ')}`);
  console.log(`  bbox max : ${mesh.bbox.max.map(n => n.toFixed(2)).join(', ')}`);
  console.log(`  STL size : ${buf.byteLength} bytes (expected ${84 + 50 * mesh.triangleCount})`);
  console.log(`  validate : ${err ?? 'OK'}`);

  if (err) allOk = false;

  // Quick topology: every edge should appear exactly twice (manifold).
  // Build edges from indices.
  const edges = new Map();
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c2 = idx[t + 2];
    for (const [u, v] of [[a, b], [b, c2], [c2, a]]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const [, count] of edges) if (count !== 2) bad++;
  console.log(`  manifold : ${bad === 0 ? 'OK (all edges shared by 2 triangles)' : `FAIL (${bad} edges with !=2 triangles)`}`);
  if (bad !== 0) allOk = false;

  // Winding consistency: for each shared edge, the two triangles should traverse
  // it in OPPOSITE directions. Check half-edge counts.
  const halfEdges = new Map(); // "u,v" => count of directed traversals
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c2 = idx[t + 2];
    for (const [u, v] of [[a, b], [b, c2], [c2, a]]) {
      const key = `${u},${v}`;
      halfEdges.set(key, (halfEdges.get(key) ?? 0) + 1);
    }
  }
  let windBad = 0;
  for (const [key, count] of halfEdges) {
    if (count !== 1) { windBad++; }
  }
  console.log(`  winding  : ${windBad === 0 ? 'OK (all half-edges traversed exactly once)' : `FAIL (${windBad} half-edges traversed != 1)`}`);
  if (windBad !== 0) allOk = false;

  // Bounding box check
  const expectedMaxX = widthMm + 2 * c.border;
  const expectedMaxZ = maxThicknessMm;
  const xOk = Math.abs(mesh.bbox.max[0] - expectedMaxX) < 0.05;
  const zOk = Math.abs(mesh.bbox.max[2] - expectedMaxZ) < 0.05;
  console.log(`  bbox X   : ${xOk ? 'OK' : `FAIL — got ${mesh.bbox.max[0]}, expected ~${expectedMaxX}`}`);
  console.log(`  bbox Z   : ${zOk ? 'OK' : `FAIL — got ${mesh.bbox.max[2]}, expected ~${expectedMaxZ}`}`);
  if (!xOk || !zOk) allOk = false;

  const outPath = resolve(__dirname, `test_${c.label.replace(/\s+/g, '_')}.stl`);
  writeFileSync(outPath, Buffer.from(buf));
  console.log(`  wrote    : ${outPath}`);
}

// ---- Integration: RGBA photo -> luminance -> mesh -> STL (full pipeline) ----
{
  console.log('\n=== integration: RGBA -> luminance -> mesh -> STL ===');
  // Synthetic 120x90 "photo": a diagonal brightness gradient.
  const IW = 120, IH = 90;
  const rgba = { width: IW, height: IH, data: new Uint8ClampedArray(IW * IH * 4) };
  for (let y = 0; y < IH; y++) {
    for (let x = 0; x < IW; x++) {
      const v = Math.round(255 * ((x / IW + y / IH) / 2));
      const i = (y * IW + x) * 4;
      rgba.data[i] = rgba.data[i + 1] = rgba.data[i + 2] = v;
      rgba.data[i + 3] = 255;
    }
  }

  const params = {
    mirror: true, invert: false, gamma: 1.4, brightness: 0, contrast: 10,
    smoothingPx: 1,
  };
  // Downsample to a print grid, then convert to luminance.
  const gridW = 80;
  const gridH = Math.round(gridW * IH / IW);
  const resampled = resampleRgba(rgba, gridW, gridH);
  const lum = rgbaToLuminance(resampled, params);

  // Luminance range sanity.
  let lmin = Infinity, lmax = -Infinity;
  for (const v of lum.data) { if (v < lmin) lmin = v; if (v > lmax) lmax = v; }
  const rangeOk = lmin >= 0 && lmax <= 1 && lmax > lmin;
  console.log(`  luminance : ${rangeOk ? 'OK' : 'FAIL'} (range ${lmin.toFixed(3)}..${lmax.toFixed(3)})`);
  if (!rangeOk) allOk = false;

  const mesh = buildMesh(lum, {
    widthMm: 100, minThicknessMm: 0.8, maxThicknessMm: 3.0, borderMm: 2,
  });
  const buf = meshToBinaryStl(mesh, 'integration test');
  const err = validateBinaryStlBuffer(buf);
  console.log(`  mesh      : ${mesh.vertexCount} verts, ${mesh.triangleCount} tris`);
  console.log(`  STL bytes : ${buf.byteLength} (${err ?? 'OK'})`);
  if (err) allOk = false;

  // Manifold + winding on the integrated mesh.
  const edges = new Map();
  const hes = new Map();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t], b = mesh.indices[t + 1], c2 = mesh.indices[t + 2];
    for (const [u, v] of [[a, b], [b, c2], [c2, a]]) {
      const uk = u < v ? `${u},${v}` : `${v},${u}`;
      edges.set(uk, (edges.get(uk) ?? 0) + 1);
      hes.set(`${u},${v}`, (hes.get(`${u},${v}`) ?? 0) + 1);
    }
  }
  let badE = 0, badH = 0;
  for (const [, c] of edges) if (c !== 2) badE++;
  for (const [, c] of hes) if (c !== 1) badH++;
  console.log(`  manifold  : ${badE === 0 ? 'OK' : `FAIL (${badE})`}`);
  console.log(`  winding   : ${badH === 0 ? 'OK' : `FAIL (${badH})`}`);
  if (badE || badH) allOk = false;

  // Write artifact for the NumPy verifier too.
  const outPath = resolve(__dirname, 'test_integration.stl');
  writeFileSync(outPath, Buffer.from(buf));
  console.log(`  wrote     : ${outPath}`);
}

console.log(`\n${allOk ? 'PASS' : 'FAIL'} — JS-side checks`);
process.exit(allOk ? 0 : 1);
