import '@picocss/pico/css/pico.min.css';
import '../src/base.css';
import './plain.css';
import '../src/index.js';
import '../src/skins/plain/index.js';

const form = document.querySelector('#settings-form');
const saved = document.querySelector('#saved');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  saved.value = 'Saved.';
});
form.addEventListener('input', () => (saved.value = ''));

// A held button clicks once the hold completes.
document.querySelector('#delete').addEventListener('click', () => {
  document.querySelector('#deleted').value = 'Deletion scheduled. You have 7 days to change your mind.';
});
