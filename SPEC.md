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
