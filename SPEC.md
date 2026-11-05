# Folio — architecture spec (the contract every module follows)

Folio is a browser design tool in the spirit of code-native canvases: **every layer is a real DOM
element styled with real CSS**. Plain JavaScript, no build step, no framework. Scripts are classic
`<script>` tags (NOT ES modules) loaded in the order listed in `index.html`; each file adds to the
global `window.Folio` namespace inside an IIFE. The app must work by double-clicking `index.html`
(file://) and via any static server / GitHub Pages.

## Already written (read them, don't rewrite them)
| File | Provides |
|---|---|
| `src/state.js` | `Folio.store` (document, selection, tool, viewport, history, autosave, events), `Folio.presets`, `Folio.util` |
| `src/css.js` | `Folio.css.nodeStyles(node, {mode})` → CSS object. **The single source of truth** for how a node looks, used by both the canvas renderer and the code exporter. |
| `src/fonts.js` | `Folio.fonts.list / ensure(family) / stack(family) / googleHref(families) / weightsOf(family)` |
| `src/ui.js` | `Folio.ui.h(tag, attrs, ...children)`, `Folio.ui.toast(msg, kind)`, `Folio.ui.isTyping()` |
| `src/icons.js` | `Folio.icons.svg(name)` / `Folio.icons.el(name)` — see file for names |
| `styles/base.css` | tokens (`--bg --panel --panel-2 --panel-3 --line --text --text-2 --text-3 --accent --accent-2 --accent-soft --danger --canvas --radius --font --mono`), app grid, shared classes: `.f-section .f-section__head .f-row .f-label .f-hint .f-input .f-select .f-num .f-btn(.f-btn--primary/--ghost/--icon/--danger, .is-active) .f-seg .f-swatch .f-icon` |
| `index.html` | DOM skeleton + script order |

## DOM skeleton (ids are fixed)
```
#app (CSS grid)
  header#toolbar            → toolbar.js
  aside#left-panel > #layers → layers.js
  main#canvas-viewport       → canvas.js (pan/zoom/pointer), position:relative, overflow:hidden
     #canvas-world           → render.js (nodes live here; transformed by viewport)
     #canvas-overlay         → overlay.js (selection UI in SCREEN coordinates, pointer-events:none except handles/labels)
  aside#right-panel > #inspector → inspector.js
  section#code-panel[hidden] → export.js (code view drawer)
#toast-root                  → ui.js toasts
```

## Data model (see `defaultNode` in state.js)
- `doc = { version, name, nodes: {id: node}, roots: [ids] }`. `roots` are top-level **artboards** placed on the infinite canvas by `x/y` (world px).
- Node `type`: `'frame' | 'text' | 'image'`. Rectangles and ellipses are just frames (ellipse = frame with `style.radius: 9999`, name "Ellipse"). Only frames have children.
- `x, y`: position — used for roots (world coords) and for children of **freeform** frames (`layout.mode === 'none'`, relative to the parent's padding box — i.e. CSS `left/top`, inside the border). Ignored for children of flex frames.
- `width, height` + `sizing: {w, h}` each `'fixed' | 'hug' | 'fill'`.
- `layout` (frames): `{ mode: 'none'|'flex', direction: 'row'|'column', wrap, gap, justify, align, padding:[t,r,b,l] }`.
- `style`: `fills[]`, `radius` (number or [tl,tr,br,bl]), `border{width,color,style}`, `shadows[]{x,y,blur,spread,color,inset,visible}`, `opacity` 0–1, `blur`, `backdropBlur`, `blend`, `clip` (overflow hidden), `rotation`, optional `adjust{brightness,contrast,saturate,grayscale,hue}`.
- Fill types (array order: **last = top-most**, like layers):
  - `{type:'solid', color}`
  - `{type:'linear', angle, stops:[{color,pos}]}`
  - `{type:'radial', cx, cy, stops}`
  - `{type:'conic', angle, stops}`
  - `{type:'mesh', base, spread, points:[{color,x,y}]}` (4 points)
  - `{type:'image', src, fit:'cover'|'contain'|'fill'|'tile'}`
  - `{type:'noise', opacity}` (grain)
  - every fill may have `visible:false`.
- `text` (text nodes): `{content, font, size, weight, lineHeight, letterSpacing(em), color, align, transform, italic, decoration}`.
- `image` (image nodes): `{src, fit}` — rendered as `<img>`.
- Colors are CSS strings, normally `#rrggbb` or `#rrggbbaa` (alpha) — `rgba()` also accepted.
- `visible:false` → not rendered (canvas: `display:none`; export: omitted). `locked:true` → cannot be selected/moved on canvas (still selectable in layers).

## Store usage rules
- Mutate only through store helpers: `createNode, buildFromTree, update, updateMany, remove, move, reorder, duplicate, copy, paste, wrapInFrame, select, toggleSelect, setTool, setHover, setViewport`.
- Mutators emit `'change'` immediately (live feedback). **Call `Folio.store.commit(label)` once when a gesture/edit finishes** (pointerup, input `change` event, button click). Never commit on every pointermove / `input` event.
- Events: `'change'` (doc changed), `'selection'`, `'tool'`, `'hover'`, `'viewport'`, `'history'`, `'doc'` (new/loaded doc or rename), `'saved'`.
- Viewport: `screen = world * zoom + (viewport.x, viewport.y)` relative to `#canvas-viewport`'s top-left.
- Additional cross-module events modules may emit/listen to via `Folio.store.emit/on`: `'code:toggle'` (show/hide code panel), `'zoom:fit'`.

## Module APIs (who builds what)
Each module exposes `init()` (no args, finds its own DOM by id). `main.js` calls, in order:
`Folio.render.init(); Folio.canvas.init(); Folio.inspector.init(); Folio.layers.init(); Folio.toolbar.init(); Folio.codePanel.init(); Folio.shortcuts.init();`
— each guarded (`if (Folio.x) ...`) so a missing module never crashes the app.

**Canvas agent** — `src/render.js`, `src/overlay.js`, `src/canvas.js`, `styles/canvas.css`
- `Folio.render`: `init()`, `el(id)` → the DOM element for a node, `rerender()`.
- `Folio.overlay`: `init()`, `update()`.
- `Folio.canvas`: `init()`, `zoomToFit(ids?)`, `zoomToSelection()`, `setZoom(z, screenPoint?)`, `zoomIn()`, `zoomOut()`, `screenToWorld(x,y)`, `worldToScreen(x,y)`, `centerOn(id)`, `nodeRect(id)` → world-space `{x,y,width,height}`, `startTextEdit(id)`, `placeImage(src, name)`, `createArtboard(preset)` → new root placed in free space to the right of existing artboards, selected and zoomed to.

**Inspector agent** — `src/inspector.js`, `styles/inspector.css`
- `Folio.inspector`: `init()`, `refresh()`.

**Shell agent** — `src/toolbar.js`, `src/layers.js`, `src/export.js`, `src/shortcuts.js`, `src/demo.js`, `src/main.js`, `styles/shell.css`, `README.md`
- `Folio.toolbar`, `Folio.layers`, `Folio.codePanel` (`init`, `toggle(show?)`), `Folio.exporter` (`htmlFor(id)`, `cssFor(id)`, `pageFor(id)`, `exportPng(id)`, `saveFile()`, `openFile()`), `Folio.shortcuts`, `Folio.demo.build()` (creates the starter document).

Do not edit files owned by another agent or the "already written" files. If you need something from
another module that may not exist yet, feature-detect it (`Folio.canvas && Folio.canvas.zoomToFit()`).
If you believe a shared file has a bug, work around it and report it in your final message.

## Interaction rules (canvas)
- Tools: `select` (V), `hand` (H), `frame` (F), `rect` (R), `ellipse` (O), `text` (T), `image` (I). Holding Space = temporary hand. Middle-mouse drag pans. Wheel/trackpad scroll pans; Ctrl/Cmd+wheel or pinch zooms around the cursor. Zoom range 0.02–32.
- Click selection: hit-test with `document.elementsFromPoint` on elements with `data-id`. Path = root→deepest hit. Default click selects the **direct child of the artboard** on that path (or the artboard itself when clicking its empty area/label). If the current selection's parent is on the path, select the path node at the selection's depth (sibling switching). Double-click goes one level deeper; double-clicking a text node starts editing. Cmd/Ctrl+click selects the deepest node directly. Shift+click toggles multi-select. Click empty canvas clears selection; drag on empty canvas = marquee selecting intersecting artboards (or children within the artboard under the start point).
- Drag to move (threshold 3px): visual feedback by CSS `transform: translate()` on the dragged elements; commit on pointerup. Drop target = deepest **frame** under the pointer excluding the dragged subtree (none = canvas). Freeform target → set x/y relative to it. Flex target → insert at index computed from sibling midpoints along the main axis; show an insertion line. Canvas target → becomes a root artboard. Alt/Option while dragging → duplicate.
- Resize: 8 handles on a single selection. Changing width sets `sizing.w='fixed'` (same for h). Shift keeps aspect ratio. Top/left handles also move x/y for freeform/root nodes. Show a W×H badge.
- Drawing (frame/rect/ellipse/text/image): drag a box (click = default size). Parent = deepest frame under the pointer-down point (none = new root artboard). After creating, select it and switch back to `select`. Text tool: click creates a hug text node and starts editing immediately. Image tool: opens a file picker; image becomes a data URL `image` node.
- Text editing: `contentEditable="plaintext-only"` on the rendered element; Esc or click outside commits; empty text on commit deletes the node.
- Overlay: hover outline (1px accent), selection outline + handles (white squares with accent border), artboard name labels above every root (click selects, drag moves), size badge, marquee rectangle, drop indicator. Outline sizes stay constant on screen regardless of zoom.

---

## AI designer (v0.2)

Claude designs directly on the canvas, the way coding agents drive code-native design tools over
MCP — but here the agent loop runs **in the browser** with the user's own Anthropic API key.

```
chat panel (ai.js) ──► Claude Messages API (streaming, tool use, official SDK via ESM CDN)
      ▲                         │ tool_use blocks
      │ tool_result             ▼
      └──────────── Folio.aiTools.execute(name, input) ──► Folio.store (live canvas updates)
```

### API rules (from the current Claude API docs — do not "improve" these from memory)
- SDK: `const { default: Anthropic } = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.137.0/+esm')`
  (fallback `https://esm.sh/@anthropic-ai/sdk@0.137.0`). Classic scripts may use dynamic `import()`.
  Client: `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`.
- Models (user picks; default first). Prices $/MTok input / output / cache-read:
  `claude-opus-5-5` 4 / 20 / 0.20 (default) · `claude-sonnet-5-5` 2 / 10 / 0.20 · `claude-haiku-5-5` 0.10 / 0.50 / 0.01.
  Cache writes ≈ 1.25× input price. Use the exact ids — never add date suffixes.
- Request: `client.beta.messages.stream({ model, max_tokens: 64000, system, tools, messages,
  output_config: { effort }, thinking: { type: 'adaptive', display: 'summarized' },
  cache_control: { type: 'ephemeral' } })` then `await stream.finalMessage()`.
  - Effort: user setting `low | medium | high`, default `medium` — always send it explicitly.
  - Never send `temperature`, `top_p`, `top_k`, `budget_tokens`, or `thinking: {type:'disabled'}` (all 400).
  - Never force tools: `tool_choice` stays default (`auto`). No assistant prefill.
  - Refusal fallbacks ON for Opus/Sonnet: add `betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'`.
    Haiku: omit both. Response content may contain `type:'fallback'` blocks — show a small note, keep them in history.
- Exception (per API docs): after a mid-output fallback, omit `thinking`, `redacted_thinking` and `tool_use`
  blocks that appear *before* the final `fallback` block when echoing that turn; everything else echoes normally.
- Loop: append `message.content` **unchanged** as the assistant turn (thinking blocks included — history is
  append-only; never edit or delete earlier turns). Execute every `tool_use` block, then send **all**
  `tool_result` blocks in **one** user message (`is_error: true` on failures). Stop on `end_turn`;
  on `pause_turn` re-send; on `refusal` stop and show `stop_details.explanation`; on `max_tokens` show an
  error (never run truncated tool input). Cap at 40 iterations per user message.
- Errors: use `Anthropic.AuthenticationError`, `RateLimitError`, `BadRequestError`, `APIError`,
  `APIConnectionError` (`instanceof`, most specific first) — never string-match messages.
- Caching: `system` and `tools` must be byte-stable across requests (no dates/ids in them). Volatile
  context (document outline, selection) goes in the user message text.

### Module contract
**`src/ai-prompt.js` + `src/ai-tools.js` (Tools agent)**
- `Folio.aiPrompt.system` — string. Folio's schema reference + design guidelines + workflow.
- `Folio.aiPrompt.tools` — array of Anthropic tool definitions `{name, description, input_schema}` in a fixed order.
- `Folio.aiPrompt.contextFor()` — string describing the current document (artboards: id, name, size)
  and the current selection (id, type, name, parent, a compact subtree), prepended to each user message.
- `Folio.aiTools.execute(name, input)` → `Promise<{ content, isError, summary, changedIds }>`
  - `content`: string, or an array of content blocks (text / `{type:'image', source:{type:'base64', media_type:'image/png', data}}`)
    usable directly as `tool_result.content`.
  - `summary`: short human text for the chat UI, e.g. `Created 14 layers in “Hero”`.
  - Must validate & sanitize every input (unknown types, bad colours, unknown fonts → fallback, NaN numbers,
    huge sizes, cycles) and **never throw** — return `isError: true` with a helpful message for the model.
  - Must not call `store.commit()` (the chat panel commits once per AI run = one undo step).
- Tool names (fixed): `get_document`, `get_tree`, `create_nodes`, `update_nodes`, `delete_nodes`,
  `move_nodes`, `screenshot`.
- `src/export.js` may gain a non-downloading `Folio.exporter.pngDataUrl(id, { scale, maxSize })` (refactor
  `exportPng` to share it) for the `screenshot` tool.

**`src/ai.js` + `styles/ai.css` (Chat agent)** — `Folio.ai.init()`, `Folio.ai.open()`, `Folio.ai.close()`.
- Right panel gets two tabs: **Design** (the existing `#inspector`) and **AI** (`#ai-panel`). `⌘/Ctrl+K` opens AI and focuses the prompt.
- API key setup card: password input, "Remember on this device" (localStorage `folio:ai:key`; otherwise
  sessionStorage), link to `https://console.anthropic.com/settings/keys`, plain-English note that the key
  stays in this browser and requests go straight to Anthropic and cost money on the user's account.
- Settings: model + effort (persist in localStorage `folio:ai:settings`).
- Chat: messages (user, assistant markdown-lite text, collapsible thinking summaries, tool step chips using
  `summary`, error cards), context chip ("Editing: Hero" / "New artboard"), quick-prompt chips, image
  attachments (paste / drop / pick → base64 image block in the user message), Stop button
  (`stream.abort()`), New chat, per-run cost estimate from `usage` + price table.
- While running: store flag `Folio.store.aiBusy = true` + emit `'ai:busy'`; canvas still updates live.
  At the end (success, error, or stop): `store.commit('AI: <prompt>')` once.

---

## Claude Code bridge (MCP) — use Folio with a Claude subscription

Claude Code (logged in with the user's Pro/Max subscription) drives the Folio canvas through a local
MCP server. Folio never sees any Claude credentials; Claude Code does all model calls.

```
Claude Code ──stdio MCP──► mcp/folio-mcp.js (Node ≥18, zero npm deps)
                              │  also an HTTP server on 127.0.0.1:4317 that
                              │  • serves the Folio app files (so the tab's origin is fixed)
                              │  • GET  /bridge/events?token=…  (SSE: tool calls → browser)
                              │  • POST /bridge/result?token=…  (browser → tool results)
                              ▼
                     Folio tab (src/bridge.js) ──► Folio.aiTools.execute(name, input)
```

- `mcp/folio-mcp.js`: newline-delimited JSON-RPC 2.0 MCP server over stdio implementing `initialize`
  (echo a supported `protocolVersion`, `capabilities: {tools:{}}`, `serverInfo`, `instructions` =
  `Folio.aiPrompt.system`), `notifications/initialized`, `ping`, `tools/list` (from `Folio.aiPrompt.tools`,
  `input_schema` → `inputSchema`), `tools/call` (forward to the browser, await result, convert
  content blocks: text → `{type:'text'}`, base64 image → `{type:'image', data, mimeType}`; `isError`).
  It loads `src/ai-prompt.js` with Node's `vm` (a bare `window` object) — so **ai-prompt.js must not touch
  the DOM or `Folio.store` at load time**. stdout is reserved for JSON-RPC; logs go to stderr.
- Plus one bridge-only tool `open_folio` (returns the URL; opens the browser).
- Security: random token persisted in `~/.folio/bridge.json`; `/bridge/*` requires it; listen on 127.0.0.1 only;
  no wildcard CORS. App URL: `http://localhost:4317/?bridge=<token>`.
- When a tool call arrives and no tab is connected: auto-open the URL in the default browser
  (`open` / `start` / `xdg-open`), wait up to 25 s, else return `isError` telling the user to open the URL.
- `src/bridge.js` (`Folio.bridge.init()`): if the page has `?bridge=` (or a saved token for this origin),
  connect via EventSource, execute calls sequentially, POST results, reconnect with backoff. Status pill
  (Connected / Claude is designing… / Disconnected). Mutating tool calls are committed with
  `store.commit('Claude: <tool>')` after 1.2 s of quiet (one undo step per burst).
- `.mcp.json` at the repo root registers the server for anyone who runs `claude` inside the folder.

---

## Brand kit (v0.3)

Several brand kits live in a **library** (this browser, localStorage `folio:brands:v1`). Each document
has one **active brand**, embedded as `doc.brand` (a full copy, so saved `.folio.json` files and undo
carry it). Layers **link** to brand values through real CSS variables, so editing a brand colour
updates every layer at once, and switching the document to another brand re-skins it.

### Data
```
brand = {
  id: 'b_xxxxxx', name: 'Crumb Bakery', updatedAt: 1730000000000,
  colors: [ { id: 'primary', name: 'Primary', value: '#c2410c', core: true }, ... ],
      // core ids (always present, can't be deleted): primary, on-primary, secondary, accent, background, surface, text, muted, success, danger
      // custom colours get ids like 'c_ab12' (stable; renaming changes only `name`)
  fonts:  [ { id: 'heading', name: 'Heading', family: 'Fraunces', weight: 700, core: true },
            { id: 'body',    name: 'Body',    family: 'DM Sans',  weight: 400, core: true }, ... ],
  logos:  [ { id: 'l_ab12', name: 'Logo — on light', src: 'data:image/png;base64,…' | 'https://…', width, height } ],
      // uploads: SVG kept as-is; raster resized to max 1024px longest side; ≤ 1.5 MB each
  voice:  { tagline, description, audience, tone: ['warm','playful'], useWords, avoidWords, sampleCopy },
  style:  { radius: { sm: 6, md: 12, lg: 24 }, button: 'pill'|'rounded'|'square',
            density: 'compact'|'comfortable'|'airy', shadow: 'none'|'soft'|'bold',
            gradients: [ { name, fill: <a Folio fill object, e.g. mesh/linear> } ] }
}
```

### Token references inside layers (plain strings, valid CSS)
- Colour → `"var(--color-<id>)"` anywhere a colour goes (fills, stops, mesh points, text colour, border, shadow).
- Font → `text.font = "var(--font-<id>)"` (`Folio.fonts.stack/ensure/weightsOf` already pass/resolve these).
- Corner radius → `style.radius = "var(--radius-sm|md|lg)"` (`css.js` already passes strings through).
- Logo → `image.src = "brand-logo:<logoId>"` (also allowed as an `image` fill `src`).
- CSS variables generated from a brand: `--color-<id>`, `--font-<id>` (value = `Folio.fonts.stack(family)`),
  `--radius-sm/md/lg`.

### `Folio.brand` (src/brand.js) — API used by everyone else
- `init()`: load library; sync `doc.brand` with the library (newer `updatedAt` wins; unknown brand from a
  file is added to the library); apply CSS variables to `#canvas-world`; re-apply on store `'change'`,
  `'doc'`, `'history'` (after undo/redo, write `doc.brand` back to the library if it differs).
- `library()`, `active()` (doc.brand or null), `get(id)`, `templates()` (3–5 starter kits),
  `create(fromTemplateOrPartial)`, `update(id, patch)` (deep-merge; arrays replaced; bumps updatedAt;
  writes library + doc.brand when active; emits `'brand'`; **does not commit** — callers commit),
  `remove(id)`, `duplicate(id)`, `setActive(id | null)` (copies into doc.brand; emits `'brand'`),
  `exportJson(id)`, `importJson(text)`.
- `cssVars(brand)` → `{ '--color-primary': '#c2410c', '--font-heading': '"Fraunces", Georgia, serif', ... }`
- `cssRootBlock(brand)` → `":root {\n  --color-primary: #c2410c;\n  ...\n}"` for exports.
- `isToken(value)`, `tokenOf(value)` → `{kind:'color'|'font'|'radius', id}` or null,
  `resolveColor(v)` (token → literal colour; non-token unchanged), `resolveFont(v)`, `resolveSrc(src)`
  (`brand-logo:` → logo src), `colorRef(id)` → `"var(--color-id)"`, `fontRef(id)`.
- `detach(tokenString)` replaces every use in the document with its literal value (used before deleting a custom colour/font).
- Store event `'brand'` fires whenever the active brand or its contents change.

---

## Components & variants (v0.4)

Same model as professional design tools: a **main component** lives on the canvas; **instances** are real
layers linked to it. Instances are ordinary nodes in `doc.nodes`, so rendering, export, layers and the
canvas need no special drawing code.

### Data (stored in the document → saved files and undo carry everything)
```
doc.components = { [compId]: { id: 'k_ab12', name: 'Button', mainId: '<node id>', setId: 's_ab12' | null,
                               variant: { Style: 'Primary', Size: 'M' } | {}, description: '',
                               snapshot: <tree of the main at the last propagation, see toTree> } }
doc.componentSets = { [setId]: { id, name: 'Button', frameId: '<node id of the set container frame>',
                                 props: { Style: ['Primary','Secondary','Ghost'], Size: ['S','M','L'] } } }
node.component = compId            // on the ROOT of a main component
node.instance  = { componentId }   // on the ROOT of an instance
node.sourceId  = '<main node id>'  // on every node inside an instance (root included), pointing at its counterpart in the main
```
- A component **set** is a frame (flex row, wrap, gap 24, dashed purple border, padding 24) that contains one
  main per variant. Variant mains are named like `Style=Primary, Size=M`.
- Mains usually live in an artboard called "Components" (the starter kit creates it), but any frame can become one.

### Overrides (decided by diff, not by tracking edits)
Overridable fields on instance nodes: `text.content`, `text.color`, `style.fills`, `style.border.color`,
`image.src`, `image.fit`, `visible`. The instance ROOT additionally owns `x, y, width, height, sizing, name`.
Everything else (layout, padding, gap, fonts, sizes of inner layers, radius, shadows, structure) follows the main.

**Propagation** (when a main or anything inside it changes): for each instance node, for each overridable
field: if `instanceValue !== snapshotValue` (deep-equal) it is an **override** → keep it; otherwise take the
new main value. Non-overridable fields always take the new main value. Then the snapshot is updated.
Structure: reuse instance nodes by `sourceId` (ids stay stable), create nodes for new main children, delete
nodes whose source vanished, keep main child order.

**Nested instances** (e.g. a Button instance inside the Card main): only instances whose root has no
instance-root ancestor are "direct" and get propagated from their component. Instances that sit inside
another instance's subtree ride along with the outer component (they keep `instance`, but are treated as
part of the outer instance; variant switching on them is disabled in v0.4). Propagation must run
inner-first (Button → Card main → Card instances) and must terminate (no cycles: a component may not
contain an instance of itself, directly or indirectly — refuse with a clear message).

Deleting a main (store.remove) → its instances are detached (become plain layers) with a toast; undo restores.

### `Folio.components` (src/components.js) — API
- `init()`; listens to store `'change'` (debounced ~100 ms) and propagates mains whose subtree differs
  from their snapshot. **Wrap `Folio.store.commit` so pending propagation is flushed synchronously first.**
  `flush()` is public. After `'history'` / `'doc'`, don't re-propagate needlessly (snapshots are in the doc).
- Queries: `list()`, `sets()`, `get(compId)`, `getSet(setId)`, `componentOf(nodeId)` (comp if node is a main
  root), `mainRootOf(nodeId)` (main root id if the node is a main or inside one), `instanceRootOf(nodeId)`
  (nearest ancestor-or-self with `instance`), `isDirectInstance(nodeId)`, `isOverridable(field, isRoot)`,
  `overridesOf(instanceId)` → `{ '<name path>': { 'text.content': 'Buy now', ... } }`, `pathOf(nodeId)` (name
  path relative to its instance/main root, e.g. `Content/Label`), `variantsOf(compId)`.
- Mutations (emit `'change'` + `'components'`; never commit — callers commit):
  - `create(nodeIds, { name })` → comp. One frame → becomes the main in place; several nodes or a non-frame →
    wrapped in a hug flex frame first. Refuses nodes inside an instance.
  - `createInstance(compId, { parentId, index, x, y, overrides })` → instance root id. Default placement:
    inside the selected frame, else to the right of the main. `overrides` keyed by name path:
    `{ 'Label': { text: { content: 'Buy now' } }, 'Icon': { visible: false } }` (only overridable fields applied).
  - `setOverrides(instanceId, overrides)`, `resetOverrides(instanceId, path?)`, `detach(instanceId)`.
  - Variants: `addVariant(compId, variantProps)` (creates the set if needed and duplicates the main into it),
    `combineAsVariants(compIds, { name, prop })`, `setSetProps(setId, props)`, `setVariantOf(compId, variant)`,
    `setVariant(instanceId, variantPatch)` → swaps the instance to the matching variant main, carrying
    overrides over by name path.
  - `addStarterKit()` → builds (or updates) a "Components" artboard with sets: **Button** (Style
    Primary/Secondary/Ghost × Size S/M/L), **Badge** (Tone Neutral/Accent/Success), **Card** (with a nested
    Button instance), **Input** (State Default/Focus/Error), **Nav bar**, **Avatar** (Size S/M/L). Uses brand
    tokens (`var(--color-primary)`, `var(--font-body)`, `var(--radius-md)`, …) when a brand is active, tasteful
    literals otherwise. Returns created comp ids.
- Store event `'components'` fires when the registry changes.

### UI rules (src/components-panel.js, inspector, layers, canvas)
- Left panel third tab **Components**: search, list of sets/components with live thumbnails, click = insert
  instance, drag onto canvas = place, "Add starter kit" button, per-item menu (go to main, rename, delete).
- Inspector: main → "Main component" section (name, description, variant props editor, Add variant);
  instance → "Instance" section (component name + "Go to main", variant dropdowns per prop, list of overrides
  with reset, Reset all, Detach). For nodes inside an instance, non-overridable sections are read-only with
  a hint "Edit the main component to change this".
- Layers: main = filled purple diamond icon + purple name; instance = outlined diamond; nodes inside an instance
  shown in purple-ish tint. Deleting a child inside an instance sets `visible:false` instead.
- Canvas: main component artboard label/outline in purple; instance internals are not valid drop targets;
  double-click still edits instance text (text.content is overridable).
- Shortcuts: ⌥⌘K create component, ⌥⌘B detach instance.

---

## Logo designer (v0.5)

Claude drafts logos as **SVG** (real vectors), tests them on a "Logo concepts" artboard, and saves the chosen
one to the active brand kit with automatic versions. Users can also save any selected Folio frame as a logo.

### `src/svg.js` → `Folio.svg` (shared by the AI tools and the brand panel)
- `sanitize(markup)` → `{ svg, warnings }`; throws an Error with a plain message when unusable. Parse with
  DOMParser (`image/svg+xml`). Root must be `<svg>` with a `viewBox` (add one from width/height if missing).
  Whitelist elements: svg, g, path, rect, circle, ellipse, line, polyline, polygon, text, tspan, defs,
  linearGradient, radialGradient, stop, clipPath, mask, use (internal `#id` only), title, desc.
  Whitelist presentation attributes (fill, stroke, stroke-width, stroke-linecap/linejoin, opacity, fill-opacity,
  stroke-opacity, fill-rule, clip-rule, transform, d, x, y, x1…y2, cx, cy, r, rx, ry, width, height, points,
  offset, stop-color, stop-opacity, gradientUnits, gradientTransform, font-family, font-size, font-weight,
  letter-spacing, text-anchor, dominant-baseline, clip-path, mask, id, viewBox, xmlns, href/xlink:href (only `#…`)).
  Drop everything else: scripts, `on*`, `<style>`, `style=` (convert simple style props to attributes if easy),
  foreignObject, images, external `url(...)`/hrefs. Max 200 KB input. Paint values may be colours, `none`,
  `currentColor` or internal `url(#id)`; brand tokens `var(--color-x)` are resolved to literals via `Folio.brand`.
- `embedFonts(svg)` → `Promise<svg>`: for every font-family used by `<text>`, inline a `@font-face` (font file as
  data URL, latin subset is fine) inside `<defs><style>`, so wordmarks render correctly inside `<img>`, in exports
  and in other browsers. Reuse the exporter's Google Fonts embedding code (refactor it into a shared helper rather
  than copying). On network failure: return the svg unchanged with a warning.
- `recolor(svg, fn)` → new svg where every paint (fill, stroke, stop-color) is replaced by `fn(colour)`.
- `versions(svg, brand?)` → `{ 'on-light': svg, 'on-dark': svg, 'mono': svg }`:
  on-dark maps dark paints (luminance < 0.35) to `#ffffff` (or the brand's background if the brand ground is dark)
  and keeps brand accents; mono maps every paint to one colour (brand text colour, else `#111111`).
- `toDataUrl(svg)` (`data:image/svg+xml;charset=utf-8,` + encodeURIComponent), `size(svg)` → `{width, height}` from viewBox.
- `fromNode(nodeId)` → `Promise<svg>`: a Folio frame/image as SVG (html-to-image `toSvg` with embedded fonts; or the
  image's own SVG when it already is one). Used by "Save selection as logo".
- As built: `toSvg` output is a `<foreignObject>` (which `sanitize` must drop), so `fromNode` draws real vectors
  itself — frames → rect/path (solid, linear, radial fills; radius; border; clip), text → `<text>`/`<tspan>` per
  rendered line, SVG images → nested `<svg>`; raster images, conic/mesh/noise fills and rotation are left out.
  `embedFonts(svg, warnings?)` and `fromNode(id, warnings?)` push plain-language warnings into the optional array.
  `decode(src)` → SVG text of a `data:image/svg+xml` URL (base64 or percent-encoded) or null.
  `sanitize` keeps a `<style>` only when it is nothing but `@font-face` rules with `data:` font files (what
  `embedFonts` writes), so sanitizing an embedded logo again is lossless. Font CSS comes from
  `Folio.exporter.fontFaceCss(families, text, {exact})` (shared with PNG export; `exact` cuts fonts to the text).

### Brand kit logos
- A logo may carry `version: 'on-light' | 'on-dark' | 'mono' | 'symbol'` and `group: '<id>'` linking the versions of
  one logo. `Folio.brand` accepts internally generated `data:image/svg+xml` srcs (already sanitized) via
  `addLogoSrc`; the model-facing `set_brand` keeps refusing data URLs (logos go through `save_logo`).
- Brand panel Logos section: versions of one group shown together with labels; button **Save selection as logo**
  (selected frame or image → `fromNode` → sanitize → versions → logos) and per-group **Make versions**.

### AI tools (appended at the END of the tool list)
- `draft_logo` `{ name, svg, concept }` → sanitize + embedFonts → adds a concept card to the "Logo concepts" artboard
  (created on demand, 1440 wide, hug height, flex row wrap, neutral ground): the logo large on white, the same at
  64/32/16 px tall on white and on near-black, and a caption (name + one-sentence concept). Returns the card id and
  the image node id. Claude screenshots the artboard to judge the drafts.
- `save_logo` `{ node_id | svg, name, symbol_svg? }` → adds the logo with versions (on-light, on-dark, mono, and symbol
  when given) to the active brand kit (create a minimal kit from the name if none is active, and say so). Returns the
  logo ids to use as `brand-logo:<id>`.
- Prompt: a "Logo design" section — only when the user asks; process from docs/design-principles.md §5 (brief →
  category clichés → 8–12 one-line concepts → the three most different → draft in black first → test small and
  reversed → present three with a recommendation and wait for the choice → colour + save_logo); SVG authoring rules
  (viewBox, simple geometry, few anchor points, consistent strokes, text only in fonts from the list, no effects,
  details no smaller than 1/48 of the mark); red flags; suggest a trademark search before real use.

---

## Pages (v0.6)

A document has one or more **pages** (like "Website", "Social", "Ideas"). Each page holds its own artboards.

### Data
```
doc.pages = [ { id: 'p_ab12', name: 'Page 1', roots: [ …artboard ids ], viewport?: { x, y, zoom } } ]
doc.page  = 'p_ab12'            // the page being viewed
doc.roots === <active page>.roots   // the SAME array object (invariant)
```
- `doc.roots` stays "the artboards of the current page", so every existing module (layers, canvas, zoom,
  export targets, AI outlines) keeps working on the current page unchanged.
- All nodes of all pages stay in `doc.nodes`. Components and instances work across pages (propagation already
  walks `doc.nodes`).
- Migration: a document without `pages` becomes one page "Page 1" holding all roots. New documents start with
  one page "Page 1".
- The invariant is re-established after `load`, `newDoc`, undo/redo restore (JSON.parse breaks the shared
  reference) and any page operation. Undo/redo keeps the user on the page they are viewing when it still exists.

### Store API (src/state.js)
- `pages()` → array, `currentPage()` → page, `pageOf(nodeId)` → page holding that node's root.
- `addPage(name?, { index, activate })` → page (name defaults to "Page N"), `renamePage(id, name)`,
  `removePage(id)` (refuses the last page; removes its nodes through `remove` so component rules still apply),
  `movePage(id, index)`, `duplicatePage(id)`.
- `switchPage(id)`: remembers the viewport on the page being left, rebinds `doc.roots`, clears the selection,
  emits `'page'` then `'change'`; the canvas restores the target page's viewport or zooms to fit.
- `moveToPage(rootIds, pageId)` moves artboards (roots only) to another page, placed to the right of its artboards.
- `withPage(pageId, fn)`: temporarily binds `doc.roots` to another page while `fn` runs (no `'page'` event),
  so code can create artboards on a page without switching the view.
- `ensurePage(name)` → page with that name (created at the end if missing). Used for "Components" and "Logos".
- All page operations emit `'change'` and are recorded by the next `commit()`.

### Rendering
- `render.js` renders the artboards of **all** pages; artboards of inactive pages are `display:none`, so they are
  never hit-tested or shown, but their elements exist (component thumbnails keep working).
- Screenshots / PNG export of something on another page: `Folio.exporter.pngDataUrl` temporarily shows that
  page's artboard (or the caller switches page).

### UI
- Layers tab: a **Pages** list above the layers tree (collapsible): click to switch, double-click to rename,
  "+" to add, drag to reorder, right-click: Rename, Duplicate, Delete (confirm when it has artboards).
  Right-click an artboard in layers / canvas: **Move to page ▸**. Current page highlighted.
- Shortcut: ⌥↑ / ⌥↓ (Alt+PageUp / Alt+PageDown) previous / next page.
- Components starter kit goes on the **Components** page (`ensurePage('Components')` + `withPage`), and the UI
  switches to it after the user clicks "Add starter kit". Logo drafts go on the **Logos** page.

### AI tools
- `get_document` lists all pages (id, name, artboard count, current flag) and the current page's artboards in full;
  other pages' artboards as one-line summaries.
- New tool (appended at the end) `manage_pages` `{ action: 'list'|'create'|'switch'|'rename'|'delete'|'move',
  page_id?, name?, node_ids?, index? }`. Creating artboards with `create_nodes` `parent_id: null` uses the current
  page unless `page_id` is given. Tools that touch or screenshot a node on another page switch the view to that
  page first (the user follows along) and say so in the result.
- `add_starter_kit` → Components page; `draft_logo` → Logos page.

---

## HTML import (v0.7)

Turns HTML (+CSS) into **editable Folio layers with auto layout**. Sources: pasted code or an .html file,
a selection copied from a live website, a URL (via Claude Code / the MCP bridge), the user's own code.

### `src/import.js` → `Folio.importer`
- `fromHtml(html, { width = 1440, name, baseUrl, pageId, parentId = null, x, y, selector })` →
  `Promise<{ rootId, count, warnings: [], skipped: { reason: count } }>`. Never commits (callers commit once).
- **Rendering:** a hidden `<iframe sandbox="allow-same-origin">` (no `allow-scripts`, so no script ever runs),
  `width` px wide, `srcdoc` = sanitised HTML with `<base href=baseUrl>` when given. Before loading, strip
  `<script>`, `on*` attributes, `<meta http-equiv>`, `<iframe>/<object>/<embed>/<frame>`, forms' actions,
  `javascript:` URLs. Wait for load + `document.fonts.ready` (timeout ~8 s), then read
  `getComputedStyle` + `getBoundingClientRect` for every element. Remove the iframe afterwards.
  `selector` optionally imports only the first matching element.
- **Conversion rules** (editable first, close to the original):
  - Elements with element children → frames. `display:flex` → Folio flex (direction, wrap, gap/row-gap,
    justify, align, padding). Block flow (block children stacked) → flex column; vertical margins between
    siblings become `gap` when uniform, otherwise spacer-free per-child padding approximations are fine; record
    differences ≤ 2px as acceptable. `display:grid` → flex row with wrap and the column gap (approximation,
    warn). `position:absolute/fixed` children → the parent becomes freeform for those (or wrap them) with measured x/y.
  - Sizing from measurement: a child as wide as its parent's content box → `w: fill`; text that wraps → `w: fill`
    or fixed; inline-ish / shrink-to-fit → `hug`; otherwise fixed measured px. Heights hug unless the element
    has an explicit height/min-height that differs from its content (then fixed).
  - Text: an element whose content is text (incl. inline children like `<b>`, `<a>`, `<span>`) → one text node
    with the element's computed font (first family; Google font name kept, `Folio.fonts.ensure`), size, weight,
    line-height (as multiplier), letter-spacing (em), colour, align, transform, italic, decoration. Inline styling
    differences inside the run are flattened (warn once). Mixed blocks of text + elements → text nodes for each
    text run in order.
  - Visuals: background-color → solid fill; `linear-gradient(...)` → linear fill (parse angle + stops; fall back
    to the first colour); background-image url → image fill (`fit` from background-size); border (uniform width
    + colour; else the top border), border-radius (per corner when different), box-shadow (parse each),
    opacity, `overflow:hidden` → clip, filter blur / backdrop-filter blur.
  - `<img>` / `<picture>` → image node (absolute `currentSrc`, `object-fit`); inline `<svg>` → image node with
    `Folio.svg.sanitize` → `toDataUrl`; `<video>/<canvas>` → frame placeholder with the poster/none (warn).
  - Skip: invisible (`display:none`, `visibility:hidden`, 0×0, opacity 0 with no children), `<head>` contents,
    comments. Collapse pure wrappers (no fill/border/shadow/padding/radius, one child, same box) into the child.
  - Names: `aria-label` / id / first class / tag, e.g. "header", "Button", "hero" (trimmed, ≤ 40 chars).
  - Limits: 3,000 layers (stop with a warning), 3 MB HTML.
- The import becomes a new artboard (`parentId null`, placed to the right of existing artboards on the page) named
  from `name`, `<title>` or "Imported page", width = `width`, height hug, fill = the body background.

### UI
- File menu → **Import HTML…**: a modal with a code textarea, "Open .html file", width presets
  (Desktop 1440 / Laptop 1280 / Tablet 768 / Mobile 390), optional base URL for relative links, Import button,
  progress + warnings summary. Commit once; select + zoom to the new artboard.
- **Paste from a website:** ⇧⌘V (and the `paste` event when the clipboard holds `text/html` that did not come from
  Folio) imports the clipboard HTML as layers into the selected frame (or a new artboard). Normal ⌘V keeps
  pasting Folio layers.

### AI + bridge
- Tool `import_html` `{ html, width?, name?, base_url?, page_id?, parent_id?, selector? }` → importer → returns the
  artboard id, layer count, warnings, and a short tree outline so Claude can refine it with update_nodes.
- Tool `import_url` `{ url, width?, selector? }`: handled **in mcp/folio-mcp.js (Node)**: fetch with a 15 s
  timeout, ≤ 3 MB, http(s) only, refuse private/loopback/link-local addresses (resolve DNS first), follow ≤ 5
  redirects re-checking each; then forward as `import_html` with `base_url` = final URL. In the in-app chat
  (no Node) `import_url` returns a clear error suggesting Claude Code or pasting the HTML.
- Prompt: when the user gives code, a URL to recreate, or asks to bring their site/components into Folio →
  import first, then screenshot, then clean up (rename layers, link brand tokens, make repeated parts components).
  Mention that script-built pages may import nearly empty.

---

## Effects: liquid glass, shader-style gradients, metal logos (v0.9)

Effects seen in WebGL/React libraries, rebuilt **natively** (CSS + SVG, zero dependencies) so Folio exports stay
plain HTML/CSS/SVG. Inspiration only — no code copied from those projects.

### Liquid glass (layer style)
- `style.backdropSaturate` (percent, default 100) → `backdrop-filter: blur(..) saturate(..)` alongside
  `backdropBlur` in css.js (both prefixed with `-webkit-`), round-tripped by the importer when present.
- Inspector Effects section: a **Liquid glass** preset button that applies, to the selected frames: a translucent
  linear fill (white 28% → 8%, 160°), backdropBlur 24, backdropSaturate 180, border 1px white 35%, shadows
  `inset 0 1px 0 #ffffff80`, `inset 0 -1px 0 #ffffff1a` and a soft drop `0 8 32 -8 #0f172a2e`, radius 24 (or the brand's
  radius-lg). Tinted variant for dark grounds (white 12% → 4%). Shown in the CSS preview like any style.
- Folio can't refract (bend) the backdrop portably; say so in the guide. Glass only reads over something colourful.

### Shader-style gradients (fills)
- More mesh presets in the fill editor (keep the existing 5): **Aurora**, **Dusk**, **Lagoon**, **Ember**, **Chrome**
  (base + 4 points + spread, each designed to pair with a noise fill at 0.08–0.15). A **"+ grain"** toggle on mesh
  rows adds/removes a noise fill on top.
- Brand gradient presets already exist; nothing changes there.

### Metal logo version
- `Folio.svg.versions(svg, brand)` gains `metal`: every paint becomes a shared chrome `linearGradient`
  (stops: #fdfdfd 0, #b9bec6 30, #f4f5f7 50, #5e646e 72, #d9dce1 100, at a slight angle), plus a subtle specular
  highlight via an SVG `<filter>` (feGaussianBlur → feSpecularLighting with feDistantLight → feComposite in=SourceAlpha
  → feMerge with SourceGraphic). Must still read at 32 px.
- The sanitizer whitelist adds the filter primitives this needs (filter, feGaussianBlur, feOffset,
  feSpecularLighting, feDiffuseLighting, feDistantLight, fePointLight, feComposite, feMerge, feMergeNode,
  feColorMatrix, feTurbulence, feDisplacementMap, feFlood, feBlend) with their numeric/enum attributes and
  `filter="url(#id)"` (internal ids only). **Never** feImage or anything with an href.
- Logo groups get an optional **metal** version (brand panel "Make versions" offers it; `save_logo` takes
  `metal: true`). Label "Metal". Static image — no animation.

### Claude's guide
- A short "Effects" paragraph: glass at most on one floating layer, only over a colourful ground, with the preset
  values; shader-style mesh + grain as the one rich-visual device per design; metal logo versions only when the user
  asks (they suit dark, premium contexts; never the primary logo). Animated shader backgrounds are out of scope:
  recommend pre-rendered video for motion.
## Smart guides (v0.8)

While the user **moves**, **resizes** or **draws** a layer that is positioned by x/y (artboards and children of
freeform frames — not children of auto-layout frames, whose position comes from flexbox), its edges and centre
snap to nearby edges and centres, with pink guide lines and distance labels.

- Snap candidates: the left/centre/right x and top/centre/bottom y of (a) the parent frame's inner box (padding box),
  (b) siblings in the same parent (artboards: other artboards on the page), visible and unlocked only, excluding the
  layers being dragged and their descendants. Limit to the ~60 nearest candidates for speed.
- Threshold: 6 **screen** px (divide by zoom for world units). Snap x and y independently, to the closest candidate.
  Resizing snaps only the edges being dragged (and keeps the shift aspect lock working: snap the driving edge,
  derive the other). Drawing a new frame/shape/text snaps its start point and its dragged corner.
- Hold **⌘ / Ctrl** while dragging to turn snapping off for that gesture. Snapped positions are whole pixels.
  A canvas toggle in the View/zoom menu: **Snap to layers** (on by default, remembered in localStorage).
- Guides (overlay, screen space, 1px `#ff3b8d`, crisp at any zoom): a vertical/horizontal line spanning the snapped
  layer and the layer it snapped to; small cross marks at the matched edges are a nice touch. **Distance labels**
  (pink pill, white 11px text) show the gap in px to the nearest neighbour on each side along the snapped axis, and
  to the parent edges when snapped to the parent. Guides disappear on pointerup.
- Multi-selection moves as one box (snap the union bounds). Alt-drag duplicate and reparenting keep working.
  Moves into an auto-layout frame (drop line) don't snap.
- Performance: no layout thrash during drags — measure candidate boxes once at gesture start, then pure math.

---

## Tailwind export (v0.10)

Export any artboard or layer as **Tailwind CSS v4** code, as **HTML** (`class="…"`) or a **React component**
(`className="…"`), plus the `@theme` block for the brand tokens it uses. Values are **exact**: a standard class
when it matches exactly, an arbitrary class otherwise (`p-4` for 16px, `p-4.5` for 18px, `p-[17px]` for 17px).

### `src/tailwind.js` → `Folio.tailwind`
- `classesFor(node, parent)` → `{ classes: string[], style: {prop: value} }` built from
  `Folio.css.nodeStyles(node, { mode: 'export' })` — the single source of truth — so Tailwind output can never
  drift from the canvas. Anything without a faithful utility stays in `style` (inline), never dropped.
- `htmlFor(id)`, `jsxFor(id, { componentName })`, `themeFor(id)` (`@import "tailwindcss";` + `@theme static { … }` (static: keep variables only inline styles use)
  with only the variables the subtree uses: `--color-*`, `--font-*`, `--radius-*`), `pageFor(id)` (a standalone
  preview: Google Fonts link, `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3"></script>`,
  `<style type="text/tailwindcss">` with the theme, then the HTML).
- Mapping rules (v4 semantics):
  - Spacing/size: px divisible by 2 → `<prefix>-<px/4>` (v4 accepts any multiple of 0.25rem; keep to integers and
    .5), else `<prefix>-[Npx]`. `100%` → `-full`, `fit-content` → `-fit`, `max-content` → `-max`, `auto` → `-auto`.
    Padding collapses to `p-`, `px-`/`py-`, or per side. `gap`, `left/top`, `min-w-0`.
  - Flex: `flex`, `flex-col`/`flex-row`, `flex-wrap`, `justify-*`, `items-*`, `self-stretch`, `flex-[1_1_0px]` (not `flex-1`: its 0% basis
    sizes differently in auto-height columns), `shrink-0` (omitted when a `flex` shorthand is present). Position `relative`/`absolute`.
  - Colour: brand token `var(--color-x)` → `bg-x` / `text-x` / `border-x`; literal → `bg-[#rrggbb(aa)]`.
    Gradient/mesh/noise/image backgrounds → inline style (exact CSS).
  - Radius: `var(--radius-sm|md|lg)` → `rounded-sm|md|lg` (theme overrides), 9999 → `rounded-full`, else
    `rounded-[Npx]` (per-corner `rounded-tl-[…]` etc.). Border: `border` (1px) / `border-[Npx]`, colour as above,
    non-solid style → `border-dashed|dotted|double`.
  - Effects: `shadow-[…]` (spaces → `_`), `opacity-N`, `blur-[Npx]`, `backdrop-blur-[Npx]`, `backdrop-saturate-N`,
    `mix-blend-*`, `overflow-hidden`, `rotate-N` / `rotate-[Ndeg]`.
  - Text: `font-x` for `var(--font-x)`, else `font-['Family_Name',fallbacks]` (keeps the stack); size named only on exact match (xs 12, sm 14,
    base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36, 5xl 48, 6xl 60, 7xl 72, 8xl 96, 9xl 128) else `text-[Npx]`;
    always emit `leading-[…]` (named `leading-none` for 1); `font-thin…black` for 100…900; `tracking-[…em]`;
    `text-center|right|justify`; `uppercase|lowercase|capitalize`; `italic`; `underline|line-through`;
    `whitespace-pre-wrap`; `[overflow-wrap:break-word]`; `m-0`. Omit `box-sizing` (preflight).
  - Images: `<img>` with `object-*`, `block`, `max-w-none` (undo preflight); `brand-logo:` srcs resolved like the HTML export.
- Same tags and structure as `Folio.exporter.htmlFor` (reuse its helpers where possible). JSX: `className`,
  self-closing `<img … />`, `style={{ camelCase: '…' }}`, text escaped for JSX (`{`, `}`, `<`, `>`), component name
  from the layer name in PascalCase, `export default function Name() { return (…); }`.

### UI
- Code panel: a **Tailwind** tab with an **HTML / React** switch, showing the theme block above the markup;
  Copy, Download (`.html` preview page, or `.jsx`), live updates like the other tabs. Export menu: **Tailwind (HTML)**
  and **Tailwind (React)** download entries.

### AI
- New tool `export_code` `{ node_id, format: 'html-css' | 'tailwind-html' | 'tailwind-react' }` (appended at the
  end) → the code as text (+ the theme/CSS), so Claude Code can implement a Folio design in the user's codebase.
  A short guide line: when the user asks to build a Folio design in their project, read their stack first, use
  `export_code` in the matching format, then adapt names and structure to their conventions.

---

## Prototyping (v0.11)

Wire artboards into a clickable flow, play it full-screen inside Folio, or export one HTML file to share.
In v0.11: navigate, back, open link, overlays, hover states from variants, scrolling frames.
Transitions: instant, dissolve, slide. Interactions start on click (hover comes from variants).

### Data (in the document → saved, undone, copied with the layer)
```
node.interactions = [ {
  trigger: 'click',
  action: 'navigate' | 'back' | 'url' | 'overlay' | 'close',
  target: '<artboard id>',               // navigate / overlay: an artboard on the SAME page
  url: 'https://…',                      // url: http(s):, mailto:, tel: only
  transition: { type: 'instant' | 'dissolve' | 'slide', direction: 'left'|'right'|'up'|'down', duration: 300 },
  overlay: { position: 'center'|'top'|'bottom'|'left'|'right', closeOnOutside: true, backdrop: '#0f172a66' },
} ]
node.scroll = 'none' | 'vertical' | 'horizontal' | 'both'   // frames; play/export: overflow auto on that axis
page.start = '<artboard id>' | undefined                    // start screen; default = the page's first artboard
```
- Absent fields mean "none"; omit defaults when storing. `Folio.prototype.normalize(nodeId, list)` →
  `{ interactions, warnings }` is THE validator (used by the panel and Claude's tool): drops unknown actions,
  targets that are not artboards on the node's page (or the node's own artboard for navigate), bad URLs; fills
  defaults (transition instant, duration 300 clamped 0–2000, overlay center + closeOnOutside + backdrop).
- Canvas: a scrolling frame clips like `style.clip` (content stays editable by selecting layers); play/export
  scroll it (`overflow-x/y: auto`), via `Folio.css.nodeStyles` `mode: 'play'` (export and canvas unchanged
  otherwise). The HTML/CSS and Tailwind exports also emit the overflow for scroll frames.
- Components: `interactions` and `scroll` follow the main inside instances; the instance ROOT owns its own
  `interactions` (add to `ROOT_OWN`), so each Button instance can go somewhere different.
- Deleting an artboard leaves dangling targets; they are ignored at play time and shown as "Missing screen"
  in the panel (no data rewrite, so undo stays simple).

### Hover states (no data)
In play/export, a direct instance whose component belongs to a set with a variant property that has a value
`Hover` (case-insensitive) shows that variant while the pointer is over it (same other prop values; carry the
instance's overrides by name path). Its click interactions still apply. Touch devices: no hover.

### Runtime — `src/prototype.js` → `Folio.prototype`
- `bundleFor(pageId?)` → `{ name, start, screens: { [artboardId]: { name, width, height, html, css } },
  interactions: { [nodeId]: [...] }, hovers: { [nodeId]: { html } } }`, built from `Folio.exporter` (same
  markup/CSS as the HTML export, elements carry `data-fid="<node id>"` for binding). Must not modify the
  document or history (render hover variants off-document or undo any temporary change without commit/autosave).
- `fileFor(pageId?)` → one self-contained HTML file: fonts link, the bundle as JSON, a small inline player
  script (no external JS). `play(startId?)` opens the in-app player: a full-screen `#play-root` with an
  `<iframe srcdoc>` of `fileFor` (one code path for app and export), top bar (screen name + screen menu,
  Restart, Close). `stop()`. Starting screen: the selected artboard (or the artboard holding the selection),
  else `page.start`, else the first artboard.
- Player: screen fitted to the window (scale down to fit; a screen taller than the window at its width scrolls
  vertically instead), centred on a neutral background. Navigate pushes history; Back pops (closes the top
  overlay first). Overlay: shows the target artboard on a backdrop over the visible part of the current screen, at its position, click outside (if allowed)
  or Esc closes; `close` closes the top overlay. URL: `window.open(url, '_blank', 'noopener')`.
  Transitions: CSS animations, ease-out; slide back reverses direction; `prefers-reduced-motion` → instant.
  Clicking a spot with no interaction briefly highlights the clickable layers (hint). Accessibility: clickable
  layers get `role="button"` (links `role="link"`), `tabindex="0"`, Enter/Space activate, visible focus ring.
- Toolbar: **Play** button (▶) next to Code; shortcut ⌥⌘↵ (Alt+Ctrl+Enter). Esc exits play. Export menu:
  **Prototype (HTML)** → downloads `<Page name>.prototype.html`.

### Editor — `src/prototype-panel.js` → `Folio.prototypePanel`, `styles/prototype.css`
- Right panel tabs: **Design · Prototype · AI** (tabs live in `src/ai.js` `buildTabs/setTab`; the Prototype tab
  shows `#prototype-panel` and hides the inspector). Remembered like the AI tab.
- Panel, layer selected: list of interactions, "+ Add interaction": **On click → Navigate to ▾ (artboards on
  this page) | Back | Open link | Open overlay ▾ | Close overlay**; transition (Instant / Dissolve / Slide +
  direction arrows, duration); overlay position + "Close when clicking outside"; remove. Frames: **Scroll**
  (None / Vertical / Horizontal / Both). Artboard selected: "Start screen" toggle. Nothing selected: page start
  screen dropdown, flow summary, **Play** button. Every edit goes through `normalize` + `store.update` + one
  `commit()`.
- Canvas (while the Prototype tab is open, drawn in `#canvas-overlay`, screen coordinates): curved arrows from
  each layer with navigate/overlay interactions to the target artboard's left edge (dashed for overlays);
  arrows of the selection highlighted, others faint; a "▶ Start" flag on the start artboard. A round handle on
  the selected layer's right edge: drag it onto an artboard to add (or retarget the first) navigate interaction,
  with a live arrow and the drop artboard highlighted; dropping elsewhere cancels.

### AI
- New tool `set_interactions` (appended at the end) `{ node_id, interactions?: [...] (replaces; [] clears),
  scroll?, start?: true }` → validated through `normalize`, returns the stored list + warnings. `get_tree` /
  node descriptions mention interactions (`→ Pricing (slide left)`) and scroll; `get_document` names the start screen.
- Guide lines: wire the main CTAs, nav links and back buttons; overlays for modals/menus/sheets; to get hover
  states, add a `State=Hover` variant; long content in a phone screen → a scroll frame; tell the user to press
  Play (▶) to try it.
