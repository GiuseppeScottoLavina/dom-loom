import assert from 'node:assert/strict';
import test from 'node:test';
import { mapThrough, offsetAt } from '../src/core/mapper.js';
import { fieldAt, pcg } from '../src/core/math.js';
import { definePrimitive, primitives } from '../src/core/primitives.js';
import { Scene, U, UNIFORM_FLOATS } from '../src/core/scene.js';
import { buildShader } from '../src/core/shader.js';
import { BEND } from '../src/primitives/bend.js';
import { DENT } from '../src/primitives/dent.js';
import { GHOST } from '../src/primitives/ghost.js';
import { GLITCH } from '../src/primitives/glitch.js';
import { JITTER } from '../src/primitives/jitter.js';
import { LENS } from '../src/primitives/lens.js';
import { MORPH } from '../src/primitives/morph.js';
import { ROLL } from '../src/primitives/roll.js';
import { SHIFT } from '../src/primitives/shift.js';
import { STRETCH } from '../src/primitives/stretch.js';
import { TILT } from '../src/primitives/tilt.js';
import { VORTEX } from '../src/primitives/vortex.js';

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

test('a flat tilt is the identity; a turned card maps onto its plane, beside it nothing', () => {
  const flat = new Scene();
  flat.push(TILT, [100, 100, 200, 120], [0, 0, 900, 1], [0, 0, 0, 0], 12);
  assert.deepEqual(mapThrough(150, 130, uniforms(), flat.data, flat.count), { x: 150, y: 130 });
  const turned = new Scene();
  turned.push(TILT, [100, 100, 200, 120], [0.12, 0.2, 900, 1.03], [0, 0, 0, 0], 14);
  const centre = mapThrough(200, 160, uniforms(), turned.data, turned.count);
  assert.ok(Math.abs(centre.x - 200) < 0.01 && Math.abs(centre.y - 160) < 0.01, 'the centre stays');
  const right = mapThrough(290, 160, uniforms(), turned.data, turned.count);
  assert.ok(right && right.x > 290, `the receding side is drawn smaller: the pixel shows a farther point (${right?.x})`);
  assert.equal(mapThrough(305, 104, uniforms(), turned.data, turned.count), null, 'beside the turned card');
});

test('a bent strip keeps its middle and its ends, and crowds the sides', () => {
  const scene = new Scene();
  scene.push(BEND, [0, 0, 400, 100], [0.8, 0]);
  const at = (x) => mapThrough(x, 50, uniforms(), scene.data, scene.count).x;
  assert.ok(Math.abs(at(200) - 200) < 1e-6);
  assert.ok(Math.abs(at(400) - 400) < 0.5);
  assert.ok(at(250) < 250, 'the middle swells: a pixel shows content nearer the middle');
  assert.ok(at(399) - at(389) > 10, 'at the ends, content crowds: more than a pixel per pixel');
});

test('a stretch sends the divider shown to the divider laid out, and keeps the edges', () => {
  const scene = new Scene();
  scene.push(STRETCH, [0, 0, 400, 100], [0, 400, 200, 240]);
  const at = (x) => mapThrough(x, 50, uniforms(), scene.data, scene.count).x;
  assert.equal(at(240), 200);
  assert.equal(at(0), 0);
  assert.ok(Math.abs(at(400) - 400) < 1e-6);
  assert.ok(Math.abs(at(120) - 100) < 1e-6, 'the left pane is stretched evenly');
});

// A cut style registered here: the left half of the scope is live behind the front, and the
// style shows the old page everywhere while front is 0 (the cut waits for the new picture).
const CUT_KIND = 30;
definePrimitive({
  kind: CUT_KIND,
  name: 'test-cut',
  cut: {
    wgsl: 'fn testCut(p: vec2f, sc: vec4f, s: f32, front: f32, dir: f32, light: ptr<function, vec3f>) -> vec3f { return sampleGhost(p); }',
    fn: 'testCut',
    js: (x, y, sc, s, front) => (front > 0 && x < sc[0] + sc[2] / 2 ? undefined : null),
  },
});

test('a cut style maps as its js says, inside the scope only', () => {
  const none = new Float32Array(16);
  const u = uniforms({ wipeActive: 1, wipeFront: 0.3, wipeBand: 0.1, wipeSlant: 0.42, wipeStyle: CUT_KIND });
  // The blade would show the old page at s > 0.3 here; the style says live (left half).
  assert.deepEqual(mapThrough(100, 250, u, none, 0), { x: 100, y: 250 }, 'live where the style says so');
  assert.equal(mapThrough(300, 20, u, none, 0), null, 'old where the style says null');
  u.set([100, 100, 200, 100], U.scope);
  assert.deepEqual(mapThrough(20, 280, u, none, 0), { x: 20, y: 280 }, 'outside the scope the page is live');
  assert.deepEqual(mapThrough(150, 150, u, none, 0), { x: 150, y: 150 });
  assert.equal(mapThrough(250, 150, u, none, 0), null);
  // Waiting for the new picture: front is 0, everything is the old page.
  u[U.wipeFront] = 0;
  assert.equal(mapThrough(150, 150, u, none, 0), null);
  // An unknown style kind keeps the blade.
  u[U.wipeFront] = 0.5;
  u[U.wipeStyle] = 28;
  assert.deepEqual(mapThrough(150, 150, u, none, 0), { x: 150, y: 150 });
  assert.equal(mapThrough(250, 150, u, none, 0), null);
});

test('the shader emits the presence mask as two unsigned words, kinds 0..31 and 32..63', () => {
  const code = buildShader([{ kind: 27, name: 'a', light: { wgsl: '' } }, { kind: 31, name: 'b', post: { wgsl: '' } }]);
  assert.ok(code.includes(`present(${(1 << 27) >>> 0}u, 0u)`), 'kind 27');
  assert.ok(code.includes('present(2147483648u, 0u)'), 'kind 31 does not turn negative');
  assert.ok(code.includes('u32(u.present.y) << 16u') && code.includes('u32(u.present.w) << 16u'), 'four slots of 16 bits');
  const high = buildShader([{ kind: 40, name: 'c', light: { wgsl: '' } }, { kind: 63, name: 'd', post: { wgsl: '' } }]);
  assert.ok(high.includes(`present(0u, ${1 << 8}u)`), 'kind 40 is bit 8 of the high word');
  assert.ok(high.includes('present(0u, 2147483648u)'), 'kind 63 does not turn negative');
});

test('a scene marks kinds above 31 in its high word', () => {
  const scene = new Scene();
  scene.push(3, [0, 0, 1, 1]);
  scene.push(33, [0, 0, 1, 1]);
  scene.push(63, [0, 0, 1, 1]);
  assert.equal(scene.mask, 1 << 3);
  assert.equal(scene.maskHi >>> 0, ((1 << 1) | (1 << 31)) >>> 0);
  scene.reset();
  assert.deepEqual([scene.mask, scene.maskHi], [0, 0]);
});

test('a primitive kind must be in 1..63', () => {
  assert.throws(() => definePrimitive({ kind: 64, name: 'too-far' }), RangeError);
  assert.throws(() => definePrimitive({ kind: 0, name: 'none' }), RangeError);
});

test('the shader chains the registered cut styles after the scope check', () => {
  const code = buildShader(primitives.all());
  assert.ok(code.includes('fn testCut('));
  assert.ok(code.includes(`if (style == ${CUT_KIND}u) { return testCut(p, sc, s, front, dir, light); }`));
  assert.ok(code.indexOf('let style = u32(u.wipe2.y + 0.5)') < code.indexOf('if (s > front)'));
  assert.ok(!buildShader([]).includes('let style = u32'), 'no styles, no chain');
});

test('the displacement field samples bilinearly between cell centres and is zero when off', () => {
  const cols = 4, rows = 2;
  const field = new Float32Array(cols * rows * 2);
  // Cell (c, r) holds (c * 10, r * 100): the field is a ramp, so bilinear is exact.
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) field.set([c * 10, r * 100], (r * cols + c) * 2);
  const u = uniforms();
  u.set([cols, rows, 1], U.field);
  // Cell centres of a 400 x 300 canvas: x = 50, 150, 250, 350; y = 75, 225.
  assert.deepEqual(fieldAt(150, 75, u, field), { x: 10, y: 0 }, 'on a cell centre');
  assert.deepEqual(fieldAt(200, 150, u, field), { x: 15, y: 50 }, 'halfway between four cells');
  assert.deepEqual(fieldAt(0, 0, u, field), { x: 0, y: 0 }, 'clamped at the corner');
  assert.deepEqual(fieldAt(399, 299, u, field), { x: 30, y: 100 }, 'clamped at the far corner');
  u[U.field + 2] = 0;
  assert.deepEqual(fieldAt(200, 150, u, field), { x: 0, y: 0 }, 'zero when inactive');
  u[U.field + 2] = 1;
  assert.deepEqual(fieldAt(200, 150, u, null), { x: 0, y: 0 }, 'zero without data');
});

test('a primitive twin receives the frame uniforms and the frozen field', () => {
  let seen = null;
  definePrimitive({
    kind: 29,
    name: 'test-field',
    offset: { wgsl: '', js(x, y, items, b, out, ctx) { seen = ctx; out.x += fieldAt(x, y, ctx.uniforms, ctx.field).x; } },
  });
  const scene = new Scene();
  scene.push(29, [0, 0, W, H]);
  const field = new Float32Array(2 * 2 * 2).fill(7);
  const u = uniforms();
  u.set([2, 2, 1], U.field);
  assert.deepEqual(mapThrough(100, 100, u, scene.data, scene.count, field), { x: 107, y: 100 });
  assert.equal(seen.field, field);
  assert.equal(seen.uniforms, u);
  assert.deepEqual(mapThrough(100, 100, u, scene.data, scene.count), { x: 100, y: 100 }, 'no field: no displacement');
});
