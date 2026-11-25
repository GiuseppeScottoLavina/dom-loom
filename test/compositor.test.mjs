import assert from 'node:assert/strict';
import test from 'node:test';
import { definePlugin, NO_TARGET } from '@giuseppe-scotto-lavina/html-in-canvas-polyfill/effects';
import { createCompositor } from '../src/core/compositor.js';
import { definePrimitive } from '../src/core/primitives.js';
import { sharedDevice } from '../src/core/runtime.js';
import { FIELD_COLS, FIELD_ROWS, ITEM_FLOATS, Scene, U, UNIFORM_FLOATS } from '../src/core/scene.js';
import { GHOST } from '../src/primitives/ghost.js';
import { SHIFT } from '../src/primitives/shift.js';

// The presenter supplies these WebGPU constants in the browser.
globalThis.GPUBufferUsage ??= { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 };
globalThis.GPUTextureUsage ??= { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2 };

function gpu(limits = { maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728 }) {
  const log = { pipelines: [], layouts: [], groups: [], textures: [], writes: [] };
  return {
    log,
    limits,
    createBindGroupLayout(desc) { log.layouts.push(desc); return desc; },
    createPipelineLayout(desc) { return desc; },
    createRenderPipelineAsync(desc) {
      log.pipelines.push([desc.label, desc.fragment.targets[0].format]);
      return Promise.resolve({ getBindGroupLayout: () => ({}) });
    },
    createBindGroup(desc) { log.groups.push(desc); return desc; },
    createShaderModule(desc) { return desc; },
    createSampler(desc) { return desc; },
    createTexture({ size: [width, height], label }) {
      const texture = { width, height, label, views: 0, createView() { this.views++; return {}; }, destroy() {} };
      log.textures.push(texture);
      return texture;
    },
    createBuffer(desc) {
      assert.ok(desc.size <= limits.maxBufferSize);
      return { ...desc, destroyed: false, destroy() { this.destroyed = true; } };
    },
    queue: {
      writeBuffer(buffer, offset, data, start = 0, size = data.length - start) {
        assert.ok(!buffer.destroyed && offset + size * data.BYTES_PER_ELEMENT <= buffer.size);
        buffer.lastWrite = data.slice(start, start + size);
        log.writes.push(buffer);
      },
    },
  };
}

function stageFixture() {
  const scene = new Scene();
  scene.uniforms = new Float32Array(UNIFORM_FLOATS);
  return {
    scene,
    field: { cols: FIELD_COLS, rows: FIELD_ROWS, data: new Float32Array(FIELD_COLS * FIELD_ROWS * 2), active: false, dirty: true },
    _step() { return scene; },
    _needsFrames() { return false; },
    _sized() {},
    _attachCompositor(compositor) { this.compositor = compositor; },
    _detachCompositor(compositor) { if (this.compositor === compositor) this.compositor = null; },
  };
}

async function mount(device, stage = stageFixture(), format = 'bgra8unorm') {
  const def = createCompositor({ definePlugin, NO_TARGET }, stage);
  const instance = await def.create({ device, format, requestRender() {} });
  const sourceView = {};
  const encoder = { beginRenderPass() { return { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }; } };
  function draw(sourceVersion = 1, sourceReady = true, now = performance.now()) {
    instance.render({
      now, width: 100, height: 100, cssWidth: 100, cssHeight: 100, dpr: 1,
      encoder, sourceReady, sourceVersion, sourceView, sourceTexture: { width: 100, height: 100 }, destinationView: {},
    });
  }
  return { instance, draw, def, stage };
}

test('compatible stages share compilation, and a stable source reuses its bind group and blank view', async () => {
  const device = gpu();
  const stages = await Promise.all(Array.from({ length: 9 }, () => mount(device)));
  const rgba = await mount(device, stageFixture(), 'rgba8unorm');
  assert.deepEqual(device.log.pipelines, [['domloom', 'bgra8unorm'], ['domloom-ghost', 'rgba8unorm'], ['domloom', 'rgba8unorm']]);
  assert.equal(device.log.layouts.length, 1);
  assert.equal(stages[0].def.outputCapabilities.directCanvasRenderAttachment, true);
  for (let i = 0; i < 60; i++) stages[0].draw();
  assert.equal(device.log.groups.length, 1);
  assert.equal(device.log.textures.filter((tex) => tex.width === 1).length, 10);
  assert.ok(device.log.textures.every((tex) => tex.views === 1));

  const other = gpu();
  const recovered = await mount(other);
  // The scene for the canvas, the ghost blit, and the scene again for the ghost's format.
  assert.deepEqual(other.log.pipelines, [['domloom', 'bgra8unorm'], ['domloom-ghost', 'rgba8unorm'], ['domloom', 'rgba8unorm']]);
  for (const stage of [...stages, rgba, recovered]) stage.instance.destroy();
});

test('the item buffer grows across frames and gesture mapping stays tied to each presented frame', async () => {
  const device = gpu();
  const { draw, instance, stage } = await mount(device);
  const scene = stage.scene;
  const point = { x: 10, y: 10 };
  const binding = (index) => device.log.groups.at(-1).entries.find((entry) => entry.binding === index).resource.buffer;
  scene.push(SHIFT, [0, 0, 50, 50], [2, 0]);
  draw();
  const initialBuffer = binding(3);
  const first = instance.captureInputMapper().captureGestureSnapshot();
  const initialData = scene.data;
  while (scene.count < 128) scene.push(GHOST, [60, 60, 1, 1]);
  scene.push(SHIFT, [0, 0, 50, 50], [5, 0]);
  assert.notEqual(scene.data, initialData);
  assert.equal(scene.count, 129);
  assert.equal(scene.mask, (1 << GHOST) | (1 << SHIFT));
  draw();
  const grownBuffer = binding(3);
  const second = instance.captureInputMapper().captureGestureSnapshot();
  assert.equal(second(point).x, 17);
  assert.equal(first(point).x, 12);
  assert.notEqual(grownBuffer, initialBuffer);
  assert.equal(initialBuffer.destroyed, true);
  assert.ok(grownBuffer.size >= 129 * ITEM_FLOATS * 4);
  assert.equal(binding(0).lastWrite[U.count], 129);
  assert.deepEqual(grownBuffer.lastWrite, scene.data.subarray(0, 129 * ITEM_FLOATS));

  const grownData = scene.data;
  scene.reset();
  scene.push(SHIFT, [0, 0, 50, 50], [1, 0]);
  draw();
  assert.equal(scene.data, grownData);
  assert.equal(device.log.groups.length, 2);
  assert.equal(binding(3), grownBuffer);
  assert.equal(grownBuffer.lastWrite.length, ITEM_FLOATS);
  assert.equal(instance.captureInputMapper()(point).x, 11);
  assert.equal(second(point).x, 17);
  assert.equal(grownBuffer.destroyed, false);
  instance.destroy();
  assert.equal(grownBuffer.destroyed, true);
});

test('a new device fits a previously grown scene up to its binding or allocation limit', async () => {
  const stage = stageFixture();
  const { scene } = stage;
  const size = 384 * ITEM_FLOATS * 4;
  for (let i = 0; i < 384; i++) scene.push(GHOST, [i, 0, 1, 1]);
  assert.equal(scene.count, 384);
  assert.ok(scene.data.byteLength > size);
  const original = await mount(gpu(), stage);
  original.draw();
  original.instance.destroy();

  for (const limited of ['maxStorageBufferBindingSize', 'maxBufferSize']) {
    const device = gpu({ maxBufferSize: size * 2, maxStorageBufferBindingSize: size * 2, [limited]: size });
    const { draw, instance } = await mount(device, stage);
    draw();
    const buffer = device.log.groups[0].entries.find((entry) => entry.binding === 3).resource.buffer;
    assert.equal(buffer.size, size);
    scene.push(GHOST, [384, 0, 1, 1]);
    const writes = device.log.writes.length;
    assert.throws(draw, /requires 385 primitives.*supports 384/);
    assert.equal(device.log.writes.length, writes);
    instance.destroy();
    assert.equal(buffer.destroyed, true);
    scene.reset();
    for (let i = 0; i < 384; i++) scene.push(GHOST, [i, 0, 1, 1]);
  }
});

test('presented and gesture mappers keep the twins used by the presented shader during a plugin update', async () => {
  function registerOffset(dx) {
    return definePrimitive({
      kind: 31, name: 'test-offset',
      offset: { wgsl: 'o.x += ' + dx + '.0;', js(x, y, data, base, out) { out.x += dx; } },
    });
  }
  const kind = registerOffset(2);
  const device = gpu();
  const a = await mount(device);
  const b = await mount(device);
  a.stage.scene.push(kind, [0, 0, 100, 100]);
  const point = { x: 10, y: 10 };
  assert.deepEqual(a.instance.captureInputMapper()(point), { x: point.x, y: point.y }, 'before the first frame the page is where it was');
  a.draw();
  const first = a.instance.captureInputMapper().captureGestureSnapshot();
  assert.equal(first(point).x, 12);
  registerOffset(5);
  a.draw();
  b.draw();
  assert.equal(a.instance.captureInputMapper()(point).x, 12);
  await new Promise(setImmediate);
  a.draw();
  assert.equal(a.instance.captureInputMapper()(point).x, 15);
  assert.equal(first(point).x, 12);
  // A plugin update rebuilds the scene for the canvas and for the ghost (drawn as presented).
  assert.deepEqual(device.log.pipelines, [
    ['domloom', 'bgra8unorm'], ['domloom-ghost', 'rgba8unorm'], ['domloom', 'rgba8unorm'],
    ['domloom', 'rgba8unorm'], ['domloom', 'bgra8unorm'],
  ]);
  a.draw(2, false);
  assert.deepEqual(a.instance.captureInputMapper()(point), { x: point.x, y: point.y }, 'a frame without the picture of the page leaves it where it is');
  a.instance.destroy();
  b.instance.destroy();
});

test('a fresh compositor uploads its own copy of an active displacement field after recovery', async () => {
  const device = gpu();
  const a = await mount(device);
  a.draw();
  const fieldBytes = a.stage.field.data.byteLength;
  assert.equal(device.log.writes.filter((buffer) => buffer.size === fieldBytes).length, 0);
  a.stage.field.active = true;
  a.draw();
  a.draw();
  assert.equal(device.log.writes.filter((buffer) => buffer.size === fieldBytes).length, 1);
  a.instance.destroy();
  const next = gpu();
  const b = await mount(next, a.stage);
  b.draw();
  assert.equal(next.log.writes.filter((buffer) => buffer.size === fieldBytes).length, 1);
  b.instance.destroy();
});

test('continuous frames advance by elapsed time at 15 Hz and a new animation starts at rest', async () => {
  const stage = stageFixture();
  let elapsed = 0;
  let running = true;
  stage._step = (now, dt) => {
    elapsed += dt;
    return stage.scene;
  };
  stage._needsFrames = () => running;
  const { instance, draw } = await mount(gpu(), stage);
  for (let i = 0; i <= 75; i++) draw(1, true, i * (1000 / 15));
  assert.ok(Math.abs(elapsed - 5) < 1e-9);
  running = false;
  draw(1, true, 5100);
  const beforeRest = elapsed;
  running = true;
  draw(1, true, 6500);
  assert.equal(elapsed, beforeRest);
  instance.destroy();
});

test('ghost and source requests settle on capture, cancellation, timeout and teardown', async () => {
  const device = gpu();
  const { stage, draw, instance } = await mount(device);
  const compositor = stage.compositor;
  const abort = new AbortController();
  const cancelled = [compositor.captureGhost(abort.signal), compositor.waitForSource(0, 400, abort.signal)];
  abort.abort();
  assert.deepEqual(await Promise.all(cancelled), [false, false]);
  draw();
  assert.equal(device.log.textures.filter((t) => t.label === 'domloom-ghost').length, 0);
  const ghost = compositor.captureGhost();
  const updated = compositor.waitForSource(1);
  draw(2);
  assert.deepEqual(await Promise.all([ghost, updated, compositor.waitForSource(1)]), [true, true, true]);
  assert.equal(device.log.textures.filter((t) => t.label === 'domloom-ghost').length, 1);
  const groups = device.log.groups.length;
  const ghostAgain = compositor.captureGhost();
  draw(2);
  assert.equal(await ghostAgain, true);
  assert.equal(device.log.groups.length, groups);
  assert.deepEqual(await Promise.all([compositor.captureGhost(), compositor.waitForSource(2, 10)]), [false, false]);
  const pending = [compositor.captureGhost(), compositor.waitForSource(2)];
  instance.destroy();
  assert.deepEqual(await Promise.all(pending), [false, false]);
  assert.equal(await compositor.captureGhost(), false);
});

test('concurrent stages retry one shared GPU request after failure and after loss', async (t) => {
  let attempts = 0;
  let lose;
  const gpu = {
    async requestAdapter() {
      if (++attempts === 1) throw new Error('transient adapter failure');
      return { async requestDevice() { return { lost: new Promise((resolve) => { lose = resolve; }) }; } };
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { gpu }, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
  const first = sharedDevice();
  assert.equal(sharedDevice(), first);
  await assert.rejects(first, /transient adapter failure/);
  const [a, b] = await Promise.all([sharedDevice(), sharedDevice()]);
  assert.equal(a, b);
  assert.equal(attempts, 2);
  lose();
  await Promise.resolve();
  assert.notEqual(await sharedDevice(), a);
  assert.equal(attempts, 3);
});
