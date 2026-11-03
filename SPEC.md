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
