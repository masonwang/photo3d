function reliefZ(lum, i, j, W, H, borderMm, minZ, maxZ) {
    if (borderMm > 0 && (i === 0 || i === W - 1 || j === 0 || j === H - 1)) {
        return minZ;
    }
    return minZ + (1 - lum) * (maxZ - minZ);
}
export function buildMesh(h, p) {
    const W = h.width;
    const H = h.height;
    if (W < 2 || H < 2) throw new Error('Heightmap must be at least 2x2');
    const pixelMm = p.widthMm / (W - 1);
    const innerWMm = (W - 1) * pixelMm;
    const innerHMm = (H - 1) * pixelMm;
    const borderMm = Math.max(0, p.borderMm);
    const totalWMm = innerWMm + 2 * borderMm;
    const totalHMm = innerHMm + 2 * borderMm;
    const minZ = p.minThicknessMm;
    const maxZ = p.maxThicknessMm;
    const positions = [];
    const indices = [];
    for(let j = 0; j < H; j++){
        for(let i = 0; i < W; i++){
            const x = borderMm + i * pixelMm;
            const y = borderMm + (H - 1 - j) * pixelMm;
            const z = reliefZ(h.data[j * W + i], i, j, W, H, borderMm, minZ, maxZ);
            positions.push(x, y, z);
        }
    }
    const gridIdx = (i, j)=>j * W + i;
    for(let j = 0; j < H - 1; j++){
        for(let i = 0; i < W - 1; i++){
            const v00 = gridIdx(i, j);
            const v10 = gridIdx(i + 1, j);
            const v01 = gridIdx(i, j + 1);
            const v11 = gridIdx(i + 1, j + 1);
            indices.push(v00, v01, v11);
            indices.push(v00, v11, v10);
        }
    }
    const perim = [];
    for(let i = 0; i < W; i++)perim.push({
        i,
        j: 0
    });
    for(let j = 1; j < H; j++)perim.push({
        i: W - 1,
        j
    });
    for(let i = W - 2; i >= 0; i--)perim.push({
        i,
        j: H - 1
    });
    for(let j = H - 2; j >= 1; j--)perim.push({
        i: 0,
        j
    });
    const PN = perim.length;
    if (borderMm === 0) {
        const ringStart = positions.length / 3;
        for (const e of perim){
            const x = e.i * pixelMm;
            const y = (H - 1 - e.j) * pixelMm;
            positions.push(x, y, 0);
        }
        const ring = (k)=>ringStart + (k % PN + PN) % PN;
        const centerIdx = positions.length / 3;
        positions.push(innerWMm / 2, innerHMm / 2, 0);
        for(let k = 0; k < PN; k++){
            indices.push(centerIdx, ring(k), ring(k + 1));
        }
        for(let k = 0; k < PN; k++){
            const a_top = gridIdx(perim[k].i, perim[k].j);
            const b_top = gridIdx(perim[(k + 1) % PN].i, perim[(k + 1) % PN].j);
            const a_bot = ring(k);
            const b_bot = ring(k + 1);
            indices.push(a_top, b_top, b_bot);
            indices.push(a_top, b_bot, a_bot);
        }
    } else {
        const innerRingStart = positions.length / 3;
        for (const e of perim){
            const x = borderMm + e.i * pixelMm;
            const y = borderMm + (H - 1 - e.j) * pixelMm;
            positions.push(x, y, maxZ);
        }
        const innerRing = (k)=>innerRingStart + (k % PN + PN) % PN;
        const BL = positions.length / 3;
        positions.push(0, 0, 0);
        const BR = positions.length / 3;
        positions.push(totalWMm, 0, 0);
        const TR = positions.length / 3;
        positions.push(totalWMm, totalHMm, 0);
        const TL = positions.length / 3;
        positions.push(0, totalHMm, 0);
        const BL_T = positions.length / 3;
        positions.push(0, 0, maxZ);
        const BR_T = positions.length / 3;
        positions.push(totalWMm, 0, maxZ);
        const TR_T = positions.length / 3;
        positions.push(totalWMm, totalHMm, maxZ);
        const TL_T = positions.length / 3;
        positions.push(0, totalHMm, maxZ);
        indices.push(BL, TL, TR);
        indices.push(BL, TR, BR);
        indices.push(BL, BR, BR_T);
        indices.push(BL, BR_T, BL_T);
        indices.push(BR, TR, TR_T);
        indices.push(BR, TR_T, BR_T);
        indices.push(TR, TL, TL_T);
        indices.push(TR, TL_T, TR_T);
        indices.push(TL, BL, BL_T);
        indices.push(TL, BL_T, TL_T);
        const innerCount = PN;
        for(let k = 0; k < W - 1; k++){
            indices.push(TL_T, innerRing(k), innerRing(k + 1));
        }
        indices.push(TL_T, innerRing(W - 1), TR_T);
        const rightEnd = W - 1 + (H - 1);
        for(let k = W - 1; k < rightEnd; k++){
            indices.push(TR_T, innerRing(k), innerRing(k + 1));
        }
        indices.push(TR_T, innerRing(rightEnd), BR_T);
        const bottomEnd = rightEnd + (W - 1);
        for(let k = rightEnd; k < bottomEnd; k++){
            indices.push(BR_T, innerRing(k), innerRing(k + 1));
        }
        indices.push(BR_T, innerRing(bottomEnd), BL_T);
        for(let k = bottomEnd; k < innerCount; k++){
            indices.push(BL_T, innerRing(k), innerRing(k + 1));
        }
        indices.push(BL_T, innerRing(innerCount), TL_T);
        for(let k = 0; k < PN; k++){
            const a_top = gridIdx(perim[k].i, perim[k].j);
            const b_top = gridIdx(perim[(k + 1) % PN].i, perim[(k + 1) % PN].j);
            const a_bot = innerRing(k);
            const b_bot = innerRing(k + 1);
            indices.push(a_top, b_top, b_bot);
            indices.push(a_top, b_bot, a_bot);
        }
    }
    let minX = Infinity, minY = Infinity, minZ_ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ_ = -Infinity;
    for(let i = 0; i < positions.length; i += 3){
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ_) minZ_ = z;
        if (z > maxZ_) maxZ_ = z;
    }
    return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        vertexCount: positions.length / 3,
        triangleCount: indices.length / 3,
        bbox: {
            min: [
                minX,
                minY,
                minZ_
            ],
            max: [
                maxX,
                maxY,
                maxZ_
            ]
        },
        gridWidth: W,
        gridHeight: H
    };
}
export function buildCurvedMesh(h, p) {
    const W = h.width, H = h.height;
    if (W < 2 || H < 2) throw new Error('Heightmap must be at least 2x2');
    const arcRad = p.arcDeg * Math.PI / 180;
    const R = p.widthMm / arcRad;
    const mmPerPxH = p.widthMm * H / W / (H - 1);
    const minZ = p.minThicknessMm, maxZ = p.maxThicknessMm;
    const borderMm = Math.max(0, p.borderMm);
    const positions = [];
    const indices = [];
    const colPhi = (i)=>(i / (W - 1) - 0.5) * arcRad;
    const rowY = (j)=>(H - 1 - j) * mmPerPxH;
    for(let j = 0; j < H; j++){
        for(let i = 0; i < W; i++){
            const phi = colPhi(i);
            const t = reliefZ(h.data[j * W + i], i, j, W, H, borderMm, minZ, maxZ);
            const r = R + t;
            positions.push(r * Math.sin(phi), rowY(j), r * Math.cos(phi) - R);
        }
    }
    const frontIdx = (i, j)=>j * W + i;
    for(let j = 0; j < H - 1; j++){
        for(let i = 0; i < W - 1; i++){
            const v00 = frontIdx(i, j), v10 = frontIdx(i + 1, j);
            const v01 = frontIdx(i, j + 1), v11 = frontIdx(i + 1, j + 1);
            indices.push(v00, v01, v11);
            indices.push(v00, v11, v10);
        }
    }
    const backBase = W * H;
    for(let j = 0; j < H; j++){
        for(let i = 0; i < W; i++){
            const phi = colPhi(i);
            positions.push(R * Math.sin(phi), rowY(j), R * Math.cos(phi) - R);
        }
    }
    const backIdx = (i, j)=>backBase + j * W + i;
    for(let j = 0; j < H - 1; j++){
        for(let i = 0; i < W - 1; i++){
            const v00 = backIdx(i, j), v10 = backIdx(i + 1, j);
            const v01 = backIdx(i, j + 1), v11 = backIdx(i + 1, j + 1);
            indices.push(v00, v11, v01);
            indices.push(v00, v10, v11);
        }
    }
    for(let i = 0; i < W - 1; i++){
        indices.push(frontIdx(i, 0), frontIdx(i + 1, 0), backIdx(i + 1, 0));
        indices.push(frontIdx(i, 0), backIdx(i + 1, 0), backIdx(i, 0));
    }
    for(let i = 0; i < W - 1; i++){
        indices.push(frontIdx(i, H - 1), backIdx(i, H - 1), backIdx(i + 1, H - 1));
        indices.push(frontIdx(i, H - 1), backIdx(i + 1, H - 1), frontIdx(i + 1, H - 1));
    }
    for(let j = 0; j < H - 1; j++){
        indices.push(frontIdx(0, j), backIdx(0, j), backIdx(0, j + 1));
        indices.push(frontIdx(0, j), backIdx(0, j + 1), frontIdx(0, j + 1));
    }
    for(let j = 0; j < H - 1; j++){
        indices.push(backIdx(W - 1, j), frontIdx(W - 1, j), frontIdx(W - 1, j + 1));
        indices.push(backIdx(W - 1, j), frontIdx(W - 1, j + 1), backIdx(W - 1, j + 1));
    }
    let minX = Infinity, minY = Infinity, minZ_ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ_ = -Infinity;
    for(let i = 0; i < positions.length; i += 3){
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ_) minZ_ = z;
        if (z > maxZ_) maxZ_ = z;
    }
    return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        vertexCount: positions.length / 3,
        triangleCount: indices.length / 3,
        bbox: {
            min: [
                minX,
                minY,
                minZ_
            ],
            max: [
                maxX,
                maxY,
                maxZ_
            ]
        },
        gridWidth: W,
        gridHeight: H
    };
}
function appendBox(pos, idx, vStart, iStart, xa, xb, ylo, yhi, zlo, zhi) {
    const p = vStart * 3;
    pos[p + 0] = xa;
    pos[p + 1] = ylo;
    pos[p + 2] = zlo;
    pos[p + 3] = xa;
    pos[p + 4] = ylo;
    pos[p + 5] = zhi;
    pos[p + 6] = xb;
    pos[p + 7] = ylo;
    pos[p + 8] = zlo;
    pos[p + 9] = xb;
    pos[p + 10] = ylo;
    pos[p + 11] = zhi;
    pos[p + 12] = xa;
    pos[p + 13] = yhi;
    pos[p + 14] = zlo;
    pos[p + 15] = xa;
    pos[p + 16] = yhi;
    pos[p + 17] = zhi;
    pos[p + 18] = xb;
    pos[p + 19] = yhi;
    pos[p + 20] = zlo;
    pos[p + 21] = xb;
    pos[p + 22] = yhi;
    pos[p + 23] = zhi;
    const tris = [
        4,
        5,
        6,
        6,
        5,
        7,
        0,
        2,
        1,
        2,
        3,
        1,
        0,
        4,
        2,
        2,
        4,
        6,
        1,
        3,
        5,
        3,
        7,
        5,
        0,
        1,
        4,
        1,
        5,
        4,
        2,
        6,
        3,
        6,
        7,
        3
    ];
    for(let i = 0; i < 36; i++)idx[iStart + i] = vStart + tris[i];
}
export function addBaseMesh(panel, baseHeightMm = 3, baseExtendMm = 10, tabWidthMm = 0) {
    const x0 = panel.bbox.min[0];
    const x1 = panel.bbox.max[0];
    const yt = panel.bbox.max[1];
    const yb = yt - baseHeightMm;
    const zlo = panel.bbox.min[2] - baseExtendMm;
    const zhi = panel.bbox.max[2] + baseExtendMm;
    const useTabs = tabWidthMm > 0 && tabWidthMm * 3 < x1 - x0;
    const boxCount = useTabs ? 3 : 1;
    const newVC = panel.vertexCount + 8 * boxCount;
    const newTC = panel.triangleCount + 12 * boxCount;
    const newPos = new Float32Array(newVC * 3);
    const newIdx = new Uint32Array(newTC * 3);
    newPos.set(panel.positions);
    newIdx.set(panel.indices);
    if (!useTabs) {
        appendBox(newPos, newIdx, panel.vertexCount, panel.triangleCount * 3, x0, x1, yb, yt, zlo, zhi);
    } else {
        const cx = (x0 + x1) / 2;
        const hw = tabWidthMm / 2;
        const tabs = [
            [
                x0,
                x0 + tabWidthMm
            ],
            [
                cx - hw,
                cx + hw
            ],
            [
                x1 - tabWidthMm,
                x1
            ]
        ];
        let vOff = panel.vertexCount;
        let iOff = panel.triangleCount * 3;
        for (const [xa, xb] of tabs){
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
            min: [
                x0,
                panel.bbox.min[1],
                zlo
            ],
            max: [
                x1,
                yt,
                zhi
            ]
        },
        gridWidth: panel.gridWidth,
        gridHeight: panel.gridHeight
    };
}
export function updateFrontZ(positions, h, borderMm, _pixelMm, minZ, maxZ) {
    const W = h.width, H = h.height;
    for(let j = 0; j < H; j++){
        for(let i = 0; i < W; i++){
            const idx = (j * W + i) * 3;
            positions[idx + 2] = reliefZ(h.data[j * W + i], i, j, W, H, borderMm, minZ, maxZ);
        }
    }
}
export function updateFrontCurved(positions, h, p) {
    const W = h.width, H = h.height;
    const arcRad = p.arcDeg * Math.PI / 180;
    const R = p.widthMm / arcRad;
    const minZ = p.minThicknessMm, maxZ = p.maxThicknessMm;
    const borderMm = p.borderMm;
    for(let j = 0; j < H; j++){
        for(let i = 0; i < W; i++){
            const phi = (i / (W - 1) - 0.5) * arcRad;
            const t = reliefZ(h.data[j * W + i], i, j, W, H, borderMm, minZ, maxZ);
            const r = R + t;
            const idx = (j * W + i) * 3;
            positions[idx + 0] = r * Math.sin(phi);
            positions[idx + 2] = r * Math.cos(phi) - R;
        }
    }
}
