// Windows 7 edition: Electron 22 renders with Chromium 108, which has no color-mix(). Tailwind
// writes opacity modifiers (bg-black/50, border-accent/25, …) as
//   @supports (color:color-mix(in lab, red, red)){SEL{PROP:color-mix(in oklab, var(--x) 50%, transparent)}}
// after a full-opacity fallback. This replaces each such block, in place, with plain rgba() rules
// for the dark and light themes, resolved from the design tokens in the same stylesheet.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/assets';

function vars(css, selector) {
  const start = css.indexOf(`${selector}{`);
  if (start < 0) throw new Error(`win7-css: no ${selector} block`);
  const body = css.slice(start + selector.length + 1, css.indexOf('}', start));
  return Object.fromEntries(body.split(';').map(d => d.split(/:(.*)/s)).filter(([k, v]) => k?.startsWith('--') && v).map(([k, v]) => [k.trim(), v.trim()]));
}

function rgba(value, pct, tokens) {
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return tokens[ref[1]] ? rgba(tokens[ref[1]], pct, tokens) : null;
  let r, g, b, a = 1, m;
  if ((m = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i))) {
    const h = m[1].length <= 4 ? [...m[1]].map(c => c + c).join('') : m[1];
    [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else if ((m = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/))) {
    [r, g, b] = m.slice(1, 4).map(Number); a = m[4] === undefined ? 1 : Number(m[4]);
  } else return null;
  return `rgba(${r},${g},${b},${+(a * pct / 100).toFixed(3)})`;
}

/** oklch() is Chrome 111+ too: convert Tailwind's palette values to sRGB hex. */
function oklchToHex(_, l, c, h) {
  const L = parseFloat(l) / (l.endsWith('%') ? 100 : 1), C = c === 'none' ? 0 : parseFloat(c), H = (h === 'none' ? 0 : parseFloat(h)) * Math.PI / 180;
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l_ = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m_ = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s_ = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
  return '#' + lin.map(v => { v = Math.min(1, Math.max(0, v)); v = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(v * 255).toString(16).padStart(2, '0'); }).join('');
}

for (const file of readdirSync(dir).filter(f => f.endsWith('.css'))) {
  const path = join(dir, file);
  let css = readFileSync(path, 'utf8').replace(/oklch\(([\d.]+%?) ([\d.]+|none) ([\d.]+|none)\)/g, oklchToHex);
  const base = { ...vars(css, ':root,:host'), ...vars(css, ':root,[data-theme=dark]') };
  const themes = { dark: base, light: { ...base, ...vars(css, '[data-theme=light]') } };
  let replaced = 0, kept = 0;
  css = css.replace(/@supports \(color:color-mix\(in lab, red, red\)\)\{([^{}]+)\{([\w-]+):color-mix\(in oklab, ([^ ]+) ([\d.]+)%, transparent\)\}\}/g,
    (block, sel, prop, color, pct) => {
      const dark = rgba(color, Number(pct), themes.dark);
      const light = rgba(color, Number(pct), themes.light);
      if (!dark || !light) { kept++; return block; } // e.g. currentcolor: the fallback stays
      replaced++;
      const lightSel = sel.split(',').map(s => `:where([data-theme=light]) ${s}`).join(',');
      return `${sel}{${prop}:${dark}}${lightSel}{${prop}:${light}}`;
    });
  writeFileSync(path, css);
  console.log(`win7-css: ${file}: ${replaced} color-mix rules resolved, ${kept} left on their fallback`);
}
