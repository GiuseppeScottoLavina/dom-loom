import assert from 'node:assert/strict';
import test from 'node:test';
import { mapThrough } from '../src/core/mapper.js';
import { Scene, U, UNIFORM_FLOATS } from '../src/core/scene.js';
import { buildShader } from '../src/core/shader.js';
import { primitives } from '../src/core/primitives.js';
import { ZOOM } from '../src/primitives/zoom.js';

const W = 400;
const H = 200;
function uniforms() {
  const u = new Float32Array(UNIFORM_FLOATS);
  u[U.viewport + 2] = W;
  u[U.viewport + 3] = H;
  return u;
}
const zoom = (scale, fade = 1) => {
  const scene = new Scene();
  scene.push(ZOOM, [0, 0, W, H], [scale, fade]);
  return scene;
};
// The scene holds 32-bit floats: 0.95 is not exact. A thousandth of a pixel is.
const near = (a, b) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;

test('a zoom maps a point to where the panel shows it: c + (p - c) / scale', () => {
  const scene = zoom(0.95);
  // The centre stays; a point 95 px right of it shows the panel 100 px right of it.
  assert.ok(near(mapThrough(200, 100, uniforms(), scene.data, scene.count), { x: 200, y: 100 }));
  assert.ok(near(mapThrough(295, 100, uniforms(), scene.data, scene.count), { x: 300, y: 100 }));
  assert.ok(near(mapThrough(105, 52.5, uniforms(), scene.data, scene.count), { x: 100, y: 50 }));
});

test('a zoom takes no input past the scaled panel, nor while it is all but faded', () => {
  const scene = zoom(0.9);
  // The scaled panel spans x 20..380: x 10 shows nothing.
  assert.equal(mapThrough(10, 100, uniforms(), scene.data, scene.count), null);
  assert.ok(mapThrough(25, 100, uniforms(), scene.data, scene.count));
  const faded = zoom(0.94, 0.02);
  assert.equal(mapThrough(200, 100, uniforms(), faded.data, faded.count), null);
});

test('at scale 1 a zoom leaves every point where it is', () => {
  const scene = zoom(1);
  assert.ok(near(mapThrough(17, 183, uniforms(), scene.data, scene.count), { x: 17, y: 183 }));
});

test('the zoom is in the shader the page builds', () => {
  const code = buildShader(primitives.all());
  assert.match(code, /p = zc \+ \(p - zc\) \/ max\(it\.p\.x, 0\.01\);/);
});
