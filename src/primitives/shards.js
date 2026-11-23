import { definePrimitive } from '../core/primitives.js';
import { pcg } from '../core/math.js';

// SHATTER: the old picture of a removed element breaks into Voronoi shards. A picture
// primitive that is also drawn during a transition (`transition: true`: core/shader.js
// composeTransition, core/mapper.js). The shards are drawn from the ghost texture
// through the inverse of each shard's own motion; no shard is ever an input target.
//
//   r  where shards can be (the element's rect grown by how far they can travel)
//   p  the element's rect (x, y, w, h): the picture that breaks
//   q  burst origin (x, y), seed, total time (s)
//   h  [1] seconds since the break, [2] grid columns, [3] grid rows
//
// The cells are a jittered grid (one seed per cell), so the shard of a pixel is found
// among the seeds around it; each shard moves as a pure function of (id, seed, time).

const MAX_SHARDS = 48;
const TOTAL = 1.05; // seconds
const GRAVITY = 1400;

const G = {
  hash: (id, n, sd) => pcg((Math.imul(id, 9781) + Math.imul(n, 6271) + Math.imul(sd, 1237) + 17) >>> 0) / 4294967296,
};

/** The grid of cells for a rect: about 28 shards, never more than MAX_SHARDS. */
export function grid(w, h) {
  const size = Math.sqrt(Math.max(w * h, 1) / 28);
  let gx = Math.min(16, Math.max(1, Math.round(w / size)));
  let gy = Math.min(16, Math.max(1, Math.round(h / size)));
  while (gx * gy > MAX_SHARDS) {
    if (gx / w > gy / h) gx--;
    else gy--;
  }
  return [gx, gy];
}

const WGSL = /* wgsl */ `
fn shHash(id: u32, n: u32, sd: u32) -> f32 {
  return hash01(id * 9781u + n * 6271u + sd * 1237u + 17u);
}

// The seed of cell id: a jittered point in it (in the element's rect).
fn shSeed(it: Item, id: u32, gx: u32, gy: u32) -> vec2f {
  let sd = u32(it.q.z + 0.5);
  let cw = it.p.z / f32(gx);
  let ch = it.p.w / f32(gy);
  return it.p.xy + vec2f((f32(id % gx) + 0.2 + 0.6 * shHash(id, 100u, sd)) * cw,
                         (f32(id / gx) + 0.2 + 0.6 * shHash(id, 101u, sd)) * ch);
}

// The shards over p: rgb and opacity (w), or w = -1 where no shard covers p. The edge
// light of the crack lines goes into light.
fn shardsPicture(p: vec2f, light: ptr<function, vec3f>) -> vec4f {
  let n = u32(u.misc.x);
  var best = vec4f(0.0, 0.0, 0.0, -1.0);
  var bestLight = vec3f(0.0);
  var bestNear = -1.0;
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) != 27u || !insideR(p, it.r)) { continue; }
    let gx = u32(it.h.z + 0.5);
    let gy = u32(it.h.w + 0.5);
    let sd = u32(it.q.z + 0.5);
    let tau = it.h.y;
    let org = it.q.xy;
    let diag = length(it.p.zw);
    let burst = 260.0 + 0.9 * min(diag, 400.0);
    let cell = it.p.zw / vec2f(f32(gx), f32(gy));
    let reach = 1.6 * length(cell);
    let total = min(gx * gy, 48u);
    for (var k = 0u; k < total; k++) {
      let s = shSeed(it, k, gx, gy);
      let away = s - org;
      let l = length(away);
      let ha = shHash(k, 1u, sd);
      var dir = vec2f(cos(ha * 6.2832), sin(ha * 6.2832));
      if (l > 1.0) { dir = away / l; }
      let sway = (ha - 0.5) * 0.8;
      dir = vec2f(dir.x * cos(sway) - dir.y * sin(sway), dir.x * sin(sway) + dir.y * cos(sway));
      let speed = burst * (0.45 + 0.9 * shHash(k, 2u, sd));
      // The crack runs outward from the origin: nearer shards break loose first.
      let tk = max(tau - (0.03 + min(l, 600.0) / 2600.0), 0.0);
      let pos = s + dir * speed * (1.0 - exp(-3.0 * tk)) / 3.0
        + vec2f(0.0, 0.5 * 1400.0 * tk * tk - (90.0 + 240.0 * shHash(k, 3u, sd)) * tk);
      let theta = (shHash(k, 4u, sd) - 0.5) * 7.0 * tk;
      let he = shHash(k, 5u, sd);
      var flip = 0.0;
      if (he > 0.5) { flip = (2.0 + he * 4.0) * tk; }
      let size = 1.0 - 0.32 * smoothstep(0.0, 1.0, tk);
      let sx = cos(flip);
      if (abs(sx) < 0.06) { continue; }
      let sc = vec2f(sx * size, size);
      let r0 = p - pos;
      let cs = cos(theta);
      let sn = sin(theta);
      let q = s + vec2f(cs * r0.x + sn * r0.y, -sn * r0.x + cs * r0.y) / sc;
      let dq = q - s;
      if (dot(dq, dq) > reach * reach) { continue; }
      // The distance to the nearest crack (the bisector with a neighbouring seed) or edge.
      var de = min(min(q.x - it.p.x, it.p.x + it.p.z - q.x), min(q.y - it.p.y, it.p.y + it.p.w - q.y));
      let ci = i32(k % gx);
      let cj = i32(k / gx);
      for (var dj = -1; dj <= 1 && de > 0.0; dj++) {
        for (var di = -1; di <= 1; di++) {
          let ni = ci + di;
          let nj = cj + dj;
          if ((di == 0 && dj == 0) || ni < 0 || nj < 0 || ni >= i32(gx) || nj >= i32(gy)) { continue; }
          let m = shSeed(it, u32(nj) * gx + u32(ni), gx, gy);
          de = min(de, (dot(q - m, q - m) - dot(dq, dq)) / (2.0 * distance(m, s)));
        }
      }
      if (de <= 0.0) { continue; }
      let fade = 1.0 - smoothstep(0.48 + 0.22 * shHash(k, 6u, sd), 0.78 + 0.22 * shHash(k, 6u, sd), tau);
      if (fade <= 0.003) { continue; }
      let z = shHash(k, 7u, sd);
      let nearness = 1.0 - z;
      if (nearness <= bestNear) { continue; }
      let dpx = de * min(abs(sc.x), sc.y);
      let moving = smoothstep(0.0, 0.6, tk);
      var col = sampleGhost(q);
      col = mix(col, col * (0.55 + 0.9 * u.holo.rgb), 0.4 * moving);
      col *= 1.0 - 0.42 * z * moving;
      let he2 = shHash(k, 8u, sd);
      // Seen from behind: dark glass, tinted.
      if (sx < 0.0) { col = mix(col * 0.22, u.holo.rgb * 0.34, 0.55); }
      // The edge catches light as the shard turns.
      let glint = pow(0.5 + 0.5 * sin(theta * 2.2 + tau * 8.0 + he2 * 6.2832), 10.0);
      var tint = u.holo.rgb;
      if (he2 > 0.84) { tint = mix(u.holo.rgb, u.hot.rgb, 0.8); }
      let crack = 0.4 + 0.9 * smoothstep(0.0, 0.16, tau);
      let edgeLight = exp(-dpx / 1.3) * crack * fade;
      bestLight = (tint * (0.5 + 1.1 * glint) + vec3f(1.0, 0.95, 0.97) * glint * 0.7) * edgeLight
        + tint * exp(-dpx / 5.0) * 0.12 * fade * moving;
      best = vec4f(col, smoothstep(0.0, 1.1, dpx) * fade);
      bestNear = nearness;
    }
  }
  if (best.w >= 0.0) { *light += bestLight; }
  return best;
}
`;

// The shard of p, in JavaScript: true where a shard covers it (the twin of shardsPicture).
function covers(x, y, d, b) {
  const rx = d[b + 8], ry = d[b + 9], rw = d[b + 10], rh = d[b + 11];
  const ox = d[b + 12], oy = d[b + 13], sd = Math.round(d[b + 14]) >>> 0;
  const tau = d[b + 1];
  const gx = Math.round(d[b + 2]), gy = Math.round(d[b + 3]);
  const diag = Math.hypot(rw, rh);
  const burst = 260 + 0.9 * Math.min(diag, 400);
  const cw = rw / gx, ch = rh / gy;
  const reach = 1.6 * Math.hypot(cw, ch);
  const seedOf = (id) => [
    rx + ((id % gx) + 0.2 + 0.6 * G.hash(id, 100, sd)) * cw,
    ry + (Math.floor(id / gx) + 0.2 + 0.6 * G.hash(id, 101, sd)) * ch,
  ];
  const total = Math.min(gx * gy, MAX_SHARDS);
  for (let k = 0; k < total; k++) {
    const [sx0, sy0] = seedOf(k);
    const ax = sx0 - ox, ay = sy0 - oy;
    const l = Math.hypot(ax, ay);
    const ha = G.hash(k, 1, sd);
    let dx = Math.cos(ha * 6.2832), dy = Math.sin(ha * 6.2832);
    if (l > 1) { dx = ax / l; dy = ay / l; }
    const sway = (ha - 0.5) * 0.8;
    const cw0 = Math.cos(sway), sw0 = Math.sin(sway);
    [dx, dy] = [dx * cw0 - dy * sw0, dx * sw0 + dy * cw0];
    const speed = burst * (0.45 + 0.9 * G.hash(k, 2, sd));
    const tk = Math.max(tau - (0.03 + Math.min(l, 600) / 2600), 0);
    const along = (speed * (1 - Math.exp(-3 * tk))) / 3;
    const px = sx0 + dx * along;
    const py = sy0 + dy * along + 0.5 * GRAVITY * tk * tk - (90 + 240 * G.hash(k, 3, sd)) * tk;
    const theta = (G.hash(k, 4, sd) - 0.5) * 7 * tk;
    const he = G.hash(k, 5, sd);
    const flip = he > 0.5 ? (2 + he * 4) * tk : 0;
    const size = 1 - 0.32 * smooth(tk);
    const sx = Math.cos(flip);
    if (Math.abs(sx) < 0.06) continue;
    const scx = sx * size, scy = size;
    const r0x = x - px, r0y = y - py;
    const cs = Math.cos(theta), sn = Math.sin(theta);
    const qx = sx0 + (cs * r0x + sn * r0y) / scx;
    const qy = sy0 + (-sn * r0x + cs * r0y) / scy;
    const dqx = qx - sx0, dqy = qy - sy0;
    if (dqx * dqx + dqy * dqy > reach * reach) continue;
    let de = Math.min(qx - rx, rx + rw - qx, qy - ry, ry + rh - qy);
    const ci = k % gx, cj = Math.floor(k / gx);
    for (let dj = -1; dj <= 1 && de > 0; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = ci + di, nj = cj + dj;
        if ((di === 0 && dj === 0) || ni < 0 || nj < 0 || ni >= gx || nj >= gy) continue;
        const [mx, my] = seedOf(nj * gx + ni);
        de = Math.min(de, ((qx - mx) ** 2 + (qy - my) ** 2 - (dqx * dqx + dqy * dqy)) / (2 * Math.hypot(mx - sx0, my - sy0)));
      }
    }
    if (de <= 0) continue;
    const f0 = 0.48 + 0.22 * G.hash(k, 6, sd);
    if (1 - smooth((tau - f0) / 0.3) <= 0.003) continue;
    return true;
  }
  return false;
}

function smooth(t) {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

export const SHARDS = definePrimitive({
  kind: 27,
  name: 'shards',
  picture: {
    name: 'shardsPicture',
    order: 90,
    transition: true,
    wgsl: WGSL,
    // Shards take no input: null where one covers, undefined elsewhere.
    js(x, y, d, b) {
      const bx = d[b + 4], by = d[b + 5];
      if (x < bx || y < by || x >= bx + d[b + 6] || y >= by + d[b + 7]) return undefined;
      return covers(x, y, d, b) ? null : undefined;
    },
  },
  // An exit style for stage.discard / transition({ exit: 'shatter' }) (core/stage.js):
  // the item that shows an element of rect `rect` `ms` after it was removed, or null once gone.
  exit: {
    name: 'shatter',
    ms: TOTAL * 1000,
    item(rect, ms, { origin, seed, whole }) {
      const tau = ms / 1000;
      if (tau >= TOTAL) return null;
      const [x, y, w, h] = rect;
      const [gx, gy] = grid(w, h);
      const burst = 260 + 0.9 * Math.min(Math.hypot(w, h), 400);
      const reach = 0.45 * burst + 0.3 * Math.hypot(w, h) + 20;
      const rise = 140;
      const fall = 0.5 * GRAVITY * TOTAL * TOTAL;
      let bx = x - reach, by = y - reach - rise, bw = w + 2 * reach, bh = h + 2 * reach + rise + fall;
      if (whole) {
        const l = Math.max(bx, whole[0]), t = Math.max(by, whole[1]);
        bw = Math.min(bx + bw, whole[0] + whole[2]) - l;
        bh = Math.min(by + bh, whole[1] + whole[3]) - t;
        bx = l;
        by = t;
        if (bw <= 0 || bh <= 0) return null;
      }
      const o = origin ?? [x + w / 2, y + h / 2];
      return { rect: [bx, by, bw, bh], p: [x, y, w, h], q: [o[0], o[1], seed, TOTAL], h: [tau, gx, gy] };
    },
  },
});
