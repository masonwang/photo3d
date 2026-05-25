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
        }
    };
}
export function addBaseMesh(panel, baseHeightMm = 3, baseExtendMm = 10) {
    const x0 = panel.bbox.min[0];
    const x1 = panel.bbox.max[0];
    const yt = panel.bbox.max[1];
    const yb = yt - baseHeightMm;
    const zlo = -baseExtendMm;
    const zhi = panel.bbox.max[2] + baseExtendMm;
    const baseVerts = [
        x0,
        yb,
        zlo,
        x0,
        yb,
        zhi,
        x1,
        yb,
        zlo,
        x1,
        yb,
        zhi,
        x0,
        yt,
        zlo,
        x0,
        yt,
        zhi,
        x1,
        yt,
        zlo,
        x1,
        yt,
        zhi
    ];
    const baseTris = [
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
    const vOff = panel.vertexCount;
    const iOff = panel.triangleCount * 3;
    const newVC = panel.vertexCount + 8;
    const newTC = panel.triangleCount + 12;
    const newPos = new Float32Array(newVC * 3);
    const newIdx = new Uint32Array(newTC * 3);
    newPos.set(panel.positions);
    for(let i = 0; i < baseVerts.length; i++)newPos[vOff * 3 + i] = baseVerts[i];
    newIdx.set(panel.indices);
    for(let i = 0; i < baseTris.length; i++)newIdx[iOff + i] = vOff + baseTris[i];
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
        }
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
