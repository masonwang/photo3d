/**
 * Reactive parameter store for the lithophane pipeline.
 *
 * Subscribers register interest in a set of keys; they are only notified
 * when one of those keys changes. This lets the image processor, mesh
 * generator, and renderer each subscribe to just the slice that affects them
 * — the heart of the hot-path / cold-path architecture.
 */

export type Params = {
  // Geometry
  widthMm: number;
  minThicknessMm: number;
  maxThicknessMm: number;
  pixelsPerMm: number;
  // Image processing
  mirror: boolean;
  invert: boolean;
  gamma: number;
  brightness: number; // -100 .. 100
  contrast: number;   // -100 .. 100
  smoothingPx: number;
  // Border
  borderMm: number;
  // Base
  baseExtendMm: number;  // how far the foot extends beyond the panel on each side
  baseHeightMm: number;  // height of the base foot from the build plate
  baseTabWidthMm: number; // 0 = solid base; >0 = three breakaway tabs of this width
  // Output
  asciiStl: boolean;
};

export const defaultParams: Params = {
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
  asciiStl: false,
};

// Hot-path keys: change recomputes Z values on the existing mesh — instant.
export const HOT_KEYS = new Set<keyof Params>([
  'minThicknessMm',
  'maxThicknessMm',
  'gamma',
  'brightness',
  'contrast',
  'mirror',
  'invert',
  'smoothingPx',
]);

// Cold-path keys: change requires rebuilding the mesh structure — debounced.
export const COLD_KEYS = new Set<keyof Params>([
  'pixelsPerMm',
  'borderMm',
  'baseExtendMm',
  'baseHeightMm',
  'baseTabWidthMm',
]);

// Free keys: no recompute — handled as a scene-graph transform.
export const FREE_KEYS = new Set<keyof Params>([
  'widthMm',
]);

type Listener = (changedKeys: ReadonlySet<keyof Params>) => void;

export class ParamStore {
  private state: Params;
  private listeners: Array<{ keys: Set<keyof Params>; fn: Listener }> = [];

  constructor(initial: Params = { ...defaultParams }) {
    this.state = { ...initial };
  }

  get(): Readonly<Params> {
    return this.state;
  }

  set<K extends keyof Params>(key: K, value: Params[K]): void {
    if (this.state[key] === value) return;
    this.state[key] = value;
    this.emit(new Set([key]));
  }

  setMany(patch: Partial<Params>): void {
    const changed = new Set<keyof Params>();
    for (const k of Object.keys(patch) as Array<keyof Params>) {
      const v = patch[k];
      if (v !== undefined && this.state[k] !== v) {
        (this.state as any)[k] = v;
        changed.add(k);
      }
    }
    if (changed.size) this.emit(changed);
  }

  /** Subscribe; fn is called when any of `keys` changes. */
  subscribe(keys: Iterable<keyof Params>, fn: Listener): () => void {
    const entry = { keys: new Set(keys), fn };
    this.listeners.push(entry);
    return () => {
      const i = this.listeners.indexOf(entry);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(changed: Set<keyof Params>) {
    for (const { keys, fn } of this.listeners) {
      let intersects = false;
      for (const k of changed) if (keys.has(k)) { intersects = true; break; }
      if (intersects) fn(changed);
    }
  }
}
