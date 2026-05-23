export function meshToBinaryStl(mesh, headerText = 'lithophane-app') {
    const triCount = mesh.triangleCount;
    const buf = new ArrayBuffer(84 + 50 * triCount);
    const view = new DataView(buf);
    for(let i = 0; i < Math.min(80, headerText.length); i++){
        view.setUint8(i, headerText.charCodeAt(i) & 0x7f);
    }
    view.setUint32(80, triCount, true);
    let offset = 84;
    const pos = mesh.positions;
    const idx = mesh.indices;
    const maxY = mesh.bbox.max[1];
    for(let t = 0; t < triCount; t++){
        const i0 = idx[t * 3 + 0] * 3;
        const i1 = idx[t * 3 + 1] * 3;
        const i2 = idx[t * 3 + 2] * 3;
        const v0x = pos[i0], v0y = pos[i0 + 2], v0z = maxY - pos[i0 + 1];
        const v1x = pos[i1], v1y = pos[i1 + 2], v1z = maxY - pos[i1 + 1];
        const v2x = pos[i2], v2y = pos[i2 + 2], v2z = maxY - pos[i2 + 1];
        const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
        const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        const len = Math.hypot(nx, ny, nz);
        if (len > 0) {
            nx /= len;
            ny /= len;
            nz /= len;
        } else {
            nx = 0;
            ny = 0;
            nz = 0;
        }
        view.setFloat32(offset + 0, nx, true);
        view.setFloat32(offset + 4, ny, true);
        view.setFloat32(offset + 8, nz, true);
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
export function validateBinaryStlBuffer(buf) {
    if (buf.byteLength < 84) return `file too small: ${buf.byteLength} bytes`;
    const view = new DataView(buf);
    const triCount = view.getUint32(80, true);
    const expectedSize = 84 + 50 * triCount;
    if (buf.byteLength !== expectedSize) {
        return `size mismatch: file=${buf.byteLength}, expected=${expectedSize} for ${triCount} triangles`;
    }
    let offset = 84;
    for(let t = 0; t < triCount; t++){
        for(let f = 0; f < 12; f++){
            const v = view.getFloat32(offset + f * 4, true);
            if (!Number.isFinite(v)) return `non-finite float at triangle ${t} field ${f}`;
        }
        offset += 50;
    }
    return null;
}
