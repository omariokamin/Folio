# Paper desktop feature scan (0.5.18)

Static local research, 2026-11-09. This is evidence for the Folio wayfinder, not a complete inventory of Paper's remotely delivered editor. **The installed application is a desktop shell that loads the editor from `https://app.paper.design`. Most requested editor internals are not shipped here.** Unknown below does not mean Paper lacks the feature.

Scope of change: this report and pointer comments on research issues #3, #4, #5 only. No app code, callers, tests, fixtures, configuration or exports change; no Paper source is copied into Folio. `main` is unchanged. Folio comparisons use the checked-out main at `1329c06`, especially SPEC's data model, HTML import, effects, components, Tailwind export and prototyping sections.

## Evidence and method

- Read-only inputs: `/Applications/Paper.app/Contents/Resources/app.asar`, its unpacked companions, and `~/.paper/bin/paper`. Paper was not launched; its code/CLI was not executed; no requests to Paper servers were made. App contents were treated as untrusted data.
- `package.json` identifies `@paper/desktop`, version `0.5.18`, main `dist/main.cjs`, license `Proprietary`. That is the desktop package's license, **not** a license determination for the separately published Paper Shaders library.
- ASAR SHA-256: `f897a97c20bbda8015003bffd740f5e8b7fa2cc453a873b5d2f5bd1e50463fce`.
- REA `open_binary` and `extract_artifact` were used. Extraction evidence: `ev_04fabd56465ebd9e2ab1a73be7ccc8fd6143a257c4154e0e98e2045abe2f70ec`. REA extracted 4,885 regular files to a fresh temporary directory outside the repo. Inventory has 5,654 occurrences (directories and structural entries included).
- Integrity caveat: REA initially rejected two unpacked native files. A second extraction with `integrity_policy: record-and-continue` retained their observed bytes as untrusted. This is compatible with post-packaging signing/stripping but does not prove the reason. CLI `dist/cli-bin/darwin-arm64/paper`: declared hash `d8d78ad93ffd9096b3e1ae9d67d1d4fcd5512439e0484edc59a16eb41284a426`, observed `58507f6ca5256b52cba6c9ff6658ab1175c32674e754faa3cadd04e025cee414`. TypeScript `node_modules/@typescript/typescript-darwin-x64/lib/tsc`: declared `76e4987d060ef8207875a53a73619ce665ff16fb2800c0d57a452e21c829bd7b`, observed `0a5565dcdcaf77d9a1f04935a26b41b579c9adaf8404121a5ded9576c8978dc4`.
- Installed `~/.paper/bin/paper` matches the observed packaged CLI hash and size (5,903,280 bytes). This binary was searched as bytes, not decompiled or run.
- Text and byte searches covered all extracted regular files, with focused static inspection of `dist/main.cjs` and `dist/preload.cjs`. Dependency internals and incidental substring matches were not counted as editor features. No web assets, caches, user documents, session stores or source maps were fetched.

Locations below are **zero-based UTF-8 byte offsets in the original shipped file**, not offsets in a prettified copy. Unless specified otherwise paths are relative to the ASAR root. `dist/main.cjs` SHA-256: `fc735fb0a3c3378d92cd0d534f7425f0beb1ae002f6d5e4e32d55be960ff8cc6`; `dist/preload.cjs`: `b3c3b07a1f3c56609c13339d20fc850105f0dd5eeab653a3e0ab2532cabd035d`. Search strings make the evidence relocatable. No credential values are included.

### Delivery boundary — confirmed (static code)

`dist/main.cjs`, byte 1245651, `function Xh`: production addresses include `MAIN_APP: https://app.paper.design`, `API: https://api.paper.design`, `WORKERS: https://workers.paper.design`, `SYNC: wss://sync.paper.design`, `ASSETS: https://assets.paper.design`, `MCP: https://mcp.paper.design`, `CLIENT_SIGNALS: https://signals.paper.design` and `FILE_ASSETS: https://app.paper.design`.

`h7` at byte 1247136 selects the main app address; tab `load()` around bytes 1809820–1810130 passes that address plus the tab route to the URL loader. `ko` at byte 1803200 calls `loadURL`; its offline HTML is a fallback page, not a bundled editor. The local `dist/` contains main/preload scripts, app-bar preload, icons and a native CLI, with no editor renderer bundle. **Inferred:** editor-specific rendering, parsing and generation likely live in the remote app; exact remote implementation remains unexamined. Desktop version alone cannot identify the remote editor revision.

## 1. Shaders and effects

**Confirmed (bounded local search):** no `@paper-design/shaders` package directory, manifest, license file or literal package reference was found in the extraction. The desktop `package.json` does not declare it. No locally evidenced version or shader-library license can be reported. No matching editor strings for mesh gradient, liquid metal or fluted glass were found.

There is a misleading `halftone` match: `dist/main.cjs` byte 1668748, `halftone:` points to `dist/icons/halftone.png` in the **application icon selector**, alongside `pattern`, `dots`, `gooey` and `default`. It is not evidence of a halftone shader. The same bundle has no case-insensitive `shader` match.

**Unconfirmed:** the actual effects catalog (mesh gradient, liquid metal, grain, halftone, fluted glass, etc.), their parameters, WebGL/animation behavior, use/version/license of the public library, and shader-layer export as canvas plus script, static image or CSS. The PDF HTML interface in section 4 does not establish shader serialization.

**Folio implication (inferred):** keep #3 open. This scan does not justify vendoring any Paper code or choosing a shader export strategy. Folio already has native effects; SPEC's v0.9 section explicitly calls for CSS/SVG and inspiration only. Investigating the separately published library's source/license is separate research, outside this no-Paper-server scan.

## 2. Image generation

**Confirmed (locations):** the desktop service map declares Paper-owned API and worker hosts (delivery boundary above). No image-generation route or provider call chain was found in the inspected desktop code. Whole-extraction searches for `api.openai.com`, `fal.ai`, `api.replicate.com`, `seedream` and `nano banana` returned no matches; focused searches in main/preload/CLI did not identify an image-model catalog.

**Unconfirmed:** models/providers actually offered, provider-specific endpoints, request shapes, authentication, whether generation calls go directly to providers or through Paper's backend, and browser CORS/key handling. The Paper-owned hosts alone cannot prove backend-mediated image generation. Generic MCP sampling schemas and telemetry feature-flag code are not image-generation evidence.

Flux 2, Nano Banana Pro, OpenAI Image Edit 1.5 and Seedream 4.5 are names supplied in issue #4; **they are research leads, not discoveries from this installed artifact**. No keys or tokens are reproduced here.

**Folio implication (inferred):** keep #4 open. This local scan cannot answer provider pricing, CORS or bring-your-own-key feasibility; those require separate provider research. It supplies no basis for selecting Paper's provider architecture.

## 3. Import

**Confirmed (desktop Figma integration):** `dist/preload.cjs` exposes `paper.desktop.openFigmaOAuth` and `onFigmaOAuthResult`, using IPC `open-figma-oauth` and `figma-oauth-result`. `dist/main.cjs` bytes 2009820–2010360 builds a URL at `https://workers.paper.design/figma-oauth/authorize`, with query parameter names `session`, `desktop`, `protocol`, `opener_origin`, then opens it externally. Deep-link handlers around bytes 1795216–1795500 and 2008463 recognize `figma-oauth/done` and `figma-oauth/error` and relay the result. This confirms an OAuth bridge; it does **not** establish clipboard support or its parser.

**Confirmed (local image access, not a proven import UI):** `dist/main.cjs` byte 1998272, `function pAe`, parses the `paper-asset://` scheme into local paths. The extension/MIME table at byte 1998761 includes PNG, JPG/JPEG, GIF, WebP, SVG (`image/svg+xml`), BMP, ICO and AVIF. Its protocol handler fetches an allowed local file and serves it with a matching content type. This is evidence of native local image/SVG access, not evidence that SVG paths become editable nodes. TIFF/PDF/video strings in a separate navigation/download detector are not an import support list.

**Unconfirmed:** Figma paste, HTML paste and Snapshot extension import. Whole-extraction searches found no `figmeta`, `(figma)` or `application/x-figma` payload markers. No desktop clipboard HTML reader was identified; `text/html` matches belong to fallback pages/HTTP response handling. Consequently no MIME list, Figma comment payload decoding, binary parser, HTML-to-layer conversion or Snapshot message schema is established. OAuth must not be conflated with Figma paste. Image import controls and SVG sanitization/editability also remain unconfirmed.

**Folio implication (inferred):** keep Figma paste as fog. For #5, no Paper React/JSX import implementation was recovered; Folio SPEC's HTML import is a useful existing foundation, but JSX conversion and Tailwind style resolution remain separate work.

## 4. Export

**Confirmed (declared format schema):** `dist/main.cjs` byte 1999756, `var bf=`, enumerates `avif`, `jpg`, `mp4`, `pdf`, `png`, `svg`, `webm`, `webp`. The still-export entry schema `iAt` at byte 1999961 accepts PNG/JPG/SVG/PDF/WebP/AVIF, with `scale`, `suffix`, optional quality (`low`, `medium`, `high`) and resampling (`detailed`, `basic`). The video schema `oAt` at byte 2000325 accepts MP4/WebM with `scale`, `suffix`, optional `duration`. **Schema presence confirms format declarations, not successful export or UI availability.**

**Confirmed (PDF implementation):** `dist/preload.cjs`, `exportPdf` invokes IPC `export-pdf`; registration is near `dist/main.cjs` byte 2010270. `DCe` at byte 2000596 receives `pages`, `quality`, `resampling`, `fileName`; rejects empty pages and non-positive dimensions; renders each page and merges PDFs with `pdf-lib` (desktop manifest version `1.17.1`). `aAt` at byte 2001208 accepts HTML/width/height, adds page dimensions, writes a temporary HTML file, creates a hidden Chromium window, loads the HTML, waits for fonts and calls `printToPDF` with backgrounds enabled. Cleanup destroys the window and deletes the temporary file. A following pass compresses/resizes embedded images before saving the final PDF.

**Unconfirmed:** the still-image/SVG encoders, MP4/WebM capture and codecs, shader animation capture, SVG vector fidelity, and the code export formats HTML/JSX/Tailwind/React. There is no `tailwind` match anywhere in the extraction, and no `get_jsx` or `write_html` match. Incidental JSX support in server/compiler dependencies would not establish editor export. No local generator shows how JSX/Tailwind are produced. Renderer-provided HTML for PDF is not proof of a downloadable HTML export.

**Folio implication (inferred):** the declared still/video list and the PDF implementation are useful comparison targets. Folio already specifies HTML/CSS, Tailwind HTML/React and prototype HTML exports (SPEC v0.10/v0.11); do not mark those absent in Folio merely because Paper's code generator is inaccessible. JSX **export** and JSX **import** are separate capabilities for #5.

## 5. Vector editing

**Confirmed (search boundary):** no editor path model, pen-tool implementation or boolean-operation implementation was recovered from the desktop entry/preload/CLI files. `bezier` and SVG path operation matches in `dist/main.cjs` belong to bundled `pdf-lib` drawing code, not the editor's document model. The local SVG MIME mapping in section 3 establishes asset serving only.

**Unconfirmed:** whether Paper stores SVG `d` strings, path segments/control points or a proprietary node type; union/subtract/intersect/exclude; pen creation and point editing. None can be answered from the desktop shell. No absence claim is warranted.

**Folio implication (inferred):** retain vector editing as fog. Folio's frame/text/image model and SVG asset/logo helpers are not equivalent to an editable vector path/pen/boolean model (SPEC data model and logo/SVG sections). A concrete sample document or editor-source inspection would be needed to compare those operations.

## 6. Other capabilities and storage

**Confirmed (desktop features):** tab/window state persistence uses `window_state.json` (`dist/main.cjs` byte 1815149), containing viewport and tab route/title/pinned/icon state. This is **shell state**, not the design document format. Production service constants include a WebSocket sync host (delivery boundary above). Resource routing accepts a Paper file ID, `/file/<id>` route or file URL (bytes 1845050–1846650). Desktop preload exposes open-file/tab/resource notifications.

**Confirmed (agent integration):** local MCP is bound to `127.0.0.1:29979/mcp` (`FV=29979`, `Ev="/mcp"` near byte 1993000). `Ymt` returns dynamically supplied `r.tools`; calls are forwarded to `handleToolCall` (byte 1993578). `getMCPServerConfig` appears at bytes 1995309/1996407. Broker `Wxe` around byte 1845275 selects a file/tab and waits for renderer `window.resolveMCPHandlers`. The CLI installation path is `.paper/bin/paper` (around byte 1625600). These are desktop/agent plumbing, not a statically recoverable editor tool catalog. No MCP request was made.

**Inferred:** hosted editor URLs, file IDs, auth integration and the sync host suggest cloud-connected documents. They do not prove document persistence semantics, offline support, a downloadable local file format, or simultaneous multi-user collaboration.

**Unconfirmed:** Paper components/instances/variants, tokens/themes, interaction prototyping, multiplayer presence/comments/conflicts, version history and file serialization/extension. Feature-flag `variants` in telemetry code and JavaScript `prototype` strings are false positives. Local window JSON must not be described as a `.paper` design file.

**Folio implication (inferred):** Folio already has components/variant sets, brand tokens, prototype playback/export and a Node MCP bridge in its contract. Paper's shell gives no basis to call those comparative gaps. Cloud collaboration/storage may be a different product choice, pending evidence.

## Unconfirmed

This scan answers the locally observable desktop boundary, not the full remotely delivered product. Still unresolved:

- Shader catalog/parameters, library version and license, runtime cost, animation and live/static export (#3).
- Image model/provider selection and direct-vs-backend routing, auth, CORS, prices and output lifetime (#4).
- JSX/React import subset and transformation; HTML, Snapshot and Figma clipboard parsing; JSX/Tailwind code generators (#5 and paste fog).
- Vector path storage, booleans and pen/point editing (vector fog).
- Actual rendering/export success beyond static declarations; video codecs; SVG fidelity.
- Components/variants, tokens/themes, prototype behavior, real-time collaboration and document format/offline behavior.

Next evidence, if separately authorized, would be a fixed remote editor bundle or supplied sanitized export/clipboard/document samples, plus independent public-library/provider documentation. No such acquisition was attempted here. The installed shell can load different remote code without a desktop version change, so these findings must not be treated as a stable complete Paper feature matrix.
