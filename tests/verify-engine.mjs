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

// ---------- image processor (extended) ----------
console.log('\n=== image processor (extended) ===');
{
  const px = (r, g, b, a = 255) => ({
    width: 1, height: 1, data: new Uint8ClampedArray([r, g, b, a]),
  });
  const base = { ...defaultParams, mirror: false, invert: false, gamma: 1,
    brightness: 0, contrast: 0, smoothingPx: 0 };

  // Rec.709 red weight = 0.2126
  let lum = rgbaToLuminance(px(255, 0, 0), base);
  check('red -> 0.2126 (Rec.709)', approx(lum.data[0], 0.2126), `got ${lum.data[0]}`);

  // Rec.709 blue weight = 0.0722
  lum = rgbaToLuminance(px(0, 0, 255), base);
  check('blue -> 0.0722 (Rec.709)', approx(lum.data[0], 0.0722), `got ${lum.data[0]}`);

  // Negative brightness: white shifted to 0.5; black stays at 0 (clamped)
  lum = rgbaToLuminance(px(255, 255, 255), { ...base, brightness: -50 });
  check('brightness -50 shifts white to 0.5', approx(lum.data[0], 0.5), `got ${lum.data[0]}`);
  lum = rgbaToLuminance(px(0, 0, 0), { ...base, brightness: -50 });
  check('brightness -50 clamps black at 0', approx(lum.data[0], 0.0), `got ${lum.data[0]}`);

  // Contrast -100: c=(−100+100)/100=0, so every value maps to (v−0.5)*0+0.5=0.5
  lum = rgbaToLuminance(px(0, 0, 0), { ...base, contrast: -100 });
  check('contrast -100 maps black to 0.5', approx(lum.data[0], 0.5), `got ${lum.data[0]}`);
  lum = rgbaToLuminance(px(255, 255, 255), { ...base, contrast: -100 });
  check('contrast -100 maps white to 0.5', approx(lum.data[0], 0.5), `got ${lum.data[0]}`);

  // Smoothing: 3x3 image with only center pixel lit.
  // After separable box blur r=1, center → 1/9; corners → 0.25.
  const img3 = {
    width: 3, height: 3,
    data: new Uint8ClampedArray([
      0,0,0,255,  0,0,0,255,  0,0,0,255,
      0,0,0,255,  255,255,255,255,  0,0,0,255,
      0,0,0,255,  0,0,0,255,  0,0,0,255,
    ]),
  };
  lum = rgbaToLuminance(img3, { ...base, smoothingPx: 1 });
  check('smoothing reduces center value (1.0 -> ~1/9)', approx(lum.data[4], 1 / 9, 1e-4),
    `got ${lum.data[4].toFixed(5)}, expected ${(1/9).toFixed(5)}`);
  check('smoothing diffuses to corner neighbors (0 -> ~0.25)', approx(lum.data[0], 0.25, 1e-4),
    `got ${lum.data[0].toFixed(5)}, expected 0.25`);

  // Output dimensions preserved through every transform
  const imgWH = { width: 7, height: 5, data: new Uint8ClampedArray(7 * 5 * 4).fill(128) };
  imgWH.data.forEach((_, i, a) => { if (i % 4 === 3) a[i] = 255; });
  lum = rgbaToLuminance(imgWH, { ...base, mirror: true, invert: true, gamma: 1.5,
    brightness: 10, contrast: 20, smoothingPx: 2 });
  check('output width preserved after all transforms', lum.width === 7);
  check('output height preserved after all transforms', lum.height === 5);
  check('output data length matches W*H', lum.data.length === 35);
}

// ---------- store (extended) ----------
console.log('\n=== parameter store (extended) ===');
{
  const store = new ParamStore();
  let hotHits = 0, coldHits = 0;
  store.subscribe(HOT_KEYS, () => hotHits++);
  store.subscribe(COLD_KEYS, () => coldHits++);

  // setMany with values already at their current defaults: no notification
  store.setMany({ gamma: defaultParams.gamma, brightness: defaultParams.brightness });
  check('setMany with unchanged values emits nothing', hotHits === 0 && coldHits === 0);

  // setMany mixing hot + cold keys fires each subscriber set exactly once
  store.setMany({ gamma: 2.2, pixelsPerMm: 5 });
  check('setMany mixed hot+cold fires hot subscriber once', hotHits === 1);
  check('setMany mixed hot+cold fires cold subscriber once', coldHits === 1);

  // widthMm is now a COLD key (affects curved mesh geometry)
  let widthHits = 0;
  store.subscribe(new Set(['widthMm']), () => widthHits++);
  store.set('widthMm', 50);
  check('widthMm notifies a widthMm subscriber', widthHits === 1);
  check('widthMm does not trigger hot subscriber', hotHits === 1);
  check('widthMm triggers cold subscriber', coldHits === 2);

  // Subscriber receives the correct changedKeys set
  let receivedKeys = null;
  store.subscribe(HOT_KEYS, (keys) => { receivedKeys = keys; });
  store.set('gamma', 1.0);
  check('subscriber receives a Set containing the changed key',
    receivedKeys instanceof Set && receivedKeys.has('gamma'),
    `got ${receivedKeys}`);
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

  // All four RGBA channels are transferred correctly (not just R).
  const colorSrc = { width: 1, height: 1, data: new Uint8ClampedArray([100, 150, 200, 42]) };
  const colorUp = resampleRgba(colorSrc, 2, 2);
  check('upsample preserves R channel', colorUp.data[0] === 100);
  check('upsample preserves G channel', colorUp.data[1] === 150);
  check('upsample preserves B channel', colorUp.data[2] === 200);
  check('upsample preserves A channel', colorUp.data[3] === 42);

  // Non-square resize: 4x2 -> 2x4
  const nsq = { width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4).fill(1) };
  const nsqOut = resampleRgba(nsq, 2, 4);
  check('non-square resample target width', nsqOut.width === 2);
  check('non-square resample target height', nsqOut.height === 4);
  check('non-square resample data length', nsqOut.data.length === 2 * 4 * 4);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — engine checks (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
