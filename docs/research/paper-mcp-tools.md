# Paper's MCP tools compared with Folio's

Research for issue #2. Observed 2026-11-09.

## Short answer

Paper's MCP server (the Paper Desktop `paper mcp` CLI, a hosted server at `https://mcp.paper.design`, and WebMCP in the browser app) exposes about 41 tools. Its main way of writing is HTML: `write_html` inserts HTML into a node or replaces a node with it. Around that sit reads that Folio lacks, such as computed styles, style and text search, image fills and font lookup, plus comment threads, file and folder management, image, video and PDF export, and a "working on" indicator that the agent must release. Folio has 21 tools in `src/ai-prompt.js` (the ticket says 20; `open_folio` in the bridge makes 22 over MCP). Folio has components, a full brand kit, logos, URL import and prototyping. Paper's tool list has none of these.

## Method and where each claim comes from

Paper's docs do not list its tools. The docs page says the CLI hands agents "Paper's tools and instructions", and the published Claude extension sets `"tools_generated": true` and ships no static list. So the claims below come in two tiers:

- **Tier 1, docs/plugins/packages** (the briefed source list): Paper's site pages and the `paper-design` GitHub repos. These confirm capabilities in prose and only three tool names.
- **Tier 2, Paper's publicly served editor bundle**: `https://app.paper.design/assets/MCPHandlers-Bc1Lc3DD.js`, downloaded read-only on 2026-11-09 and searched as text, never executed. This file is outside the briefed source list. It is not the local `/Applications/Paper.app` and not a run of `paper mcp`. It holds Paper's tool registry: name, description, annotations and Zod input schema for each tool. A third-party proxy describes the same mechanism, where `tools/list` maps to the editor's `getMCPServerConfig()` ([vcashwin/paper-remote-mcp](https://github.com/vcashwin/paper-remote-mcp), community project, used only to find the source). The chunk's hash changes with every Paper deploy, so this is a snapshot. **Cross-check every Tier 2 row against the app scan on branch `research/paper-app-mcp-scan`.**

Sources (cited below by tag):

| Tag | Source |
|---|---|
| D-MCP | https://paper.design/docs/mcp |
| D-SUP | https://paper.design/docs/support |
| D-PASTE | https://paper.design/docs/paste/html |
| D-TOK | https://paper.design/docs/tokens |
| LOG | https://paper.design/build-log |
| P-README | https://github.com/paper-design/agent-plugins/blob/main/plugins/paper-desktop/README.md |
| P-REMOTE | https://github.com/paper-design/agent-plugins/blob/main/plugins/paper/README.md (hosted server `https://mcp.paper.design`, OAuth) |
| P-MANIFEST | https://github.com/paper-design/agent-plugins/blob/main/claude-extensions/paper-desktop/manifest.json (`tools_generated: true`) |
| P-OLD | https://github.com/paper-design/agent-plugins/commit/7f69728b (early manifest naming `get_basic_info` with description) |
| WEBMCP | https://github.com/paper-design/webmcp-agent-example (README and `app/api/chat/route.ts`) |
| BUNDLE | https://app.paper.design/assets/MCPHandlers-Bc1Lc3DD.js (Tier 2) |

### What Tier 1 confirms on its own

- Tool names: `get_basic_info` with description (P-OLD; D-SUP tells users to ask the agent to call it), `get_tree_summary` (WEBMCP system prompt), `host_control_ping` (WEBMCP, which excludes it from the agent's tools, so it looks like plumbing).
- Reads: "artboard structure, screenshots, computed styles, JSX output, and text content" (P-README, P-REMOTE).
- Writes: "Create artboards, add or replace HTML nodes, update styles, set text, and duplicate elements" (P-README, P-REMOTE).
- Export of artboards as images or PDFs, plus reading and writing design tokens (P-REMOTE, D-TOK).
- Agents can "find, create, rename, move, and archive files and folders through MCP" (LOG, Oct 2026). Agents can create and open files and change pages (LOG, May 2026). Tools to "change layer order or reparent existing layers" (LOG). "Image generation via the MCP" (LOG). Comments "to communicate with your teammates and your agents" (LOG, Aug 2026).
- Agents get HTML extras: `<x-paper-clone node-id="…">` clones an existing node, and the `layer-name`, `data-paper-locked` and `hidden` attributes. Pasted HTML keeps only inline styles, and class or selector CSS is dropped (D-PASTE).
- "Visual feedback in Paper" while an agent examines a frame (D-MCP), plus "Teammate and agent presence in file" (LOG). This is the "working on" marker.
- Paper says components are "Coming soon" (LOG, Sep 2026).

## Paper's tools

All rows are Tier 2 (BUNDLE) unless marked. "File-scoped" tools also accept an optional `fileId`, which the registry wrapper adds, and default to the file the user is viewing. `pageId` defaults to the page the user is viewing. Annotation: R = `readOnlyHint`, W = `destructiveHint`.

### Files, folders, pages

| Name | Inputs | What it does | Ann. |
|---|---|---|---|
| `open_file` | `fileId` (ID, route or URL), `pageId?` | Opens a Paper file; returns a `get_basic_info` response | R |
| `list_resources` | `parentId?`, `limit?`, `includeArchived?` | Lists files and folders (open tabs first) | R |
| `create_file` | `name?`, `parentId?`, `cloneFileId?` | Creates a file in the active team | W |
| `create_folder` | `name?`, `parentId?` | Creates a folder | W |
| `rename_resource` | `resourceId`, `name` | Renames a file or folder | W |
| `archive_resources` | `resourceIds[]` | Archives files and folders, all or nothing | W |
| `unarchive_resources` | `resourceIds[]` | Restores archived items | W |
| `move_resources` | `resourceIds[]`, `parentId` | Moves files and folders into a folder | W |
| `create_page` | `name?`, `icon?` | Adds a page after the current one | W |
| `update_pages` | `updates[{pageId, name?, icon?}]` | Renames pages or changes their icons; does not switch the view | W |
| `arrange_pages` | `order[]` (page IDs or `{type:"divider"}`), `removeDividerIds?` | Reorders pages and adds or removes dividers. "Pages are never deleted" | W |

### Reading the design

| Name | Inputs | What it does | Ann. |
|---|---|---|---|
| `get_basic_info` | `pageId?` | File and page names, node count, artboards with sizes, fonts used, compact token list, page list. "Call first" (Tier 1: P-OLD, D-SUP) | R |
| `get_selection` | (only `fileId`) | IDs, names, types, sizes and artboard of the selected nodes | R |
| `get_node_info` | `nodeId` | Size, visibility, lock, parent, children IDs, plain text, world and relative x/y, image-generation status | R |
| `get_children` | `nodeId` | Direct children with types, child counts and positions | R |
| `get_tree_summary` | `nodeId`, `depth?` (default 3, max 10) | Compact indented outline of a subtree (Tier 1 name: WEBMCP) | R |
| `get_jsx` | `nodeId`, `format?` (`inline-styles` or `tailwind`), `includeNodeIds?` (default true), `includeRootPositioning?` | JSX for a node and its subtree; node IDs stay in as `id` attributes so the agent can target its edits | R |
| `get_computed_styles` | `nodeIds[]` | Map of node ID to computed CSS properties | R |
| `get_screenshot` | `nodeId`, `scale?` (1 or 2) | PNG of a node as base64 | R |
| `get_fill_image` | `nodeId` | The image fill as base64 JPEG plus the original URL | R |
| `find_nodes` | `pageId?`, `nodeId?`, `textValue?`, `filters[{styleName?, styleValue?}]?` | Finds nodes by computed style or token and/or text, with wildcards; colours match by value | R |
| `get_font_family_info` | `familyNames[]` | Whether a font is available, from local and Google Fonts, with its weights, styles and axes | R |
| `get_tokens` | `types?`, `namePattern?`, `format?` (`json`, `css`, `tailwind`) | Lists design tokens, or returns them as a `:root` block or a Tailwind v4 `@theme` block | R |
| `get_guide` | `topic` | Long guides: `paper-mcp-instructions` (the server tells agents to load it first), `mobile-status-bar`, `figma-import`, `image-generation` | R |

### Writing

| Name | Inputs | What it does | Ann. |
|---|---|---|---|
| `create_artboard` | `name`, `styles{width, height, …camelCase CSS}`, `pageId?` | New top-level frame, placed automatically; defaults to a flex column | W |
| `write_html` | `html`, `targetNodeId`, `mode` (`insert-children` or `replace`) | Parses inline-styled HTML into nodes inside the target or in place of it. The guidance says one visual group per call, prefer `<x-paper-clone>`, no margin, grid or tables, `paper-asset://` for local images and `paper-gen://` for AI images | W |
| `set_text_content` | `updates[{nodeId, html}]` | Replaces a text node's inner HTML (rich-text spans); ID and layout are kept | W |
| `update_styles` | `updates[{nodeIds[], styles{}}]` | Applies camelCase CSS to nodes; reports `ignoredStyles` that have no effect | W |
| `rename_nodes` | `updates[{nodeId, name}]` | Renames layers (50 characters max) | W |
| `duplicate_nodes` | `nodes[{id, parentId?}]` | Deep-clones nodes; returns `descendantIdMap` | W |
| `move_nodes` | `moves[]`: `{nodeId, before}`, `{nodeId, after}` or `{nodeId, parentId|'root', index?}` | Reorders or reparents nodes and keeps their IDs; works across pages; returns `affectedParents` | W |
| `delete_nodes` | `nodeIds[]` | Deletes nodes and their descendants | W, consequential |
| `create_tokens` | `tokens[{type, name:"--x", value, description?}]` | Creates design tokens; `var(--other)` makes an alias | W |
| `set_tokens` | `tokens[{name, newName?, value?, description?, delete?}]` | Renames, edits or deletes tokens | W |

### Export, comments, presence

| Name | Inputs | What it does | Ann. |
|---|---|---|---|
| `export` | `nodes` (`"nodes-with-exports-only"` or a map of node ID to `[{format, scale:"2x"|"512w"|"1080p", durationSeconds?, pdfQuality?, pdfResampling?}]`), `type?` (`image` or `video`), `pageId?` | Exports image, SVG, PDF or video (mp4/webm) files; the hosted server returns a download link valid for 24 hours | R |
| `export_combined_pdf` | not extracted | Exports several nodes into one PDF; Desktop only | R |
| `list_comment_threads` | filters: `pageId`, `nodeId`, `status`, `search`, author and participant, sort, `limit`, `offset`, … | Summaries of comment threads | R |
| `get_comment_thread` | `commentThreadId` | One thread in full, with replies, reactions and attachment URLs | R |
| `list_comment_thread_authors` | `pageId?` | People who commented, so names can be resolved to user IDs | R |
| `set_comment_thread_status` | `commentThreadId`, `status` (`open` or `resolved`) | Marks feedback as done or reopens it | W |
| `finish_working_on_nodes` | `nodeIds?` | "MUST call this when done working". Removes the working indicator from artboards the agent edited | R |

The server instructions (BUNDLE) also require agents to load `get_guide("paper-mcp-instructions")` first, to call `get_font_family_info` before any typography, to call `get_screenshot` at review checkpoints, to take exact values from `get_jsx` and `get_computed_styles` rather than from screenshots, and to never show node IDs to the user.

## Folio's tools against Paper's

Folio's definitions are in `src/ai-prompt.js` (21 tools, `get_document` through `set_interactions`). The bridge `mcp/folio-mcp.js` adds `open_folio`.

| Folio tool | Closest Paper tool(s) | Difference |
|---|---|---|
| `get_document` | `get_basic_info` + `get_selection` | Folio returns one outline that includes the selection and a brand summary. Paper splits this across two calls and adds fonts used and a token list |
| `get_tree` | `get_tree_summary`, `get_children`, `get_node_info`, `get_jsx` | Folio returns the full editable JSON (the `create_nodes` format) plus `_rendered` sizes. Paper returns a cheap outline, or JSX as a full read |
| `create_nodes` | `create_artboard` + `write_html` (`insert-children`) | Folio writes structured JSON (layout, sizing, style). Paper writes HTML. Paper needs `create_artboard` before it can write into a new artboard |
| `update_nodes` | `update_styles`, `rename_nodes`, `set_text_content` | Folio sends one deep-merge patch per node. Paper uses separate calls with raw CSS and reports `ignoredStyles` |
| `delete_nodes` | `delete_nodes` | Same |
| `move_nodes` | `move_nodes` | Paper adds before/after placement, moves across pages, and returns `affectedParents` |
| `screenshot` | `get_screenshot` | Same idea. Folio takes scale 0.1–2 with a 1400px cap; Paper takes scale 1 or 2. Paper also has `export` |
| `get_brand` | `get_tokens` | Paper has tokens only, with css and tailwind output. Folio's brand kit also holds voice, logos and style rules |
| `set_brand` | `create_tokens`, `set_tokens` | Paper tokens are free-form CSS variables with aliases. Folio has fixed core colour and font IDs, plus custom entries and kit templates |
| `list_components`, `create_component`, `create_instances`, `update_instances`, `add_starter_kit` | none | No component tools in the bundle; LOG lists components as "Coming soon". `duplicate_nodes` and `<x-paper-clone>` make unlinked copies |
| `draft_logo`, `save_logo` | none | Paper can write inline SVG through HTML (not confirmed for agents) and can generate images with `paper-gen://` |
| `manage_pages` | `create_page`, `update_pages`, `arrange_pages` | Paper cannot delete pages ("Pages are never deleted") or switch the user's view ("You can't switch their page"). Folio can do both |
| `import_html` | `write_html` | Paper's main way of writing. It can **replace** a node, which Folio cannot. Paper accepts only inline styles (D-PASTE). Folio accepts `<style>` and class CSS, `selector`, `base_url` and `width`, and can create its own artboard |
| `import_url` | none | Paper's Snapshot is a browser extension, not an MCP tool |
| `export_code` | `get_jsx` (+ `get_tokens` `css`/`tailwind`) | Paper outputs JSX with inline styles or Tailwind and can keep node IDs for round-trip edits. Folio outputs html-css, tailwind-html and a tailwind-react component with an `@theme` block |
| `set_interactions` | none | No prototyping tools |
| `open_folio` (bridge) | `open_file`, `list_resources` | Paper manages many files and tabs. Folio opens its one browser tab |

## What Paper's agents can do that Folio's can't

| Capability | Paper tool | Notes for Folio |
|---|---|---|
| Replace a node with new HTML | `write_html` mode `replace` | `import_html` only inserts |
| Read computed CSS | `get_computed_styles` | Folio exposes authored props plus `_rendered` size only |
| Find nodes by style, token or text | `find_nodes` | Folio has no search tool |
| "Working on" presence marker | `finish_working_on_nodes` (indicator) | Folio shows nothing on the canvas while the agent works, though the whole run undoes in one step |
| Rich text inside one text node | `set_text_content` (inline HTML spans) | Folio text nodes have one style |
| Clone inline while writing HTML | `<x-paper-clone node-id>` | Folio would need `create_nodes` from `get_tree` output |
| Duplicate with an ID map | `duplicate_nodes` | Folio has no duplicate tool |
| JSX that keeps node IDs for round-trip edits | `get_jsx includeNodeIds` | `export_code` has no IDs |
| Tokens as CSS or Tailwind `@theme` | `get_tokens format` | Folio puts `@theme` inside `export_code` only |
| Image, video and PDF export to files | `export`, `export_combined_pdf` | Folio's screenshot is a PNG returned to the agent |
| Read image fills as data | `get_fill_image` | — |
| Font availability lookup | `get_font_family_info` | — |
| Generate AI images | `paper-gen://` URLs in `write_html`, `update_styles`, `create_artboard` | — |
| Comment threads (read and resolve) | 4 comment tools | Folio has no comments |
| Files and folders (create, open, archive, move) | 8 resource tools | Folio has one document per tab |
| Work on another page without moving the user | `pageId` on most tools | Folio's `create_nodes` and `import_html` take `page_id`; most other Folio tools act on IDs |
| Long guides on demand | `get_guide` | Folio puts its guide in the system prompt |
| Hosted remote server and WebMCP | `mcp.paper.design`, WebMCP (P-REMOTE, WEBMCP) | Folio is local only |

## What Folio has that Paper lacks

| Capability | Folio tool |
|---|---|
| Components, variant sets, instances with overrides, detach | `list_components`, `create_component`, `create_instances`, `update_instances` |
| Ready-made starter component kit that follows the brand | `add_starter_kit` |
| Brand kit beyond tokens: voice, logos, style rules (button shape, density, shadow), templates, library kits | `get_brand`, `set_brand` |
| Logo designer with sanitized SVG, preview cards and light, dark, mono and metal versions | `draft_logo`, `save_logo` |
| Import a live URL | `import_url` |
| Import HTML that uses `<style>` and class CSS, a CSS `selector` and a viewport `width` | `import_html` |
| Prototyping: navigate, overlay, back, links, scroll, start screen | `set_interactions` |
| Delete pages and switch the user's view | `manage_pages` |
| Structured JSON node model for create and patch, with deep merge | `create_nodes`, `update_nodes`, `get_tree` |
| Export as plain HTML+CSS or as a React component with an `@theme` block | `export_code` |
| One-step undo of the agent's whole run | (system prompt, `src/ai-prompt.js`) |

## Unconfirmed

- **The 41-tool list itself** comes from the public web bundle (Tier 2), not from docs or packages. Unconfirmed: see the app scan (`research/paper-app-mcp-scan`).
- **The tool count differs between sources.** The bundle has 41 tools. The third-party proxy's README shows `doctor` reporting "36 tools available". The difference may be feature flags, versions or Desktop-only tools. Unconfirmed: see the app scan.
- **How the "working on" indicator is switched on.** There is no `start_working_on_nodes` tool, and only the release side is a tool. Whether write tools set the indicator automatically is not shown in the sources. Unconfirmed: see the app scan.
- **The hosted server's tool list.** `https://mcp.paper.design` returns 401 without OAuth. The `export` description mentions "Paper's remote MCP server", which suggests the same registry. Unconfirmed.
- **Inputs not extracted** for `export_combined_pdf`. `get_selection` appears to take only `fileId`.
- **The `get_guide` topic list.** Four topics were found; others may be gated.
- **Inline SVG in `write_html`** as a way for agents to make logos is inferred from the "use SVG icons" guidance, not stated as a tool feature.
- **`host_control_ping`** (WEBMCP) is not in the bundle registry. It may be specific to WebMCP or the host.
- Two third-party npm packages (`paper-remote-mcp`, `@try-works/dsh-paper-design`) were used only to find sources. None of their claims are relied on.
