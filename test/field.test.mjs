import assert from 'node:assert/strict';
import test from 'node:test';
import { DENT, GHOST, GLITCH, JITTER, LENS, MORPH, ROLL, SHIFT, VORTEX, Scene, U, UNIFORM_FLOATS, mapThrough, offsetAt, pcg } from '../src/field.js';

const W = 400;
const H = 300;
function uniforms(extra = {}) {
  const u = new Float32Array(UNIFORM_FLOATS);
  u[U.viewport + 2] = W;
  u[U.viewport + 3] = H;
  for (const [k, v] of Object.entries(extra)) u[U[k]] = v;
  return u;
}

test('pcg is a u32 hash with the WGSL wrap-around', () => {
  // Reference values computed with 32-bit unsigned arithmetic.
  const ref = (v) => {
    const state = (BigInt(v) * 747796405n + 2891336453n) & 0xffffffffn;
    const word = (((state >> ((state >> 28n) + 4n)) ^ state) * 277803737n) & 0xffffffffn;
    return Number(((word >> 22n) ^ word) & 0xffffffffn);
  };
  for (const v of [0, 1, 7, 31, 4093, 65535, 123456789, 0xffffffff]) assert.equal(pcg(v >>> 0), ref(v >>> 0));
});

test('an empty scene maps every point to itself', () => {
  const scene = new Scene();
  assert.deepEqual(mapThrough(120, 80, uniforms(), scene.data, 0), { x: 120, y: 80 });
});

test('a pressed dent shows content from farther out: the button shrinks toward the finger', () => {
  const scene = new Scene();
  scene.push(DENT, [100, 100, 200, 60], [200, 130, 110, 1], [0, 0, 9]);
  const p = mapThrough(240, 130, uniforms(), scene.data, scene.count);
  assert.ok(p.x > 240, `source x ${p.x} should be farther from the contact than 240`);
  assert.equal(p.y, 130);
  // Outside the clip rect nothing moves.
  assert.deepEqual(mapThrough(20, 20, uniforms(), scene.data, scene.count), { x: 20, y: 20 });
  // At the clip edge the displacement fades to zero: no tear.
  const edge = mapThrough(100.01, 130, uniforms(), scene.data, scene.count);
  assert.ok(Math.abs(edge.x - 100.01) < 0.2);
});

test('a ring crest pushes content outward', () => {
  const scene = new Scene();
  scene.push(DENT, [0, 0, 400, 300], [200, 150, 100, 0], [50, 4, 9]);
  const p = mapThrough(250, 150, uniforms(), scene.data, scene.count);
  assert.ok(p.x < 250 - 3.5, `the crest samples toward the centre (got ${p.x})`);
});

test('jitter and glitch stay inside their rectangles and are finite', () => {
  const scene = new Scene();
  scene.push(JITTER, [50, 50, 100, 40], [2, 1.3, 0.4]);
  scene.push(GLITCH, [50, 120, 100, 40], [8, 3, 77]);
  let moved = 0;
  for (let y = 120; y < 160; y += 1) {
    const o = offsetAt(100, y, scene.data, scene.count);
    assert.ok(Number.isFinite(o.x) && Math.abs(o.x) <= 8);
    if (o.x !== 0) moved++;
  }
  assert.ok(moved > 3, 'some glitch slices move');
  assert.deepEqual(offsetAt(10, 10, scene.data, scene.count), { x: 0, y: 0 });
});

test('a transition maps the old page to no target and flying elements to their new place', () => {
  const scene = new Scene();
  // A 100x40 element flying from (20, 20) to (220, 200), drawn now at (120, 110).
  scene.push(MORPH, [120, 110, 100, 40], [20, 20, 100, 40], [220, 200, 100, 40], 0.5);
  const u = uniforms({ wipeActive: 1, wipeFront: 0.5, wipeBand: 0.1, wipeSlant: 0.42 });
  assert.deepEqual(mapThrough(170, 130, u, scene.data, scene.count), { x: 270, y: 220 });
  assert.equal(mapThrough(390, 290, u, scene.data, scene.count), null, 'the old page has no target');
  assert.deepEqual(mapThrough(10, 10, u, scene.data, scene.count), { x: 10, y: 10 }, 'the revealed page is live');
});

test('the boot sweep hides what it has not reached', () => {
  const u = uniforms({ bootActive: 1, bootLine: 100 });
  assert.equal(mapThrough(10, 150, u, new Float32Array(16), 0), null);
  assert.deepEqual(mapThrough(10, 50, u, new Float32Array(16), 0), { x: 10, y: 50 });
});

test('a shift shows content from below, and empty space past the edge', () => {
  const scene = new Scene();
  // A details body of 60 px opening under a line at y = 100, 20 px uncovered so far.
  scene.push(SHIFT, [0, 120, W, 1e5], [0, 40]);
  assert.deepEqual(mapThrough(50, 110, uniforms(), scene.data, scene.count), { x: 50, y: 110 }, 'the uncovered body is live');
  assert.deepEqual(mapThrough(50, 150, uniforms(), scene.data, scene.count), { x: 50, y: 190 }, 'below, the old place shows the moved content');
  assert.equal(mapThrough(50, 280, uniforms(), scene.data, scene.count), null, 'nothing comes from past the bottom');
});

test('a ghost band shows the old picture and takes no input', () => {
  const scene = new Scene();
  scene.push(GHOST, [0, 100, W, 30]);
  scene.push(SHIFT, [0, 130, W, 1e5], [0, -30]);
  assert.equal(mapThrough(50, 110, uniforms(), scene.data, scene.count), null);
  assert.deepEqual(mapThrough(50, 160, uniforms(), scene.data, scene.count), { x: 50, y: 130 });
  // During a cut too: a ghost is a picture, never a target.
  const u = uniforms({ wipeActive: 1, wipeFront: 2, wipeSlant: 0.42 });
  assert.equal(mapThrough(50, 110, u, scene.data, scene.count), null);
});

test('a scoped cut leaves the rest of the stage live and runs the way it is told', () => {
  const scene = new Scene();
  const u = uniforms({ wipeActive: 1, wipeFront: 0.5, wipeBand: 0.1, wipeSlant: 0 });
  u.set([100, 100, 200, 100], U.scope);
  u[U.wipeDir] = 1;
  assert.deepEqual(mapThrough(20, 20, u, scene.data, scene.count), { x: 20, y: 20 }, 'outside the scope');
  assert.deepEqual(mapThrough(150, 150, u, scene.data, scene.count), { x: 150, y: 150 }, 'left half cut first');
  assert.equal(mapThrough(250, 150, u, scene.data, scene.count), null, 'right half still old');
  u[U.wipeDir] = -1;
  assert.equal(mapThrough(150, 150, u, scene.data, scene.count), null, 'mirrored: left half still old');
  assert.deepEqual(mapThrough(250, 150, u, scene.data, scene.count), { x: 250, y: 150 });
});

test('a moving glass bends what is under its edge, inward, and nothing outside it', () => {
  const scene = new Scene();
  const glassRect = [100, 100, 120, 40];
  scene.push(LENS, [99, 99, 122, 42], [4, 6, 14, 0], glassRect);
  const nearLeft = mapThrough(102, 120, uniforms(), scene.data, scene.count);
  assert.ok(nearLeft.x > 102 + 3, `the left rim shows content from farther in (${nearLeft.x})`);
  const nearTop = mapThrough(160, 101, uniforms(), scene.data, scene.count);
  assert.ok(nearTop.y > 101 + 3, `the top rim too (${nearTop.y})`);
  assert.deepEqual(mapThrough(160, 120, uniforms(), scene.data, scene.count), { x: 160, y: 120 }, 'the middle is clear');
  assert.deepEqual(mapThrough(90, 120, uniforms(), scene.data, scene.count), { x: 90, y: 120 }, 'outside is untouched');
});

test('during a cut, what left the page takes no input, and flights stay on top of it', () => {
  const scene = new Scene();
  scene.push(GHOST, [0, 100, W, 40], [0, 0, 0, 0], [0, 0, 0, 0], 0, 0.5, 1);
  scene.push(MORPH, [0, 120, 100, 40], [0, 0, 100, 40], [0, 200, 100, 40], 0.5);
  const u = uniforms({ wipeActive: 1, wipeFront: 1.1, wipeBand: 0.1, wipeSlant: 0.42 });
  assert.equal(mapThrough(200, 110, u, scene.data, scene.count), null, 'the crumbling row');
  assert.deepEqual(mapThrough(50, 130, u, scene.data, scene.count), { x: 50, y: 210 }, 'a flight over it');
  assert.deepEqual(mapThrough(200, 180, u, scene.data, scene.count), { x: 200, y: 180 }, 'the rest is live');
});

test('a vortex twists the picture around its centre and leaves the centre and far points alone', () => {
  const scene = new Scene();
  scene.push(VORTEX, [0, 0, W, H], [200, 150, 60, 1.2], [0.1]);
  assert.deepEqual(mapThrough(200, 150, uniforms(), scene.data, scene.count), { x: 200, y: 150 }, 'the eye is still');
  const near = mapThrough(230, 150, uniforms(), scene.data, scene.count);
  assert.ok(near.y > 150 + 8, `a point near the eye shows content from around the turn (${JSON.stringify(near)})`);
  const far = mapThrough(395, 290, uniforms(), scene.data, scene.count);
  assert.ok(Math.abs(far.x - 395) < 0.5 && Math.abs(far.y - 290) < 0.5, 'far away nothing turns');
});

test('a rolling value maps as itself', () => {
  const scene = new Scene();
  scene.push(ROLL, [100, 100, 80, 30], [0.5, 1]);
  assert.deepEqual(mapThrough(120, 110, uniforms(), scene.data, scene.count), { x: 120, y: 110 });
});
