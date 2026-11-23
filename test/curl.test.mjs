// The geometry of the CURL cut's JS twin (src/primitives/curl.js): where the old page shows.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CURL, curlGeometry, curlRadius } from '../src/primitives/curl.js';
import { mapperTables } from '../src/core/primitives.js';
import { mapThrough } from '../src/core/mapper.js';
import { U, UNIFORM_FLOATS } from '../src/core/scene.js';

const SC = [10, 20, 760, 250];
const BAND = 0.1;

function uniforms({ front, dir = 1, slant = 0.42, sc = SC }) {
  const u = new Float32Array(UNIFORM_FLOATS);
  u[U.viewport + 2] = 800;
  u[U.viewport + 3] = 300;
  u[U.wipeActive] = 1;
  u[U.wipeFront] = front;
  u[U.wipeBand] = BAND;
  u[U.wipeSlant] = slant;
  u[U.wipeDir] = dir;
  u[U.wipeStyle] = CURL;
  u.set(sc, U.scope);
  return u;
}

/** The twin, called as the mapper does. */
function twin(x, y, { front, dir = 1, slant = 0.42, sc = SC }) {
  const lx = dir < 0 ? sc[2] - (x - sc[0]) : x - sc[0];
  const s = (lx + (y - sc[1]) * slant) / (sc[2] + sc[3] * slant);
  return CURL_JS(x, y, sc, s, front, dir, uniforms({ front, dir, slant, sc }));
}
const CURL_JS = mapperTables().cuts[CURL];

/** The first x along a row where the old page shows, scanning from the new page's side. */
function edge(y, opts) {
  const { dir = 1, sc = SC } = opts;
  if (dir > 0) {
    for (let x = sc[0]; x < sc[0] + sc[2]; x += 0.25) if (twin(x, y, opts) === null) return x;
  } else {
    for (let x = sc[0] + sc[2]; x > sc[0]; x -= 0.25) if (twin(x, y, opts) === null) return x;
  }
  return null;
}

test('the radius scales with the scope between 40 and 70 px', () => {
  assert.equal(curlRadius([0, 0, 300, 200]), 40);
  assert.equal(curlRadius([0, 0, 760, 250]), 40);
  assert.equal(curlRadius([0, 0, 1280, 900]), 70);
  assert.ok(Math.abs(curlRadius([0, 0, 800, 500]) - 55) < 1e-9);
});

test('while the cut waits (front 0) the old page shows everywhere', () => {
  for (let y = SC[1]; y < SC[1] + SC[3]; y += 13) {
    for (let x = SC[0]; x < SC[0] + SC[2]; x += 17) assert.equal(twin(x, y, { front: 0 }), null);
  }
});

test('at the end of the cut nothing of the old page is left', () => {
  for (const dir of [1, -1]) {
    for (let y = SC[1]; y < SC[1] + SC[3]; y += 7) {
      for (let x = SC[0]; x < SC[0] + SC[2]; x += 11) assert.equal(twin(x, y, { front: 1 + BAND, dir }), undefined, `dir ${dir} at ${x}, ${y}`);
    }
  }
});

test('the silhouette sweeps across without going back, and the page behind it is live', () => {
  for (const dir of [1, -1]) {
    let last = dir > 0 ? -Infinity : Infinity;
    for (let front = 0.04; front < 1 + BAND; front += 0.04) {
      const x = edge(SC[1] + SC[3] / 2, { front, dir });
      if (x === null) continue;
      assert.ok(dir > 0 ? x >= last : x <= last, `dir ${dir}: the edge moved back at front ${front.toFixed(2)} (${x} after ${last})`);
      last = x;
      // Behind the edge (the new page's side) every point is live, ahead of it the old page covers.
      const behind = dir > 0 ? x - 1 : x + 1;
      const ahead = dir > 0 ? x + 1 : x - 1;
      if (behind > SC[0] && behind < SC[0] + SC[2]) assert.equal(twin(behind, SC[1] + SC[3] / 2, { front, dir }), undefined);
      assert.equal(twin(ahead, SC[1] + SC[3] / 2, { front, dir }), null);
    }
    assert.ok(Number.isFinite(last), `dir ${dir} had an edge`);
  }
});

test('the silhouette lies r before the axis: x = A - r on the cylinder', () => {
  const opts = { front: 0.5, slant: 0 };
  const g = curlGeometry(SC, 0.5, 1, 0, BAND);
  const x = edge(SC[1] + 100, opts);
  // With no slant the normal is x: the cylinder's far side is at SC[0] + A - r.
  assert.ok(Math.abs(x - (SC[0] + g.A - g.r)) <= 0.5, `edge ${x}, expected ${SC[0] + g.A - g.r}`);
});

test('a short sheet makes a lip: the cylinder is only as long as what has been peeled', () => {
  // The first px of paper wrap through f = A / r: the silhouette is A - r sin(A / r), not A - r.
  const g = curlGeometry(SC, 0.03, 1, 0, BAND);
  assert.ok(g.A < g.r, 'the test needs A < r');
  const x = edge(SC[1] + 100, { front: 0.03, slant: 0 });
  const expected = SC[0] + g.A - g.r * Math.sin(g.A / g.r);
  assert.ok(Math.abs(x - expected) <= 0.5, `edge ${x}, expected ${expected}`);
});

test('mirrored: from the right with no slant is the left-to-right cut reflected', () => {
  for (const front of [0.2, 0.5, 0.8]) {
    for (let x = SC[0] + 0.5; x < SC[0] + SC[2]; x += 9) {
      const mx = SC[0] + SC[2] - (x - SC[0]);
      assert.equal(twin(x, 100, { front, dir: 1, slant: 0 }), twin(mx, 100, { front, dir: -1, slant: 0 }), `front ${front} at ${x}`);
    }
  }
});

test('the corners of the scope fold: the turned back has the sheet\'s shape, not a band', () => {
  // A slanted axis: the rect's left edge is not parallel to it, so the back's far edge is slanted
  // against the axis. Higher on the page the old page has turned further than lower down.
  const front = 0.5;
  const top = edge(SC[1] + 2, { front });
  const bottom = edge(SC[1] + SC[3] - 2, { front });
  assert.ok(bottom < top, `the silhouette leans with the cut: top ${top}, bottom ${bottom}`);
});

test('the mapper asks the twin: the new page shows through, the old page takes no input', () => {
  const front = 0.5;
  const u = uniforms({ front });
  const y = SC[1] + SC[3] / 2;
  const x = edge(y, { front });
  assert.equal(mapThrough(x + 20, y, u, new Float32Array(0), 0), null);
  const live = mapThrough(x - 20, y, u, new Float32Array(0), 0);
  assert.ok(live && Math.abs(live.x - (x - 20)) < 1e-6 && Math.abs(live.y - y) < 1e-6);
  // Outside the scope the page is live.
  const outside = mapThrough(SC[0] + SC[2] + 20, y, u, new Float32Array(0), 0);
  assert.ok(outside);
});
