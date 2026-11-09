# Research: turning React/JSX into Folio layers without a build step

Issue #5 (blocks #9). Researched 2026-11-09 against `main` @ 1329c06. Nothing in the app was changed.

## In plain words

Folio can already turn HTML into layers. React code is not HTML, so it has to be translated first. JSX made
of fixed markup can be translated as plain text, safely and in about 120 lines of our own code, with no
library. JSX that computes things (`.map()` lists, props, `{expressions}`) can only be translated by
**running** the pasted code, and running someone else's code is a security decision. Tailwind classes are the
easier part: Tailwind's own compiler turns class names into CSS without running any of the user's code, so
the import iframe never has to allow scripts.

## The real fault line: read the code, or run it?

| | **Tier A: static JSX (read only)** | **Tier B: dynamic JSX (must execute)** |
|---|---|---|
| Covers | elements, fragments, string/number attributes, `className`, `style={{ k: 'v', n: 8 }}`, text, `{"literal"}`, `{/* comments */}`, entities, self-closing tags, the `export default function X() { return (…) }` wrapper | `items.map(…)`, `{cond && …}`, props passed into same-file components, template strings with `${}`, spread props, hooks (`useState` with an initial value) |
| Runs pasted code? | No. Text in, text out. | Yes |
| Where it can run | Folio's own page, next to `src/import.js`. No security change. | Only in an opaque-origin sandbox: `<iframe sandbox="allow-scripts">` **without** `allow-same-origin`, with a CSP `<meta>` blocking network, a stub `React.createElement` that builds an HTML string, `postMessage` back, a source check, then the existing sanitiser |
| Folio's own `export_code` `tailwind-react` output | **Round-trips fully** (proof of concept below) | Not needed for it |

Everything below hangs off this split. Every transformer library in option (2) only gets you from Tier A
to Tier B if you are also willing to execute the result. A transformer turns JSX into
`React.createElement(…)` **JavaScript**, and that JavaScript still has to run to produce markup.

## Options table

Sizes are from `npm pack` of each package into a scratch directory (not the repo); "gz" is `gzip -9`.

| # | Approach | Size Folio would load | License | Subset supported | Loads from a classic `<script>` / no bundling? | Risks |
|---|---|---|---|---|---|---|
| 0 | **No code: Claude is the transform.** In Claude Code, Claude reads the component and calls `import_html`, or renders it with the user's own `react-dom/server` + their Tailwind build and imports the result | 0 | n/a | Anything the user's project can render | n/a | Only over Claude Code / in-app chat, not plain paste. `import_url` refuses loopback addresses (SPEC.md:503-504), so a local dev server can't be fetched directly. Client-rendered pages import nearly empty (`src/ai-prompt.js:769`) |
| 1 | **Hand-written static JSX → HTML** (Tier A) | ~120 lines in Folio, 0 deps | ours | Tier A, exactly. Unknown `{expr}` / spreads / handlers are dropped with a warning; capitalised components become `<div>` with a warning | yes (it is Folio code) | Edge cases in JSX whitespace and React's style rules (see "traps"). No lists or props. |
| 2a | acorn 8.19.0 + acorn-jsx 5.3.2 (parser only) | 247 KB + 16 KB raw / 58 KB + 4 KB gz | MIT + MIT | Full JSX **syntax** as an AST. Interpreting the AST is still Tier A unless you build a JS interpreter | acorn: UMD global `acorn`. acorn-jsx: CommonJS only (`require('./xhtml')`, `require("acorn")`), needs a shim or jsDelivr `+esm` (11.9 KB) | Gives a correct parser, not a renderer. Only worth it if the hand parser keeps breaking on real-world code |
| 2b | sucrase 3.35.1 | jsDelivr `+esm` 186 KB, plus `ts-interface-checker` 39 KB, `gen-mapping` 3.6 KB, `lines-and-columns` 1.3 KB, plus 2 more not measured | MIT | JSX + TypeScript → JS (Tier B once executed) | No browser build in the package (`dist/` is CommonJS, `package.json` has no `browser` field). Works via `import()` of jsDelivr `+esm` | Many CDN requests. Execution needed |
| 2c | @babel/standalone 8.1.1 | `babel.min.js` 2.37 MB / 550 KB gz | MIT | Everything | yes: UMD global `Babel` | Heaviest JS option. Execution needed |
| 2d | esbuild-wasm 0.28.2 | `browser.min.js` 54 KB + `esbuild.wasm` 14.0 MB / 3.7 MB gz | MIT | Everything, plus bundling | `browser.min.js` is a classic script; needs the `.wasm` fetched | 14 MB download. Execution needed |
| 2e | TypeScript 5.9.3 (`lib/typescript.js`) | 9.1 MB / 1.6 MB gz | Apache-2.0 | Everything | yes (global `ts`) | Too big for the app; fine as a dev-test parser (already used by `handoff/dev-tests/tailwind/jsx-parse-check.js`). TypeScript 7.x on npm is the native port with per-platform binaries, so it has no browser build |
| 2f | htm 3.1.1 | 1.4 KB | Apache-2.0 | **Not JSX.** It parses tagged templates (`html\`<div ${x}>\``), using `${}` and not `{}` (its README, lines 14 and 275) | yes (UMD) | Would need the user's paste rewritten first, which is the problem we are trying to solve |
| 3 | **Node MCP bridge** (`mcp/folio-mcp.js`) | 0 for the app; a vendored transformer in the bridge | n/a | Same as whichever transformer is vendored | n/a | Node cannot parse JSX: `node t.jsx` → `SyntaxError: Unexpected token '<'` on v22.23.0, and Node's TypeScript docs say "`.tsx` files are unsupported". The bridge is zero-dependency, so it would need vendoring too. **Executing** the result there is code execution on the user's laptop: Node's docs say "The `node:vm` module is not a security mechanism. Do not use it to run untrusted code." Only serves the Claude Code path, not in-app paste |

Loading pattern. Folio already loads pinned third-party code at runtime without a build step:
`html-to-image@1.11.11` by classic `<script>` (`index.html:45`), and the Anthropic SDK by dynamic `import()`
of jsDelivr `+esm` with esm.sh as a fallback (`src/ai.js:26-27`). Dynamic `import()` works inside a classic
script, so it also sidesteps the CommonJS shim question for acorn-jsx and sucrase. The cost: HTML paste works
offline today; anything loaded from a CDN will not.

## Tailwind: giving classes real computed styles

**Finding: Tailwind's compiler needs no DOM and runs none of the user's code.** `tailwindcss@4.3.3`
`dist/lib.js` has no `require`s and exports `compile`. `compile('@import "tailwindcss";', { loadStylesheet })`
followed by `.build(classList)` turned all **230/230** distinct classes in the three demo artboards'
`jsxFor` output into CSS, each checked on its own with a fresh compiler, in about 15 ms in Node. The input is a
list of class-name strings; the output is CSS text. So the CSS can be built **outside** the import iframe and
injected into the sanitised markup as a `<style>`. The iframe keeps `sandbox="allow-same-origin"` with no
`allow-scripts` (`src/import.js:83`).

| Option | How | Verdict |
|---|---|---|
| T1: inject `@tailwindcss/browser` into the import iframe | Add a `<script>` to the iframe | **No.** The browser build has no API: on load it scans `document.querySelectorAll("[class]")`, watches the document with a `MutationObserver` and appends a `<style>` to `document.head` (end of `dist/index.global.js`). So it must run inside the page it styles, which needs `allow-scripts`. The import iframe is same-origin (it needs `allow-same-origin` so Folio can read `getComputedStyle`), and MDN: combining the two "lets the embedded document remove the `sandbox` attribute — making it no more secure than not using the `sandbox` attribute at all." The sanitiser drops `<script>`, but `allow-scripts` would turn every sanitiser gap into script running with Folio's origin (the API key in `localStorage`, the document) |
| T2: run `@tailwindcss/browser` in a **separate** opaque iframe (`sandbox="allow-scripts"` only), send it the markup, read the CSS back via `postMessage` | Two iframes | Works and is safe (MDN: without `allow-same-origin` the frame is "a special origin that always fails the same-origin policy"), but more moving parts than T3 for the same output |
| **T3: core `compile()` in Folio's page, inject the CSS** | Lazy `import('https://cdn.jsdelivr.net/npm/tailwindcss@4.3.3/+esm')` (286 KB, about 75 KB gz; checked: HTTP 200, no further imports), `loadStylesheet` fetches `tailwindcss@4.3.3/index.css` (29.8 KB / 7.9 KB gz; it has no `@import`s, so it is the only stylesheet), collect classes from the converted markup, `build()`, prepend `<style>` to the HTML handed to `fromHtml` | **Recommended.** Only Tailwind's own code runs, on strings. Same version pin as the export's preview page (`src/tailwind.js:266`), so export and import agree |
| T4: a reverse map in `src/tailwind.js` | Invert the export tables | **No.** `src/tailwind.js` only maps CSS → class. A reverse map would cover Folio's own output but must re-implement the v4 spacing scale, named sizes, the ~240-entry oklch palette, variants and arbitrary-value parsing to handle real code, for a weaker result than a ~75 KB gz compiler |
| T5: compile in the Node bridge | Vendor `tailwindcss` into `mcp/` | Works (the probe ran in Node) but only for Claude Code, and breaks the bridge's zero-dependency rule. No advantage over T3 |

Two details that matter for round-trip and for real components:

- **Brand tokens need the theme.** `bg-primary`, `font-heading` produce **no** rule without the `@theme`
  block, and `rounded-md` silently falls back to Tailwind's default (`--radius-md: 0.375rem`) where the brand
  says 10px. Probe result: without `@theme`, no `.bg-primary` / `.font-heading`; with it, both present and
  `--radius-md: 10px`. So the compile input should be `Folio.tailwind.themeFor`-style `@theme static { … }` built
  from the active brand, plus any `@theme` the user pasted.
- **Preflight on.** Folio's export assumes preflight (`m-0` on text, `max-w-none` on images, no
  `box-sizing`), and so do real React + Tailwind projects. `@import "tailwindcss"` includes it (the probe's
  output contains `box-sizing: border-box`).

Security note on T3. The compiler sees only class strings. Arbitrary values such as `bg-[url(https://…)]`
can make the iframe fetch a URL. Today's importer already keeps `<link rel="stylesheet">` and inline styles
(`src/import.js:23`), so this adds no new network exposure (not tested beyond reading the code; see
Unconfirmed).

## Recommendation

1. **Build Tier A + T3.** Add `Folio.importer.fromJsx(src, opts)` = static JSX → HTML (≈120 lines, no
   deps) → collect classes → lazy-loaded Tailwind `compile()` with the brand `@theme` → `<style>` + HTML →
   the existing `fromHtml`. It runs no pasted code, needs no sandbox change, and round-trips Folio's own
   `export_code` `tailwind-react` output (markup proven below; the full pipeline to identical layers is not
   yet tested). Expressions it can't read become warnings ("Dropped `{items.map(…)}`; paste the rendered HTML
   or ask Claude"), shown in the existing warnings summary. Skip the Tailwind step when the markup has no
   `class`.
2. **For dynamic JSX, lean on option 0 first.** Claude (in-app or Claude Code) is already a JSX → HTML
   translator, and in Claude Code it can render with the user's real toolchain. A prompt line in the
   `import_html` guidance costs nothing.
3. **Only if #9 really needs pasted `.map()`/props without Claude:** Tier B with sucrase via `+esm`, run in
   an opaque `sandbox="allow-scripts"` iframe with a CSP and a timeout, output through the sanitiser. Treat it
   as its own security review.
4. If a new AI tool is added (`import_jsx`), it goes at the **end** of the tool list (`src/ai-prompt.js` is
   append-only for prompt caching). Possibly unnecessary: `import_html` could accept JSX and sniff for
   `className=`.

Traps for whoever builds Tier A (the proof of concept handles each, but carries only a subset of the unitless
list and of the SVG attribute map):
- React appends `px` to unitless numbers except a fixed set (71 names in React's
  `packages/react-dom-bindings/src/shared/isUnitlessNumber.js`: `lineHeight`, `opacity`, `flex`, `zIndex`,
  `fontWeight`, `strokeWidth`, …). `margin: 8` is `8px`, `lineHeight: 1.4` stays `1.4`. Copy the full list.
- Vendor-prefixed keys: `WebkitBackdropFilter` → `-webkit-backdrop-filter`. Custom properties (`'--x'`) keep their name.
- JSX whitespace: lines are trimmed and joined with one space, empty lines dropped, but a space before an
  inline `{expr}` on the same line is kept.
- Attribute names: `className` → `class`, `htmlFor` → `for`, and camelCase SVG attributes (`strokeWidth`,
  `fillRule`, …) need React's attribute map for inline `<svg>`.
- `{"a\nb"}` is how Folio exports multi-line text (`src/tailwind.js` `jsxText`); keep the newline.

## Evidence: proof of concept (scratch only, not committed as code)

Oracle: for every demo artboard, `jsx2html(Folio.tailwind.jsxFor(id))` must equal `Folio.tailwind.htmlFor(id)`
(whitespace between tags ignored). Run in Node with the same harness as
`handoff/dev-tests/tailwind/jsx-parse-check.js`.

```
ok   Desktop — Landing (13413 chars)
ok   Instagram Post (3401 chars)
ok   Mobile — Wallet (11978 chars)
converter lines (non-blank, excl. checks): 120
```

Plus asserts for the rules round-trip does not hit: unitless numbers and prefixes, whitespace, fragments and
comments, a dropped `.map()`, a component kept as `<div>` with its `onClick` dropped, boolean attributes, and a
dropped template string. It never calls `eval`/`Function`.

<details><summary>Converter source (~125 lines, for whoever picks up #9)</summary>

```js
// ---------------- converter ----------------
const UNITLESS = new Set(['animationIterationCount', 'aspectRatio', 'flex', 'flexGrow', 'flexShrink', 'fontWeight', 'lineHeight', 'opacity', 'order', 'orphans', 'scale', 'tabSize', 'widows', 'zIndex', 'zoom', 'fillOpacity', 'strokeOpacity', 'strokeWidth', 'gridRow', 'gridColumn', 'columnCount']); // shortcut: subset of React's isUnitlessNumber
const ATTR = { className: 'class', htmlFor: 'for', tabIndex: 'tabindex', viewBox: 'viewBox', strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', fillRule: 'fill-rule', clipRule: 'clip-rule' };
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'col', 'wbr']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const kebab = (k) => k.replace(/^(Webkit|Moz|ms)(?=[A-Z])/, (p) => '-' + p.toLowerCase()).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

function jsx2html(src, warn = () => {}) {
  let i = src.search(/<[A-Za-z>]/);
  if (i < 0) throw new Error('No JSX element found.');
  const ws = () => { while (/\s/.test(src[i])) i++; };
  const expect = (s) => { if (!src.startsWith(s, i)) throw new Error(`Expected "${s}" at ${i}`); i += s.length; };
  const name = () => { const m = /^[A-Za-z_$][\w$.:-]*/.exec(src.slice(i)); if (!m) throw new Error('Expected a name at ' + i); i += m[0].length; return m[0]; };

  // a literal value: 'str' "str" `str` (no ${}) number true/false/null {k: literal}; anything else -> undefined
  function literal() {
    ws();
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let out = '';
      i++;
      while (src[i] !== c) {
        if (i >= src.length) return skip();
        if (c === '`' && src.startsWith('${', i)) { i = src.indexOf('`', i) + 1; return skip(); } // shortcut: no nested backticks inside ${}
        if (src[i] === '\\') { const n = src[++i]; out += { n: '\n', t: '\t', r: '\r' }[n] ?? n; } else out += src[i];
        i++;
      }
      i++;
      return out;
    }
    const num = /^-?\d*\.?\d+(e-?\d+)?/i.exec(src.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    const kw = /^(true|false|null)\b/.exec(src.slice(i));
    if (kw) { i += kw[0].length; return JSON.parse(kw[0]); }
    if (c === '{') {
      i++;
      const obj = {};
      for (ws(); src[i] !== '}'; ws()) {
        let key;
        if (src[i] === '"' || src[i] === "'") key = literal();
        else { key = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))?.[0]; if (key) i += key.length; }
        if (typeof key !== 'string') return skip();
        ws(); expect(':');
        const v = literal();
        if (v === undefined) return skip(); // a computed value somewhere inside: give up on the whole object
        obj[key] = v;
        ws();
        if (src[i] === ',') i++;
      }
      i++;
      return obj;
    }
    return skip();
  }
  // skip to the end of the current {...} expression, tracking strings and nesting; returns undefined
  function skip() {
    for (let depth = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'" || c === '`') { for (i++; src[i] !== c && i < src.length; i++) if (src[i] === '\\') i++; }
      else if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') { if (depth === 0) return undefined; depth--; }
    }
  }
  function container() { // after '{', returns literal or undefined, consumes '}'
    ws();
    if (src.startsWith('/*', i)) { i = src.indexOf('*/', i) + 2; ws(); expect('}'); return ''; }
    const v = literal();
    if (v === undefined) { const start = i; skip(); warn('Dropped an expression the converter cannot read: {' + src.slice(start, i).slice(0, 40) + '}'); }
    ws(); expect('}');
    return v;
  }
  function styleText(obj) {
    return Object.entries(obj).map(([k, v]) => `${k.startsWith('--') ? k : kebab(k)}: ${typeof v === 'number' && v !== 0 && !UNITLESS.has(k) ? v + 'px' : v};`).join(' ');
  }
  function text(raw) { // React's JSX whitespace rule (cleanJSXElementLiteralChild)
    const lines = raw.split(/\r\n|\n|\r/);
    const kept = lines.map((l, n) => { if (n > 0) l = l.replace(/^[ \t]+/, ''); if (n < lines.length - 1) l = l.replace(/[ \t]+$/, ''); return l; }).filter((l) => l);
    return esc(decode(kept.join(' ')));
  }
  function element() {
    expect('<');
    if (src[i] === '>') { i++; return children('') ; } // fragment
    const tag = name();
    if (/^[A-Z]|\./.test(tag)) warn(`Component <${tag}> was not expanded; kept as a <div>.`);
    const html = /^[A-Z]|\./.test(tag) ? 'div' : tag;
    let attrs = '';
    for (ws(); src[i] !== '>' && src[i] !== '/'; ws()) {
      if (src[i] === '{') { i++; skip(); i++; warn('Dropped a {...spread} attribute.'); continue; }
      const a = name();
      ws();
      let v = true;
      if (src[i] === '=') {
        i++; ws();
        if (src[i] === '"' || src[i] === "'") { const q = src[i]; const end = src.indexOf(q, i + 1); v = decode(src.slice(i + 1, end)); i = end + 1; }
        else { expect('{'); v = container(); }
      }
      if (v === undefined || v === false || v === null || /^on[A-Z]/.test(a) || a === 'key' || a === 'ref') continue;
      const out = ATTR[a] || a;
      if (a === 'style' && typeof v === 'object') attrs += ` style="${escAttr(styleText(v))}"`;
      else attrs += v === true ? ` ${out}` : ` ${out}="${escAttr(v)}"`;
    }
    if (src[i] === '/') { expect('/>'); return VOID.has(html) ? `<${html}${attrs}>` : `<${html}${attrs}></${html}>`; }
    expect('>');
    return `<${html}${attrs}>` + children(tag) + (VOID.has(html) ? '' : `</${html}>`);
  }
  function children(tag) {
    let out = '';
    for (;;) {
      const lt = src.indexOf('<', i), br = src.indexOf('{', i);
      const stop = Math.min(lt < 0 ? Infinity : lt, br < 0 ? Infinity : br);
      if (stop === Infinity) throw new Error(`Unclosed <${tag || ''}>`);
      out += text(src.slice(i, stop));
      i = stop;
      if (src[i] === '{') { i++; const v = container(); if (typeof v === 'string' || typeof v === 'number') out += esc(v); }
      else if (src.startsWith('</', i)) { i += 2; ws(); if (tag) { const close = name(); if (close !== tag) throw new Error(`</${close}> closes <${tag}>`); } ws(); expect('>'); return out; }
      else out += element();
    }
  }
  return element();
}
```
</details>

Tailwind probe, condensed:

```js
const tw = require('tailwindcss/dist/lib.js'); // 4.3.3
const c = await tw.compile('@import "tailwindcss";', { base, loadStylesheet: async (id) => ({ path, base, content }) });
c.build(['p-21', "font-['Inter',system-ui,sans-serif]"]); // .p-21 { padding: calc(var(--spacing) * 21); } …
```

## Unconfirmed

- **Full pipeline fidelity.** Markup equality with `htmlFor` is proven. That `fromJsx` → layers matches the
  original artboard (pixel or tree compare, as `fidelity.js` does for export) is not tested.
- **T3 in a browser.** `compile()` ran in Node only. The browser path (`+esm` import plus one `index.css`
  fetch, and how long it takes) is not measured.
- **Real-world JSX.** Only Folio's own output and hand-written cases were tested. Code from v0, shadcn or
  Tailwind UI (imports, `cn(...)`, `clsx`, conditional classes) will mostly land in the "dropped" bucket. How
  much is unknown.
- **Tier B hang risk.** Whether Chrome runs an opaque sandboxed iframe in a separate process, so a
  `while(true)` in pasted code can't freeze Folio, was not checked. A Worker with `terminate()` might be safer
  but would need its own origin story.
- **sucrase total size.** The `+esm` graph has at least 6 requests; `@jridgewell/trace-mapping` and
  `sourcemap-codec` were not measured.
- **Arbitrary-value classes.** It was not checked whether any Tailwind arbitrary value can produce CSS
  beyond what the importer already accepts in pasted stylesheets (reasoned, not tested).
- **`srcdoc` origin.** That a `srcdoc` iframe with `allow-same-origin` shares Folio's origin is inferred from
  `src/import.js` reading its `contentDocument`. The HTML spec section was not fetched (MDN does not state it).

## Questions for you before #9

1. Is static JSX (what Folio itself exports, plus hand-written markup) enough for a first version, with
   lists/props going through Claude?
2. Is it OK for JSX import to need internet the first time (Tailwind loads from the CDN, like the Claude SDK)?
3. One import box that detects JSX, or a separate "Import React" entry?

## Sources

- Package tarballs via `npm pack` (versions above); LICENSE files read from each tarball.
- jsDelivr `+esm` endpoints, checked with `curl` (HTTP 200 and byte counts).
- MDN, `<iframe>`: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe (sandbox tokens, the `allow-scripts` + `allow-same-origin` warning, `about:srcdoc`).
- Node.js `vm`: https://nodejs.org/api/vm.html. Node.js TypeScript: https://nodejs.org/api/typescript.html (`.tsx` unsupported; type stripping on by default since v22.18.0 / v23.6.0).
- React `isUnitlessNumber`: https://github.com/facebook/react/blob/main/packages/react-dom-bindings/src/shared/isUnitlessNumber.js
- Folio: `src/import.js:23,83`, `src/tailwind.js`, `src/ai.js:26-27`, `index.html:45`, `src/ai-prompt.js:372,769`, `SPEC.md` "HTML import (v0.7)" and "Tailwind export (v0.10)".
