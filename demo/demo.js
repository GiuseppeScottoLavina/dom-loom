import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource-variable/big-shoulders-display';
import '@fontsource-variable/jetbrains-mono';
import '../src/loom.css';
import './demo.css';
import '../src/index.js';

const stage = document.querySelector('#loadout');
const form = document.querySelector('#loadout-form');
const receipt = document.querySelector('[data-view=receipt]');
const altitude = form.elements.altitude;
const altitudeOut = document.querySelector('#altitude-out');
const status = document.querySelector('#status');
const soundButton = document.querySelector('#sound');
const clock = document.querySelector('#clock');

const metres = (value) => `${Number(value).toLocaleString('en-US')} m`;
altitude.addEventListener('input', () => {
  altitudeOut.value = metres(altitude.value);
});
form.addEventListener('reset', () => {
  setTimeout(() => (altitudeOut.value = metres(altitude.value)));
});

soundButton.addEventListener('click', () => {
  const on = !stage.hasAttribute('sound');
  stage.toggleAttribute('sound', on);
  soundButton.setAttribute('aria-pressed', String(on));
  soundButton.textContent = on ? 'Sound on' : 'Sound off';
});

stage.ready.then((renderer) => {
  status.textContent = renderer === 'webgpu'
    ? `WebGPU compositor · ${stage.dataset.mode === 'native' ? 'native HTML-in-Canvas' : 'polyfill'}`
    : 'Plain DOM · no WebGPU here';
  status.dataset.state = renderer;
});

let ticking = 0;
function startClock() {
  const start = performance.now();
  clearInterval(ticking);
  ticking = setInterval(() => {
    const t = (performance.now() - start) / 1000;
    const m = String(Math.floor(t / 60)).padStart(2, '0');
    const s = (t % 60).toFixed(1).padStart(4, '0');
    clock.textContent = `T+${m}:${s}`;
  }, 100);
}

function show(view) {
  const toReceipt = view === receipt;
  form.inert = toReceipt;
  receipt.inert = !toReceipt;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const out = (name) => receipt.querySelector(`[data-out=${name}]`);
  out('callsign').textContent = data.get('callsign');
  out('role').textContent = data.get('role');
  out('altitude').textContent = metres(data.get('altitude'));
  out('nv').textContent = data.has('nv') ? 'On' : 'Off';
  out('comms').textContent = data.has('comms') ? 'Silent' : 'Open';
  // The chosen role's segment flies into the readout.
  for (const label of form.querySelectorAll('.segments label')) {
    label.style.viewTransitionName = label.querySelector('input').checked ? 'role' : '';
  }
  startClock();
  await stage.transition(() => show(receipt));
  receipt.querySelector('#receipt-title').focus({ preventScroll: true });
});

document.querySelector('#edit').addEventListener('click', async () => {
  await stage.transition(() => show(form));
  clearInterval(ticking);
  form.elements.callsign.focus({ preventScroll: true });
});

/* ------------------------------------------------------------- ops panel */
const ops = document.querySelector('#ops');
const hull = document.querySelector('#hull');
const shield = document.querySelector('#shield');
const uplink = document.querySelector('#uplink');
const hullOut = document.querySelector('#hull-out');
const shieldOut = document.querySelector('#shield-out');
const uplinkOut = document.querySelector('#uplink-out');
const linkButton = document.querySelector('#link');

const showVitals = () => {
  hullOut.value = `${Math.round(hull.value)} / 100`;
  shieldOut.value = `${shield.value} / 5`;
};
const between = (a, b) => a + Math.random() * (b - a);

document.querySelector('#hit').addEventListener('click', () => {
  // The shield takes a cell first; with no cells left, the hull takes it all.
  if (shield.value > 0) {
    shield.value -= 1;
    hull.value = Math.max(0, hull.value - Math.round(between(4, 8)));
  } else {
    hull.value = Math.max(0, hull.value - Math.round(between(16, 26)));
  }
  showVitals();
});

document.querySelector('#patch').addEventListener('click', () => {
  hull.value = Math.min(100, hull.value + 15);
  shield.value = Math.min(5, shield.value + 1);
  showVitals();
});

linkButton.addEventListener('click', () => {
  linkButton.disabled = true;
  uplink.removeAttribute('value');
  uplinkOut.value = 'Handshake…';
  setTimeout(() => {
    uplink.value = 0;
    let done = 0;
    const step = () => {
      done = Math.min(100, done + Math.round(between(5, 14)));
      uplink.value = done;
      uplinkOut.value = done < 100 ? `${done} %` : 'Linked · 2.4 MB';
      if (done < 100) setTimeout(step, between(110, 260));
      else linkButton.disabled = false;
    };
    step();
  }, 1100);
});

ops.toggleAttribute('sound', stage.hasAttribute('sound'));
soundButton.addEventListener('click', () => ops.toggleAttribute('sound', stage.hasAttribute('sound')));

/* ---------------------------------------------------------- roster panel */
const roster = document.querySelector('#roster');
const table = document.querySelector('#roster-table');
const pages = document.querySelector('.pages');
const PER_PAGE = 6;
let page = 1;

function paginate() {
  [...table.tBodies[0].rows].forEach((row, i) => {
    row.hidden = Math.floor(i / PER_PAGE) + 1 !== page;
  });
  for (const button of pages.querySelectorAll('button')) {
    if (Number(button.dataset.page) === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
paginate();
// Sorting reorders every row; keep the same page in view.
table.addEventListener('loom-sorted', paginate);

pages.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-page]');
  if (!button) return;
  const next = Number(button.dataset.page);
  if (next === page) return;
  const direction = next > page ? 1 : -1;
  page = next;
  roster.transition(paginate, { scope: table.tBodies[0], direction });
});

/* The mission phase stepper in the ops panel. */
const steps = [...document.querySelectorAll('.steps li')];
document.querySelector('#advance').addEventListener('click', () => {
  const i = steps.findIndex((li) => li.getAttribute('aria-current') === 'step');
  steps[i].removeAttribute('aria-current');
  steps[(i + 1) % steps.length].setAttribute('aria-current', 'step');
});

for (const s of [ops, roster]) s.toggleAttribute('sound', stage.hasAttribute('sound'));
soundButton.addEventListener('click', () => roster.toggleAttribute('sound', stage.hasAttribute('sound')));

/* ----------------------------------------------------- requisition panel */
const req = document.querySelector('#req');
const reqForm = document.querySelector('#req-form');
const windowOut = document.querySelector('#window-out');
const hour = (h) => `${String(h).padStart(2, '0')}:00`;
reqForm.addEventListener('input', (event) => {
  if (event.target.closest('[interval]')) {
    windowOut.value = `${hour(reqForm.elements.from.value)} – ${hour(reqForm.elements.to.value)}`;
  }
});
reqForm.addEventListener('submit', (event) => event.preventDefault());

const tags = document.querySelector('#tags');
const tagInput = document.querySelector('#tag-input');
tagInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const text = tagInput.value.trim();
  if (!text) return;
  const li = document.createElement('li');
  li.setAttribute('removable', '');
  li.textContent = text;
  tags.append(li);
  tagInput.value = '';
});

const filesOut = document.querySelector('#files-out');
reqForm.elements.intel.addEventListener('change', (event) => {
  const files = [...event.target.files];
  filesOut.value = files.length ? `${files.length} file${files.length > 1 ? 's' : ''}: ${files.map((f) => f.name).join(', ')}` : 'No files yet';
});

req.toggleAttribute('sound', stage.hasAttribute('sound'));
soundButton.addEventListener('click', () => req.toggleAttribute('sound', stage.hasAttribute('sound')));

/* ----------------------------------------------------------- comms panel */
const comms = document.querySelector('#comms');
const toastList = comms.querySelector('[toasts]');
const unread = document.querySelector('#unread');
const alarm = document.querySelector('#alarm');
const signal = document.querySelector('#signal');
const signalOut = document.querySelector('#signal-out');
const ring = document.querySelector('#decrypt-ring');
const decryptOut = document.querySelector('#decrypt-out');
const intercept = document.querySelector('#intercept');
const decryptButton = document.querySelector('#decrypt');

function toast(text, tone) {
  const li = document.createElement('li');
  li.textContent = text;
  if (tone) li.dataset.tone = tone;
  toastList.append(li);
}

const replies = ['Nightjar: copy that.', 'Kestrel: on the roof, two minutes.', 'Moth: medkits stocked.', 'Grackle: dish is aligned.'];
let replyIndex = 0;
document.querySelector('#ping').addEventListener('click', () => {
  toast('Ping sent to Squad 04');
  setTimeout(() => {
    toast(replies[replyIndex++ % replies.length]);
    unread.textContent = String(Number(unread.textContent) + 1);
  }, 900);
});

const breaches = ['Hull breach on deck 2. Seal the bulkheads.', 'Drone swarm over the relay. Take cover.', 'Comms jammed on channel 4. Switch to 7.'];
let breachIndex = 0;
document.querySelector('#breach').addEventListener('click', () => {
  alarm.textContent = breaches[breachIndex++ % breaches.length];
  alarm.hidden = false;
  signal.value = Math.max(0, signal.value - 1);
  signalOut.value = `${signal.value} / 5`;
  if (signal.value === 0) setTimeout(() => {
    signal.value = 4;
    signalOut.value = '4 / 5';
    toast('Signal restored', 'good');
  }, 2500);
});

decryptButton.addEventListener('click', () => {
  decryptButton.disabled = true;
  ring.removeAttribute('value');
  decryptOut.value = 'Working';
  intercept.setAttribute('aria-busy', 'true');
  setTimeout(() => {
    intercept.innerHTML = `<h3>Intercept 0412</h3>
      <p>"Courier moved to the freight lift. Two guards, no drones."</p>
      <p>Rail yard · 04:12 · confidence 92 %</p>`;
    intercept.setAttribute('aria-busy', 'false');
    ring.value = 100;
    decryptOut.value = 'Done';
    decryptButton.disabled = false;
    toast('Intercept 0412 decrypted', 'good');
  }, 1600);
});

comms.toggleAttribute('sound', stage.hasAttribute('sound'));
soundButton.addEventListener('click', () => comms.toggleAttribute('sound', stage.hasAttribute('sound')));
