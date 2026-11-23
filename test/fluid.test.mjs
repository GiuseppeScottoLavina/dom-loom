import assert from 'node:assert/strict';
import test from 'node:test';
import { FluidSim, REST } from '../src/behaviors/fluid-sim.js';
import { strengthOf } from '../src/behaviors/fluids.js';
import { mapThrough } from '../src/core/mapper.js';
import { Scene, U, UNIFORM_FLOATS } from '../src/core/scene.js';
import { buildShader } from '../src/core/shader.js';
import { primitives } from '../src/core/primitives.js';
import { FLUID } from '../src/primitives/fluid.js';

const COLS = 64;
const ROWS = 40;
const W = 640;
const H = 400;

function uniforms() {
  const u = new Float32Array(UNIFORM_FLOATS);
  u[U.viewport + 2] = W;
  u[U.viewport + 3] = H;
  u.set([COLS, ROWS, 1], U.field);
  return u;
}

/** A stroke across the sim: n steps of a finger moving at (vx, vy) px/s, one frame each. */
function stroke(sim, x, y, vx, vy, n) {
  for (let i = 0; i < n; i++) {
    sim.splat(x, y, vx, vy);
    sim.step(1 / 60);
    x += vx / 60;
    y += vy / 60;
  }
}

test('a stirred fluid stays finite and bounded, and moves with the finger', () => {
  const sim = new FluidSim(COLS, ROWS);
  sim.resize(W, H);
  stroke(sim, 60, 200, 1400, 0, 18);
  assert.ok(sim.data.every(Number.isFinite), 'finite');
  assert.ok(sim.maxShift > 8, `a stroke displaces the picture (${sim.maxShift})`);
  assert.ok(sim.maxShift <= 44.001, `and is capped (${sim.maxShift})`);
  // The finger drags to the right, so the pixel shows content that was to its left: o.x < 0, near the stroke.
  let sum = 0;
  for (let c = 0; c < COLS; c++) for (let r = 18; r < 22; r++) sum += sim.data[(r * COLS + c) * 2];
  assert.ok(sum < 0, `content follows the finger (sum o.x = ${sum})`);
  // Far from the finger nothing has moved.
  const far = (35 * COLS + 60) * 2;
  assert.ok(Math.hypot(sim.data[far], sim.data[far + 1]) < sim.maxShift * 0.12, `the far corner is nearly still (${Math.hypot(sim.data[far], sim.data[far + 1]).toFixed(2)} of ${sim.maxShift.toFixed(1)} px)`);
});

test('a stirred fluid settles to exact rest, smoothly, and stays at rest', () => {
  const sim = new FluidSim(COLS, ROWS);
  sim.resize(W, H);
  stroke(sim, 80, 120, 900, 500, 24);
  let frames = 0;
  let wobbles = 0;
  let last = sim.maxShift;
  let rising = false;
  while (!sim.resting && frames < 1200) {
    sim.step(1 / 60);
    frames++;
    if (sim.maxShift > last + 0.05 && !rising) wobbles++;
    rising = sim.maxShift > last + 0.05;
    last = sim.maxShift;
  }
  assert.ok(sim.resting, 'it comes to rest');
  assert.ok(frames < 400, `in under 6.5 s (${frames} frames)`);
  assert.ok(sim.data.every((v) => v === 0), 'the field is exactly zero');
  assert.ok(sim.maxShift < REST);
  // At rest, a step changes nothing.
  sim.step(1 / 60);
  assert.ok(sim.data.every((v) => v === 0));
  console.log(`       settles in ${frames} frames (${(frames / 60).toFixed(1)} s at 60 Hz), ${wobbles} wobble(s)`);
});

test('the fluid is stable at any frame rate and with a huge step', () => {
  for (const dt of [1 / 240, 1 / 120, 1 / 30, 0.5, 5]) {
    const sim = new FluidSim(COLS, ROWS);
    sim.resize(W, H);
    for (let i = 0; i < 20; i++) {
      sim.splat(200 + i * 10, 150, 3000, -800);
      sim.step(dt);
    }
    for (let i = 0; i < 40; i++) sim.step(dt);
    assert.ok(sim.data.every(Number.isFinite), `finite at dt ${dt}`);
    assert.ok(sim.maxShift <= 44.001, `bounded at dt ${dt}`);
  }
});

test('the fluid is incompressible enough to swirl: a stroke leaves curl, not only a heap', () => {
  const sim = new FluidSim(COLS, ROWS);
  sim.resize(W, H);
  stroke(sim, 100, 200, 1000, 0, 20);
  // Divergence of the velocity stays small next to its vorticity.
  let div = 0;
  let curl = 0;
  for (let r = 2; r < ROWS - 2; r++) {
    for (let c = 2; c < COLS - 2; c++) {
      const i = r * COLS + c;
      div += Math.abs((sim.vx[i + 1] - sim.vx[i - 1]) / (2 * sim.cw) + (sim.vy[i + COLS] - sim.vy[i - COLS]) / (2 * sim.ch));
      curl += Math.abs((sim.vy[i + 1] - sim.vy[i - 1]) / (2 * sim.cw) - (sim.vx[i + COLS] - sim.vx[i - COLS]) / (2 * sim.ch));
    }
  }
  assert.ok(curl > 0.5, `it swirls (curl ${curl.toFixed(1)})`);
  assert.ok(div < curl * 0.6, `and does not pile up (div ${div.toFixed(1)} < curl ${curl.toFixed(1)})`);
});

test('a step costs well under half a millisecond on a busy grid', () => {
  const sim = new FluidSim(COLS, ROWS);
  sim.resize(W, H);
  for (let i = 0; i < 300; i++) {
    sim.splat(320 + Math.cos(i / 6) * 200, 200 + Math.sin(i / 6) * 120, Math.cos(i / 6) * 1200, Math.sin(i / 6) * 800);
    sim.step(1 / 60);
  }
  let worst = 0;
  const t0 = performance.now();
  const N = 400;
  for (let i = 0; i < N; i++) {
    sim.splat(320 + Math.cos(i / 6) * 200, 200 + Math.sin(i / 6) * 120, Math.cos(i / 6) * 1200, Math.sin(i / 6) * 800);
    const a = performance.now();
    sim.step(1 / 60);
    worst = Math.max(worst, performance.now() - a);
  }
  const avg = (performance.now() - t0) / N;
  console.log(`       fluid step (splat + step): ${avg.toFixed(3)} ms average, ${worst.toFixed(3)} ms worst of ${N}`);
  assert.ok(avg < 0.5, `average ${avg} ms`);
});

test('a new canvas size restarts the water', () => {
  const sim = new FluidSim(COLS, ROWS);
  sim.resize(W, H);
  stroke(sim, 100, 200, 1000, 0, 10);
  assert.ok(sim.maxShift > 1);
  sim.resize(W, H);
  assert.ok(sim.maxShift > 1, 'the same size keeps the water');
  sim.resize(W + 1, H);
  assert.ok(sim.data.every((v) => v === 0) && sim.maxShift === 0, 'another size starts over');
});

test('the strength of a [fluid] element is its value, 1 when empty or unreadable', () => {
  const el = (value) => ({ getAttribute: () => value });
  assert.equal(strengthOf(el('')), 1);
  assert.equal(strengthOf(el(null)), 1);
  assert.equal(strengthOf(el('0.5')), 0.5);
  assert.equal(strengthOf(el('0')), 0);
  assert.equal(strengthOf(el('abc')), 1);
  assert.equal(strengthOf(el('-2')), 0);
  assert.equal(strengthOf(el('99')), 3);
});

// The primitive's twin: the field of the frame, scaled by the strength, only inside the element, faded at its edge.
test('the fluid primitive moves the picture by the field, inside its rect only, and the mapper sees the frozen field', () => {
  const field = new Float32Array(COLS * ROWS * 2);
  for (let i = 0; i < COLS * ROWS; i++) field.set([-20, 8], i * 2);
  const scene = new Scene();
  scene.push(FLUID, [100, 100, 300, 200], [1, 1, 0, 0]);
  const u = uniforms();
  const inner = mapThrough(250, 200, u, scene.data, scene.count, field);
  assert.deepEqual(inner, { x: 230, y: 208 }, 'the middle shows content from the field shift');
  assert.deepEqual(mapThrough(50, 200, u, scene.data, scene.count, field), { x: 50, y: 200 }, 'outside the element nothing moves');
  const edge = mapThrough(102, 200, u, scene.data, scene.count, field);
  assert.ok(Math.abs(edge.x - 102) < 4, `it fades toward the edge (${edge.x - 102})`);
  assert.deepEqual(mapThrough(250, 200, u, scene.data, scene.count, null), { x: 250, y: 200 }, 'no field, no displacement');
  const half = new Scene();
  half.push(FLUID, [100, 100, 300, 200], [0.5, 1, 0, 0]);
  assert.deepEqual(mapThrough(250, 200, u, half.data, half.count, field), { x: 240, y: 204 }, 'half strength, half the shift');
});

test('two fluid elements share one field and differ by rect and strength', () => {
  const field = new Float32Array(COLS * ROWS * 2);
  for (let i = 0; i < COLS * ROWS; i++) field.set([10, 0], i * 2);
  const scene = new Scene();
  scene.push(FLUID, [20, 20, 200, 100], [1, 1, 0, 0]);
  scene.push(FLUID, [20, 200, 200, 100], [0.5, 1, 0, 0]);
  const u = uniforms();
  assert.equal(mapThrough(120, 70, u, scene.data, scene.count, field).x, 130);
  assert.equal(mapThrough(120, 250, u, scene.data, scene.count, field).x, 125);
  assert.equal(mapThrough(120, 150, u, scene.data, scene.count, field).x, 120, 'between them nothing moves');
});

test('the shader builds with the fluid primitive: offset, light, and no pass when it is absent', () => {
  const code = buildShader(primitives.all());
  assert.ok(code.includes('fn fluidAt('));
  assert.ok(code.includes('if (kind == 26u)'));
  assert.ok(buildShader([primitives.get(FLUID)]).includes(`present(${(1 << 26) >>> 0}u)`));
  assert.ok(!buildShader([]).includes('fluidAt'));
});
