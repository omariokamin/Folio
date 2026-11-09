# Paper desktop app: feature scan

Read-only scan of the Paper desktop app (paper.design) installed on this laptop. The goal is to
list what Paper can do so Folio knows which features it lacks. It feeds the wayfinder map
(issue #1) and research tickets #3 (shaders), #4 (image providers) and #5 (React/JSX import), plus
the fog items "vector editing" and "pasting from Figma".

Labels used below:

- **Confirmed**: seen directly in code or data, with the file or string named.
- **Inferred**: a reasonable reading of what was seen, not proven.
- **Not found**: searched for and absent from everything available locally. That suggests the
  feature is missing, but it is not proof.

Nothing in this document is copied Paper source code. It describes behaviour in plain words and
names identifiers, MIME types and hosts only.

## Where the code lives (local vs remote)

- `/Applications/Paper.app` is **v0.5.18** (Electron, packaged by ToDesktop). The `app.asar` contains only
  `dist/main.cjs` (main process), `dist/preload.cjs`, `dist/app-bar/preload.cjs`, six app-icon PNGs
  and a Go CLI binary (`dist/cli-bin/darwin-arm64/paper`, the same file as `~/.paper/bin/paper`).
  **Confirmed** (`package.json`, file listing).
- **The editor is not shipped in the app.** The main process loads the editor from Paper's web app
  (`MAIN_APP: https://app.paper.design`) using `webContents.loadURL(url)`. When the laptop is offline
  it shows an offline HTML page from a `data:` URL instead. **Confirmed** (`dist/main.cjs`).
- What the shipped app does locally: tabs and windows, auto-update, deep links (`paper://`), Figma
  OAuth hand-off, **PDF export**, a local asset protocol (`paper-asset://`), writing MCP config for
  agent tools, and installing a Claude Desktop extension. **Confirmed** (`ipcMain` channels in `main.cjs`:
  `export-pdf`, `open-figma-oauth`, `desktop:update-mcp-config`, `desktop:install-claude-extension`,
  `desktop:get-open-files`, `tabs:*`, `check-for-updates` …).
- **Where the editor evidence comes from.** Chromium keeps an HTTP cache of the web app in
  `~/Library/Application Support/Paper/Cache/Cache_Data`. Reading it is a local, read-only step with no
  network call. The cached entries are dated **2026-11-09**. They hold the main editor chunk
  (`assets/main-DKD0SyZR.js`, 3.3 MB) and every lazy chunk it references except one
  (`assets/index-D0boMYJH.js`, not cached). So sections 1–6 describe **a cached copy of Paper's remote
  code**, not code shipped in v0.5.18. Paper can change it on the server at any time.
- The cached editor chunk includes its own dependency manifest, used to write version comments into
  copied code. The parts that matter for Folio: `@paper-design/shaders` and `@paper-design/shaders-react`
  **0.0.82**, `@paper/vector-graph`, `@paper/svg-parser`, `svg-path-parser`, `svgpath`, `kiwi-schema`,
  `fzstd`, `pako`, `mediabunny` 1.34.4, `dom-to-image-more` 3.7.2, `heic-to`, `@jsquash/avif`,
  `tailwindcss`, `prosemirror-*`, `mobx`, `react`, and a forked `opentype.js`. **Confirmed**.

## 1. Shaders and effects

- **The shader catalogue has 30 shader layer types**, each a component with id `Shader<Name>` and its
  own parameter panels: ColorPanels, Dithering, DotGrid, DotOrbit, FlutedGlass, GemSmoke, GodRays,
  GrainGradient, HalftoneCmyk, HalftoneDots, Heatmap, ImageDithering, LensDistortion, LiquidMetal,
  MeshGradient, Metaballs, NeuroNoise, PaperTexture, PerlinNoise, PulsingBorder, SimplexNoise,
  SmokeRing, Spiral, StaticMeshGradient, StaticRadialGradient, Swirl, Voronoi, Warp, Water, Waves.
  **Confirmed** (`specifierName` values in `assets/fills-*.js`; matching thumbnails at
  `app.paper.design/static/shaders/<name>.webp` in the cache).
- Shaders sit in a "Shaders" tool and menu (`shaderTool`, `shadersMenuVisible`). Some shaders take an
  image input; default sample images come from `shaders.paper.design`. **Confirmed**.
- **Is `@paper-design/shaders` bundled?** Not in the desktop app. It is compiled into the remote
  `fills-*.js` chunk at version **0.0.82** (from the dependency manifest). There is **no license file**
  for it anywhere local, in the asar or in the cache. **Not found**. Ticket #3 should take the license
  from the npm package itself and not from this scan.
- Each shader renders into a WebGL `<canvas>` (it sets WebGL context attributes). Before a layer is
  cloned or unmounted, Paper reads the shader's current animation frame and saves it as a `frame` prop
  without adding an undo step. **Confirmed** (`paperShaderMount.getCurrentFrame()` in `fills-*.js`).
  Why it does this (likely so that static exports and copies show the same moment) is **inferred**.
- **How a shader layer is exported:**
  - *Code (Copy as React / Tailwind, MCP `get_jsx`)*: the layer becomes a JSX element that imports
    the named component from `@paper-design/shaders-react`, with a version comment
    (`/** @paper-design/shaders-react@0.0.82 */`) and the layer's props. In copied code, a shader stays
    a live React component. **Confirmed** (`generateJsx: {importSource: '@paper-design/shaders-react',
    specifier: 'named', type: 'custom'}` per shader, and the import-header builder in `main-*.js`).
  - *PNG / JPG / WebP / AVIF*: raster capture of the DOM, so the canvas pixels are drawn in.
    **Inferred** (the copy-as-PNG path draws per-node bitmaps onto a 2D canvas; the shader-specific
    step was not traced).
  - *PDF*: the node's DOM is cloned, each `<canvas>` (shaders included) is swapped for a PNG
    `<img>` from `canvas.toBlob`, CSS gradients and repeating backgrounds are rasterized, then Desktop
    prints the result to PDF. **Confirmed** (`assets/pdf-*.js`).
  - *Video (MP4/WebM)*: shaders animate frame by frame (see section 4). **Inferred** for shaders
    specifically.
  - *Plain HTML/CSS export of a shader*: **Not found**. Paper has no "Copy as HTML", and no CSS-only
    version of a shader exists.
- Separate from shaders: the app-icon options `halftone`, `pattern`, `dots` and `gooey` in `main.cjs`
  are only Dock icon choices, not effects.

## 2. Image generation

- **Image generation goes through Paper's backend.** The client sends a POST to
  `${WORKERS}${apiEndpoint}`, where WORKERS is `https://workers.paper.design` and the endpoints are
  `/gen-image/*`. It sends credentials, an `X-FileId` header, and a JSON body with the model id, the
  prompt and any image prompt URLs. Each call is charged in "mana" against a meter
  (`workers.paper.design/meter/balance`). No provider API hosts appear anywhere in the renderer.
  **Confirmed** (`main-*.js`, `fills-*.js`, `MCPHandlers-*.js`). No keys appear on the client side.
- Endpoints seen: `openai`, `openai-edit`, `google-nano-banana(-edit)`, `nano-banana-pro(-edit)`,
  `flux-pro`, `flux-pro-ultra`, `flux-pro-edit`, `xai`, `xai-edit`, `seedream`, `ideogram`, `imagen(-edit)`,
  `recraft`, `recraft-svg`, `recraft-vectorize`, `quiver-arrow-stream`. **Confirmed**.
- **Active models (the registry has `active: true`)**, as label → `providerModelId`:
  - Text-to-image: OpenAI Image 2.6 / 2.6 Big / 2.6 GIF (`gpt-image-2.6-flare`, `gpt-image-2.6-sunburst`),
    Nano Banana 2.1 (`google/nano-banana-2.1`), Nano Banana Pro (`google/nano-banana-pro`),
    Flux 2 Pro (`black-forest-labs/flux-2-pro`), Grok (`grok-imagine-image-2.0`),
    Recraft V4.1 (`recraft-ai/recraft-v4.1`), Ideogram v3 (`ideogram-ai/ideogram-v3-balanced`),
    Seedream 4.5 (`bytedance/seedream-4.5`).
  - SVG generation: QuiverAI Arrow 2 and Arrow 2 Telos (`arrow-2`, `arrow-2-telos`).
  - Image edit (image-to-image): OpenAI Image 2.6 (+Big), Nano Banana 2.1, Flux 2 Pro, Grok, Nano Banana Pro,
    QuiverAI Arrow 2 (+Telos) for SVG edits.
  - "Vectorize image" (raster → SVG): Recraft `v1/images/vectorize`.
  - Default "variety pack" sets: text-to-image uses OpenAI 2.6, Grok, Nano Banana 2.1 and Seedream 4.5;
    edit uses OpenAI edit 2.6, Nano Banana 2.1, Flux 2 Pro edit and Grok edit.
  - Retired models (`active: false`) are still listed: gpt-image-1/1.5/2/2.5, Imagen 3/4,
    Flux 1.1 Pro (Ultra), Recraft V3 / V3 SVG, Nano Banana / 2, QuiverAI Arrow 1.1 Max.
  - **Confirmed** (model registry objects in `fills-*.js`, with copies in `main-*.js` and `MCPHandlers-*.js`).
- **Which upstream vendor serves each model is inferred.** It is read only from the `owner/model`
  slugs (`black-forest-labs/…`, `google/…`, `bytedance/…`, `recraft-ai/…`, `ideogram-ai/…`). The
  client never shows which aggregator or provider the backend calls.
- Related: SVG generation runs inside the code-import chunk and can take selected SVG nodes and image
  fills as prompt sources. Uploaded images get an AI label and description from a backend call.
  **Confirmed** (`code-import-*.js`, `main-*.js`).

## 3. Import

- **Paste classifier.** On paste or drop, Paper checks the clipboard in this order (**Confirmed**,
  `main-*.js`):
  1. `text/plain` that is an SVG document (starts with `<svg`/`<?xml`, ends with `</svg>`, has shape
     tags). It is wrapped as a `pasted.svg` file.
  2. Any `image/*` clipboard items or dropped files (`Files`).
  3. `text/html` carrying Paper **design tokens**. These are pasted as tokens.
  4. `text/html` with Paper's own copy payload, an HTML comment
     `<!--<paper-paste-start data-embed="…JSON tree…"></paper-paste-start>-->`. The JSON is parsed
     and checked against a schema.
  5. `text/html` containing `!--(figma)` → **Figma import**.
  6. `text/html` wrapped in `<x-paper-html>…</x-paper-html>` → HTML import.
  7. `text/plain` that looks like HTML markup → HTML import.
  8. Anything else → plain text.
  It also reads `text/uri-list`.
- **Figma paste.** **Confirmed** end to end (`assets/parse-figma-*.js`, `main-*.js`):
  - The code finds `<!--(figmeta)…(/figmeta)-->` and `<!--(figma)…(/figma)-->` in the HTML and first
    un-escapes `&lt;`/`&gt;`. It base64-decodes both and refuses blocks over 64 MB. The `figmeta`
    block is JSON.
  - The `figma` block is a binary archive. Its first 8 bytes are `fig-kiwi` (or `fig-jam.` for
    FigJam), followed by a version number and length-prefixed chunks. Chunk 0 is the compressed
    **kiwi schema** and chunk 1 is the compressed message, each raw-deflate with a zstd fallback. The
    message decodes into `nodeChanges`, `blobs` and `pasteFileKey`, which are rebuilt into a node
    tree.
  - Vector-type nodes (VECTOR, BOOLEAN_OPERATION, ELLIPSE, STAR, REGULAR_POLYGON, LINE) keep their
    `fillGeometry`, `strokeGeometry`, `vectorData`, `arcData` and `booleanOperation`. Simple shapes are
    flattened where possible, and component properties and variable modes are resolved (**inferred** from the type sets and `activeModes`/prop-alias handling; the passes were not read in detail).
  - **The tree is then converted to HTML (`to-html-*.js`) and fed into the same HTML importer.** Figma
    import is therefore "Figma → HTML → Paper nodes". The conversion through `toHTML` is **confirmed**. That
    the result goes through the *same* importer as plain HTML paste is **inferred**: the paste switch
    sends Figma and HTML to different handler functions, and the Figma one was not read.
  - Image fills need a **Figma OAuth connection** ("Connect to Figma"). Desktop opens
    `…/figma-oauth/authorize` in the browser and receives `paper://figma-oauth/done|error`, after which
    the images are fetched (`resolve-images-*.js`). Without OAuth the paste works but the images are
    missing. The OAuth flow is **confirmed** (`main.cjs` deep-link parser plus the `open-figma-oauth`
    IPC; the UI says "Pasting from Figma. Images will be fetched."). What happens without OAuth is
    **inferred** (only a cancel path and the toast text were seen).
  - The docs link `paper.design/docs/paste/figma` appears in the renderer.
- **HTML import.** `code-import-*.js` turns DOM and CSS into Paper nodes. It covers flex and grid,
  logical margin/padding/inset, font features, line clamp, text stroke and fill, and form controls.
  It also reads `data-paper-component`, `data-paper-locked` and `data-paper-placeholder-styles`
  attributes. **Confirmed**.
- **Snapshot extension.** This is the Chrome extension "Paper Snapshot"
  (`chromewebstore.google.com/detail/paper-snapshot/lidfahaahiogmnlccifabccgplofocck`). The HTML
  importer honours a `paper-snapshot-original-tag` attribute, so captured pages keep their original
  tag names. **Confirmed** (`main-*.js`, `code-import-*.js`). The format the extension puts on the
  clipboard lives in the extension, not the app. **Unconfirmed** (it probably uses the
  `<x-paper-html>` wrapper; that is **inferred**).
- **Images and SVG.** "Place image" opens a picker for `image/*`. Accepted types include PNG, JPEG,
  WebP, GIF, AVIF, HEIC/HEIF (converted by `heic-to`) and SVG. SVG files go through a separate
  SVG→nodes path, while rasters are uploaded as image fills. **Confirmed** (`main-*.js`,
  `drag-and-drop-*.js`).
- **React / JSX / codebase import (ticket #5).** No JSX or TSX parser exists in the renderer (no
  Babel, no TSX handling). **Not found**. "Import from your codebase" is **agent-driven**: an agent
  connected over MCP reads the user's code and writes HTML into Paper with `write_html`. The in-app
  suggested prompts are "Turn the CSS variables in my codebase into tokens", "Build my code
  components on the Paper canvas using my tokens", and "Recreate my settings screen". **Confirmed**
  (onboarding text in `main-*.js`; MCP tool list).
- Side note: the desktop asar ships `typescript` 7.0.2 with a native `@typescript/typescript-darwin-x64`
  binary, but `main.cjs` never references it. **Inferred**: an unused or transitive dependency.

## 4. Export

- **Formats**: `png`, `jpg`, `webp`, `avif`, `svg`, `pdf`, `mp4`, `webm`. **Confirmed** (format enum
  in `main-*.js`). Image scales run from 0.5x to 4x, plus custom suffixes. SVG export is only offered
  when every selected node is SVG; otherwise it falls back to PNG. For a raster image fill, the
  original file is exported.
- **Copy as…**: PNG (`Mod+Shift+C`), SVG (SVG nodes only), **Tailwind** (React + Tailwind classes),
  **React CSS** (React + inline styles). **Confirmed**.
  - How JSX is produced: the code walks the node tree, and each component type supplies a
    `generateJsx` recipe (a tag name, or an import for shaders). Styles are turned into JSX attributes
    by one or more "styles → attributes" converters, and the output is
    `export default function () { return (…); }` with a "from Paper / URL / date" comment header and
    versioned import lines. **Confirmed** (`main-*.js`).
  - Tailwind uses an in-browser `tailwindState` instance (the `tailwindcss` package is in the
    manifest). It is loaded on demand and used as the class converter. **Confirmed** that it is
    wired in; how styles become classes was not read, so that part is **inferred**.
  - No "Copy as HTML" and no standalone CSS export. **Not found**.
  - The MCP tool `get_jsx` returns the same JSX with either inline styles or Tailwind. **Confirmed**.
- **PDF** (Desktop only; the web app tells you to download Desktop):
  1. The renderer builds a self-contained HTML page per node: the cloned DOM, canvases as PNG,
     gradients rasterized, design tokens as CSS variables, and `@font-face` rules.
  2. Desktop writes each page to a temp file and loads it in a hidden window. It waits for
     `document.fonts.ready`, then runs `printToPDF` at the exact page size.
  3. `pdf-lib` merges the pages, and an optional pass recompresses images (JPEG quality 0.92 for high,
     0.8 for medium, lower for low). There is also a "combined PDF" option (one page per node).
  **Confirmed** (`main.cjs` `export-pdf` handler; `assets/pdf-*.js`).
- **Video** (MP4 or WebM; plan-gated, "Export to video is available with …"): Paper puts the node's
  DOM inside an offscreen `<canvas layoutsubtree>`, which is Chromium's experimental **HTML-in-canvas**
  API. It draws each frame to a Display-P3 2D context and encodes with **mediabunny**. A
  `video-element-capture` path handles the "Prepare for video export" mode. **Confirmed**
  (`video-html-in-canvas-*.js`, `video-element-capture-*.js`). The plan check is **inferred** from the
  hotkey handler and UI text.
- Export is also available to agents through MCP `export` and `export_combined_pdf`.

## 5. Vector editing

- **The data model** (**Confirmed**, `main-*.js`):
  - Vector shapes are real **SVG element nodes**, with props such as `d`, `points`, `viewBox` and
    `transform`, and nested SVG viewBoxes are supported.
  - On top of that, a node can carry an optional **`propMeta.vg` "VectorGraph"**. It is a graph of
    vertices and edges with control points, and change events come at two levels, "geometry" and
    "topology". It is close to Figma's vector networks.
  - When a node has a VectorGraph, the graph is the source and the `d` attribute is cleared and
    rebuilt from it. Without one, `d` is transformed directly.
  - The package names are `@paper/vector-graph` and `@paper/svg-parser`, with `svg-path-parser` and
    `svgpath` used for path maths.
- **Pen tool**: `Pen`, hotkey `P`. There are vector edit modes and state (`vectorEditingState`,
  `VectorEditMode`, `drawToolState`). **Confirmed**.
- **Boolean operations, flatten and outline stroke**: **Not found** in the full command/hotkey list
  or in UI labels. The hits for "Union", "Intersect" and "subtract" came from a schema library and CSS
  `mask-composite`, not from features. **Inferred absent**, with the caveat about the one uncached chunk.
- Figma booleans survive paste as geometry (section 3), but Paper cannot create new ones.
- Other drawing tools: Frame, Rectangle, Text, Shaders, Create image, Create SVG, Place image, Pen.
  **Confirmed** (toolbar and hotkeys).

## 6. Other

- **Components and variants**: **Not found**. The renderer has no "create component", "instance" or
  "variant" UI strings. Inside Paper, "component" means a node type (Frame, Text, Shader…). The
  product's answer is "Bring your components from code into Paper" through an agent. MCP offers
  `duplicate_nodes` and `<x-paper-clone node-id="…">` inside `write_html` for reuse.
  **Inferred absent**.
- **Tokens and themes**: there is a Theme panel with tokens grouped as color, spacing, container,
  breakpoint, radius, font, font-weight, text, leading, tracking and opacity. These are Tailwind-v4-style
  namespaces. Color tokens can carry **modes**. Tokens can be copied and pasted between files as
  HTML, and copied as CSS. **Libraries** publish a file's **tokens only** ("Share this file's design
  tokens and import them in your other designs"), with versions ("+ New version", "Recent versions")
  and a check for circular references. "Breakpoint" is a token type that applies to artboards. There
  is no responsive-variant system. MCP offers `get_tokens`, `create_tokens` and `set_tokens`.
  **Confirmed**.
- **Prototyping** (links, flows, present mode): **Not found**. The keyword "prototype" only matched
  JavaScript's `prototype`. The only "interaction" hits belong to an emoji picker. **Inferred absent**.
- **File format and storage**: files live in the cloud. The renderer syncs over a WebSocket to
  `wss://sync.paper.design` and calls `api.paper.design`. File assets are served from
  `app.paper.design/file-assets/…`, and file URLs have the shape `/file/<id>/<id>/<id>`. The first segment matches the team id; reading
  the other two as project and file is **inferred**. If the
  connection fails, a "Download backup file" button saves the whole file state as
  `paper-file-<id>.json`. No local file format or `.paper` document type was seen; Desktop's
  "open files" means open tabs. **Confirmed** (`main-*.js`, `main.cjs`). That no local file format
  exists is **inferred**.
- **Collaboration**: multiplayer cursors, cursor chat, comments (threads, status, sorting), team
  invites and members, and share links. **Confirmed** (hotkeys `toggleMultiplayer`, `cursorChat`,
  `commentTool`; MCP comment tools).
- **Agents and MCP**: Desktop runs the MCP server, and the CLI in `~/.paper/bin/paper` is a Go stdio
  relay that fetches its tool list from Desktop at runtime (`/mcp/desktop/config.json`). Desktop can
  write MCP config for Claude, Codex, Cursor, OpenCode, Antigravity, GitHub Copilot and VS Code, and
  it can install a Claude Desktop extension (`claude-mcpb.paper.design`). The tool names in the
  cached handlers are: `get_basic_info`, `get_selection`, `get_node_info`, `get_children`,
  `get_tree_summary`, `get_computed_styles`, `get_jsx`, `get_screenshot`, `get_fill_image`,
  `get_font_family_info`, `get_guide`, `find_nodes`, `write_html`, `set_text_content`,
  `update_styles`, `rename_nodes`, `move_nodes`, `duplicate_nodes`, `delete_nodes`,
  `create_artboard`, `create_page`, `update_pages`, `arrange_pages`, `get_tokens`, `create_tokens`,
  `set_tokens`, `export`, `export_combined_pdf`, `finish_working_on_nodes`, the comment-thread
  tools, and file/folder tools (`create_file`, `open_file`, `list_resources`, `move_resources`,
  `archive_resources`, …). **Confirmed** (`MCPHandlers-*.js`, Go symbol names in the CLI). A remote
  MCP (`mcp.paper.design`) is referenced and described as coming soon.
- Telemetry: PostHog via `cdn-ph.paper.design` and `us.i.posthog.com`, with session recording and
  surveys. **Confirmed**.

## What Folio lacks, at a glance

| Paper feature | Folio today (v0.11) |
|---|---|
| 30 WebGL shader layers, exported as `@paper-design/shaders-react` JSX | CSS-only mesh gradients, glass and metal |
| Figma paste (kiwi decode → HTML → nodes) | none |
| Pen tool and VectorGraph paths | none (SVG only inside logos) |
| AI image/SVG generation through a metered backend, about 10 active models | none (Claude chat/MCP only) |
| Video export (MP4/WebM) via HTML-in-canvas | none |
| PDF export (print-to-PDF, merged) | none |
| Tokens with modes, token libraries | brand kit (colours, fonts) |
| Multiplayer, comments, cloud sync | single-user, local |
| Components/variants, prototyping | **Folio has these; Paper does not (inferred)** |

## Method and tools

1. **REA MCP**:
   - `analyze_javascript_application` on `app.asar` **failed** with the default integrity policy.
     The unpacked native files (`dist/cli-bin/darwin-arm64/paper` and the TypeScript `tsc` binary)
     do not match the hashes recorded in the asar header, likely because they were signed after
     packing.
   - With `integrity_policy: record-and-continue` it **worked**, but I ran it only on `package.json`
     (summary detail). It confirmed 4,640 files and that coverage was partial.
   - `close_binary` was called at the end (it returned null; no binary session was open).
   - Not used: `inspect_artifact`, `extract_artifact`, `search_strings`, `analyze_web_bundle` and
     `recover_javascript_sources`. Grep over the extracted bundle was faster for this question.
     `inspect_electron_page` and `analyze_web_bundle` would need the GUI running, which the task
     ruled out.
2. **Asar extraction**: `npx @electron/asar extract` into the fresh directory
   `/tmp/paper-asar-claude-features`, then grep and a small context-printing script over
   `dist/main.cjs` and `dist/preload.cjs`.
3. **CLI binary**: `strings` on `~/.paper/bin/paper` (Go; package `github.com/paper-design/paper/cli`).
4. **Renderer from Chromium's HTTP cache**: a read-only Python reader for Chromium "simple cache"
   entries in `~/Library/Application Support/Paper/Cache/Cache_Data`. It listed the URLs and dumped
   the JS/CSS bodies, which Node's `zlib` then brotli-decompressed into `/tmp/paper-renderer-cache-claude`.
   Cookies, Local Storage and `identity.json` were not opened.

Nothing was launched, patched or sent to Paper's servers. Nothing was written into Paper.app or `~/.paper`.

## Unconfirmed

- The code in this document comes from the web app as cached on 2026-11-09. It is not shipped in
  v0.5.18 and may change server-side at any time.
- One referenced lazy chunk (`assets/index-D0boMYJH.js`) was not cached. Chunks that `main` never
  references would also be missing. Any "not found" item (booleans, components/variants, prototyping,
  HTML export) could live there.
- The `@paper-design/shaders` license: no license text exists locally.
- How shaders behave in PNG/WebP/AVIF and video export (inferred from the generic paths).
- How Tailwind classes are produced (the converter function was not read).
- Which upstream vendors or aggregators serve each image model (inferred from slugs only).
- The clipboard payload the Snapshot extension produces.
- Whether video export is limited to paid plans (inferred from the hotkey guard and UI text).
- Why the desktop asar ships TypeScript 7.
