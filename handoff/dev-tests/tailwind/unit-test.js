/* Folio.tailwind mapping rules, in Node. run: node .dev/tailwind/unit-test.js */
const path = require('path');
const ROOT = path.join(__dirname, '../..');
global.window = globalThis;
const mem = {};
global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k] };
global.document = { getElementById: () => null, createElement: () => ({ dataset: {} }), head: { appendChild() {} } };
window.addEventListener = () => {};
['state', 'css', 'fonts', 'brand'].forEach((f) => require(path.join(ROOT, `src/${f}.js`)));
Folio.ui = { h: () => ({}), toast: () => {} };
Folio.icons = { el: () => ({}) };
['export', 'tailwind'].forEach((f) => require(path.join(ROOT, `src/${f}.js`)));
let fails = 0;
const ok = (c, msg, extra) => { console.log((c ? '  ok   ' : '  FAIL ') + msg + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 400))); if (!c) fails++; };
const S = Folio.store, T = Folio.tailwind, B = Folio.brand;
S.newDoc();
B.init();
B.setActive(B.create(B.templates()[0]).id);

const P = (a) => (typeof a === 'number' ? [a, a, a, a] : a);
const ab = S.buildFromTree({
  type: 'frame', name: 'landing page', x: 0, y: 0, width: 1440, sizing: { w: 'fixed', h: 'hug' }, layout: { mode: 'flex', direction: 'column', gap: 24, padding: P(16) },
  style: { fills: [{ type: 'solid', color: 'var(--color-primary)' }], radius: 'var(--radius-lg)' },
  children: [
    { type: 'frame', name: 'P18', width: 13, height: 40, layout: { mode: 'flex', padding: P(18) } },
    { type: 'frame', name: 'P17', width: 100, height: 40, layout: { mode: 'flex', padding: [8, 12, 8, 12] }, style: { border: { width: 1, color: 'var(--color-primary)', style: 'solid' }, shadows: [{ x: 0, y: 10, blur: 28, spread: -6, color: '#6d5efc80' }] } },
    { type: 'frame', name: 'PX', width: 100, height: 40, layout: { mode: 'flex', padding: [0, 12, 0, 12] }, style: { radius: [16, 0, 7, 3], border: { width: 2, color: '#e4e4ea', style: 'dashed' }, opacity: 0.5, blur: 4, rotation: 12 } },
    { type: 'frame', name: 'Grad', width: 100, height: 40, layout: { mode: 'flex', padding: P(17) }, style: { fills: [{ type: 'linear', angle: 90, stops: [{ color: 'var(--color-accent)', pos: 0 }, { color: '#fff', pos: 100 }] }], radius: 9999 } },
    { type: 'frame', name: 'Free', width: 300, height: 200, layout: { mode: 'none' }, children: [
      { type: 'frame', name: 'Abs', x: -18, y: 7, width: 20, height: 20, style: { adjust: { saturate: 140, grayscale: 20 }, backdropBlur: 12, backdropSaturate: 180 } },
    ] },
    { type: 'text', name: 'Heading', sizing: { w: 'fill', h: 'hug' }, text: { content: 'Hi {there} <b> & co', font: 'var(--font-heading)', size: 20, weight: 700, lineHeight: 1, color: 'var(--color-text)' } },
    { type: 'text', name: 'Odd', text: { content: 'line one\nline two', font: 'DM Sans', size: 21, weight: 450, lineHeight: 1.2, letterSpacing: -0.02, color: '#334155', align: 'center', transform: 'uppercase', italic: true, decoration: 'underline' } },
    { type: 'text', name: 'Thirty', text: { content: 'x', font: 'Inter', size: 30, weight: 300, lineHeight: 1.5, color: '#000' } },
    { type: 'image', name: 'Photo', width: 120, height: 80, image: { src: 'https://example.com/a.png', fit: 'contain' } },
  ],
});
S.commit('setup');
const by = (n) => Object.values(S.doc.nodes).find((x) => x.name === n);
const cf = (n) => T.classesFor(by(n));
const has = (n, ...cls) => { const c = cf(n).classes; const miss = cls.filter((x) => !c.includes(x)); ok(!miss.length, `${n}: ${cls.join(' ')}`, { miss, got: c }); };
const hasnt = (n, ...cls) => { const c = cf(n).classes; ok(cls.every((x) => !c.includes(x)), `${n}: no ${cls.join(' ')}`, c); };

// spacing / size
has('landing page', 'p-4', 'gap-6', 'flex', 'flex-col', 'bg-primary', 'rounded-lg', 'relative', 'w-360', 'h-auto');
has('P18', 'p-4.5', 'w-[13px]', 'h-10', 'shrink-0');
has('P17', 'py-2', 'px-3', 'border', 'border-primary', 'shadow-[0px_10px_28px_-6px_#6d5efc80]');
has('PX', 'px-3', 'rounded-tl-[16px]', 'rounded-br-[7px]', 'rounded-bl-[3px]', 'border-[2px]', 'border-dashed', 'border-[#e4e4ea]', 'opacity-50', 'blur-[4px]', 'rotate-12');
hasnt('PX', 'py-0', 'rounded-tr-[0px]');
has('Grad', 'p-[17px]', 'rounded-full');
ok(/linear-gradient\(90deg, var\(--color-accent\)/.test(cf('Grad').style['background-image']) && !cf('Grad').classes.some((c) => c.startsWith('bg-')), 'gradient stays inline', cf('Grad'));
has('Abs', 'absolute', '-left-4.5', 'top-[7px]', 'backdrop-blur-[12px]', 'backdrop-saturate-180');
ok(cf('Abs').style.filter === 'saturate(140%) grayscale(20%)' && !('-webkit-backdrop-filter' in cf('Abs').style), 'filters out of Tailwind order stay inline; webkit prefix dropped', cf('Abs').style);
// text
has('Heading', 'font-heading', 'text-xl', 'leading-none', 'font-bold', 'text-text', 'self-stretch', 'm-0', 'whitespace-pre-wrap', '[overflow-wrap:break-word]');
has('Odd', "font-['DM_Sans',system-ui,sans-serif]", 'text-[21px]', 'font-[450]', 'leading-[1.2]', 'tracking-[-0.02em]', 'text-[#334155]', 'text-center', 'uppercase', 'italic', 'underline', 'w-max');
has('Thirty', 'text-3xl', 'font-light', 'leading-[1.5]');
has('Photo', 'block', 'object-contain', 'max-w-none', 'w-30', 'h-20');
ok(Object.values(S.doc.nodes).every((n) => !T.classesFor(n).classes.includes('box-sizing') && !('box-sizing' in T.classesFor(n).style)), 'box-sizing omitted (preflight)');
// nothing dropped: every declaration is a class or inline style
ok(Object.values(S.doc.nodes).every((n) => { const r = T.classesFor(n); return Object.keys(Folio.css.nodeStyles(n, { mode: 'export' })).filter((k) => k !== 'box-sizing' && !(k in r.style)).length <= r.classes.length; }), 'no declaration lost');

// theme: only the variables used
const theme = T.themeFor(ab.id);
ok(theme.startsWith('@import "tailwindcss";') && /--color-primary:/.test(theme) && /--color-accent:/.test(theme) && /--radius-lg: \d+px/.test(theme) && /--font-heading:/.test(theme), 'theme has the used variables', theme);
ok(!/--color-secondary|--radius-sm|--font-body/.test(theme), 'theme leaves unused variables out');
ok(T.themeFor(by('Thirty').id) === '@import "tailwindcss";', 'no tokens → just the import');

// HTML
const html = T.htmlFor(ab.id);
ok(/<p class="[^"]*">Hi \{there\} &lt;b&gt; &amp; co<\/p>/.test(html), 'HTML escapes text');
ok(/style="background-image: linear-gradient/.test(html) && /<img class="[^"]*" src="https:\/\/example.com\/a.png" alt="Photo">/.test(html), 'HTML inline style + img');

// JSX
const jsx = T.jsxFor(ab.id);
ok(/^export default function LandingPage\(\) \{\n  return \(\n    <div className="/.test(jsx) && /\n  \);\n\}\n$/.test(jsx), 'JSX component wrapper + PascalCase name', jsx.slice(0, 120));
ok(!/ class="/.test(jsx), 'JSX uses className only');
ok(jsx.includes(">Hi {'{'}there{'}'} &lt;b&gt; &amp; co</p>"), 'JSX escapes { } < >');
ok(jsx.includes('>{"line one\\nline two"}</'), 'JSX keeps newlines as a string expression');
ok(/style=\{\{ backgroundImage: 'linear-gradient\(90deg, var\(--color-accent\) 0%, #fff 100%\)', backgroundSize: '100% 100%'/.test(jsx), 'JSX style={{ camelCase }}');
ok(/<img className="[^"]*" src="https:\/\/example.com\/a.png" alt="Photo" \/>/.test(jsx), 'JSX self-closing img');
ok(/export default function Hero\(\)/.test(T.jsxFor(ab.id, { componentName: 'Hero' })), 'componentName option');
ok(/function Component3Cards\(\)/.test(T.jsxFor(S.buildFromTree({ type: 'frame', name: '3 cards', x: 0, y: 900, width: 10, height: 10 }).id)), 'name starting with a digit');
ok(/WebkitBackdropFilter|filter: 'saturate/.test(T.jsxFor(by('Abs').id)), 'JSX inline filter');

// page
const page = T.pageFor(ab.id);
ok(page.includes('<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3"></script>') && /<style type="text\/tailwindcss">\n@import "tailwindcss";\n\n@theme static \{/.test(page) && /fonts\.googleapis\.com/.test(page), 'pageFor: script, theme, fonts');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
