// Colours a skin can read from the page around a stage (token fallbacks).

/** The rgb channels of a computed CSS colour. */
const channels = (css) => (css.match(/[\d.]+/g) ?? []).map(Number);

/** The first background that is not transparent, from the stage up; the canvas colour without one. */
export function pageBackground(stage) {
  for (let el = stage; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor;
    const [, , , a = 1] = channels(c);
    if (c !== 'transparent' && a > 0.5) return c;
  }
  return 'Canvas';
}

/**
 * The page's accent: the stage's accent-color, else the one the page gives its controls
 * inside the stage, else the blue browsers use for form controls.
 */
export function pageAccent(stage) {
  const own = getComputedStyle(stage).accentColor;
  if (own && own !== 'auto') return own;
  const control = stage.querySelector('input[type=checkbox], input[type=radio], input[type=range], progress');
  const theirs = control && getComputedStyle(control).accentColor;
  return theirs && theirs !== 'auto' ? theirs : '#0a66ff';
}

/** Whether the page behind the stage is dark. */
export function pageIsDark(stage) {
  const bg = pageBackground(stage);
  if (bg === 'Canvas') return matchMedia('(prefers-color-scheme: dark)').matches;
  const [r, g, b] = channels(bg);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}
