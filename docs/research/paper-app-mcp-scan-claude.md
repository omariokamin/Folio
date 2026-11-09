# Paper desktop app: MCP tool surface vs Folio

Research for issue #2, "How do Paper's MCP tools compare to Folio's?". Scanned on 2026-11-09.

## The short version

- Paper Desktop **0.5.18** exposes **41 MCP tools**. It has no resources and no prompts. The full list was **confirmed live**: we ran Paper's own CLI (`paper mcp`) and sent only `initialize`, `notifications/initialized` and `tools/list`. No tool was called.
- **The tool definitions are not in the app.** The Electron bundle and the CLI only carry the plumbing. The tool list, the server instructions and every tool call are handled by Paper's web app (loaded from `app.paper.design`) inside the desktop window. Paper can change its tools without shipping a new desktop build, and this list is a snapshot of one day.
- Paper's write path is **HTML in, layers out** (`write_html` into a target node, with `insert-children` or `replace`). Its read path returns **JSX (inline styles or Tailwind)**, **computed CSS**, screenshots, image-fill bytes and design tokens. It also has file and folder management, comments, a "working on" indicator for multi-agent work, and on-demand guides.
- Folio's write path is a **typed JSON node schema** (`create_nodes`/`update_nodes`), with `import_html` as the HTML route. Folio has components and variants, brand kits, a logo designer, prototyping and URL import. Paper's tool list has none of these.
- Correction to the brief: Folio does not have 20 tools. `src/ai-prompt.js` defines **21**. The MCP bridge adds `open_folio`, so Claude Code sees **22**. The in-app chat sees the 21, but `import_url` refuses to run there (`src/ai-tools.js:4060`).

## Method

Everything was read-only. We did not launch, patch or modify Paper, sent nothing to Paper's servers, and touched no Paper document.

| Step | Tool | Result |
|---|---|---|
| Version | `Info.plist`, `package.json` in the asar | 0.5.18, `@paper/desktop`, ToDesktop build `261031pthw9s82w`. Depends on `@modelcontextprotocol/sdk` 1.31.0, `@hono/mcp`, `hono`, `zod`. |
| Electron fuses | REA `inspect_electron_fuses` | **Worked.** Context only: RunAsNode on, embedded asar integrity validation off, OnlyLoadAppFromAsar off. |
| JS app graph | REA `analyze_javascript_application` | **Worked only with `integrity_policy: record-and-continue`.** The default run failed on an asar integrity mismatch for the unpacked CLI binary `dist/cli-bin/darwin-arm64/paper`. That mismatch is expected, because the binary is code-signed after packing. Its hash matches `~/.paper/bin/paper`. |
| Extract asar | REA `open_binary` + `extract_artifact` (record-and-continue) | **Worked.** 4,885 files went to an REA temp dir with containment verified. The planned fallback (`npx @electron/asar extract` to `/tmp/paper-asar-claude-mcp`) was not needed. |
| String search | REA `search_strings` on the asar | **Failed.** No configured provider handles archive targets: Ghidra, Kuna and IDA are not configured, Java is not installed, and Hopper refuses archives. We grepped the extracted files instead. |
| Web bundle / source recovery | REA `analyze_web_bundle`, `recover_javascript_sources` | **Not applicable.** The first needs a CDP debugging target, which would mean attaching to or relaunching the GUI. The second is Linux-x64 only. |
| CLI binary | `file`, `strings` | A Go 1.26 Mach-O arm64 binary (`github.com/paper-design/paper/cli`) that acts as an MCP **stdio relay**. |
| Live tool list | `~/.paper/bin/paper mcp` over stdio | **Worked.** Paper was already running, started by the user. 41 tools came back. |
| Folio side | `src/ai-prompt.js` (tools array from `get_document`), `mcp/folio-mcp.js`, `SPEC.md` | Read directly. |

REA session closed with `close_binary`.

## How Paper's MCP is wired (confirmed in `dist/main.cjs` and the CLI binary)

- **HTTP server in the Electron main process:** Hono on `127.0.0.1:29979`, MCP endpoint `/mcp` (Streamable HTTP, one session per client). It rejects requests that carry an `Origin` header or a CORS preflight. Its Host-header allowlist covers only `127.0.0.1:29979` and `localhost:29979`, as protection against DNS rebinding. The server's name is `paper-desktop` and it declares only the `tools` capability.
- **Config route:** `GET /mcp/desktop/config.json` returns `{ tools, instructions }`.
- **The renderer does the real work.** For `tools/list` and the instructions, the main process calls `getMCPServerConfig` over RPC into the window. For `tools/call` it calls `handleToolCall(sessionId, name, args, clientIdentity)`. When a session closes it calls `removeAgent`, which shows that each MCP session is tracked as an "agent". The window loads `https://app.paper.design`. No tool names exist in `dist/main.cjs`, `dist/preload.cjs` or the CLI binary (grep and `strings` found zero hits for `write_html`, `get_jsx` and `finish_working_on_nodes`).
- **Client identity:** the server records `clientInfo` (name, version, title) from `initialize` or from a `_meta` key, plus the transport. The header `x-paper-from: CLI` marks a request as stdio.
- **CLI relay (`paper mcp`):** it fetches the config from `http://127.0.0.1:29979/mcp/desktop/config.json`, answers `initialize` and `tools/list` from that, and forwards `tools/call` to `/mcp`. If Paper is not running, it serves an empty tool list with instructions telling the agent to ask the user to restart Paper.
- **Headless mode** (`PAPER_HEADLESS_MCP=true`): `/mcp` then requires a bearer token, which Paper checks against its API. We saw this in code and tried nothing.
- **Remote MCP** also exists: `https://mcp.paper.design` appears in the code, and the `export` tool's description mentions "Paper's remote MCP server". So does a Claude Desktop extension host (`https://claude-mcpb.paper.design`). We did not contact either.

## Paper's 41 tools

Where found: **every row was confirmed from the live `tools/list`**. The "What it does" column paraphrases Paper's own tool descriptions. We did not read the handlers, because they live in the remote web app.

Annotations: **R** = `readOnlyHint`, **D** = `destructiveHint`. `delete_nodes` also carries a non-standard `consequentialHint`. A `?` after a parameter means it is optional. Unless marked otherwise, `fileId` is required.

### Files and folders (the team file browser)

| Tool | Inputs | What it does | Ann. |
|---|---|---|---|
| `open_file` | `fileId` (id or URL), `pageId?` | Opens a file as a desktop tab. `pageId` only counts on first open. Returns the same thing as `get_basic_info`. | R |
| `list_resources` | `limit?`, `includeArchived?`, `parentId?` (no fileId) | Lists files and folders: open tabs first, then recent team items. Flags `open`, `active` and `draft`. Paginate until `truncated` is absent. | R |
| `create_file` | `name?`, `parentId?`, `cloneFileId?` | Creates a file in the active team (optionally cloned from another). Returns id, name, parentId and URL. | D |
| `create_folder` | `name?`, `parentId?` | Creates a folder. | D |
| `rename_resource` | `resourceId`, `name` | Renames a file or folder. | D |
| `archive_resources` | `resourceIds[]` | Archives items, folders recursively. All-or-nothing validation. | D |
| `unarchive_resources` | `resourceIds[]` | Restores items. An item whose folder is still archived lands at top level. | D |
| `move_resources` | `resourceIds[]`, `parentId` | Moves items between folders. They stay inside team or inside drafts. | D |

### Pages

| Tool | Inputs | What it does | Ann. |
|---|---|---|---|
| `create_page` | `name?`, `icon?` (17-value enum: `arrow`, `padlock`, `check`, `design`, `swatches`, `bar-chart`, `paper`…) | Adds a page after the one the user is viewing. Returns its id. | D |
| `update_pages` | `updates[{pageId, name?, icon?\|null}]` | Renames pages or changes their icons in a batch. Does not switch the user's view. | D |
| `arrange_pages` | `order[pageId \| {type:"divider"}]`, `removeDividerIds?` | Sets the complete page order and adds or removes dividers. It rejects stale lists. **Pages are never deleted.** | D |

### Reading the canvas

| Tool | Inputs | What it does | Ann. |
|---|---|---|---|
| `get_basic_info` | `fileId?`, `pageId?` | File and page name, node count, artboards with size and world position, fonts used, a compact token list and the page list (with dividers and the active page). | R |
| `get_selection` | `fileId?` | The user's current selection: ids, names, kinds, sizes and parent artboard. | R |
| `get_node_info` | `nodeId` | One node: size, visibility, lock, parent, child ids, plain text, world and relative x/y. Also the status of AI image generation on that node. | R |
| `get_children` | `nodeId` | Direct children, with child counts and positions. | R |
| `get_tree_summary` | `nodeId`, `depth?` | A cheap indented outline of a subtree (kind, name, id, size). | R |
| `get_screenshot` | `nodeId`, `scale?` | Base64 image of a node, size-capped. | R |
| `get_jsx` | `nodeId`, `format?` (`inline-styles`\|`tailwind`), `includeNodeIds?`, `includeRootPositioning?` | The subtree as JSX with inline styles or Tailwind classes. Also how SVG output is read. | R |
| `get_computed_styles` | `nodeIds[]` | A map from nodeId to its computed CSS properties. | R |
| `get_fill_image` | `nodeId` | Base64 JPEG of a node's image fill (resized), plus the original URL. | R |
| `find_nodes` | `pageId?`, `nodeId?`, `textValue?`, `filters?[{styleName?, styleValue?}]` | Searches the whole file (or one page or subtree) by computed style and/or text, with `*` wildcards. Colours match by equivalence, and a raw colour also finds usages bound to a token. Built for bulk token migration. | R |
| `get_font_family_info` | `familyNames[]` | Checks whether a font is available (local machine or Google Fonts) and lists its weights, styles and variable axes. | R |
| `get_guide` | `topic` (no fileId) | Returns a long guide on demand. Topics named: `paper-mcp-instructions` (required first call), `mobile-status-bar`, `figma-import`, `image-generation`. | R |

### Comments

| Tool | Inputs | What it does | Ann. |
|---|---|---|---|
| `list_comment_threads` | `pageId?`, `currentPageOnly?`, `nodeId?`, `status?` (`open`\|`resolved`\|`all`), `search?`, `searchScope?`, `participantUserId?`, `threadAuthorUserId?`, `sortField?`, `sortDirection?`, `limit?`, `offset?`, `previewLength?` | Thread summaries, open-only by default. | R |
| `get_comment_thread` | `commentThreadId` | The full thread: replies, reactions, attachment URLs, page and node context. | R |
| `list_comment_thread_authors` | `pageId?` | Who has commented, so a name can be turned into a userId. | R |
| `set_comment_thread_status` | `commentThreadId`, `status` (`open`\|`resolved`) | Resolves or reopens a thread once the feedback is handled. | D |

### Writing and editing

| Tool | Inputs | What it does | Ann. |
|---|---|---|---|
| `write_html` | `html`, `targetNodeId`, `mode` (`insert-children`\|`replace`) | Turns inline-styled HTML into layers inside a node, or replaces that node with it. Rules: flex, padding and gap only (no margin, grid or tables). `layer-name="…"` sets the layer name. `<x-paper-clone node-id=… style=…/>` clones an existing node. `paper-asset:///abs/path` loads local images and `paper-gen://` generates AI images. The tool asks for **one visual group per call**, so the user watches it build. | D |
| `create_artboard` | `name`, `styles{width, height}`, `pageId?` | New artboard, flex column by default, placed automatically in empty space. Default sizes: 1440×900, 768×1024, 390×844. | D |
| `update_styles` | `updates[{nodeIds[], styles{prop: string\|number}}]` | Sets raw CSS on nodes in a batch, CSS variables (tokens) allowed. Styles that have no effect in that context are dropped and reported back as `ignoredStyles`. Setting top/left on an artboard moves it. | D |
| `set_text_content` | `updates[{nodeId, html}]` | Replaces a text node's inner HTML, with **inline rich-text spans** (colour, font, size, spacing, decoration, stroke, gradient text). | D |
| `rename_nodes` | `updates[{nodeId, name}]` | Batch renames (50-character cap). | D |
| `duplicate_nodes` | `nodes[{id, parentId?}]` | Deep-clones nodes and returns a `descendantIdMap` from old to new ids for every descendant. | D |
| `move_nodes` | `moves[{nodeId, before} \| {nodeId, after} \| {nodeId, parentId, index?}]` | Reparents or reorders with ids preserved. Placement is relative to a sibling or absolute under a parent (`parentId:"root"` for the page root). **Works across pages.** Returns the new child lists of every affected parent. | D |
| `delete_nodes` | `nodeIds[]` | Deletes nodes and their descendants. | D + consequential |
| `finish_working_on_nodes` | `nodeIds?` | Removes the "agent is working here" indicator from artboards. Required when done. Passing specific ids is preferred so several agents can share a file. | R |

### Design tokens

| Tool | Inputs | What it does | Ann. |
|---|---|---|---|
| `get_tokens` | `types?[]`, `namePattern?`, `format?` (`json`\|`css`\|`tailwind`) | Lists the file's tokens. | R |
| `create_tokens` | `tokens[{type, name, value, description?}]` | Creates tokens. `var(--other)` makes an alias. 11 types: `breakpoint`, `color`, `container`, `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `opacity`, `radius`, `spacing`. | D |
| `set_tokens` | `tokens[{name, newName?, value?, description?, delete?}]` | Renames, updates or deletes tokens, with errors reported per entry. | D |

### Export

| Tool | Inputs | What it does | Ann. |
|---|---|---|---|
| `export` | `nodes` (`"nodes-with-exports-only"` or a map nodeId → `[{format, scale, durationSeconds?, pdfQuality?, pdfResampling?}]`), `type?` (`image`\|`video`), `pageId?` | Writes files and returns their paths. Formats: `avif`, `jpg`, `png`, `svg`, `webp`, `pdf`, **`mp4`, `webm`**. The remote server returns 24-hour links instead. PDF needs Desktop. | R |
| `export_combined_pdf` | `nodeIds[]` | Combines several nodes into one PDF, ordered by canvas position. Desktop only. | R |

### Server instructions (summary, from `initialize`)

About 2,000 characters. In our words, the instructions say:

- load the `paper-mcp-instructions` guide first;
- call `get_basic_info` and `get_selection` to orient;
- check fonts with `get_font_family_info` before any typography;
- write a short design brief (palette, type scale, spacing) for new designs;
- add one visual group per `write_html`, and prefer duplicating plus `update_styles` over rewriting;
- review with `get_screenshot`, and switch the artboard to `height: fit-content` when content clips;
- always call `finish_working_on_nodes`;
- never show node ids to the user;
- for code export, take exact values from `get_jsx`, `get_computed_styles` and `get_fill_image`, never from screenshots.

## Side by side

| Job | Paper | Folio |
|---|---|---|
| Orient | `get_basic_info` + `get_selection` | `get_document` (includes the selection and brand summary) |
| Read structure | `get_tree_summary`, `get_children`, `get_node_info` | `get_tree` (full node JSON with depth, `_rendered` sizes) |
| Read as code | `get_jsx` (inline / tailwind) | `export_code` (`html-css`, `tailwind-html`, `tailwind-react` + `@theme`) |
| Read computed CSS | `get_computed_styles` | none (closest: `export_code` or `get_tree`) |
| Screenshot | `get_screenshot` | `screenshot` |
| Create from HTML | `write_html` (insert-children / replace, clone tag) | `import_html` (new artboard or inside `parent_id`; no index, no replace) |
| Create structured | `create_artboard` + `write_html` | `create_nodes` (JSON tree, `parent_id`, `index`, `page_id`) |
| Edit styles | `update_styles` (raw CSS) | `update_nodes` (deep-merge patch in Folio's schema) |
| Edit text | `set_text_content` (rich spans) | `update_nodes` → `text.content` (one style per text layer) |
| Rename | `rename_nodes` | `update_nodes` → `name` |
| Duplicate | `duplicate_nodes` + id map | none (needs `get_tree` + `create_nodes`) |
| Move | `move_nodes` (sibling-relative, cross-page) | `move_nodes` (parent + index, x/y); artboards change page via `manage_pages move` |
| Delete | `delete_nodes` | `delete_nodes` |
| Pages | `create_page`, `update_pages`, `arrange_pages` (icons, dividers; never deletes or switches view) | `manage_pages` (list, create, switch, rename, delete with confirm, move) |
| Tokens / brand | `get_tokens`, `create_tokens`, `set_tokens` (11 types, json/css/tailwind) | `get_brand`, `set_brand` (colours, fonts, radii, logos, voice, style rules) |
| Files | 8 file/folder tools | none (one document per browser tab) |
| Comments | 4 tools | none |
| Export files | `export`, `export_combined_pdf` | none as tools (PNG and prototype export exist in the UI only) |
| Guidance | short instructions + `get_guide(topic)` on demand | whole system prompt in `instructions` |
| Session housekeeping | `finish_working_on_nodes` | each burst of calls becomes one undo step (`mcp/folio-mcp.js` instructions) |
| Annotations | every tool marked R or D | 5 read-only, `delete_nodes` destructive, `import_url` open-world (`mcp/folio-mcp.js:54,90-92`) |

## What Paper's agents can do that Folio's can't

1. **Manage files and folders**: list, create, clone, rename, archive, move, open (8 tools). Folio has one document per tab.
2. **Comments**: read threads, search them, map authors, resolve or reopen (4 tools). Folio has no comments.
3. **Search the design** by computed style and/or text, with token-aware colour matching (`find_nodes`).
4. **Read computed CSS** for many nodes in one call (`get_computed_styles`).
5. **Get image bytes back** from an image fill (`get_fill_image`).
6. **Check font availability** on the machine and on Google Fonts (`get_font_family_info`). Folio hard-codes a font list in its prompt (`src/ai-prompt.js:227`).
7. **Richer tokens**: 11 types including spacing, fontSize, lineHeight, breakpoint and opacity, with aliases, and output as json, css or tailwind. Folio's brand kit covers colours, fonts and radii.
8. **Duplicate with an id map** (`duplicate_nodes` → `descendantIdMap`).
9. **Move by sibling, and across pages,** for any node.
10. **Write HTML in place**: `write_html` with `replace` mode, a clone-by-reference tag and a `layer-name` attribute. Folio's `import_html` can't replace a node or choose an `index`.
11. **Rich text**: inline spans with their own colour, font and size (`set_text_content`). Folio text layers have one style.
12. **Export files** as images, SVG, PDF (single or combined) and **video (mp4/webm)** from a tool.
13. **AI image generation** from inside HTML or styles (`paper-gen://` URLs).
14. **Multi-agent presence**: a "working on" marker per artboard, released with `finish_working_on_nodes`.
15. **Guides on demand** (`get_guide`), which keeps the base instructions short.
16. **Local images by path** (`paper-asset:///…`).
17. Hand off to the cloud: Paper also runs a remote MCP server (`mcp.paper.design`).

## What Folio has that Paper's tools don't

1. **Components and variants**: `list_components`, `create_component`, `create_instances`, `update_instances`, `add_starter_kit`. Paper's tool list has no component tools.
2. **Brand kit beyond tokens**: logos, voice (tagline, tone, words to use and avoid), and style rules (button shape, density, shadow, gradients). See `get_brand`/`set_brand`.
3. **Logo designer**: `draft_logo` (sanitised SVG concept cards) and `save_logo` (light, dark, mono, symbol and metal versions).
4. **Import a live URL** (`import_url`), fetched by the bridge with private addresses blocked.
5. **Prototyping**: `set_interactions` (navigate, back, url, overlay, close; transitions; scroll frames; start screen).
6. **Page delete and view switch**: `manage_pages delete` (with confirm) and `switch`. Paper states that it never deletes pages and can't switch the user's page.
7. **A typed node schema** (frame, text, image with sizing hug/fill/fixed) and deep-merge patches, instead of raw CSS strings.
8. **React component output** with a Tailwind `@theme` block (`export_code tailwind-react`). Paper's `get_jsx` returns JSX but does not claim a component wrapper or theme.
9. **`open_folio`** to open the canvas from Claude Code. Paper is a desktop app that must already be running.

## Unconfirmed or odd

- **Handler behaviour is inferred from descriptions only.** The handlers live in the remote web app and were not read. We made no tool calls, so return shapes are unverified.
- **`get_guide` content is unknown.** Reading it would be a tool call. The full rules for `write_html` (inline formatting, image generation, Figma import) live there.
- **`fileId` is required in 31 of 41 schemas**, but the instructions and several descriptions say to omit it to use the current file. Only `get_basic_info` and `get_selection` mark it optional. We could not test whether the server accepts an omitted `fileId` without making a call.
- **`serverInfo.version` came back `0.0.1`**, while the HTTP server is built with the app version (0.5.18). We infer that the Go relay answers `initialize` itself and forwards only `tools/call`.
- **The list may vary by state.** It was captured with Paper running. Whether a file was open was not checked. Whether the list changes with no file open, or differs on the remote server, is unconfirmed (the `export` and `export_combined_pdf` descriptions already show Desktop-only differences).
- **The list is a snapshot.** Paper serves it from its web app, so it can change at any time without a desktop update.
- **Side effect of the live check:** one short MCP session. Paper tracks each session as an agent and removes it on close. No document was opened, read or changed.
- **Not attempted:** headless mode, the remote MCP server, the Claude Desktop extension, and reading Paper's local HTTP cache.
