/* Every demo artboard's jsxFor output must parse as JSX (global typescript). run: NODE_PATH=$(npm root -g) node .dev/tailwind/jsx-parse-check.js */
const path = require('path');
const ts = require('typescript');
const ROOT = path.join(__dirname, '../..');
global.window = globalThis;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = { getElementById: () => null, createElement: () => ({ dataset: {} }), head: { appendChild() {} } };
window.addEventListener = () => {};
window.requestAnimationFrame = () => {};
['state', 'css', 'fonts', 'brand', 'components'].forEach((f) => require(path.join(ROOT, `src/${f}.js`)));
Folio.ui = { h: () => ({}), toast: () => {} };
Folio.icons = { el: () => ({}) };
['export', 'tailwind', 'demo'].forEach((f) => require(path.join(ROOT, `src/${f}.js`)));
Folio.demo.build();
let fails = 0;
for (const id of Folio.store.doc.roots) {
  const src = Folio.tailwind.jsxFor(id);
  const out = ts.transpileModule(src, { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.React }, fileName: 'x.tsx' });
  const errs = (out.diagnostics || []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  console.log((errs.length ? '  FAIL ' : '  ok   ') + Folio.store.get(id).name + ` (${src.length} chars)` + (errs.length ? ' ' + errs.join('; ') : ''));
  if (errs.length) fails++;
}
process.exit(fails ? 1 : 0);
