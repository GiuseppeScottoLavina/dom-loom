// Latin only: the one kanji on the page (雷) comes from the system's Japanese font.
import '@fontsource/zen-kaku-gothic-new/latin-500.css';
import '@fontsource/zen-kaku-gothic-new/latin-700.css';
import '@fontsource/dela-gothic-one/latin-400.css';
import '../src/base.css';
import '../src/skins/manga/manga.css';
import './manga.css';
import '../src/index.js';
import '../src/skins/manga/index.js';

const stage = document.querySelector('#survey');
const form = document.querySelector('#survey-form');
const receipt = document.querySelector('[data-view=receipt]');
const picked = document.querySelector('#picked');
const hype = form.elements.hype;
const hypeOut = document.querySelector('#hype-out');

// The card keeps three favourites: a fourth tick is taken back, and the count says why.
const series = [...form.querySelectorAll('input[name=series]')];
function count(refused = false) {
  const n = series.filter((box) => box.checked).length;
  picked.value = refused ? 'Three at most!' : `${n} / 3`;
  picked.classList.toggle('refused', refused);
}
for (const box of series) {
  box.addEventListener('change', () => {
    const over = series.filter((b) => b.checked).length > 3;
    if (over) box.checked = false;
    count(over);
  });
}

// How hyped: the sound effect grows with the value.
const sfx = ['…', '…', '…', 'Hm', 'Doki', 'Doki doki', 'Doki doki', 'Doki doki!', 'Doki doki!!', 'Dokkan!', 'DOKKAN!!'];
const showHype = () => (hypeOut.value = sfx[hype.value]);
hype.addEventListener('input', showHype);

form.addEventListener('reset', () => setTimeout(() => { count(); showHype(); }));

function show(view) {
  const toReceipt = view === receipt;
  form.inert = toReceipt;
  receipt.inert = !toReceipt;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const votes = data.getAll('series');
  const out = (name) => receipt.querySelector(`[data-out=${name}]`);
  out('votes').textContent = votes.length ? votes.join(' · ') : 'No favourites this week.';
  out('pen').textContent = data.has('draw')
    ? `${data.get('pen')} is in the prize draw. Winners are printed in No. 50.`
    : `Thanks, ${data.get('pen')}. The ranking moves on Monday.`;
  // Let the impact land, then turn the card over to its postmarked side.
  await new Promise((resolve) => setTimeout(resolve, 380));
  await stage.transition(() => show(receipt), { style: 'curl' });
  if (!receipt.inert) receipt.querySelector('#receipt-title').focus({ preventScroll: true });
});

document.querySelector('#again').addEventListener('click', async () => {
  await stage.transition(() => { form.reset(); show(form); }, { style: 'curl', direction: -1 });
  if (!form.inert) series[0].focus({ preventScroll: true });
});
