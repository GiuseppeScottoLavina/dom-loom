// Compile-only check of the public types (npm run test:types).
import { useRef } from 'react';
import { defineSkin, extendSkin, PILL, ADD, type LoomStage as Stage } from 'dom-loom';
import 'dom-loom/tabs';
import { defineBehavior, getSkin, type LoomStage as CoreStage } from 'dom-loom/core';
import { PILL as Pill } from 'dom-loom/primitives/pill';
// @ts-expect-error: the core exports no primitive kinds (import them from dom-loom or dom-loom/primitives/*)
import { PILL as NotInCore } from 'dom-loom/core';
import { SHARDS } from 'dom-loom/primitives/shards';
import { LoomStage, useLoomEvent, useLoomDiscard, useLoomTransition } from 'dom-loom/react';
import { DomLoom, isCustomElement, useLoomStage } from 'dom-loom/vue';
import { ref } from 'vue';

const skin = defineSkin({ name: 'mine', tokens: { accent: ['--accent', '#fc0'] }, roles: { hot: 'accent' } });
extendSkin('mine', { press: (scene, state, { colors }) => scene.push(PILL, state.rect, [4, 0, 8, 0.3], colors.accent, ADD) });
void skin;

const stage = document.querySelector('loom-stage');
stage?.transition(() => {}, { scope: document.body, direction: -1, cut: true }).then(() => stage.mapPoint({ x: 1, y: 2 }));
stage?.addEventListener('loom-sort', (e) => e.detail.direction === 'ascending');
if (stage) {
  stage.skin = 'mine';
  stage.overlay = 'right';
  stage.overlay = false;
  const name: string | undefined = stage.skin?.name;
  void name;
  void stage.discard(document.body, undefined, { exit: 'shatter' });
}
void Pill;
void NotInCore;
void SHARDS;
void getSkin('holo');
defineBehavior('probe', class {
  constructor(private stage: CoreStage) {
    stage.listen('pointermove', (e: PointerEvent) => stage.pointOf(e));
  }
  step() { return false; }
  emit(scene: Parameters<CoreStage['draw']>[1]) {
    if (this.stage.visible(this.stage.source)) this.stage.draw('reticle', scene, { rect: this.stage.rectOf(this.stage.source) });
  }
});

export function App() {
  const r = useRef<Stage>(null);
  const transition = useLoomTransition(r);
  const discard = useLoomDiscard(r);
  useLoomEvent(r, 'loom-remove', (e) => discard(e.target as Element, () => {}, { exit: 'shatter' }));
  return (
    <LoomStage ref={r} sound skin="holo" onReady={(renderer) => renderer === 'webgpu'}>
      <table sortable=""><tbody /></table>
      <label dropzone=""><input type="file" /></label>
      <button hold="900ms" onClick={() => transition(() => {}, { morph: [], cut: false })}>Go</button>
    </LoomStage>
  );
}

const s = ref<Stage | null>(null);
useLoomStage(s).transition(async () => {});
void DomLoom;
void isCustomElement('loom-stage');
