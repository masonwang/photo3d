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
export function updateFrontZ(positions, h, borderMm, _pixelMm, minZ, maxZ) {
    const W = h.width, H = h.height;
    for(let j = 0; j < H; j++){
        for(let i = 0; i < W; i++){
            const idx = (j * W + i) * 3;
            positions[idx + 2] = reliefZ(h.data[j * W + i], i, j, W, H, borderMm, minZ, maxZ);
        }
    }
}
