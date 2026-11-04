/*
 * tailwind.js — Tailwind CSS v4 export, built on Folio.css.nodeStyles (mode 'export').
 *
 *   Folio.tailwind
 *     classesFor(node, parent)       -> { classes: [...], style: {prop: value} }  (style = no faithful utility)
 *     htmlFor(id)                    -> HTML with class="…"
 *     jsxFor(id, { componentName })  -> a React component (className="…", style={{ … }})
 *     themeFor(id)                   -> '@import "tailwindcss";' + @theme with the brand variables the subtree uses
 *     pageFor(id)                    -> standalone preview page (Tailwind browser build)
 */
window.Folio = window.Folio || {};

(function () {
  const store = Folio.store;
  const ex = () => Folio.exporter;

  const PX = /^(-?\d*\.?\d+)px$/;
  const TOKEN = /^var\(--(color|font|radius)-([\w-]+)\)$/;
  const tokenId = (v, kind) => {
    const m = String(v).trim().match(TOKEN);
    return m && m[1] === kind ? m[2] : null;
  };
  // Tailwind reads `_` as a space inside [...]; a literal underscore needs `\_`
  const arb = (v) => '[' + String(v).replace(/_/g, '\\_').replace(/"/g, "'").replace(/,\s+/g, ',').replace(/\s+/g, '_') + ']';
  const num = (n) => Math.round(n * 1000) / 1000;

  /** Spacing / size: multiples of 2px use the 0.25rem scale (integers and .5), anything else is arbitrary. */
  function size(prefix, v) {
    const kw = { '100%': 'full', 'fit-content': 'fit', 'max-content': 'max', auto: 'auto' }[v];
    if (kw) return `${prefix}-${kw}`;
    const m = PX.exec(v);
    if (!m) return null;
    const n = Number(m[1]);
    if (n % 2 === 0) return `${n < 0 ? '-' : ''}${prefix}-${Math.abs(n) / 4}`;
    return `${prefix}-${arb(v)}`;
  }

  function color(prefix, v) {
    const id = tokenId(v, 'color');
    if (id) return `${prefix}-${id}`;
    if (v === 'transparent') return `${prefix}-transparent`;
    if (/^(#[0-9a-f]{3,8}$|(rgba?|hsla?|oklch|oklab)\()/i.test(v)) return `${prefix}-${arb(v)}`;
    return null;
  }

  /** "fn(arg) fn(arg)" -> utilities, only when Tailwind's fixed composition order gives the same result. */
  const FILTER_ORDER = ['blur', 'brightness', 'contrast', 'grayscale', 'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia'];
  function filters(v, pre) {
    const out = [];
    let last = -1;
    for (const [, fn, arg] of String(v).matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
      const i = FILTER_ORDER.indexOf(fn);
      if (i <= last) return null;
      last = i;
      const n = parseFloat(arg);
      if (fn === 'blur') out.push(`${pre}blur-${arb(arg)}`);
      else if (fn === 'hue-rotate') out.push(Number.isInteger(n) && /deg$/.test(arg) ? `${n < 0 ? '-' : ''}${pre}hue-rotate-${Math.abs(n)}` : `${pre}hue-rotate-${arb(arg)}`);
      else out.push(Number.isInteger(n) && /%$/.test(arg) ? `${pre}${fn}-${n}` : `${pre}${fn}-${arb(arg)}`);
    }
    return out.length ? out : null;
  }

  function padding(v) {
    let p = String(v).split(/\s+/);
    if (!p.every((x) => PX.test(x))) return null;
    if (p.length === 1) p = [p[0], p[0], p[0], p[0]];
    else if (p.length === 2) p = [p[0], p[1], p[0], p[1]];
    else if (p.length === 3) p = [p[0], p[1], p[2], p[1]];
    const [t, r, b, l] = p;
    const zero = (x) => parseFloat(x) === 0;
    const sides = (list) => list.filter(([, x]) => !zero(x)).map(([k, x]) => size(k, x));
    if (t === r && t === b && t === l) return [size('p', t)];
    if (t === b && r === l) return sides([['py', t], ['px', r]]);
    if (t === b) return sides([['py', t], ['pr', r], ['pl', l]]);
    if (r === l) return sides([['px', r], ['pt', t], ['pb', b]]);
    return sides([['pt', t], ['pr', r], ['pb', b], ['pl', l]]);
  }

  function radius(v) {
    const id = tokenId(v, 'radius');
    if (id) return [`rounded-${id}`];
    const p = String(v).split(/\s+/);
    if (!p.every((x) => PX.test(x))) return null;
    const one = (pre, x) => (parseFloat(x) >= 9999 ? `${pre}-full` : `${pre}-${arb(x)}`);
    if (p.length === 1 || p.every((x) => x === p[0])) return [one('rounded', p[0])];
    if (p.length !== 4) return null;
    return p.map((x, i) => (parseFloat(x) ? one('rounded-' + ['tl', 'tr', 'br', 'bl'][i], x) : null)).filter(Boolean);
  }

  function border(v) {
    const m = String(v).match(/^(\S+) (\S+) (.+)$/);
    if (!m || !PX.test(m[1])) return null;
    const style = { solid: null, dashed: 'border-dashed', dotted: 'border-dotted', double: 'border-double' }[m[2]];
    const c = color('border', m[3]);
    if (style === undefined || !c) return null;
    return [m[1] === '1px' ? 'border' : `border-${arb(m[1])}`, style, c].filter(Boolean);
  }

  const TEXT_SIZES = { 12: 'xs', 14: 'sm', 16: 'base', 18: 'lg', 20: 'xl', 24: '2xl', 30: '3xl', 36: '4xl', 48: '5xl', 60: '6xl', 72: '7xl', 96: '8xl', 128: '9xl' };
  const WEIGHTS = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
  const BOX = { left: 'left', top: 'top', right: 'right', bottom: 'bottom', width: 'w', height: 'h', 'min-width': 'min-w', 'min-height': 'min-h', gap: 'gap' };
  const ENUMS = {
    position: { relative: 'relative', absolute: 'absolute', fixed: 'fixed', sticky: 'sticky' },
    display: { flex: 'flex', block: 'block', 'inline-block': 'inline-block', grid: 'grid', none: 'hidden' },
    'flex-direction': { row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' },
    'flex-wrap': { wrap: 'flex-wrap' },
    'flex-shrink': { 0: 'shrink-0' },
    'align-self': { stretch: 'self-stretch', center: 'self-center', 'flex-start': 'self-start', 'flex-end': 'self-end' },
    'justify-content': { 'flex-start': 'justify-start', center: 'justify-center', 'flex-end': 'justify-end', 'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly' },
    'align-items': { 'flex-start': 'items-start', center: 'items-center', 'flex-end': 'items-end', stretch: 'items-stretch', baseline: 'items-baseline' },
    overflow: { hidden: 'overflow-hidden', visible: 'overflow-visible', auto: 'overflow-auto', scroll: 'overflow-scroll' },
    margin: { '0px': 'm-0', 0: 'm-0' },
    'text-align': { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify', start: 'text-start', end: 'text-end' },
    'text-transform': { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize' },
    'font-style': { italic: 'italic' },
    'text-decoration': { underline: 'underline', 'line-through': 'line-through', overline: 'overline' },
    'white-space': { 'pre-wrap': 'whitespace-pre-wrap' },
    'overflow-wrap': { 'break-word': '[overflow-wrap:break-word]' },
    'object-fit': { cover: 'object-cover', contain: 'object-contain', fill: 'object-fill', none: 'object-none', 'scale-down': 'object-scale-down' },
    'box-sizing': { 'border-box': '' }, // Tailwind's preflight already sets border-box
  };

  /** One CSS declaration -> utilities ([] = nothing needed, null = keep it as inline style). */
  function utility(k, v, css) {
    const one = (c) => (c ? [c] : null);
    if (ENUMS[k]) return v in ENUMS[k] ? [ENUMS[k][v]].filter(Boolean) : null;
    if (BOX[k]) return one(size(BOX[k], v));
    switch (k) {
      case 'flex':
        return [v === '1 1 0px' ? 'flex-1' : `flex-${arb(v)}`];
      case 'padding':
        return padding(v);
      case 'background-color':
        return one(color('bg', v));
      case 'color':
        return one(color('text', v));
      case 'border-radius':
        return radius(v);
      case 'border':
        return border(v);
      case 'box-shadow':
        return [`shadow-${arb(v)}`];
      case 'text-shadow':
        return [`text-shadow-${arb(v)}`];
      case 'opacity': {
        const n = num(Number(v) * 100);
        return [Number.isInteger(n) ? `opacity-${n}` : `opacity-${arb(v)}`];
      }
      case 'filter':
        return filters(v, '');
      case 'backdrop-filter':
        return filters(v, 'backdrop-');
      case '-webkit-backdrop-filter': // Tailwind prefixes backdrop utilities itself
        return v === css['backdrop-filter'] && filters(v, 'backdrop-') ? [] : null;
      case 'mix-blend-mode':
        return [`mix-blend-${v}`];
      case 'transform': {
        const m = String(v).match(/^rotate\((-?\d*\.?\d+)deg\)$/);
        if (!m) return null;
        const n = Number(m[1]);
        return [Number.isInteger(n) ? `${n < 0 ? '-' : ''}rotate-${Math.abs(n)}` : `rotate-${arb(v.slice(7, -1))}`];
      }
      case 'font-family': {
        const id = tokenId(v, 'font');
        return [id ? `font-${id}` : `font-${arb(v)}`];
      }
      case 'font-size': {
        const m = PX.exec(v);
        return [m && TEXT_SIZES[Number(m[1])] ? `text-${TEXT_SIZES[Number(m[1])]}` : `text-${arb(v)}`];
      }
      case 'font-weight':
        return [WEIGHTS[v] ? `font-${WEIGHTS[v]}` : `font-${arb(v)}`];
      case 'line-height':
        return [Number(v) === 1 ? 'leading-none' : `leading-${arb(v)}`];
      case 'letter-spacing':
        return [`tracking-${arb(v)}`];
    }
    return null;
  }

  /** CSS object -> { classes, style }. Nothing is dropped: no faithful utility means inline style. */
  function fromCss(css, node) {
    const classes = [];
    const style = {};
    Object.keys(css).forEach((k) => {
      const u = utility(k, css[k], css);
      if (u) classes.push(...u);
      else style[k] = css[k];
    });
    // preflight gives img max-width: 100%; the canvas never shrinks an image to its parent
    if (node && node.type === 'image') classes.push('max-w-none');
    return { classes, style };
  }

  function classesFor(node, parent) {
    return fromCss(Folio.css.nodeStyles(node, { mode: 'export', parent }), node);
  }

  // ---------- printing ----------
  const cssText = (style) => Folio.css.toCssText(style);
  const camel = (k) => k.replace(/-([a-z])/g, (m, c) => c.toUpperCase()); // -webkit-x -> WebkitX
  const jsStr = (v) => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

  function print(id, indent, jsx) {
    const E = ex();
    if (!store.get(id)) return '';
    const { tree } = E.plan(id);
    const attrs = (it) => {
      const { classes, style } = fromCss(E.stylesOf(it), it.node);
      const keys = Object.keys(style);
      let out = classes.length ? ` ${jsx ? 'className' : 'class'}="${E.esc(classes.join(' ')).replace(/"/g, '&quot;')}"` : '';
      if (keys.length) {
        out += jsx
          ? ` style={{ ${keys.map((k) => `${camel(k)}: ${jsStr(style[k])}`).join(', ')} }}`
          : ` style="${E.esc(cssText(style)).replace(/"/g, '&quot;')}"`;
      }
      return out;
    };
    // JSX folds newlines in text into spaces, so multi-line text goes in as a string expression
    const jsxText = (s) => (/[\r\n]/.test(s) ? `{${JSON.stringify(s)}}` : E.esc(s).replace(/[{}]/g, (c) => `{'${c}'}`));
    return E.printHtml(tree, attrs, indent, jsx ? jsxText : E.esc, jsx ? ' />' : '>');
  }

  const htmlFor = (id, indent = '') => print(id, indent, false);

  function componentName(n) {
    const s = String((n && n.name) || '')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9\s_-]/g, '')
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join('');
    return /^[A-Z]/.test(s) ? s : 'Component' + s;
  }

  function jsxFor(id, opts = {}) {
    const n = store.get(id);
    if (!n) return '';
    const name = opts.componentName || componentName(n);
    return `export default function ${name}() {\n  return (\n${print(id, '    ', true)}\n  );\n}\n`;
  }

  function themeFor(id) {
    const vars = ex().brandVars(id);
    const keys = Object.keys(vars);
    const theme = keys.length ? `\n\n@theme {\n${keys.map((k) => `  ${k}: ${vars[k]};`).join('\n')}\n}` : '';
    return `@import "tailwindcss";${theme}`;
  }

  function pageFor(id) {
    const n = store.get(id);
    if (!n) return '';
    const E = ex();
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${E.esc(n.name || 'Folio export')}</title>
${E.fontLinks(id)}  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3"></script>
  <style type="text/tailwindcss">
${themeFor(id)}

/* preview page only: centre the artboard on a grey page */
@layer base {
${E.RESET}
}
  </style>
</head>
<body>
${htmlFor(id, '  ')}
</body>
</html>
`;
  }

  Folio.tailwind = { classesFor, htmlFor, jsxFor, themeFor, pageFor };
})();
