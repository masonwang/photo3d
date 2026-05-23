"""
Independent STL verification — pure NumPy + struct, no third-party deps.

Runs the full topological battery on each test STL emitted by tests/verify.mjs.
This is intentionally a *separate* implementation from the JS-side checks so a
bug in one is unlikely to be mirrored in the other.

Checks per file:
  - binary STL size formula (84 + 50 * triangleCount)
  - all floats finite
  - watertight   : every undirected edge shared by exactly 2 triangles
  - winding      : every directed half-edge used exactly once
  - degenerate   : no zero-area triangles
  - bounding box : Y extent matches expected max thickness (STL is vertical: X=width, Y=thickness, Z=height)
  - volume       : signed volume (divergence theorem) is positive => closed,
                   outward-facing, consistently wound
  - Euler number : V - E + F == 2 (sphere topology, i.e. one closed shell)
"""
import struct
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
TESTS = HERE / "tests"

EXPECTED = [
    {"name": "test_no_border.stl", "expected_max_z_mm": 3.0},
    {"name": "test_with_border.stl", "expected_max_z_mm": 3.0},
    {"name": "test_integration.stl", "expected_max_z_mm": 3.0},
]


def read_binary_stl(path: Path):
    """Return (triangles Nx3x3 float64, raw_byte_len, tri_count_header)."""
    raw = path.read_bytes()
    if len(raw) < 84:
        raise ValueError(f"file < 84 bytes ({len(raw)})")
    tri_count = struct.unpack_from("<I", raw, 80)[0]
    expected = 84 + 50 * tri_count
    if len(raw) != expected:
        raise ValueError(
            f"size mismatch: file={len(raw)}, expected={expected} for {tri_count} tris"
        )
    # Each triangle: 12 floats (normal + 3 verts) + 1 uint16 attr = 50 bytes.
    tris = np.empty((tri_count, 3, 3), dtype=np.float64)
    off = 84
    # Vectorised read: build a structured view.
    rec = np.dtype([
        ("normal", "<3f4"),
        ("v0", "<3f4"),
        ("v1", "<3f4"),
        ("v2", "<3f4"),
        ("attr", "<u2"),
    ])
    arr = np.frombuffer(raw, dtype=rec, count=tri_count, offset=off)
    tris[:, 0, :] = arr["v0"]
    tris[:, 1, :] = arr["v1"]
    tris[:, 2, :] = arr["v2"]
    return tris, len(raw), tri_count, arr


def dedup_vertices(tris):
    """Map the Nx3x3 triangle soup to (vertices V x 3, faces F x 3 int)."""
    flat = tris.reshape(-1, 3)
    # Quantise to avoid float noise (test STLs are exact, but be safe).
    quant = np.round(flat, 5)
    _, inv = np.unique(quant, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    verts = np.empty((inv.max() + 1, 3), dtype=np.float64)
    verts[inv] = flat
    faces = inv.reshape(-1, 3)
    return verts, faces


def check(path: Path, expected_max_z_mm: float) -> bool:
    print(f"\n=== {path.name} ===")
    if not path.exists():
        print(f"  MISSING: {path}")
        return False

    try:
        tris, nbytes, tri_count, arr = read_binary_stl(path)
    except ValueError as e:
        print(f"  FAIL: {e}")
        return False
    print(f"  size formula: OK ({tri_count} triangles, {nbytes} bytes)")

    ok = True

    # All floats finite
    if not np.all(np.isfinite(tris)):
        print("  finite floats: FAIL")
        ok = False
    else:
        print("  finite floats: OK")

    verts, faces = dedup_vertices(tris)
    V, F = len(verts), len(faces)
    print(f"  dedup       : {V} verts, {F} faces")

    # --- Watertight: every undirected edge shared by exactly 2 faces ---
    e = np.vstack([
        faces[:, [0, 1]],
        faces[:, [1, 2]],
        faces[:, [2, 0]],
    ])
    und = np.sort(e, axis=1)
    uniq_und, counts = np.unique(und, axis=0, return_counts=True)
    bad_edges = int(np.sum(counts != 2))
    if bad_edges:
        print(f"  watertight  : FAIL ({bad_edges} edges not shared by exactly 2)")
        ok = False
    else:
        print("  watertight  : OK")
    E = len(uniq_und)

    # --- Winding: every directed half-edge used exactly once ---
    _, he_counts = np.unique(e, axis=0, return_counts=True)
    bad_he = int(np.sum(he_counts != 1))
    if bad_he:
        print(f"  winding     : FAIL ({bad_he} half-edges used != 1 time)")
        ok = False
    else:
        print("  winding     : OK")

    # --- Degenerate triangles ---
    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]
    cross = np.cross(v1 - v0, v2 - v0)
    areas = 0.5 * np.linalg.norm(cross, axis=1)
    degen = int(np.sum(areas < 1e-9))
    if degen:
        print(f"  degenerate  : FAIL ({degen} zero-area triangles)")
        ok = False
    else:
        print("  degenerate  : OK")

    # --- Bounding box ---
    # STL is in vertical-print orientation: X=width, Y=thickness, Z=height.
    mn = verts.min(axis=0)
    mx = verts.max(axis=0)
    ext = mx - mn
    print(f"  extents     : {ext[0]:.2f} x {ext[1]:.2f} x {ext[2]:.2f} mm")
    if abs(ext[1] - expected_max_z_mm) > 0.05:
        print(f"  y extent    : FAIL (expected ~{expected_max_z_mm}, got {ext[1]:.3f})")
        ok = False
    else:
        print(f"  y extent    : OK (~{expected_max_z_mm} mm)")

    # --- Signed volume (divergence theorem) ---
    # V = (1/6) * sum( v0 . (v1 x v2) ). Positive => closed & outward-wound.
    signed = np.einsum("ij,ij->i", v0, np.cross(v1, v2)).sum() / 6.0
    if signed <= 0:
        print(f"  volume      : FAIL ({signed:.2f} mm^3 — inverted or open)")
        ok = False
    else:
        print(f"  volume      : OK ({signed:.2f} mm^3)")

    # --- Euler characteristic ---
    chi = V - E + F
    if chi != 2:
        print(f"  euler chi   : FAIL ({chi}, expected 2 for one closed shell)")
        ok = False
    else:
        print("  euler chi   : OK (2 — single closed manifold)")

    return ok


def main():
    all_ok = True
    for spec in EXPECTED:
        try:
            all_ok &= check(TESTS / spec["name"], spec["expected_max_z_mm"])
        except Exception as exc:  # noqa: BLE001
            print(f"  EXCEPTION: {exc}")
            all_ok = False
    print()
    print("PASS" if all_ok else "FAIL", "— independent (NumPy) checks")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
