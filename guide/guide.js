// The guide: every page loads DomLoom in full, builds its navigation, and turns each
// example into a live stage with its code underneath. The code shown is the source that
// runs: the markup comes from the example's <script type="text/html">, and its script from
// <script type="text/plain" class="example-js">, which this module runs as a module of its
// own once the stages are in place. Both are shown as written.
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource-variable/big-shoulders-display';
import '@fontsource-variable/jetbrains-mono';
import '../src/loom.css';
import './guide.css';
import * as loom from '../src/index.js';

const PAGES = [
  ['index.html', 'Getting started'],
  ['controls.html', 'Controls'],
  ['feedback.html', 'Feedback and data'],
  ['transitions.html', 'Transitions'],
  ['effects.html', 'Effects'],
  ['overlays.html', 'Overlays'],
  ['skins.html', 'Skins and theming'],
  ['frameworks.html', 'Frameworks'],
];

/* ---------------------------------------------------------------- navigation */
const here = location.pathname.split('/').pop() || 'index.html';
const nav = document.querySelector('#guide-nav');
if (nav) {
  const list = document.createElement('ol');
  for (const [href, label] of PAGES) {
    const li = document.createElement('li');
    const a = Object.assign(document.createElement('a'), { href, textContent: label });
    li.append(a);
    if (href === here) {
      a.setAttribute('aria-current', 'page');
      // The sections of the current page, under its name.
      const sections = [...document.querySelectorAll('main h2[id]')];
      if (sections.length) {
        const sub = document.createElement('ol');
        for (const h of sections) {
          const item = document.createElement('li');
          item.append(Object.assign(document.createElement('a'), { href: `#${h.id}`, textContent: h.textContent }));
          sub.append(item);
        }
        li.append(sub);
      }
    }
    list.append(li);
  }
  nav.append(list);
}

// Previous and next pages at the foot of each page.
const foot = document.querySelector('#guide-pager');
const index = PAGES.findIndex(([href]) => href === here);
if (foot && index >= 0) {
  const [prev, next] = [PAGES[index - 1], PAGES[index + 1]];
  if (prev) foot.append(Object.assign(document.createElement('a'), { href: prev[0], rel: 'prev', textContent: `← ${prev[1]}` }));
  if (next) foot.append(Object.assign(document.createElement('a'), { href: next[0], rel: 'next', textContent: `${next[1]} →` }));
}

/* ---------------------------------------------------------------- highlighting */
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Drops the indentation that every non-empty line shares, and the blank lines around. */
function dedent(text) {
  const lines = text.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}

function highlightHtml(code) {
  return escape(code)
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-comment">$1</span>')
    .replace(/(&lt;\/?)([a-z][\w-]*)([\s\S]*?)(\/?&gt;)/gi, (m, open, name, attrs, close) => {
      const a = attrs.replace(/([\w:-]+)(=)("[^"]*")?/g, (x, n, eq, v) => `<span class="tok-attr">${n}</span>${eq}${v ? `<span class="tok-string">${v}</span>` : ''}`)
        .replace(/(\s)([\w:-]+)(?=\s|$)/g, '$1<span class="tok-attr">$2</span>');
      return `<span class="tok-punct">${open}</span><span class="tok-tag">${name}</span>${a}<span class="tok-punct">${close}</span>`;
    });
}

const JS_WORDS = /\b(import|from|export|const|let|var|function|return|await|async|if|else|for|of|new|true|false|null|undefined|class|extends|this|=&gt;)\b/g;
function highlightJs(code) {
  // Strings and comments first, kept out of the keyword pass by placeholders.
  // Placeholders carry no digits, so the number pass cannot touch them.
  const kept = [];
  const keep = (cls) => (m) => `\u0000${String.fromCharCode(0xe000 + kept.push(`<span class="${cls}">${m}</span>`) - 1)}\u0000`;
  let out = escape(code)
    .replace(/\/\/[^\n]*/g, keep('tok-comment'))
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, keep('tok-string'));
  out = out.replace(JS_WORDS, '<span class="tok-key">$1</span>').replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
  return out.replace(/\u0000([\ue000-\uf8ff])\u0000/g, (m, c) => kept[c.charCodeAt(0) - 0xe000]);
}

/** A code block with a label and a copy button. */
function codeBlock(source, lang) {
  const figure = document.createElement('figure');
  figure.className = 'code';
  const bar = document.createElement('figcaption');
  bar.append(Object.assign(document.createElement('span'), { textContent: lang === 'html' ? 'HTML' : lang === 'css' ? 'CSS' : 'JavaScript' }));
  const copy = Object.assign(document.createElement('button'), { type: 'button', className: 'copy', textContent: 'Copy' });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Select and copy';
    }
    setTimeout(() => (copy.textContent = 'Copy'), 1600);
  });
  bar.append(copy);
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.innerHTML = lang === 'html' ? highlightHtml(source) : lang === 'css' ? escape(source) : highlightJs(source);
  pre.append(code);
  pre.tabIndex = 0;
  figure.append(bar, pre);
  return figure;
}

/* ---------------------------------------------------------------- examples */
globalThis.__domloomGuide = loom;
for (const example of document.querySelectorAll('.example')) {
  const markup = example.querySelector('script[type="text/html"]');
  const behaviour = example.querySelector('script.example-js');
  const style = example.querySelector('style.example-css');
  const live = document.createElement('div');
  live.className = 'live';
  const codes = document.createElement('div');
  codes.className = 'codes';
  if (markup) {
    const source = dedent(markup.textContent);
    live.innerHTML = source;
    codes.append(codeBlock(source, 'html'));
  }
  if (style) codes.append(codeBlock(dedent(style.textContent), 'css'));
  if (behaviour) codes.append(codeBlock(dedent(behaviour.textContent), 'js'));
  (markup ?? behaviour ?? style).before(live, codes);
  if (behaviour) {
    // Run the example's script as written, as a module of its own. A module made from text
    // cannot resolve the package name, so `import { … } from 'dom-loom'` takes the same
    // exports from the library this page has already loaded.
    const code = behaviour.textContent.replace(/import\s*\{([^}]*)\}\s*from\s*'dom-loom';/g, 'const {$1} = globalThis.__domloomGuide;');
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    import(/* @vite-ignore */ url).catch((error) => console.error(`Example ${example.id}:`, error)).finally(() => URL.revokeObjectURL(url));
  }
}

/* ---------------------------------------------------------------- plain code samples */
for (const pre of document.querySelectorAll('pre[data-lang]')) {
  pre.replaceWith(codeBlock(dedent(pre.textContent), pre.dataset.lang));
}
