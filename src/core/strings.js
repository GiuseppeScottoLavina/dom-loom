/**
 * The words DomLoom writes into the page for assistive technology: the names it gives the
 * buttons it adds and the hints it announces. Each comes in the language of the element it
 * belongs to (its nearest `lang`, else the document's), falling back to English. A label
 * or description the page sets itself always wins.
 */

const tables = new Map([
  ['en', {
    holdHint: 'Press and hold, or activate twice, to confirm',
    holdArmed: (label) => `${label}: activate again to confirm`,
    remove: (label) => `Remove ${label}`,
    dismiss: 'Dismiss',
    resizePanes: 'Resize panes',
    sortBy: (label) => `Sort by ${label}`,
  }],
  ['it', {
    holdHint: 'Tieni premuto, o attiva due volte, per confermare',
    holdArmed: (label) => `${label}: attiva di nuovo per confermare`,
    remove: (label) => `Rimuovi ${label}`,
    dismiss: 'Chiudi',
    resizePanes: 'Ridimensiona i riquadri',
    sortBy: (label) => `Ordina per ${label}`,
  }],
]);

/**
 * Adds a language, or changes some of its words. Each value is a string, or a function of
 * the element's own text for the words that name it (`remove`, `sortBy`, `holdArmed`).
 * Words a language leaves out come from English. Elements labelled already keep their
 * labels; call it before the stages start.
 * @param {string} lang  a BCP 47 tag: 'de', or 'pt-BR' for a regional variant
 * @param {Partial<LoomStrings>} strings
 */
export function defineStrings(lang, strings) {
  const key = String(lang).toLowerCase();
  tables.set(key, { ...tables.get(key), ...strings });
}

/** The language that applies to an element: its nearest lang attribute, else the document's. */
function languageOf(el) {
  const lang = el?.closest?.('[lang]')?.getAttribute('lang') || globalThis.document?.documentElement?.lang || 'en';
  return lang.toLowerCase();
}

/**
 * One of the words, for an element: in its language (its region's variant first: pt-BR,
 * then pt), else in English.
 * @param {Element|null} el
 * @param {keyof LoomStrings} key
 * @param {string} [label]  the element's own text, for the words that name it
 */
export function wordFor(el, key, label = '') {
  const lang = languageOf(el);
  const value = tables.get(lang)?.[key] ?? tables.get(lang.split('-')[0])?.[key] ?? tables.get('en')[key];
  return typeof value === 'function' ? value(label) : value;
}

/**
 * @typedef {object} LoomStrings
 * @property {string} holdHint  the description of a button with `hold`
 * @property {string | ((label: string) => string)} holdArmed  announced when an activation arms a `hold` button
 * @property {string | ((label: string) => string)} remove  the name of a chip's remove button
 * @property {string} dismiss  the name of a toast's close button
 * @property {string} resizePanes  the name of a splitter
 * @property {string | ((label: string) => string)} sortBy  the name of a sortable header's button
 */
