import { mapThrough } from './mapper.js';
import { mapperTables, primitives } from './primitives.js';
import { FIELD_COLS, FIELD_ROWS, INITIAL_ITEM_CAPACITY, ITEM_FLOATS, U, UNIFORM_FLOATS } from './scene.js';
import { BLIT_WGSL, buildShader } from './shader.js';
// The core's own primitives: transitions, ghosts, rolls, slides, arrivals.
import '../primitives/ghost.js';
import '../primitives/materialize.js';
import '../primitives/morph.js';
import '../primitives/roll.js';
import '../primitives/shift.js';

// WebGPU objects belong to their device. Keep just the latest shader revision
// for each attachment format; mounted stages may finish drawing an older one.
const devices = new WeakMap();
const ITEM_BYTES = ITEM_FLOATS * Float32Array.BYTES_PER_ELEMENT;

function resourcesFor(device) {
  let resources = devices.get(device);
  if (resources) return resources;
  const FRAGMENT = globalThis.GPUShaderStage?.FRAGMENT ?? 2;
  // An explicit layout: with 'auto' a binding the shader does not use (the field,
  // until a primitive reads it) would be dropped, and the bind group would fail.
  const bindLayout = device.createBindGroupLayout({
    label: 'domloom',
    entries: [
      { binding: 0, visibility: FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 5, visibility: FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ label: 'domloom', bindGroupLayouts: [bindLayout] });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  resources = { bindLayout, pipelineLayout, sampler, formats: new Map(), blit: null };
  devices.set(device, resources);
  return resources;
}

function scenePipeline(device, resources, format) {
  const version = primitives.version;
  const previous = resources.formats.get(format);
  if (previous?.version === version) return previous;
  const module = device.createShaderModule({ label: 'domloom', code: buildShader(primitives.all()) });
  const entry = { version, tables: mapperTables(), ready: null };
  entry.ready = device.createRenderPipelineAsync({
    label: 'domloom',
    layout: resources.pipelineLayout,
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  }).catch((error) => {
    if (resources.formats.get(format) === entry) resources.formats.delete(format);
    throw error;
  });
  resources.formats.set(format, entry);
  return entry;
}

function ghostPipeline(device, resources) {
  if (!resources.blit) {
    const module = device.createShaderModule({ label: 'domloom-ghost', code: BLIT_WGSL });
    resources.blit = device.createRenderPipelineAsync({
      label: 'domloom-ghost',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    }).catch((error) => {
      resources.blit = null;
      throw error;
    });
  }
  return resources.blit;
}

/**
 * One effect plugin per stage: the whole stage is drawn in one pass. The stage owns
 * the scene (what moves and lights up); the plugin uploads it, draws it, and hands the
 * host a mapper frozen on the numbers of each presented frame.
 */
export function createCompositor(runtime, stage) {
  const { definePlugin, NO_TARGET } = runtime;
  return definePlugin({
    type: 'domloom-compositor',
    apiVersion: 2,
    version: 1,
    outputCapabilities: { directCanvasRenderAttachment: true },
    async create(context) {
      const { device, format } = context;
      const GPUUsage = globalThis.GPUBufferUsage;
      const TexUsage = globalThis.GPUTextureUsage;
      const resources = resourcesFor(device);
      const { bindLayout, sampler } = resources;
      let shader = scenePipeline(device, resources, format);
      let [pipeline, blit] = await Promise.all([shader.ready, ghostPipeline(device, resources)]);
      const uniformBuffer = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUUsage.UNIFORM | GPUUsage.COPY_DST });
      function createItemBuffer(count) {
        return device.createBuffer({ size: count * ITEM_BYTES, usage: GPUUsage.STORAGE | GPUUsage.COPY_DST });
      }
      let itemBuffer = createItemBuffer(INITIAL_ITEM_CAPACITY);
      const fieldBuffer = device.createBuffer({ size: FIELD_COLS * FIELD_ROWS * 2 * 4, usage: GPUUsage.STORAGE | GPUUsage.COPY_DST });
      const blank = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: TexUsage.TEXTURE_BINDING | TexUsage.RENDER_ATTACHMENT });
      const blankView = blank.createView();
      const uniforms = new Float32Array(UNIFORM_FLOATS);

      let ghost = null; // { texture, view, cssW, cssH }
      const ghostRequests = new Set();
      const versionWaiters = new Set();
      let destroyed = false;
      let lastNow = NaN;
      let sourceVersion = -1;
      let presented = null;
      let fieldCopy = null; // the field as last uploaded: frozen with each presented frame that uses it
      let groups = new WeakMap();
      const blitGroups = new WeakMap();
      let attemptedVersion = shader.version;
      const rebuild = () => {
        if (attemptedVersion === primitives.version) return;
        const next = scenePipeline(device, resources, format);
        attemptedVersion = next.version;
        next.ready.then((compiled) => {
          if (destroyed || attemptedVersion !== next.version) return;
          pipeline = compiled;
          shader = next;
          context.requestRender();
        }, (error) => {
          if (!destroyed) console.error('DomLoom: the compositor could not be rebuilt', error);
        });
      };

      function bindGroupFor(sourceView) {
        let group = groups.get(sourceView);
        if (!group) {
          group = device.createBindGroup({
            layout: bindLayout,
            entries: [
              { binding: 0, resource: { buffer: uniformBuffer } },
              { binding: 1, resource: sampler },
              { binding: 2, resource: sourceView },
              { binding: 3, resource: { buffer: itemBuffer } },
              { binding: 4, resource: ghost?.view ?? blankView },
              { binding: 5, resource: { buffer: fieldBuffer } },
            ],
          });
          groups.set(sourceView, group);
        }
        return group;
      }

      function captureGhost(frame) {
        const { width, height } = frame.sourceTexture;
        if (!ghost || ghost.texture.width !== width || ghost.texture.height !== height) {
          ghost?.texture.destroy();
          const texture = device.createTexture({
            label: 'domloom-ghost',
            size: [width, height],
            format: 'rgba8unorm',
            usage: TexUsage.TEXTURE_BINDING | TexUsage.RENDER_ATTACHMENT,
          });
          ghost = { texture, view: texture.createView(), cssW: 0, cssH: 0 };
          groups = new WeakMap();
        }
        ghost.cssW = frame.cssWidth;
        ghost.cssH = frame.cssHeight;
        let group = blitGroups.get(frame.sourceView);
        if (!group) {
          group = device.createBindGroup({
            layout: blit.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: frame.sourceView }],
          });
          blitGroups.set(frame.sourceView, group);
        }
        const pass = frame.encoder.beginRenderPass({
          colorAttachments: [{ view: ghost.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        });
        pass.setPipeline(blit);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
      }

      // An offscreen host may never draw the requested picture. Clear timers
      // and abort handlers on every exit, including teardown and supersession.
      function waitForFrame(queue, version, timeoutMs, signal) {
        if (destroyed || signal?.aborted) return Promise.resolve(false);
        return new Promise((resolve) => {
          const waiter = {
            version,
            finish(value) {
              clearTimeout(timer);
              signal?.removeEventListener('abort', abort);
              queue.delete(waiter);
              resolve(value);
            },
          };
          const abort = () => waiter.finish(false);
          const timer = setTimeout(abort, timeoutMs);
          signal?.addEventListener('abort', abort, { once: true });
          queue.add(waiter);
          context.requestRender();
        });
      }

      const compositor = {
        captureGhost(signal) {
          return waitForFrame(ghostRequests, null, 250, signal);
        },
        get sourceVersion() {
          return sourceVersion;
        },
        waitForSource(version, timeoutMs = 400, signal) {
          if (sourceVersion > version && !destroyed && !signal?.aborted) return Promise.resolve(true);
          return waitForFrame(versionWaiters, version, timeoutMs, signal);
        },
        requestRender: () => context.requestRender(),
        viewport: () => context.viewport(),
      };
      stage._attachCompositor(compositor, context.canvas);

      return {
        spatial: true,
        get continuous() {
          return stage._needsFrames();
        },
        render(frame) {
          // Idle intervals precede the next motion. During a running motion use
          // elapsed time even at low refresh rates; springs limit their own substeps.
          const dt = Number.isNaN(lastNow) ? 0 : Math.max((frame.now - lastNow) / 1000, 0);

          if (frame.sourceReady && frame.sourceVersion !== sourceVersion) {
            sourceVersion = frame.sourceVersion;
            for (const waiter of versionWaiters) {
              if (sourceVersion > waiter.version) waiter.finish(true);
            }
          }

          const captures = ghostRequests.size && frame.sourceReady ? [...ghostRequests] : null;
          if (captures) captureGhost(frame);

          const scene = stage._step(frame.now, dt);
          if (scene.count * ITEM_BYTES > itemBuffer.size) {
            const { maxBufferSize, maxStorageBufferBindingSize } = device.limits;
            // The count uniform is an f32; every integer up to 2^24 is exactly representable.
            const maxItems = Math.min(2 ** 24, Math.floor(Math.min(maxBufferSize, maxStorageBufferBindingSize) / ITEM_BYTES));
            if (scene.count > maxItems) {
              // The host routes a failed draw to the stage's ordinary HTML fallback.
              throw new RangeError(`DomLoom: scene requires ${scene.count} primitives, but this device supports ${maxItems} per stage`);
            }
            const previous = itemBuffer;
            itemBuffer = createItemBuffer(Math.min(scene.data.length / ITEM_FLOATS, maxItems));
            groups = new WeakMap();
            // Earlier frames have been submitted. WebGPU keeps their storage alive until completion.
            previous.destroy();
          }
          lastNow = stage._needsFrames() ? frame.now : NaN;
          uniforms.fill(0);
          uniforms[U.viewport] = frame.width;
          uniforms[U.viewport + 1] = frame.height;
          uniforms[U.viewport + 2] = frame.cssWidth;
          uniforms[U.viewport + 3] = frame.cssHeight;
          uniforms[U.count] = scene.count;
          uniforms[U.time] = frame.now / 1000;
          uniforms[U.dpr] = frame.dpr;
          uniforms.set(scene.uniforms.subarray(8), 8);
          // The mask is a 32-bit integer: a float holds 24 bits exactly, so it goes in halves.
          uniforms[U.present] = scene.mask & 0xffff;
          uniforms[U.present + 1] = scene.mask >>> 16;
          const field = stage.field;
          if (field.active && (field.dirty || !fieldCopy)) {
            device.queue.writeBuffer(fieldBuffer, 0, field.data);
            fieldCopy = field.data.slice();
            field.dirty = false;
          }
          uniforms[U.field] = field.cols;
          uniforms[U.field + 1] = field.rows;
          uniforms[U.field + 2] = field.active ? 1 : 0;
          rebuild();
          if (ghost) {
            uniforms[U.ghostCss] = ghost.cssW;
            uniforms[U.ghostCss + 1] = ghost.cssH;
            uniforms[U.ghostCss + 2] = 1;
          }
          device.queue.writeBuffer(uniformBuffer, 0, uniforms);
          if (scene.count) device.queue.writeBuffer(itemBuffer, 0, scene.data, 0, scene.count * ITEM_FLOATS);

          presented = frame.sourceReady ? {
            tables: shader.tables,
            uniforms: uniforms.slice(),
            items: scene.data.slice(0, scene.count * ITEM_FLOATS),
            count: scene.count,
            // The input mapper must see the field of the frame that was drawn.
            field: field.active ? fieldCopy : null,
          } : null;

          const pass = frame.encoder.beginRenderPass({
            colorAttachments: [{
              view: frame.destinationView, loadOp: 'clear', storeOp: 'store',
              // A transparent canvas starts transparent; an opaque one starts as the panel.
              clearValue: scene.uniforms[U.alpha] > 0.5 ? { r: 0, g: 0, b: 0, a: 0 }
                : { r: scene.uniforms[U.bg], g: scene.uniforms[U.bg + 1], b: scene.uniforms[U.bg + 2], a: 1 },
            }],
          });
          if (frame.sourceReady) {
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroupFor(frame.sourceView));
            pass.draw(3);
          }
          pass.end();
          // The host submits this encoder before any later upload, so the ghost holds
          // this picture even if the page changes right after these promises resolve.
          if (captures) for (const waiter of captures) waiter.finish(true);
        },
        captureInputMapper() {
          if (!presented) return () => NO_TARGET;
          const { uniforms: u, items, count, field, tables } = presented;
          const mapper = (point) => mapThrough(point.x, point.y, u, items, count, field, tables) ?? NO_TARGET;
          mapper.captureGestureSnapshot = () => mapper;
          return mapper;
        },
        resize() {
          context.requestRender();
        },
        destroy() {
          destroyed = true;
          stage._detachCompositor(compositor);
          for (const waiter of ghostRequests) waiter.finish(false);
          for (const waiter of versionWaiters) waiter.finish(false);
          ghost?.texture.destroy();
          blank.destroy();
          uniformBuffer.destroy();
          itemBuffer.destroy();
          fieldBuffer.destroy();
        },
      };
    },
  });
}
