import { mapThrough } from './mapper.js';
import { primitives } from './primitives.js';
import { FIELD_COLS, FIELD_ROWS, ITEM_FLOATS, MAX_ITEMS, U, UNIFORM_FLOATS } from './scene.js';
import { BLIT_WGSL, buildShader } from './shader.js';
// The core's own primitives: transitions, ghosts, rolls, slides, arrivals.
import '../primitives/ghost.js';
import '../primitives/materialize.js';
import '../primitives/morph.js';
import '../primitives/roll.js';
import '../primitives/shift.js';

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
    async create(context) {
      const { device, format } = context;
      const GPUUsage = globalThis.GPUBufferUsage;
      const TexUsage = globalThis.GPUTextureUsage;
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
      // The shader holds the primitives the page has imported; a primitive imported
      // later (a lazy component) rebuilds it, and the old one draws meanwhile.
      const compile = (defs) => {
        const module = device.createShaderModule({ label: 'domloom', code: buildShader(defs) });
        return device.createRenderPipelineAsync({
          label: 'domloom',
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        });
      };
      let builtVersion = primitives.version;
      let rebuilding = false;
      const blitModule = device.createShaderModule({ label: 'domloom-ghost', code: BLIT_WGSL });
      let [pipeline, blit] = await Promise.all([
        compile(primitives.all()),
        device.createRenderPipelineAsync({
          label: 'domloom-ghost',
          layout: 'auto',
          vertex: { module: blitModule, entryPoint: 'vs' },
          fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
          primitive: { topology: 'triangle-list' },
        }),
      ]);
      const uniformBuffer = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUUsage.UNIFORM | GPUUsage.COPY_DST });
      const itemBuffer = device.createBuffer({ size: MAX_ITEMS * ITEM_FLOATS * 4, usage: GPUUsage.STORAGE | GPUUsage.COPY_DST });
      const fieldBuffer = device.createBuffer({ size: FIELD_COLS * FIELD_ROWS * 2 * 4, usage: GPUUsage.STORAGE | GPUUsage.COPY_DST });
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      const blank = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: TexUsage.TEXTURE_BINDING | TexUsage.RENDER_ATTACHMENT });
      const uniforms = new Float32Array(UNIFORM_FLOATS);

      let ghost = null; // { texture, view, cssW, cssH }
      let ghostRequests = [];
      let lastNow = NaN;
      let sourceVersion = -1;
      let versionWaiters = [];
      let presented = { uniforms: new Float32Array(UNIFORM_FLOATS), items: new Float32Array(0), count: 0, field: null };
      let fieldCopy = null; // the field as last uploaded: frozen with each presented frame that uses it
      let groups = new WeakMap();
      const rebuild = () => {
        if (rebuilding || builtVersion === primitives.version) return;
        rebuilding = true;
        const version = primitives.version;
        compile(primitives.all()).then((next) => {
          pipeline = next;
          groups = new WeakMap();
          builtVersion = version;
          rebuilding = false;
          context.requestRender();
        }, (error) => {
          rebuilding = false;
          builtVersion = version;
          console.error('DomLoom: the compositor could not be rebuilt', error);
        });
      };

      function bindGroupFor(sourceView) {
        const ghostView = ghost ? ghost.view : blank.createView();
        let perGhost = groups.get(sourceView);
        if (!perGhost) groups.set(sourceView, (perGhost = new Map()));
        const key = ghost ? ghost.view : blank;
        let group = perGhost.get(key);
        if (!group) {
          group = device.createBindGroup({
            layout: bindLayout,
            entries: [
              { binding: 0, resource: { buffer: uniformBuffer } },
              { binding: 1, resource: sampler },
              { binding: 2, resource: sourceView },
              { binding: 3, resource: { buffer: itemBuffer } },
              { binding: 4, resource: ghostView },
              { binding: 5, resource: { buffer: fieldBuffer } },
            ],
          });
          perGhost.set(key, group);
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
        }
        ghost.cssW = frame.cssWidth;
        ghost.cssH = frame.cssHeight;
        const group = device.createBindGroup({
          layout: blit.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: frame.sourceView }],
        });
        const pass = frame.encoder.beginRenderPass({
          colorAttachments: [{ view: ghost.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        });
        pass.setPipeline(blit);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
      }

      const compositor = {
        // Resolves after the frame that copied the current picture into the ghost.
        captureGhost() {
          return new Promise((resolve) => {
            ghostRequests.push(resolve);
            context.requestRender();
          });
        },
        get sourceVersion() {
          return sourceVersion;
        },
        // Resolves once a picture newer than `version` reached the GPU, or after timeoutMs.
        waitForSource(version, timeoutMs = 400) {
          return new Promise((resolve) => {
            const waiter = { version, resolve };
            versionWaiters.push(waiter);
            setTimeout(() => {
              versionWaiters = versionWaiters.filter((w) => w !== waiter);
              resolve(false);
            }, timeoutMs);
            context.requestRender();
          });
        },
        requestRender: () => context.requestRender(),
        viewport: () => context.viewport(),
      };
      stage._attachCompositor(compositor);

      return {
        spatial: true,
        get continuous() {
          return stage._needsFrames();
        },
        render(frame) {
          // After a rest (no frames), the first step is one frame long: the gap since the
          // last frame is idle time, and stepping through it would skip the motion's start.
          const gap = Number.isNaN(lastNow) ? 0 : Math.max((frame.now - lastNow) / 1000, 0);
          const dt = gap > 0.05 ? 1 / 60 : gap;
          lastNow = frame.now;

          if (frame.sourceReady && frame.sourceVersion !== sourceVersion) {
            sourceVersion = frame.sourceVersion;
            const ready = versionWaiters.filter((w) => sourceVersion > w.version);
            versionWaiters = versionWaiters.filter((w) => !ready.includes(w));
            for (const w of ready) w.resolve(true);
          }

          let ghostResolves = null;
          if (ghostRequests.length && frame.sourceReady) {
            captureGhost(frame);
            ghostResolves = ghostRequests;
            ghostRequests = [];
          }

          const scene = stage._step(frame.now, dt);
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
          if (field.dirty) {
            device.queue.writeBuffer(fieldBuffer, 0, field.data);
            field.dirty = false;
            fieldCopy = null;
          }
          if (field.active && !fieldCopy) fieldCopy = field.data.slice();
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

          presented = {
            uniforms: uniforms.slice(),
            items: scene.data.slice(0, scene.count * ITEM_FLOATS),
            count: scene.count,
            // The input mapper must see the field of the frame that was drawn.
            field: field.active ? fieldCopy : null,
          };

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
          if (ghostResolves) for (const resolve of ghostResolves) resolve();
        },
        captureInputMapper() {
          const { uniforms: u, items, count, field } = presented;
          const mapper = (point) => mapThrough(point.x, point.y, u, items, count, field) ?? NO_TARGET;
          mapper.captureGestureSnapshot = () => mapper;
          return mapper;
        },
        resize() {
          context.requestRender();
        },
        destroy() {
          stage._detachCompositor(compositor);
          for (const resolve of ghostRequests) resolve();
          for (const w of versionWaiters) w.resolve(false);
          ghostRequests = [];
          versionWaiters = [];
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
