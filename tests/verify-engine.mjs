/**
 * Headless unit checks for the non-DOM engine modules: the parameter store
 * and the pure image-processing functions. (Mesh + STL are covered by
 * verify.mjs; the DOM/three.js modules are exercised in the browser.)
 */
import { ParamStore, HOT_KEYS, COLD_KEYS, defaultParams } from '../src/store.ts';
import { rgbaToLuminance, resampleRgba } from '../src/image-processor.ts';

let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  OK   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function approx(a, b, eps = 1e-4) {
  return Math.abs(a - b) <= eps;
}

// ---------- store ----------
console.log('\n=== parameter store ===');
{
  const store = new ParamStore();
  check('defaults applied', store.get().widthMm === defaultParams.widthMm);

  let hotHits = 0;
  let coldHits = 0;
  store.subscribe(HOT_KEYS, () => hotHits++);
  store.subscribe(COLD_KEYS, () => coldHits++);

  store.set('gamma', 2.0); // hot key
  check('hot subscriber fired on hot key', hotHits === 1);
  check('cold subscriber not fired on hot key', coldHits === 0);

  store.set('pixelsPerMm', 8); // cold key
  check('cold subscriber fired on cold key', coldHits === 1);
  check('hot subscriber not fired on cold key', hotHits === 1);

  store.set('gamma', 2.0); // unchanged value
  check('no notification when value unchanged', hotHits === 1);

  store.setMany({ gamma: 1.5, brightness: 10 });
  check('setMany batches into a single notification', hotHits === 2);

  const unsub = store.subscribe(HOT_KEYS, () => hotHits++);
  unsub();
  store.set('gamma', 1.1);
  check('unsubscribe stops notifications', hotHits === 3); // only the original hot sub
}

// ---------- image processor: rgbaToLuminance ----------
console.log('\n=== image processor ===');
{
  // Helper to build a 1x1 RGBA image.
  const px = (r, g, b, a = 255) => ({
    width: 1, height: 1, data: new Uint8ClampedArray([r, g, b, a]),
  });
  const base = { ...defaultParams, mirror: false, invert: false, gamma: 1,
    brightness: 0, contrast: 0, smoothingPx: 0 };

  // Pure white -> luminance 1.0
  let lum = rgbaToLuminance(px(255, 255, 255), base);
  check('white -> 1.0', approx(lum.data[0], 1.0), `got ${lum.data[0]}`);

  // Pure black -> 0.0
  lum = rgbaToLuminance(px(0, 0, 0), base);
  check('black -> 0.0', approx(lum.data[0], 0.0), `got ${lum.data[0]}`);

  // Rec.709 luminance of pure green = 0.7152
  lum = rgbaToLuminance(px(0, 255, 0), base);
  check('green -> 0.7152', approx(lum.data[0], 0.7152), `got ${lum.data[0]}`);

  // Invert: white -> 0.0
  lum = rgbaToLuminance(px(255, 255, 255), { ...base, invert: true });
  check('invert white -> 0.0', approx(lum.data[0], 0.0), `got ${lum.data[0]}`);

  // Gamma: mid-gray (0.5) with gamma 2.0 -> 0.25
  // Build a pixel whose luminance is exactly 0.5: r=g=b=127.5 ~ use 128 -> ~0.50196
  lum = rgbaToLuminance(px(128, 128, 128), { ...base, gamma: 2.0 });
  const g = 128 / 255;
  check('gamma 2.0 squares the value', approx(lum.data[0], g * g, 1e-3),
    `got ${lum.data[0]}, expected ${(g * g).toFixed(4)}`);

  // Brightness: +50 adds 0.5, clamped at 1.0
  lum = rgbaToLuminance(px(128, 128, 128), { ...base, brightness: 50 });
  check('brightness +50 shifts up', lum.data[0] > g && lum.data[0] <= 1.0,
    `got ${lum.data[0]}`);

  // Mirror: a 2x1 image [black, white] mirrored -> [white, black]
  const img2 = { width: 2, height: 1, data: new Uint8ClampedArray([
    0, 0, 0, 255,       // x=0 black
    255, 255, 255, 255, // x=1 white
  ]) };
  lum = rgbaToLuminance(img2, { ...base, mirror: true });
  check('mirror swaps columns',
    approx(lum.data[0], 1.0) && approx(lum.data[1], 0.0),
    `got [${lum.data[0]}, ${lum.data[1]}]`);

  // Contrast: +50 should push values away from 0.5
  const lo = rgbaToLuminance(px(96, 96, 96), { ...base, contrast: 50 });
  const baseLo = rgbaToLuminance(px(96, 96, 96), base);
  check('contrast +50 pushes dark values darker', lo.data[0] < baseLo.data[0],
    `got ${lo.data[0]} vs base ${baseLo.data[0]}`);
}

// ---------- image processor: resampleRgba ----------
console.log('\n=== resample ===');
{
  // 2x2 image, downsample to 1x1 — should pick a valid source pixel.
  const img = { width: 2, height: 2, data: new Uint8ClampedArray([
    10, 10, 10, 255,   20, 20, 20, 255,
    30, 30, 30, 255,   40, 40, 40, 255,
  ]) };
  const out = resampleRgba(img, 1, 1);
  check('downsample 2x2 -> 1x1 size', out.width === 1 && out.height === 1);
  check('downsample picks a real source value',
    [10, 20, 30, 40].includes(out.data[0]), `got ${out.data[0]}`);

  // Identity resample returns equivalent data.
  const same = resampleRgba(img, 2, 2);
  check('identity resample preserves dimensions', same.width === 2 && same.height === 2);

  // Upsample 1x1 -> 3x3 fills every pixel with the source value.
  const one = { width: 1, height: 1, data: new Uint8ClampedArray([77, 77, 77, 255]) };
  const up = resampleRgba(one, 3, 3);
  let allMatch = true;
  for (let i = 0; i < up.data.length; i += 4) if (up.data[i] !== 77) allMatch = false;
  check('upsample 1x1 -> 3x3 fills with source', allMatch);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — engine checks (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
