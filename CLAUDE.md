# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A from-scratch photo → lithophane converter. A browser app that turns a photo into a print-ready binary STL: pixel brightness becomes relief height (dark = thick, bright = thin). All pipeline logic is hand-written; Three.js is used **only** for the 3D preview.

## Commands

```bash
npm start          # build dist/ then serve at http://localhost:5173
npm run build      # transpile src/*.ts -> dist/*.js (zero-dependency, via build.mjs)
npm run serve      # static-serve dist/ (serve.mjs, default port 5173; pass a port arg)
npm test           # full verification suite (engine + mesh/STL + independent NumPy)
```

Running one test layer:

```bash
node --experimental-strip-types tests/verify-engine.mjs   # store + image-processor units
node --experimental-strip-types tests/verify.mjs          # mesh + STL + integration; writes tests/*.stl
python3 verify_stl.py                                     # independent geometry checks on tests/*.stl
```

There is no per-case test runner; each `verify*` file is a flat script that prints `OK`/`FAIL` lines and exits non-zero on failure. `verify.mjs` must run before `verify_stl.py` because it produces the STL artifacts the Python checks read.

Optional bundler path (requires `npm install` — registry access needed): `npm run build:vite`, `npm run dev:vite`.

## Build system — important constraints

The primary build is **zero-dependency**. `build.mjs` transpiles TypeScript with Node's built-in `module.stripTypeScriptTypes` (transform mode), rewrites relative imports to add `.js` extensions, and injects a three.js import map (CDN) into `index.html`. Consequences:

- Requires **Node 22.6+** (for `stripTypeScriptTypes`). Tests run via `node --experimental-strip-types`.
- `preview.ts` uses parameter properties (`constructor(private container: ...)`), which need transform mode — do not assume plain type-stripping is enough.
- three.js is never installed locally; it loads at runtime from a CDN via the import map. `preview.ts` keeps bare `'three'` / `'three/examples/jsm/...'` specifiers — the import-map rewrite in `build.mjs` depends on this, so don't convert them to relative paths.
- The build cannot delete `dist/` on some mounts (EPERM); `cleanDist()` falls back to overwriting in place.

## Architecture

### Four-stage pipeline

`source image → image-processor → mesh-generator → stl-writer`, orchestrated by `main.ts`:

1. **`image-processor.ts`** — RGBA pixels → `Float32Array` luminance buffer in [0,1]. Chain: grayscale (Rec.709) → mirror → invert → brightness → contrast → gamma → box-blur. The pure functions (`rgbaToLuminance`, `resampleRgba`) are DOM-free and headlessly tested; `decodeImageToRgba` is the only browser-coupled function.
2. **`mesh-generator.ts`** — luminance buffer → watertight indexed triangle mesh (flat `positions` + `indices`, BufferGeometry-ready). Builds front relief surface, flat back plate, side walls, and an optional flat border. Winding is CCW-outward everywhere.
3. **`stl-writer.ts`** — indexed mesh → binary STL `ArrayBuffer`. Hand-written `DataView` encoder; recomputes face normals from vertex order.

### Hot / cold / free path — the central design idea

`store.ts` partitions every parameter into `HOT_KEYS`, `COLD_KEYS`, `FREE_KEYS`. `main.ts` subscribes a different handler to each set:

- **Hot** (thickness, gamma, brightness, contrast, mirror, invert, smoothing): re-derive luminance and rewrite only the front-grid Z values in place via `updateFrontZ` — no mesh rebuild. Instant.
- **Cold** (resolution, border): structural change → debounced (~150ms) full `buildMesh`.
- **Free** (width): currently routed as cold for v1.

When editing the mesh, **`buildMesh` and `updateFrontZ` must produce identical geometry**. Both call the shared `reliefZ()` helper — keep it that way, or the hot and cold paths will silently disagree.

### Mesh invariants (do not break)

- `reliefZ()` clamps the heightmap's **outermost ring to `minZ` when a border is present**. Without this, a dark edge pixel reaches `maxZ` and coincides with the border's inner-ring vertex → zero-area triangles + welded-but-separate vertices that break manifoldness in slicers. This bug is invisible to index-based checks; only the coordinate-dedup verifier catches it.
- The front grid occupies the **first `W*H` vertices** of the positions buffer. `updateFrontZ` relies on this layout.
- Output must stay watertight, consistently wound, single closed manifold (Euler χ = 2).

### Verification strategy

Two **independent** implementations check the mesh, by design:

- `tests/verify.mjs` — index-based topology checks (shares the JS mesh data structures).
- `verify_stl.py` — reads raw STL bytes, dedups vertices by quantized coordinates, re-derives watertightness / winding / signed volume / Euler number with NumPy.

The Python verifier exists specifically to catch geometry bugs the index-based checks are blind to (e.g. coincident vertices). When changing `mesh-generator.ts`, both must pass — a green `verify.mjs` alone is not sufficient.

### Preview (`preview.ts`)

Three.js scene with `OrbitControls`, render-on-demand (only renders after a change, not a continuous loop), three render modes (lit / backlit `MeshPhysicalMaterial` with transmission / wireframe), and view presets. `setMesh` is the cold path (new geometry); `notifyZUpdated` is the hot path (flags the existing position attribute dirty + recomputes normals).

## Untested surface

`preview.ts`, `main.ts`, and the DOM parts of `image-processor.ts`/`ui.ts` require a real browser and are not covered by the headless suite — they are only syntax-checked by the build. Changes there need manual verification in the browser.
