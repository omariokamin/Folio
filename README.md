# Folio

**A design tool where every layer is real HTML and CSS.**

Folio is a small, personal design canvas that runs in your browser. It works like Figma:
you draw frames, add text and images, and arrange them with auto layout. The difference is
that nothing is a picture. Every layer on the canvas is a real web element styled with real
CSS, so the code you export is the design itself, not a rough translation of it.

Use it for website mockups, landing pages, app screens and social media posts (Instagram,
Stories, LinkedIn banners, YouTube thumbnails…), then export a PNG or a ready-to-use HTML page.

---

## How to run it

There is nothing to install and no build step.

**Option 1: just open it.** Double-click `index.html`. It opens in your browser and works.

**Option 2: run a tiny local web server.** Some browsers are stricter with files opened
straight from disk, so this is the most reliable way:

```bash
cd folio
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Press `Ctrl+C` in the terminal to stop it.

**Option 3: put it online with GitHub Pages (free).**

1. Push this folder to a GitHub repository.
2. On GitHub, open the repository, then go to **Settings → Pages**.
3. Under "Build and deployment", choose **Deploy from a branch**, select the **main** branch and
   the **/ (root)** folder, then click **Save**.
4. After a minute your copy of Folio is live at `https://<your-username>.github.io/<repo-name>/`.

> Your work is **autosaved in your browser** (in `localStorage`). That copy lives only in the
> browser you used, so use **File → Save to file** to keep a `.folio.json` backup you can open
> anywhere.

An internet connection is only needed for Google Fonts and for PNG export (the
[html-to-image](https://github.com/bubkoo/html-to-image) library loads from a CDN). Everything
else works offline.

---

## Use with Claude Code (Claude subscription)

Let Claude design on your canvas while you watch, using the Claude Pro/Max subscription you're
already logged in to Claude Code with. No API key is needed, and Folio never sees your Claude login.

You need [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) (logged in) and
Node.js 18+ (check with `node --version`; if it's missing, get the LTS installer from
<https://nodejs.org>). Then, in Terminal:

```bash
cd ~/Documents/GitHub/folio
```

```bash
claude
```

Approve the **folio** MCP server when Claude Code asks (type `/mcp` to check that it's connected),
then ask something like *"Design an Instagram post for my bakery"*. Your browser opens Folio at
`http://localhost:4317` and the design appears live. Keep the tab open; press `⌘Z` in Folio to undo
Claude's last burst of changes. Usage counts toward your subscription's limits.

The full step-by-step guide, including troubleshooting, is in
[docs/claude-code.md](docs/claude-code.md).

---

## Features

- **Infinite canvas** with artboards. Presets for Desktop, Laptop, Tablet, Mobile, Instagram
  Post / Portrait, Story / Reel, Facebook ad, LinkedIn banner, X post and YouTube thumbnail.
- **Frames, rectangles, ellipses, text and images.** Draw them with the toolbar tools.
- **Auto layout = flexbox.** Rows and columns with gap, padding, alignment and
  hug / fill / fixed sizing, exactly as the browser lays them out.
- **Rich fills:** solid, linear, radial and conic gradients, **mesh gradients**, image fills
  and **noise / grain**. Stack several fills on one layer.
- **Effects:** shadows, layer blur, background blur (glass), blend modes, opacity, rotation,
  image adjustments.
- **Real fonts** from Google Fonts (Inter, Bricolage Grotesque, Bebas Neue, Playfair Display…).
- **Layers panel:** drag to reorder or move layers into frames, rename, hide and lock.
- **Pages:** split a document into pages ("Website", "Social", "Ideas"), each with its own
  artboards and view. Add, rename, reorder and delete them above the layers; right-click an
  artboard → **Move to page**. The components starter kit gets its own **Components** page.
- **Code panel:** shows the HTML + CSS (or inline-styled HTML, or JSON) of whatever you select,
  updating live as you design.
- **Export:** PNG at 1x / 2x / 3x, a complete standalone `.html` page, or copy the HTML + CSS.
- **Undo / redo**, copy / paste, duplicate, autosave, and save/open `.folio.json` files.
- **Brand kits:** keep each client's colours, fonts, logos, tone of voice and style in one place.
  Layers link to the brand, so changing a brand colour updates every design at once, and
  switching brands re-skins the whole document. Four starter kits included.
- A **demo document** (landing page, Instagram post, mobile app screen) to explore. Load it
  again any time with **File → Load demo**.

---

## Brand kit

Working for several brands? Give each one a **brand kit**: its colours, fonts, logos, tone of
voice and a few style rules. Open the **Brand** tab at the top of the left panel.

**Start one.** Pick a starter template (Folio Violet for tech, Crumb Bakery for food, Northwind
for corporate, Neon Club for events), start blank, or import a `.brand.json` file. You can also
ask Claude: in Claude Code or the ✦ AI tab, say *"Create a brand kit for my bakery"*.

**Use it on your designs.** Select layers on the canvas, then in the Brand tab:

- click a **colour swatch** to apply it (frames get it as their fill, text as its colour;
  hold `⌥`/`Alt` while clicking to use it as a border instead),
- click **"Aa"** next to a font to use it on the selected text (select a frame to change all
  the text inside it),
- click a **logo** to place it inside the selected frame,
- click a **corner style** or a **gradient** to apply it to the selected frames.

**Linked, not copied.** Applied brand values stay connected to the brand (they are real CSS
variables such as `var(--color-primary)`, and exported code includes them). Change the Primary
colour and every layer that uses it changes too. Switch the document to another brand from the
menu at the top of the Brand tab and the whole design re-skins in one click. Deleting a custom
colour, font or logo keeps the layers looking the same; they just stop being linked.

**Where brands live.** Your brand library is saved in this browser. Each document also carries
a copy of the brand it uses, so a saved `.folio.json` file opens with its brand anywhere, and
undo/redo covers brand edits too. To move brands to another computer, use **⋯ → Export .json**
and **Import .json**. Logos are resized to at most 1024 px and must be under 1.5 MB (SVG logos
are kept as they are). If the browser's storage fills up, Folio tells you; export your brands
and remove large logos.

The **Voice** section (tagline, audience, tone, words to use and avoid, sample copy) is there
for writing: Claude reads it when it writes copy for that brand.

---

## Keyboard shortcuts

On Windows and Linux, use `Ctrl` wherever this table says `⌘`. Press `?` inside Folio to see
the full list.

| Action | Shortcut |
|---|---|
| Move / select tool | `V` |
| Frame (artboard) | `F` |
| Rectangle | `R` |
| Ellipse | `O` |
| Text | `T` |
| Image | `I` |
| Hand (pan) | `H`, or hold `Space` |
| Undo / Redo | `⌘Z` / `⇧⌘Z` (or `⌘Y`) |
| Copy / Cut / Paste | `⌘C` / `⌘X` / `⌘V` |
| Duplicate | `⌘D` |
| Delete | `Delete` or `Backspace` |
| Nudge 1px / 10px | Arrow keys / `Shift` + arrow keys |
| Wrap selection in auto layout | `⇧A` |
| Group / Ungroup | `⌘G` / `⇧⌘G` |
| Bring forward / Send backward | `⌘]` / `⌘[` |
| Bring to front / Send to back | `⌥⌘]` / `⌥⌘[` |
| Select parent | `Esc` (or `Shift+Enter`) |
| Select child / edit text | `Enter` |
| Select all (siblings) | `⌘A` |
| Show / hide, Lock / unlock | `⇧⌘H`, `⇧⌘L` |
| Zoom to fit / to selection | `⇧1` / `⇧2` |
| Zoom to 100% | `⌘0` |
| Zoom in / out | `⌘+` / `⌘-` (or `⌘`/`Ctrl` + scroll) |
| Toggle code panel | `⌘E` |
| Previous / next page | `⌥↑` / `⌥↓` (or `Alt+PageUp` / `Alt+PageDown`) |
| Save to file / Open file | `⌘S` / `⌘O` |
| Show all shortcuts | `?` |

Mouse: click selects the layer inside an artboard, double-click goes one level deeper (or
edits text), `⌘`/`Ctrl`+click selects the deepest layer, `Shift`+click adds to the selection,
`Alt`/`Option`+drag duplicates.

---

## How it works (in plain English)

**The big idea: the design is the code.** When you draw a frame, Folio creates a real `<div>`
on the page. When you give it a gradient, Folio sets a real CSS `background-image`. When you turn
on auto layout, Folio sets `display: flex`. One small file, `src/css.js`, decides which CSS
every layer gets, and *both* the canvas and the code exporter use it. That's why the exported
HTML looks exactly like what you see.

**The document is a tree.** Every layer is a plain JavaScript object (its name, size, fills,
text, children…). The whole document is saved as JSON, which is what a `.folio.json` file is.
`src/state.js` holds this tree and is the only place that changes it. It also keeps the
undo history and the autosave.

**Panels listen for changes.** When something changes, the store announces it (an "event"), and
each panel (canvas, layers, inspector, code view) redraws its part. The panels never talk to
each other directly; they all go through the store.

**No build tools.** Each file is a normal `<script>` loaded by `index.html`, in order. Each one
adds its piece to a single global object, `window.Folio`.

### File map

| File | What it does |
|---|---|
| `index.html` | The page itself: the app layout and the list of scripts, in load order. |
| `src/state.js` | The "brain": the document, selection, current tool, zoom, undo/redo, autosave. |
| `src/css.js` | Turns a layer into CSS. The single source of truth for how things look. |
| `src/fonts.js` | Loads Google Fonts when a font is used. |
| `src/ui.js` | Small helpers: create elements, show toast messages. |
| `src/icons.js` | The line icons used in the interface. |
| `src/render.js` | Draws the document as real DOM elements on the canvas. |
| `src/overlay.js` | Selection outlines, resize handles, artboard labels, size badges. |
| `src/canvas.js` | Mouse interaction: pan, zoom, select, move, resize, draw, edit text. |
| `src/inspector.js` | The right panel: position, size, auto layout, fills, text, effects. |
| `src/layers.js` | The left panel: the layer tree with drag-and-drop, rename, hide and lock. |
| `src/toolbar.js` | The top bar: File menu, tools, undo/redo, zoom, Code and Export buttons. Also the shared dropdown menu. |
| `src/export.js` | Generates HTML/CSS, the standalone page and PNGs; saves/opens files; the code panel. |
| `src/shortcuts.js` | All keyboard shortcuts and the shortcuts help window. |
| `src/demo.js` | Builds the starter document. A good example of how designs are described. |
| `src/brand.js` | Brand kits: the library, the active brand, and the CSS variables (`--color-primary`, …) that link layers to it. |
| `src/brand-panel.js` | The Brand tab next to Layers: colours, fonts, logos, voice and style rules. |
| `src/ai-prompt.js` | Claude's design guide and the list of tools it can use on the canvas. |
| `src/ai-tools.js` | What those tools do: create, edit, move, delete layers, screenshots, brand kits. |
| `src/ai.js` | The ✦ AI chat tab (uses an Anthropic API key). |
| `src/bridge.js` | Connects the open Folio tab to Claude Code (your Claude subscription). |
| `mcp/folio-mcp.js` | The small local server Claude Code starts to talk to Folio. |
| `src/main.js` | Starts everything in the right order. |
| `styles/base.css` | Colours, spacing and shared controls (buttons, inputs). |
| `styles/canvas.css` | Canvas and selection overlay styles. |
| `styles/inspector.css` | Right panel styles. |
| `styles/shell.css` | Toolbar, menus, layers panel, code panel and help window. |

---

## Ideas for next steps

_Done so far: the AI designer and Claude Code connection (v0.2), brand kits (v0.3), components and variants (v0.4), the logo designer (v0.5) and pages (v0.6)._

- **Tailwind export.** Turn the CSS of each layer into Tailwind utility classes.
- **HTML import.** Paste an existing web page or snippet and turn it into editable layers.
- More: a grid and snapping, comments, version history, video
  export of simple animations.

---

## Credits

- **Design principles.** The rules Claude follows when it designs in Folio
  ([docs/design-principles.md](docs/design-principles.md)) are paraphrased from four MIT-licensed
  design-skill projects: [anti-slop](https://github.com/miqdadbadjuber/anti-slop) by miqdadbadjuber,
  [taste-skill](https://github.com/Leonxlnx/taste-skill) by Leonxlnx,
  [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) by nextlevelbuilder
  and [logo-design-skill](https://github.com/kaankiziltug/logo-design-skill) by kaankiziltug.
- **Coding rules for agents.** [Ponytail](https://github.com/DietrichGebert/ponytail) by
  DietrichGebert (MIT; see `third_party/ponytail-LICENSE`), used in `AGENTS.md`.
