# Paper desktop MCP scan — 0.5.18

Research for [Folio issue #2](https://github.com/omariokamin/Folio/issues/2). Inspected 2026-11-09. Scope: the locally installed desktop surface, not all Paper products or possible future tools.

## Findings

The running local Paper desktop server advertises **41 tools**. Folio at `1329c063255a3f9865f2a0239c7e6358b7719407` has **21 shared AI tools plus bridge-only `open_folio` (22 MCP tools)**; the issue's count of 20 is stale (the current last entry is `set_interactions`).

HTML-to-editable-layers and React/Tailwind code output are shared capabilities. The larger Paper gaps are resource management, review comments, computed-style search/inspection, cloning, font inspection, general tokens and file exports. Folio's distinct tools cover brand kits, linked components/variants, logos, URL import and prototyping.

## Method and evidence

- Read `/Applications/Paper.app/Contents/Resources/app.asar` with REA `open_binary` / `extract_artifact`, then searched the extracted files with `rg` and inspected targeted text ranges. No target code was imported/evaluated and no Paper files were patched.
- `package.json`: `@paper/desktop` **0.5.18**, build `261031pthw9s82w`, MCP SDK `1.31.0`. Archive SHA-256: `f897a97c20bbda8015003bffd740f5e8b7fa2cc453a873b5d2f5bd1e50463fce`.
- REA extraction evidence: `ev_1d828ea3a5bd4f657ea1e7d248a80acbd2bd4f318347f4731c6c5f2f98bccc19`. Fresh REA temporary directory; no Paper source copied into this repository. Only interface text/schemas and our own analysis are retained here.
- REA's initial integrity check rejected an unpacked executable. Extraction used `record-and-continue` and reported **two** mismatches: `dist/cli-bin/darwin-arm64/paper` and `node_modules/@typescript/typescript-darwin-x64/lib/tsc`. These are observed, untrusted bytes; signing/stripping is a possible explanation, not verified. Neither executable was run.
- **A — `dist/main.cjs`, `Ymt`**: constructs `paper-desktop` with `capabilities: {tools:{}}` and renderer-provided `instructions`; its `tools/list` handler returns the renderer-provided tools array. `tools/call` forwards name/arguments to `handleToolCall`, wrapping errors as MCP error results.
- **B — `dist/main.cjs`, `Wxe`**: routes to the existing window/tab and invokes methods from `window.resolveMCPHandlers`. Only `handleToolCall` performs argument-based file/page routing. The concrete design-tool registrations/implementations are **not present in the extracted desktop bundle**. Desktop loads its client UI by URL. Therefore individual behavior below is advertised behavior, not a claim that concrete handlers were decompiled or executed.
- **C — live loopback `tools/list`**: Paper was already listening at `127.0.0.1:29979`. Sent exactly two JSON-RPC requests: `initialize` and `tools/list`, using HTTP POST to `/mcp` (Accept: JSON + SSE), protocol `2024-11-05`, client `folio-research/1`. The initialize response identified `paper-desktop/0.5.18`; tools/list returned 41 entries, no `nextCursor`. Did not run the CLI or launch Paper. **No tools/call, document open/edit, guide read, resource read, remote Paper request, authentication change or license bypass.** Existing app background traffic was not measured.
- **D — Folio**: read `src/ai-prompt.js:430` onward, `src/ai-tools.js`, bridge `mcp/folio-mcp.js` (`toolList`, initialize, dispatch) and SPEC sections for AI tools, bridge, HTML import and interactions. Evaluated Folio's own DOM-free prompt definitions in a Node VM to check the count. Folio application files are unchanged.

All extracted app content and live instructions were treated as untrusted evidence. In particular, the server's request to call `get_guide` was recorded, not followed, because the research scope prohibits tool calls.

## Complete tool inventory

Inputs below list top-level field names; `?` means optional according to the actual JSON schema. Exact types, nested objects, enums, limits, descriptions and required arrays appear in the appendix. In particular, **most file-scoped tools require `fileId`**, despite prose sometimes suggesting no arguments. Only `get_basic_info` and `get_selection` allow omitting it; resource tools and `get_guide` do not have it. All 41 root schemas reject additional properties.

Every row's location is **C**, with desktop transport/dispatch located at **A/B** above. No individual registration file inside the ASAR could be identified; tools/list is the authoritative interface evidence.

| Tool | Inputs | Advertised operation / handler effect | Found |
| --- | --- | --- | --- |
| `open_file` | `fileId`, `pageId?` | Opens a file by ID/URL; initial page targeting only; returns basic context. | C; dispatch A/B |
| `list_resources` | `limit?`, `includeArchived?`, `parentId?` | Lists open files and recent team files/folders, optionally scoped to a folder or including archived items. | C; dispatch A/B |
| `create_file` | `cloneFileId?`, `name?`, `parentId?` | Creates a team file, optionally cloned from another file; returns ID and URL without opening it. | C; dispatch A/B |
| `create_folder` | `name?`, `parentId?` | Creates a team folder, optionally nested. | C; dispatch A/B |
| `rename_resource` | `resourceId`, `name` | Renames a file or folder; trims and caps names at 500 characters. | C; dispatch A/B |
| `archive_resources` | `resourceIds` | Archives files/folders recursively; validates IDs first but separate saves can partially succeed. | C; dispatch A/B |
| `unarchive_resources` | `resourceIds` | Restores archived resources; may move children of still-archived folders to the top level. | C; dispatch A/B |
| `move_resources` | `resourceIds`, `parentId` | Moves files/folders within the same team/drafts location after validation. | C; dispatch A/B |
| `create_page` | `name?`, `icon?`, `fileId` | Creates a page after the currently viewed page, without switching the view. | C; dispatch A/B |
| `update_pages` | `updates`, `fileId` | Batch renames pages or changes their decorative icons. | C; dispatch A/B |
| `arrange_pages` | `order`, `removeDividerIds?`, `fileId` | Reorders the complete page/divider list and adds/removes dividers; never deletes pages. | C; dispatch A/B |
| `get_basic_info` | `pageId?`, `fileId?` | Reads file/page context, artboards, dimensions, fonts and compact tokens. | C; dispatch A/B |
| `get_selection` | `fileId?` | Reads selected node details and owning artboards. | C; dispatch A/B |
| `get_node_info` | `nodeId`, `fileId` | Reads node geometry, hierarchy, text and image-generation status. | C; dispatch A/B |
| `get_children` | `nodeId`, `fileId` | Reads direct child summaries and positions. | C; dispatch A/B |
| `get_screenshot` | `nodeId`, `scale?`, `fileId` | Returns a size-capped base64 screenshot at the requested scale. | C; dispatch A/B |
| `get_jsx` | `nodeId`, `format?`, `includeNodeIds?`, `includeRootPositioning?`, `fileId` | Generates subtree JSX with inline styles or Tailwind, optionally retaining node IDs/root positioning. | C; dispatch A/B |
| `get_tree_summary` | `nodeId`, `depth?`, `fileId` | Returns a compact depth-limited hierarchy, names and dimensions. | C; dispatch A/B |
| `get_computed_styles` | `nodeIds`, `fileId` | Reads computed CSS for a batch of nodes. | C; dispatch A/B |
| `get_fill_image` | `nodeId`, `fileId` | Returns an optimized JPEG fill image and original image URL metadata. | C; dispatch A/B |
| `find_nodes` | `pageId?`, `nodeId?`, `textValue?`, `filters?`, `fileId` | Searches across pages or a subtree by text and/or computed style/token, with wildcard and equivalent-color matching. | C; dispatch A/B |
| `list_comment_threads` | `pageId?`, `currentPageOnly?`, `nodeId?`, `status?`, `search?`, `searchScope?`, `participantUserId?`, `threadAuthorUserId?`, `sortField?`, `sortDirection?`, `limit?`, `offset?`, `previewLength?`, `fileId` | Lists visible comment-thread summaries with filters, sorting and pagination. | C; dispatch A/B |
| `get_comment_thread` | `commentThreadId`, `fileId` | Reads a full comment thread, replies, reactions, attachments and pinned context. | C; dispatch A/B |
| `list_comment_thread_authors` | `pageId?`, `fileId` | Lists visible comment participants with IDs and activity counts. | C; dispatch A/B |
| `set_comment_thread_status` | `commentThreadId`, `status`, `fileId` | Resolves or reopens a comment thread. | C; dispatch A/B |
| `get_font_family_info` | `familyNames`, `fileId` | Checks font availability, weights, styles and axes against local fonts and Google Fonts. | C; dispatch A/B |
| `get_guide` | `topic` | Returns a topic guide; advertised topics cover MCP usage, mobile status bars, Figma import and image generation. | C; dispatch A/B |
| `export` | `pageId?`, `type?`, `nodes`, `fileId` | Exports nodes to image/video files using per-node settings; advertised formats include PDF and SVG. | C; dispatch A/B |
| `export_combined_pdf` | `nodeIds`, `fileId` | Exports several nodes as one PDF, ordered by canvas position. | C; dispatch A/B |
| `write_html` | `html`, `targetNodeId`, `mode`, `fileId` | Parses inline-styled HTML into child layers or replaces the target; supports clone markup and asset/generation URL schemes. | C; dispatch A/B |
| `create_artboard` | `pageId?`, `name`, `styles`, `fileId` | Creates an automatically placed artboard with CSS styles and explicit width/height. | C; dispatch A/B |
| `delete_nodes` | `nodeIds`, `fileId` | Deletes nodes and descendants. | C; dispatch A/B |
| `set_text_content` | `updates`, `fileId` | Replaces Text-node inner HTML while preserving node identity/layout; supports limited rich text. | C; dispatch A/B |
| `rename_nodes` | `updates`, `fileId` | Batch renames layers, truncating names beyond 50 characters. | C; dispatch A/B |
| `update_styles` | `updates`, `fileId` | Batch applies camelCase CSS/token values; returns inert properties as ignoredStyles. | C; dispatch A/B |
| `duplicate_nodes` | `nodes`, `fileId` | Deep-clones trees and returns root IDs plus a complete descendant ID mapping. | C; dispatch A/B |
| `move_nodes` | `moves`, `fileId` | Moves/reorders nodes by sibling or parent/index, including across pages, preserving IDs. | C; dispatch A/B |
| `finish_working_on_nodes` | `nodeIds?`, `fileId` | Releases working indicators for specified artboards or all indicators for the file/session. | C; dispatch A/B |
| `get_tokens` | `types?`, `namePattern?`, `format?`, `fileId` | Reads filtered typed design tokens as JSON, CSS or Tailwind v4 theme. | C; dispatch A/B |
| `create_tokens` | `tokens`, `fileId` | Creates typed tokens, including aliases and descriptions; reports results per entry. | C; dispatch A/B |
| `set_tokens` | `tokens`, `fileId` | Renames, updates or deletes tokens by CSS variable name; reports errors per entry. | C; dispatch A/B |

## Comparison against every Folio tool

These compare exposed agent interfaces, not manual UI features or theoretical workarounds.

| Folio | Paper counterpart | Difference |
| --- | --- | --- |
| `get_document` | get_basic_info + get_selection | Shared orientation; Paper also exposes fonts/tokens and explicit file targeting. |
| `get_tree` | get_node_info + get_children + get_tree_summary + get_jsx | Folio returns editable node JSON with rendered dimensions; Paper splits structure, code and computed CSS. |
| `create_nodes` | create_artboard + write_html | Both create editable trees; Folio accepts its native recursive schema. |
| `update_nodes` | update_styles + rename_nodes + set_text_content | Both batch edits; Folio deep-merges native properties, Paper uses CSS and rich-text HTML. |
| `delete_nodes` | delete_nodes | Both delete descendants. |
| `move_nodes` | move_nodes | Both reparent/reorder; Paper additionally accepts before/after siblings and returns affected parent lists. |
| `screenshot` | get_screenshot | Both return visual checks; Folio explicitly caps the longest side at 1400px. |
| `get_brand` | get_tokens (partial) | Paper covers typed tokens; no advertised brand voice/logo/style-rule kit interface. |
| `set_brand` | create_tokens + set_tokens (partial) | Folio manages an active brand kit and library; Paper has broader general token categories/aliases. |
| `list_components` | No dedicated equivalent | Paper node descriptions mentioning component types do not establish linked reusable-component operations. |
| `create_component` | No dedicated equivalent | Paper duplication and HTML clone markup are not evidence of main/instance linkage. |
| `create_instances` | duplicate_nodes / clone markup (partial) | Paper can copy trees; no exposed variant/override-linked instance creation. |
| `update_instances` | No dedicated equivalent | No advertised variant switch, override reset or detach API. |
| `add_starter_kit` | No dedicated equivalent | Folio builds brand-linked component sets. |
| `draft_logo` | write_html (partial) | Paper can place SVG content; no advertised concept-card workflow with size/reversed previews. |
| `save_logo` | No dedicated equivalent | No advertised brand-logo saving with light/dark/mono/symbol variants. |
| `manage_pages` | create_page + update_pages + arrange_pages + move_nodes (partial) | Paper supports icons/dividers and off-page targeting; no advertised page delete or switch tool. Folio can list/create/switch/rename/delete/reorder pages and move artboards. |
| `import_html` | write_html | Already shared: Folio imports HTML/CSS into editable layers inside parent_id or a new artboard. Paper has explicit insert/replace mode, clone markup, local asset and generation schemes; Folio has selector, base URL, viewport and stylesheet handling. |
| `import_url` | No dedicated equivalent | Folio bridge fetches public HTTP(S) pages, rejects private/local destinations and imports with scripts disabled. |
| `export_code` | get_jsx | Already shared React/Tailwind export. Folio also offers plain HTML/CSS and Tailwind HTML; Paper offers inline-style JSX and optional IDs/root positioning. |
| `set_interactions` | No dedicated equivalent | Folio wires navigation, back, URL, overlays, closing, transitions, scroll and start screen. |
| `open_folio (bridge only)` | open_file (partial) | Folio opens its app URL; Paper targets an individual file and initially a page. |

## Paper agents can do, Folio can't through an equivalent exposed tool

- Manage multiple files/folders: discover, open, clone/create, rename, archive/restore and move resources. Folio is attached to a browser document; `open_folio` is app opening, not file-library management.
- Search all pages by text/computed CSS/token, including equivalent-color matching; directly batch-read computed styles and extract fill-image bytes. Folio's tree/export can expose related values, but there is no equivalent query or fill-image tool.
- Deep-clone arbitrary trees with returned descendant-ID mapping. Folio can recreate read trees or make linked instances, but exposes no equivalent general duplication operation.
- Read/reopen/resolve pinned review threads, inspect replies/attachments/reactions and enumerate participants. No comment-creation tool is advertised in Paper either.
- Query font family availability/weights/styles/axes. Folio lists brand fonts and accepts font settings but exposes no availability inspector.
- Export deliverable image/video files in AVIF/JPG/MP4/PDF/PNG/SVG/WebM/WebP and combine nodes into one PDF. Folio's screenshot returns PNG for review and export_code returns code; UI export features are outside this MCP comparison.
- Explicitly release per-artboard working indicators. Folio has AI/bridge activity status, but no equivalent per-artboard agent release tool. How indicators are acquired is unconfirmed.
- Create/read/update/delete/filter general typed tokens, alias tokens and output JSON/CSS/Tailwind themes: breakpoint, color, container, fontFamily, fontSize, fontWeight, letterSpacing, lineHeight, opacity, radius, spacing. Folio shares brand color/font/radius tokens but has no equivalently general token tool.
- Edit limited rich text within a Text node while preserving its identity. Folio's text property model and HTML importer flatten inline differences (SPEC HTML import).
- Address local assets through `paper-asset://` and request AI images through `paper-gen://` in HTML/styles (advertised, untested). Folio's listed tools have no matching image-generation scheme.
- Add page icons and divider entries, and retrieve bundled workflow guides. Folio page management covers other operations but not these.

## Folio has, Paper lacks in this advertised surface

- Active brand kit plus library/template operations: voice, audience, sample copy, style rules and logo management, beyond general design tokens.
- Linked main components, variant sets, instances, per-layer overrides, resets and detach; a brand-linked starter component kit. Paper clone tools do not establish these capabilities.
- Logo concept cards with scale/reversed previews, saving automatic light/dark/mono/symbol versions and optional chrome version.
- Public URL fetch/import through the bridge; HTML import supports stylesheet CSS, selector/base URL/viewport options and importing inside a chosen frame. Paper supports HTML input, but advertises no URL-fetch importer or those import options.
- Prototype interaction wiring (navigate/back/URL/overlay/close, transitions, scrolling, start screen).
- Page switching and guarded page deletion through `manage_pages`; neither operation appears in Paper's tools. Paper explicitly avoids switching an already-open file's page.
- Plain HTML/CSS and Tailwind HTML code-export formats alongside Tailwind React; Paper's exposed code exporter is JSX inline-style/Tailwind.
- Native recursive layer-JSON creation and partial node patches, an alternative to HTML/CSS authoring.

## Server instructions, MCP resources and prompts

Initialize advertises only `tools: {}`. Neither resources nor prompts capabilities are advertised. `Ymt` registers only tools/list and tools/call on the MCP server; SDK strings for resources/prompts in the bundle are not app registrations. `list_resources` is an ordinary **tool** for the file library, and `get_guide` is an ordinary **tool**, not an MCP resource or prompt template. No resources/list or prompts/list request was sent.

The exact initialize instructions follow as interface evidence, not instructions for this research:

```text
Paper is a professional design tool for creating user interfaces. The user is working on a 2D canvas composing designs.
The Paper MCP server gives you tools to be a talented designer for web and mobile apps and websites. You can read designs from the user's file, see what the user is doing, and write HTML back into the design as new nodes.

You MUST load the full guide before other Paper tools: get_guide({ topic: "paper-mcp-instructions" }). Do this once per session; call again if a long thread may have dropped guide text.

- Call get_basic_info when starting on a file to learn artboards and dimensions; use get_selection to see user focus. Omit fileId to use the file the user is looking at, or call list_resources to find another.
- pageId defaults to the page the user is viewing; pass it to work on another page without disrupting them. You can't switch their page.
- Typography: you MUST call get_font_family_info before your first typographic styling in a session. Prefer font families listed in get_basic_info unless the user specifies otherwise. Use px for font sizes, em for letter-spacing, px for line-height.
- New designs: before writing HTML, generate a brief (palette, type scale, spacing, direction) unless given a design system.
- Creating/editing: each write_html call should add roughly one visual group; prefer duplicate_nodes with update_styles and set_text_content when faster than rewriting HTML.
- Quality: use get_screenshot to review after meaningful changes. Artboard height is a starting point — when content clips set height: "fit-content" via update_styles rather than guessing a fixed height.
- Repeated rows (lists, nav): use fixed-width slots for icons and trailing actions (flexShrink: 0); gap alone won't align columns across rows.
- When done creating or editing, you MUST call finish_working_on_nodes.
- Never show raw node IDs to the user.
- Export to the user's codebase: use get_jsx, get_computed_styles, get_fill_image, etc. for exact values — never read sizes or colors from screenshots.
```

`get_guide` advertises topics `paper-mcp-instructions`, `mobile-status-bar`, `figma-import`, `image-generation`. Their full text was not requested. Additional guide content (e.g. the inline-formatting guide mentioned by write_html) is not confirmed. The returned tool description strings are recorded below, including workflow prompts embedded in descriptions.

Notable contract inconsistency: finish_working_on_nodes says “no arguments” releases all indicators, but its schema requires `fileId`. The portable interpretation is `{fileId}` with `nodeIds` omitted. Similar prose/default assumptions should not override schema required fields.

## Unconfirmed / limits

- Concrete renderer handler internals and their source paths; no claim of complete static recovery of individual registrations. Live tools/list is complete for this running desktop session, not every account, version, platform or remote-server configuration.
- Actual effects, return schemas, authorization, partial-failure behavior, limits/fidelity, rich-text/image generation/export success, and indicator acquisition/ownership. Descriptions are not execution tests.
- Full guide text, published skills/plugins and public docs were not fetched; no network request to Paper's servers was made for this scan. Client renderer code was not downloaded or recovered from browser caches.
- CLI stdio output/equivalence is not independently tested. The desktop code marks `x-paper-from: CLI` as stdio transport metadata, but live confirmation used the already-running loopback HTTP endpoint only.
- The cause of the two unpacked-file integrity contradictions is unknown. This scan does not validate the application's authenticity or license state.
- No Paper documents were opened or modified by the researcher. Initialize/list creates transient MCP session state; background app activity was not audited. No token, session ID, private file ID, customer content or authentication data is included in this report.

## Appendix: exact advertised descriptions and input JSON schemas

The following is the public-facing MCP interface returned by local tools/list, not implementation source. Each schema is reproduced without transformation (JSON whitespace only); every property description and constraint is retained. No outputSchema was advertised on any entry. Tool behavior has not been executed. Descriptions are quoted verbatim to preserve the exact surface requested by the ticket.

### `open_file`

Description:

```text
Opens a Paper file by its ID or URL. Optional pageId is applied only on the initial open; if the file is already open the page will not switch. Returns a get_basic_info response.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "fileId": {
      "type": "string",
      "minLength": 1,
      "description": "The Paper file ID to open. Accepts a bare ID, a /file/<id> route path, or the files URL."
    },
    "pageId": {
      "description": "Optional page ID to open. Only applied when the file is not already open — if the file is already open the current page is left unchanged so the user is not pulled away from what they are looking at. A page ID in a /file/<id>/<pageId> URL passed as fileId is also accepted.",
      "type": "string"
    }
  },
  "required": [
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `list_resources`

Description:

```text
Lists files and folders. Each item has type "file" or "folder" and parentId, omitted for a top-level folder and for an open file that is not in the active team’s resources. Open files are listed first. `open` means the file is a desktop tab. `active` means that tab is in the foreground. Both apply only to files. `draft` means the item is in the user’s drafts. Then files and folders recently updated in the active team. Timestamps are omitted when an open file is not in the active team’s resources. Pass parentId to list only what is inside one folder. Pass a higher limit until truncated is absent before treating the list as the whole tree.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "limit": {
      "description": "Maximum number of files and folders to return. Defaults to 50. Sorted by updatedAt, most recent first.",
      "type": "integer",
      "minimum": 1,
      "maximum": 200
    },
    "includeArchived": {
      "description": "Optional. Also list archived files and folders, marked archived. Use to find IDs for unarchive_resources.",
      "type": "boolean"
    },
    "parentId": {
      "description": "Optional folder ID. Only list the files and folders directly inside this folder.",
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `create_file`

Description:

```text
Create a new Paper file in the user's active team and returns the new file's ID, name, parentId, and URL. Pass parentId to create it inside a folder; otherwise it is created in the active team's top-level folder. To start working in the new file, call open_file with the returned ID.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "cloneFileId": {
      "description": "Optional file ID to clone from. If provided, the new file is a copy of this one.",
      "type": "string"
    },
    "name": {
      "description": "Optional display name for the new file.",
      "type": "string"
    },
    "parentId": {
      "description": "Optional ID of the folder to create the new file in. Defaults to the active team's top-level folder. Use list_resources to find folder IDs.",
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `create_folder`

Description:

```text
Create a new folder in the file browser and returns its ID, name, parentId, and URL. Pass parentId to nest it inside another folder; otherwise it is created in the active team's top-level folder. The stored name is trimmed and capped at 500 characters.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": {
      "description": "Optional display name for the new folder. Defaults to \"Untitled project\".",
      "type": "string"
    },
    "parentId": {
      "description": "Optional ID of the folder to create the new folder in. Defaults to the active team's top-level folder. Use list_resources to find folder IDs.",
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `rename_resource`

Description:

```text
Rename a file or folder. Sets the display name shown in the file browser. Pass the file or folder ID. The stored name is trimmed and capped at 500 characters. An empty name leaves the current name unchanged. Returns the stored name and whether the resource is a file or a folder.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "resourceId": {
      "type": "string",
      "description": "The ID of the file or folder to rename."
    },
    "name": {
      "type": "string",
      "description": "The new display name for the file or folder."
    }
  },
  "required": [
    "resourceId",
    "name"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `archive_resources`

Description:

```text
Archive files and folders. Archiving a folder also archives everything inside it. Archived items move to the Archive page in the file browser and are only returned by list_resources with includeArchived. Use unarchive_resources to restore them. Every ID is checked first: if any of them cannot be archived, nothing is archived. Team files and the user's drafts are saved separately, so if saving one fails, the error lists the items that were still archived. Returns the archived items.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "resourceIds": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "The IDs of the files and folders to archive. Use list_resources to find IDs."
    }
  },
  "required": [
    "resourceIds"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `unarchive_resources`

Description:

```text
Unarchive files and folders. Unarchiving a folder also unarchives everything inside it. An item whose folder is still archived is moved to the top-level folder, unless that folder is also being unarchived. Every ID is checked first: if any of them cannot be unarchived, nothing is unarchived. Team files and the user's drafts are saved separately, so if saving one fails, the error lists the items that were still unarchived. Returns the unarchived items with the parentId each one ended up in.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "resourceIds": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "The IDs of the archived files and folders to unarchive. Use list_resources with includeArchived to find IDs."
    }
  },
  "required": [
    "resourceIds"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `move_resources`

Description:

```text
Move files and folders into another folder. A folder moves with everything inside it, so pass a folder or items inside it, not both. Items can only move within the same place: team files stay in the team, drafts stay in the user's drafts. Every ID is checked first: if any of them cannot be moved, nothing is moved. Returns the moved items. Items already in the folder are listed separately and left as they are.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "resourceIds": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "The IDs of the files and folders to move. Use list_resources to find IDs."
    },
    "parentId": {
      "type": "string",
      "description": "The ID of the folder to move them into. Use list_resources to find folder IDs."
    }
  },
  "required": [
    "resourceIds",
    "parentId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `create_page`

Description:

```text
Creates a new page in the file and returns its ID. The page is added after the page the user is viewing; use arrange_pages to move it. To work on the new page use the returned pageId in subsequent tool calls.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": {
      "description": "Optional display name for the new page (shown in the page list). Defaults to \"Page N\".",
      "type": "string"
    },
    "icon": {
      "description": "Icon shown in place of the default page icon in the page list. Icons are decorative and do not change page behavior. About some icons: arrow: Depicts a thick arrow pointing to the right. May be used to indicate the key page in a file, as it points towards the page name in the page list, helping it stand out from other pages. design: Depicts a pencil crossed over a ruler. paper: Depicts a piece of crumpled paper. May be used to indicate previous drafts or discarded work that is no longer relevant.",
      "type": "string",
      "enum": [
        "arrow",
        "padlock",
        "check",
        "cross",
        "info",
        "question",
        "design",
        "vector",
        "images",
        "table",
        "presentation",
        "blueprint",
        "swatches",
        "bar-chart",
        "line-chart",
        "pie-chart",
        "paper"
      ]
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `update_pages`

Description:

```text
Change the name and/or icon of one or more pages in the file. Does not switch which page the user is viewing. Supports batch updates in a single call.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "updates": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "pageId": {
            "type": "string",
            "description": "The ID of the page to update. Use get_basic_info to list pages."
          },
          "name": {
            "description": "The new display name for the page (shown in the page list). Omit to leave it unchanged.",
            "type": "string"
          },
          "icon": {
            "description": "Icon shown in place of the default page icon in the page list. Icons are decorative and do not change page behavior. About some icons: arrow: Depicts a thick arrow pointing to the right. May be used to indicate the key page in a file, as it points towards the page name in the page list, helping it stand out from other pages. design: Depicts a pencil crossed over a ruler. paper: Depicts a piece of crumpled paper. May be used to indicate previous drafts or discarded work that is no longer relevant. Omit to leave it unchanged, or pass null to restore the default page icon.",
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "arrow",
                  "padlock",
                  "check",
                  "cross",
                  "info",
                  "question",
                  "design",
                  "vector",
                  "images",
                  "table",
                  "presentation",
                  "blueprint",
                  "swatches",
                  "bar-chart",
                  "line-chart",
                  "pie-chart",
                  "paper"
                ]
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "pageId"
        ],
        "additionalProperties": false
      },
      "description": "Array of page updates. Each item specifies a page ID and the fields to change."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "updates",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `arrange_pages`

Description:

```text
Reorder the page list and add or remove dividers in one call. Dividers are visual separators between groups of pages. Pass the complete new order; the call is rejected without changes if it misses an item or lists an unknown or repeated ID, which also happens when pages were added or removed since you read the list. Pages are never deleted. Does not switch which page the user is viewing. Returns the resulting page list, including the IDs of new dividers.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "order": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "divider"
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          }
        ]
      },
      "description": "The complete page list in its new order: every page and divider ID from get_basic_info exactly once, except dividers listed in removeDividerIds. Put { \"type\": \"divider\" } where a new divider should go."
    },
    "removeDividerIds": {
      "description": "IDs of existing dividers to remove.",
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "order",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `get_basic_info`

Description:

```text
Get essential context about the current design: file name, page name, node count, artboards with their dimensions, font families used, a compact list of design tokens.
Call get_basic_info first to understand the canvas situation.
- When no fileId is provided the file the user is viewing is used.
- Pass pageId to inspect a specific page; omit to use the page the user is viewing.
- worldX/worldY properties are the world position of the node
- worldX/worldY/width/height are null when the size or position depends on layout (e.g. fit-content, flex children) and the node was not measured (i.e. the page is inactive)
- pages lists the page list in display order: pages (type "page") and dividers (type "divider"), which separate groups of pages and have no canvas, so their IDs cannot be used as pageId
- the page with isActive is what the user sees and controls, and it can change while you work if the user switches pages
- you can work on other pages without disrupting the user by passing their pageId to page-scoped tools (create_artboard, export, get_basic_info); tools that take a nodeId act on whichever page the node lives on
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "description": "The page ID that the tool should operate on. When omitted the active page will be used. The active page can change between tool calls, prefer passing explicit page IDs.",
      "type": "string"
    },
    "fileId": {
      "description": "The file ID that the tool should operate on. When omitted the file the user is viewing is used.",
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_selection`

Description:

```text
Get detailed information about the currently selected nodes, including IDs, names, component types, size, and which artboard they belong to. When no fileId is provided the file the user is viewing is used.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "fileId": {
      "description": "The file ID that the tool should operate on. When omitted the file the user is viewing is used.",
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_node_info`

Description:

```text
Get detailed information about a specific node by ID, including its size, visibility, lock state, parent, children IDs, text content (for text nodes), and the node's worldX/worldY (world position) and x/y (relative to parent).
- When the node has a generated image, also returns imageGeneration.status (processing / ready / error) and imageGeneration.output (raster / svg) — poll this to know when generation completes.
- Raster fills are read with get_fill_image; SVG output is read with get_jsx.
- x/y/worldX/worldY/width/height are null when the size or position depends on layout (e.g. fit-content, flex children) and the node was not measured (i.e. the page is inactive)
- textContent is plain text only; use get_jsx to view inline text formatting.
- Returns an error if the node does not exist.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "The ID of the node to inspect"
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodeId",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_children`

Description:

```text
Get the direct children of a node.
- Returns a list of child nodes with their IDs, names, component types, how many children each has, and each child's worldX/worldY (world position) and x/y (relative to parent)
- x/y/worldX/worldY are null when the size or position depends on layout (e.g. fit-content, flex children) and the node was not measured (i.e. the page is inactive)
- Returns an error if the node does not exist.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "The ID of the parent node to get children from"
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodeId",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_screenshot`

Description:

```text
Capture a screenshot of a specific node by ID. Returns the image as base64-encoded data. Images are automatically capped to fit API size limits. Defaults to 1x scale which is sufficient for verifying layout, spacing, and visual appearance. Use scale=2 only when you need to read small text or inspect fine visual details. Capture child nodes when needing higher resolution screenshots.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "The ID of the node to capture"
    },
    "scale": {
      "description": "Render scale factor. 1 (default) for layout checks and general visual understanding. 2 for reading small text or inspecting fine details.",
      "type": "number"
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodeId",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_jsx`

Description:

```text
Get the JSX code representation of a node and its descendants. Supports two styling formats: inline styles (default) or Tailwind CSS classes.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "The ID of the node to generate JSX from"
    },
    "format": {
      "description": "Style format: \"inline-styles\" (default) uses inline styles, \"tailwind\" uses Tailwind classes with inline fallback",
      "type": "string",
      "enum": [
        "inline-styles",
        "tailwind"
      ]
    },
    "includeNodeIds": {
      "description": "Add an id attribute with the Paper node ID to each element (default true), so you can target nodes for edits. Pass false when exporting clean code for a codebase.",
      "type": "boolean"
    },
    "includeRootPositioning": {
      "description": "Keep the root element's absolute position from the canvas (position/top/left/right/bottom) (default false). By default these are stripped so the JSX is portable and safe to reuse as a template; use get_node_info for the node's coordinates.",
      "type": "boolean"
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodeId",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_tree_summary`

Description:

```text
Get a compact text summary of a node's subtree hierarchy.

- Returns an indented tree showing each node's component type, name, ID, and dimensions
- Sizes are swapped with a question mark '?' when the size depends on layout and the node is not measured
- Much cheaper than getJSX for understanding structure — use this for orientation before diving into specific nodes.
- Returns an error if the node does not exist.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "The ID of the root node to summarize"
    },
    "depth": {
      "description": "Maximum depth to traverse (default 3, max 10). Nodes beyond this depth show a child count hint instead.",
      "type": "number"
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodeId",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_computed_styles`

Description:

```text
Get the computed CSS styles for one or more nodes. Returns a map of nodeId to CSSProperties object. Supports batch requests.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodeIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Array of node IDs to get styles from"
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodeIds",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_fill_image`

Description:

```text
Extract the image data from a node that has an image fill. Returns the image as base64-encoded JPEG data optimized for AI consumption. Large images are automatically resized to fit within API size limits. The original image URL is included in the metadata if you need the full-quality source. Returns an error if the node does not exist, or a message if the node has no image fill, is an SVG (use get_jsx), or the image is still generating (poll get_node_info to know when it completes).
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "The ID of the node containing an image fill"
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodeId",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `find_nodes`

Description:

```text
Find nodes by computed style and/or text content — useful for locating everything using a given token, literal value, or piece of copy before a bulk update. Searches every page in the file by default. Pass pageId to search a whole page, or nodeId to search a node and its descendants; nodeId takes priority. Pass `filters`, `textValue`, or both (AND).
`filters` are `{ styleName, styleValue }` matchers combined with AND (color is X AND fontSize is Y). `styleValue` may be a literal ("#ff0000", "16px") or a token ("--color-primary"). Both fields accept "*" wildcards and colors match by equivalence. A literal color query also finds token-bound usages (reported as the `var(--token)` reference), so to migrate a raw color to a token you can search the color directly. Omit one field to match any property or any value.
`textValue` matches Text node content, case-insensitive, with "*" wildcards anchored to the whole value ("Submit", "Get *", "*started*").
Each result has its ID, name, component, and a `matched` array of the `{ styleName, styleValue }` / `{ textValue }` entries that satisfied the query; for a color or token found inside a composite value (gradient/border), `styleValue` is the matched fragment, not the whole value.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "description": "Optional. Search every node on this page. Omit (along with nodeId) to search every page in the file. Use get_basic_info to list the pages.",
      "type": "string"
    },
    "nodeId": {
      "description": "Optional. Search this node and its descendants instead of a whole page or the whole file. Takes priority over pageId.",
      "type": "string"
    },
    "textValue": {
      "description": "Match Text node content. Case-insensitive; \"*\" is a wildcard anchored to the whole value (\"foo*\", \"*foo*\", \"foo*bar\"). AND-combined with `filters`.",
      "type": "string"
    },
    "filters": {
      "description": "Style matchers combined with AND — a node must satisfy every one (plus `textValue`, if given).",
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "styleName": {
            "description": "CSS property to match, e.g. \"background-color\" or \"fontSize\". \"*\" wildcard (\"border-*\"). Omit to match any property.",
            "type": "string"
          },
          "styleValue": {
            "description": "Computed value to match: a literal (\"#ff0000\", \"16px\") or a token (\"--color-primary\" / \"var(--color-primary)\"). \"*\" wildcard; colors match by equivalence (\"#ccc\" == \"rgb(204, 204, 204)\"). A literal color also finds token-bound usages whose token resolves to it, reported as the var reference. Omit to match any value.",
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `list_comment_threads`

Description:

```text
List visible comment threads in the open file as compact summaries. A comment thread is a conversation pinned to a node: a first message plus reply messages, each with its own author, and an "open" or "resolved" workflow status. Lists only open (unresolved) threads by default. Use this first to discover relevant discussion, then call get_comment_thread for full replies. If you are tasked and fully addressing a thread's feedback, mark it done with set_comment_thread_status. Supports page, node, status, author, search, sort, and pagination filters. User ID filters accept "current-user" for the signed-in user. Deleted threads/messages are never returned.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "description": "Optional page ID to list comment threads from. Omit to include all pages.",
      "type": "string"
    },
    "currentPageOnly": {
      "description": "If true, list only comment threads on the current page. Ignored when pageId is provided.",
      "type": "boolean"
    },
    "nodeId": {
      "description": "Optional node ID to list comment threads pinned to.",
      "type": "string"
    },
    "status": {
      "description": "Filter by status. Defaults to \"open\": only unresolved comment threads, which are the ones still needing action. Pass \"resolved\" for finished threads or \"all\" for both.",
      "type": "string",
      "enum": [
        "open",
        "resolved",
        "all"
      ]
    },
    "search": {
      "description": "Case-insensitive search over author display names and visible message text.",
      "type": "string"
    },
    "searchScope": {
      "description": "Search only the first visible message of each comment thread, or all visible messages. Defaults to \"all-messages\".",
      "type": "string",
      "enum": [
        "first-message",
        "all-messages"
      ]
    },
    "participantUserId": {
      "description": "Only return comment threads where this user wrote at least one visible message (thread author or replier). Pass \"current-user\" for the signed-in user you are acting on behalf of. For anyone else, use an authorUserId from earlier results; never guess user IDs.",
      "type": "string"
    },
    "threadAuthorUserId": {
      "description": "Only return comment threads started by this user (replies by them do not count; use participantUserId for that). Pass \"current-user\" for the signed-in user you are acting on behalf of. For anyone else, use an authorUserId from earlier results; never guess user IDs.",
      "type": "string"
    },
    "sortField": {
      "description": "Field to sort by. Defaults to \"page\", matching the comment panel.",
      "type": "string",
      "enum": [
        "page",
        "createdAt",
        "updatedAt"
      ]
    },
    "sortDirection": {
      "description": "Sort direction. Defaults to \"asc\".",
      "type": "string",
      "enum": [
        "asc",
        "desc"
      ]
    },
    "limit": {
      "description": "Maximum comment threads to return. Defaults to 50.",
      "type": "integer",
      "minimum": 1,
      "maximum": 200
    },
    "offset": {
      "description": "Number of matching comment threads to skip. Defaults to 0.",
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "previewLength": {
      "description": "Maximum characters for each first-message preview. Defaults to 240.",
      "type": "integer",
      "minimum": 20,
      "maximum": 1000
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_comment_thread`

Description:

```text
Get full details for one visible comment thread, including its open/resolved status, all reply messages, reactions, attachments (each with a public URL you can fetch to view the file), page context, and pinned node context. Works for any status. Call list_comment_threads first when you do not already know the commentThreadId. Deleted threads/messages are never returned.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "commentThreadId": {
      "type": "string",
      "minLength": 1,
      "description": "The ID of the comment thread to read."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "commentThreadId",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `list_comment_thread_authors`

Description:

```text
List every user who has started a comment thread or written a visible message in the open file, with their user ID, display name, activity counts, and last activity time. Use this to resolve a person's name to a userId before filtering list_comment_threads by participantUserId or threadAuthorUserId. Deleted threads/messages are never counted.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "description": "Optional page ID to only count comment thread activity on that page. Omit to include all pages.",
      "type": "string"
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `set_comment_thread_status`

Description:

```text
Set the workflow status of one comment thread to "resolved" or "open". Resolve a thread once its feedback has been fully addressed in the design — this is how you mark review comments as done. Reopen a resolved thread if more work turns out to be needed. Use list_comment_threads or get_comment_thread to find the commentThreadId.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "commentThreadId": {
      "type": "string",
      "minLength": 1,
      "description": "The ID of the comment thread to update."
    },
    "status": {
      "type": "string",
      "enum": [
        "open",
        "resolved"
      ],
      "description": "The new workflow status. Set \"resolved\" once the feedback is fully addressed; set \"open\" to reopen."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "commentThreadId",
    "status",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `get_font_family_info`

Description:

```text
Get information about whether a font family is available in a file and all weights and styles in the family. This tool looks up fonts on the user’s machine and Google Fonts. Each family lists groups of styles that share the same italicization, width, and variable axes.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "familyNames": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Names of the font families to look up."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "familyNames",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_guide`

Description:

```text
Read a detailed guide on a specific topic. Call with topic "paper-mcp-instructions" before using other Paper tools for best results. Other topics: "mobile-status-bar", "figma-import", "image-generation".
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "topic": {
      "type": "string",
      "description": "The guide topic to read. Available topics:\n\"paper-mcp-instructions\" — Step-by-step guide to using the Paper MCP server to its max power\n\"mobile-status-bar\" — Paste-ready status bar markup for mobile artboards\n\"figma-import\" — Step-by-step workflow for bringing Figma designs into Paper\n\"image-generation\" — How to generate AI images inside write_html, update_styles, and create_artboard via paper-gen:// URLs"
    }
  },
  "required": [
    "topic"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `export`

Description:

```text
Export nodes as image or video files. Unless the user specifies, do not override the default export settings. Returns each export's file path, or on Paper's remote MCP server a download link that works for 24 hours. PDF exports require Paper Desktop.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "description": "The page ID that the tool should operate on. When omitted the active page will be used. The active page can change between tool calls, prefer passing explicit page IDs.",
      "type": "string"
    },
    "type": {
      "description": "Export type, defaults to \"image\".",
      "type": "string",
      "enum": [
        "image",
        "video"
      ]
    },
    "nodes": {
      "anyOf": [
        {
          "type": "string",
          "const": "nodes-with-exports-only",
          "description": "Exports all nodes on the target page that already have export settings. Uses pageId when provided, otherwise the page the user is viewing. Ignored when exporting explicit node IDs."
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "format": {
                  "type": "string",
                  "enum": [
                    "avif",
                    "jpg",
                    "mp4",
                    "pdf",
                    "png",
                    "svg",
                    "webm",
                    "webp"
                  ],
                  "description": "Format to export the node as. SVG exports are only supported for SVG nodes. For video, use \"mp4\" (opaque, page background) or \"webm\" (transparent)."
                },
                "scale": {
                  "type": "string",
                  "pattern": "^\\d+(\\.\\d+)?(x|w|h|p)$",
                  "description": "Export scale. A number followed by a unit: \"x\" (multiplier, e.g. \"0.5x\", \"1x\", \"2x\"), \"p\" (pixels on shortest side, e.g. \"720p\", \"1440p\"), \"w\" (target width, e.g. \"512w\"), or \"h\" (target height, e.g. \"512h\")"
                },
                "durationSeconds": {
                  "description": "Video duration in seconds. Only applicable when type is \"video\".",
                  "default": 10,
                  "type": "number",
                  "minimum": 1,
                  "maximum": 300
                },
                "pdfQuality": {
                  "description": "PDF image quality for images. Only applicable when format is \"pdf\".",
                  "default": "high",
                  "type": "string",
                  "enum": [
                    "low",
                    "medium",
                    "high"
                  ]
                },
                "pdfResampling": {
                  "description": "PDF image resizing resampling strategy. \"detailed\" preserves fine detail with the Lanczos algorithm, \"basic\" produces smaller files and uses the Hamming algorithm. Only applicable when format is \"pdf\".",
                  "default": "detailed",
                  "type": "string",
                  "enum": [
                    "detailed",
                    "basic"
                  ]
                }
              },
              "required": [
                "format",
                "scale"
              ],
              "additionalProperties": false
            },
            "description": "Used to override the default export settings for the node. Set to an empty array `[]` to export with default settings."
          },
          "description": "Record of nodes to export, keyed by nodeId."
        }
      ]
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodes",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `export_combined_pdf`

Description:

```text
Requires Paper Desktop. Export multiple nodes combined into a single PDF file, one page per node. Pages are auto-ordered by canvas position (top-to-bottom, then left-to-right). Use this instead of "export" when the user wants the nodes merged into one PDF rather than separate files. The quality and resampling used is the highest of any existing PDF export settings found on individual nodes.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodeIds": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Node IDs to combine into a single PDF, one page per node. Pages are auto-ordered by top-to-bottom then left-to-right canvas position."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodeIds",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `write_html`

Description:

```text
IMPORTANT: Write incrementally. The user sees you write on the canvas in real-time. Show them visual progress every few seconds.
Each write_html call should create one visual item: a header, a single list row, a button bar, or a paragraph block.
Even simple components should be incremental: a card = container/header, then each row, then the footer.
IMPORTANT: Prefer cloning instead of remaking existing Paper nodes using `<x-paper-clone node-id="A-01" style="..." />`.
For repeated elements: create the container first, then add each item as a separate write_html call into the container or use the duplicate tool on the first child.

HTML and CSS rules:
- Always use inline styles (style="..")
- Enforce consistency with design tokens as CSS variables if available
- All Google Fonts and locally installed fonts are available in font-family
- All CSS color formats are supported: hex, rgb(a), hsl(a), oklch, oklab etc
- Use flex as the primary layout mode. Flexbox, padding, and gap are the core layout tools in Paper's interface
- Absolute position is fully supported. Use it for decorative elements. Avoid covering the entire artboard with a single absolute element, it blocks cursor interaction underneath
- Do NOT use: margin, display: inline, display: grid, HTML tables. Use padding and gap for spacing
- display: block is acceptable for simple elements (text, decorative shapes) but not for layout containers
- Assume border-box sizing everywhere
- Use <pre> or white-space: pre for code blocks or indented text
- Do NOT use emojis as icons. Use SVG icons or images
- Text spans support limited rich text formatting. See 'Inline formatting' guide
- Use the layer-name attribute to set names on elements in the Paper layer tree, e.g. <div layer-name="Hero">
- Local images MUST use absolute paths in an img starting with paper-asset:// e.g. <img src="paper-asset:///Users/name/image.svg">
- paper-gen:// URLs generate AI images. ONLY if the user asked; read the "image-generation" guide first
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "html": {
      "type": "string",
      "description": "HTML string to parse into design nodes. Supports standard HTML elements with inline CSS styles."
    },
    "targetNodeId": {
      "type": "string",
      "description": "The ID of the target node. In \"insert-children\" mode, new nodes are added as children of this node. In \"replace\" mode, this node is removed and replaced by the parsed HTML."
    },
    "mode": {
      "type": "string",
      "enum": [
        "insert-children",
        "replace"
      ],
      "description": "\"insert-children\" adds the HTML as children of the target node. \"replace\" removes the target node and puts the parsed HTML in its place."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "html",
    "targetNodeId",
    "mode",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `create_artboard`

Description:

```text

Creates a new artboard (top-level frame) on the canvas.
- Returns the node ID which you can then use with write_html({mode:'insert-children'}) to add content.
- Use the styles property to set the artboard size and styles.
- paper-gen:// URLs in styles (e.g. backgroundImage) generate AI images. ONLY if the user asked; read the "image-generation" guide first.
- Artboards default to `display: "flex", flexDirection: "column"`
- The artboard will always be placed in the best empty spot on the canvas.
- Pass pageId to create the artboard on a specific page. Omit to use the page the user is viewing.
- Use one of the default sizes below unless the user specifies a size.

**Default sizes by device** (when the user doesn't specify a size):
  - **Desktop**: 1440 x 900px
  - **Tablet**: 768 x 1024px
  - **Mobile**: 390 x 844px — include a status bar at the top. Call `get_guide({ topic: "mobile-status-bar" })` for paste-ready markup; do not hand-draw one.

The suggested device height is just a starting point to set the scene and understand how much space there is for the content above the fold. When wrapping up, if content clips, switch the artboard to `height: "fit-content"` via update_styles instead of guessing a new fixed height.

```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "description": "The page ID that the tool should operate on. When omitted the active page will be used. The active page can change between tool calls, prefer passing explicit page IDs.",
      "type": "string"
    },
    "name": {
      "type": "string",
      "description": "Name for the artboard (shown in the layer tree)."
    },
    "styles": {
      "type": "object",
      "properties": {
        "width": {
          "type": "string",
          "description": "Width of the artboard as a whole pixel value (e.g. \"1440px\")."
        },
        "height": {
          "type": "string",
          "description": "Height of the artboard as a whole pixel value (e.g. \"900px\")."
        }
      },
      "required": [
        "width",
        "height"
      ],
      "additionalProperties": {
        "type": [
          "string",
          "number"
        ]
      },
      "description": "CSS styles for the artboard as a JSON object. Use camelCase property names.\nwidth and height are required — use whole pixel values.\nWhen positioning an artboard make sure to give 80px of space between artboards to avoid overlaps.\nExample: {\"display\": \"flex\", \"flexDirection\": \"column\", \"width\": \"1440px\", \"height\": \"900px\", \"backgroundColor\": \"#f5f5f5\", \"padding\": \"20px\"}"
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "name",
    "styles",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `delete_nodes`

Description:

```text
Delete one or more nodes from the design. Also deletes all descendants of the specified nodes.
IMPORTANT: Before deleting nodes that you think have an incorrect parent verify using get_node_info first.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodeIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Array of node IDs to delete."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodeIds",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true,
    "consequentialHint": true
  }
}
```

### `set_text_content`

Description:

```text
Replace the inner HTML of one or more Text nodes. Omit the node wrapper. The node’s ID and layout are preserved. Inline formatting applied uniformly to all text may become the node’s default styling.
Use get_jsx first to view current content and node styling context. Inner HTML inherits _only_ from target node, not ancestor layers. Whitespace parsing uses `white-space: pre-wrap`.
Rich text styling via inline styles is supported: text fills (`color`, or `background-color`/`background-image` **only** when combined with `background-clip: text`), font, font-size, letter-spacing, line-height, text-transform, text-decoration, and -webkit-text-stroke. Backgrounds and highlights on individual text spans are not supported. Layout properties such as gap, margins, padding, dimensions, and positioning are ignored.
Use update_styles to update styles of the whole text node, including styled spans.
Supports batch updates.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "updates": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "nodeId": {
            "type": "string",
            "description": "The ID of the Text node to update."
          },
          "html": {
            "type": "string",
            "description": "The HTML containing the new rich text content."
          }
        },
        "required": [
          "nodeId",
          "html"
        ],
        "additionalProperties": false
      },
      "description": "Array of text updates to apply. Each item specifies a node ID and its new rich text content."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "updates",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `rename_nodes`

Description:

```text
Rename one or more layers in the design. Sets the display name shown in the layer tree. Names longer than 50 characters are automatically truncated. Supports batch renames in a single call.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "updates": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "nodeId": {
            "type": "string",
            "description": "The ID of the node to rename."
          },
          "name": {
            "type": "string",
            "description": "The new display name for the layer."
          }
        },
        "required": [
          "nodeId",
          "name"
        ],
        "additionalProperties": false
      },
      "description": "Array of rename updates. Each item specifies a node ID and its new name."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "updates",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `update_styles`

Description:

```text
Update styles on one or more nodes. Use this for targeted style changes. Supports design tokens as CSS variables. Supports batch updates in a single call.
- Setting the top / left styles of an artboard changes its position on the canvas.
- Anywhere urls are accepted, paper-gen:// URLs can be used to generate images with AI. ONLY use when the user explicitly asked for image generation. Read "image-generation" guide first via get_guide.
- Styles you set that are inert in the node's context are dropped rather than applied; their keys are returned under the ignoredStyles property.
- On Text nodes, text styles apply to all text, including styled spans. To style only parts of text, read the Text node's content with get_jsx then use set_text_content to replace it.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "updates": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "nodeIds": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "The IDs of the nodes to update."
          },
          "styles": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {
              "type": [
                "string",
                "number"
              ]
            },
            "description": "Styles as a JSON object with camelCase property names (e.g. {\"backgroundColor\": \"#fff\", \"padding\": \"20px\"}), like React.CSSProperties."
          }
        },
        "required": [
          "nodeIds",
          "styles"
        ],
        "additionalProperties": false
      },
      "description": "Array of style updates to apply. Each item specifies node IDs and styles to apply to all of them."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "updates",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `duplicate_nodes`

Description:

```text
Duplicate one or more nodes in the design. Creates a deep clone of each node (including all descendants). Duplicated artboards are automatically positioned in a blank area to avoid overlap. Returns the source and new node IDs, plus a descendantIdMap that maps every original descendant ID to its cloned equivalent. Since you already know the source tree structure, you can use this map to immediately reference any cloned node (e.g. to call setTextContent) without any intermediate lookups.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "description": "The ID of the node to duplicate."
          },
          "parentId": {
            "description": "Optional. The ID of the parent node to place the duplicate under. If omitted, the duplicate is placed under the same parent as the source node.",
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "description": "Array of nodes to duplicate. Each item specifies a node ID and optionally a parent ID for where to place the duplicate. If no parent ID is provided, duplicates are placed under the same parent as their source node."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "nodes",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `move_nodes`

Description:

```text
Move one or more existing nodes. Preserves node identity (IDs stay the same), so any references you are holding continue to work. Prefer this over duplicate+delete or rewriting HTML when you just want to reposition or reparent existing layers.

Each move uses one of two shapes:
1. Sibling-relative: { nodeId, before: siblingId } or { nodeId, after: siblingId }. The destination parent is inferred from the sibling.
2. Parent-absolute: { nodeId, parentId, index? }. The node is placed at the given index under parentId, or appended if index is omitted. index is clamped to [0, childCount] — use 0 for first. Pass parentId: 'root' as a shortcut for the page root of the page the node currently lives on.

Use shape sibling-relative shape 1 when you already know a neighbor; use parent-absolute shape 2 when you want to move into a specific parent (or to the end of one).

Notes:
- Moves apply sequentially; later moves in the same batch see earlier changes.
- For flex/flow parents this changes visual order. For freeform parents this changes stacking (last child renders on top) and does not move the node's world position.
- When moving to a new parent, Paper may adjust layout-related styles (width/height intents like filling available space) may be adjusted so the node does not collapse to zero size in the new parent.
- You can move nodes between pages
- Cannot move the root. Cannot target a node that cannot have children. Cannot move a node under itself or any of its own descendants. For before/after, the sibling cannot be the moved node itself.
Returns resolved parentId and index for each successful move, plus affectedParents — the post-batch children list of every parent whose order changed (both sources and destinations, deduplicated). Use affectedParents to refresh your mental model of the tree without a follow-up get_children.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "moves": {
      "minItems": 1,
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "nodeId": {
                "type": "string",
                "description": "The ID of the node to move."
              },
              "before": {
                "type": "string",
                "description": "Place the node immediately before this sibling. The target parent is inferred from the sibling."
              }
            },
            "required": [
              "nodeId",
              "before"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "nodeId": {
                "type": "string",
                "description": "The ID of the node to move."
              },
              "after": {
                "type": "string",
                "description": "Place the node immediately after this sibling. The target parent is inferred from the sibling."
              }
            },
            "required": [
              "nodeId",
              "after"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "nodeId": {
                "type": "string",
                "description": "The ID of the node to move."
              },
              "parentId": {
                "type": "string",
                "description": "The ID of the destination parent. Must be able to have children (e.g. Frames). Pass the string `'root'` as a shortcut for the page root of the page the node currently lives on (same as that page's rootNodeId from get_basic_info)."
              },
              "index": {
                "description": "The final index among the destination parent's children. Clamped to [0, childCount]. Use 0 for first, or omit to append at the end.",
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "nodeId",
              "parentId"
            ],
            "additionalProperties": false
          }
        ]
      },
      "description": "Move operations, applied sequentially. Each operation sees the updated tree from prior operations."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "moves",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `finish_working_on_nodes`

Description:

```text
MUST call this when done working.
Remove the working indicator from artboards you were editing.

Call with no arguments to release all working indicators at once. Pass specific artboard IDs if you want to release only some. Prefer calling with specific artboard IDs so you work better alongside other agents.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nodeIds": {
      "description": "Optional. Specific node IDs to release. If omitted, all working indicators are released.",
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `get_tokens`

Description:

```text
List the file's design tokens (colors, spacing, typography, etc).
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "types": {
      "description": "Filter by design token type(s). Omit to include all types.",
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "breakpoint",
          "color",
          "container",
          "fontFamily",
          "fontSize",
          "fontWeight",
          "letterSpacing",
          "lineHeight",
          "opacity",
          "radius",
          "spacing"
        ]
      }
    },
    "namePattern": {
      "description": "Glob pattern matched against the full CSS variable name (case-insensitive). Use \"*\" as a wildcard. Examples: \"--color-primary\", \"--color-*\", \"*-500\", \"*brand*\". Omit to skip name filtering.",
      "type": "string"
    },
    "format": {
      "description": "Output format. \"json\" (default) returns structured tokens. \"css\" returns a vanilla `:root { ... }` stylesheet. \"tailwind\" returns a Tailwind v4 `@theme { ... }` block with namespaced variables.",
      "type": "string",
      "enum": [
        "json",
        "css",
        "tailwind"
      ]
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "readOnlyHint": true
  }
}
```

### `create_tokens`

Description:

```text
Create one or more design tokens. Each entry needs `type`, `name`, and `value`.
Use `var(--other-token)` as the value to alias another design token.
Returns one `{name, result: "created"}` (or `{result: "error", message}`) per input entry.
Order is important. For color tokens define semantic colors before palette colors, with neutral colors first, then primary, secondary, and then accent colors. For all other design token types define them based on the size of the value, smallest first.
Prefer reusing design tokens before creating new ones.

```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "tokens": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "breakpoint",
              "color",
              "container",
              "fontFamily",
              "fontSize",
              "fontWeight",
              "letterSpacing",
              "lineHeight",
              "opacity",
              "radius",
              "spacing"
            ],
            "description": "Design token type/category."
          },
          "name": {
            "type": "string",
            "pattern": "^--[a-zA-Z0-9_-]+$",
            "description": "CSS custom property name. E.g. \"--color-primary\"."
          },
          "value": {
            "description": "Design token value. For colors, use a CSS color string like \"#ff0000\" or \"oklch(...)\". For sizes (spacing, radius, fontSize, container, breakpoint), use a px string like \"8px\". For fontWeight, use a number (e.g. 400). For lineHeight/letterSpacing, use a string (\"1.5px\") or number. For opacity, use a 0–1 number (e.g. 0.5) or a percent string (e.g. \"50%\"). To alias another design token, use a CSS variable reference like \"var(--color-red)\".",
            "type": [
              "string",
              "number"
            ]
          },
          "description": {
            "description": "Optional human-readable description of what the design token is for and how it should be used. Max 1024 characters.",
            "type": "string",
            "maxLength": 1024
          }
        },
        "required": [
          "type",
          "name",
          "value"
        ],
        "additionalProperties": false
      },
      "description": "Design tokens to create. Each entry creates a new design token; duplicate names are allowed but discouraged."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "tokens",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```

### `set_tokens`

Description:

```text
Update or delete existing design tokens by their full CSS variable name. Each entry needs `name`; any of `newName`, `value`, `delete` are optional.
- Rename: set `newName`.
- Update value: set `value`. Use `var(--other-token)` to alias.
- Delete the design token: set `delete: true`.
Returns one result per input entry. Per-entry errors are reported in-band.
```

Input schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "tokens": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "pattern": "^--[a-zA-Z0-9_-]+$",
            "description": "Target design token by its full CSS custom property name (e.g. \"--color-primary\")."
          },
          "newName": {
            "description": "Optional. Rename the design token. Provide the full CSS custom property name (e.g. \"--color-primary-strong\").",
            "type": "string",
            "pattern": "^--[a-zA-Z0-9_-]+$"
          },
          "value": {
            "description": "Optional. New value.",
            "type": [
              "string",
              "number"
            ]
          },
          "description": {
            "description": "Optional human-readable description of what the design token is for and how it should be used. Max 1024 characters. Pass an empty string to clear.",
            "type": "string",
            "maxLength": 1024
          },
          "delete": {
            "description": "Optional. If true, deletes the design token entirely.",
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ],
        "additionalProperties": false
      },
      "description": "Design tokens to update or delete, applied sequentially."
    },
    "fileId": {
      "type": "string",
      "description": "The file ID that the tool should operate on."
    }
  },
  "required": [
    "tokens",
    "fileId"
  ],
  "additionalProperties": false
}
```

Other advertised metadata:

```json
{
  "annotations": {
    "destructiveHint": true
  }
}
```
