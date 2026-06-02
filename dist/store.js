export const defaultParams = {
    widthMm: 30,
    minThicknessMm: 0.5,
    maxThicknessMm: 2.0,
    pixelsPerMm: 10,
    mirror: false,
    invert: true,
    gamma: 1.0,
    brightness: 0,
    contrast: 30,
    smoothingPx: 1,
    borderMm: 2,
    baseExtendMm: 5,
    baseHeightMm: 0.5,
    baseTabWidthMm: 1,
    asciiStl: false
};
export const HOT_KEYS = new Set([
    'minThicknessMm',
    'maxThicknessMm',
    'gamma',
    'brightness',
    'contrast',
    'mirror',
    'invert',
    'smoothingPx'
]);
export const COLD_KEYS = new Set([
    'pixelsPerMm',
    'borderMm',
    'baseExtendMm',
    'baseHeightMm',
    'baseTabWidthMm'
]);
export const FREE_KEYS = new Set([
    'widthMm'
]);
export class ParamStore {
    state;
    listeners = [];
    constructor(initial = {
        ...defaultParams
    }){
        this.state = {
            ...initial
        };
    }
    get() {
        return this.state;
    }
    set(key, value) {
        if (this.state[key] === value) return;
        this.state[key] = value;
        this.emit(new Set([
            key
        ]));
    }
    setMany(patch) {
        const changed = new Set();
        for (const k of Object.keys(patch)){
            const v = patch[k];
            if (v !== undefined && this.state[k] !== v) {
                this.state[k] = v;
                changed.add(k);
            }
        }
        if (changed.size) this.emit(changed);
    }
    subscribe(keys, fn) {
        const entry = {
            keys: new Set(keys),
            fn
        };
        this.listeners.push(entry);
        return ()=>{
            const i = this.listeners.indexOf(entry);
            if (i >= 0) this.listeners.splice(i, 1);
        };
    }
    emit(changed) {
        for (const { keys, fn } of this.listeners){
            let intersects = false;
            for (const k of changed)if (keys.has(k)) {
                intersects = true;
                break;
            }
            if (intersects) fn(changed);
        }
    }
}
