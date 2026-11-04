# Design with Claude Code (using your Claude subscription)

Folio can be driven by **Claude Code**, the Claude app for your Terminal. You type what you want
("Design an Instagram post for my bakery"), and Claude builds it on the Folio canvas in your browser
while you watch.

- It uses the **Claude Pro or Max subscription** you already log in to Claude Code with. You don't
  need an API key.
- Folio never sees your Claude login. Claude Code does all the thinking; Folio only receives the
  design changes, and only on your own Mac.

This guide is written for a Mac. If you use Windows, see the short note at the end.

---

## What you need

- **Claude Code**, installed and logged in with your Claude subscription
  ([how to install it](https://docs.claude.com/en/docs/claude-code/overview)).
- **Node.js** 18 or newer (step 1 checks this).
- **The Folio folder** on your Mac (step 2).

## Step 1: Check that Node.js is installed

Open **Terminal**: press `⌘ Space`, type `Terminal` and press Return. Then type this and press Return:

```bash
node --version
```

- If you see something like `v20.11.0` or `v22.…` (18 or higher), you're done with this step.
- If you see `command not found` (or a number below 18): go to <https://nodejs.org>, download
  the **LTS** version for macOS (the `.pkg` installer), open it and click through the installer.
  Then **quit Terminal (`⌘Q`) and open it again**, and run `node --version` once more.

## Step 2: Get Folio onto your Mac

Folio lives in a **private** GitHub repository, so you need to be signed in to a GitHub account
that has access to it. Pick one of these:

**Option A: GitHub Desktop (easiest)**

1. Install GitHub Desktop from <https://desktop.github.com> and sign in with your GitHub account.
2. Choose **File → Clone Repository…**, find `omariokamin/Folio` in the list (or paste
   `https://github.com/omariokamin/Folio` in the URL tab), choose where to save it and click **Clone**.
3. Note the folder it was saved to (by default `Documents/GitHub/folio`).

**Option B: Terminal**

```bash
git clone https://github.com/omariokamin/Folio
```

If your Mac offers to install "command line developer tools", click **Install** and run the command
again afterwards. If Git asks for a password, note that GitHub doesn't accept your normal password
here; use GitHub Desktop (option A) instead, or sign in with `gh auth login` if you have the GitHub CLI.

## Step 3: Open the Folio folder in Terminal

Type `cd` followed by a space, then **drag the `folio` folder from Finder into the Terminal window**
(this types its location for you) and press Return. It looks something like this:

```bash
cd ~/Documents/GitHub/folio
```

## Step 4: Start Claude Code

```bash
claude
```

- If Claude Code asks whether you trust the files in this folder, choose **Yes**.
- It then says it found a new MCP server called **folio** (from the `.mcp.json` file in this
  folder). Choose **"Use this and all future MCP servers in this project"** (or "Use this MCP server").

## Step 5: Check that Folio is connected

Inside Claude Code, type:

```
/mcp
```

You should see **folio** with a ✔ / "connected" next to it. Press `Esc` to close the list.

## Step 6: Ask for a design

Type a request, for example:

```
Design an Instagram post for my bakery
```

Your default browser (Safari, Chrome…) opens Folio at `http://localhost:4317`. A small pill in the
**bottom-left corner of the canvas** says **"Claude is designing…"** and you can watch the layers
appear. **Keep that tab open** while you work with Claude.

The first time Claude uses each Folio tool, Claude Code asks for permission. Choose the option
"Yes, and don't ask again…" so it doesn't ask for every step.

Keep the conversation going in the Terminal: "make the headline bigger", "try a darker background",
"add a version for Instagram Stories". If you select a layer in Folio first, Claude will work on that
("make this rounder").

---

## Import a page

Claude can turn existing web pages into real Folio layers (frames, text and images with auto
layout) that you can edit like anything else. Then it tidies them up: clear layer names, your brand
kit's colours and fonts, and components for parts that repeat. Three ways to ask:

**Paste code.** Copy HTML (and its CSS) from anywhere, then in Claude Code type something like
`Import this into Folio:` and paste it with `⌘V`. Long code is fine, up to 3 MB.

**Recreate a page from the web.**

```
Recreate https://example.com/pricing in Folio
```

Claude Code downloads the page on your Mac and Folio rebuilds it as layers. Add `on mobile` (390 px
wide) or `just the pricing table` if you want less.

**Bring in your own site.** Start `claude` in your project's folder (this needs Folio set up for
every folder; see **Using Folio from any folder** below) and ask:

```
Bring my site's pricing section from ./src into Folio
```

From the Folio folder, give the full path instead (`~/Sites/my-shop/src`).

Claude reads your files, puts the HTML and CSS together and imports just that section.

Good to know:

- **Nothing on the page runs.** Folio imports what the HTML and CSS describe and never runs the
  page's scripts. Sites that build everything with JavaScript can arrive nearly empty. Claude will
  tell you and offer to rebuild the page from a screenshot (drag one into Claude Code) or from a
  description.
- **Only public pages.** For safety Folio doesn't fetch pages from your own computer or home
  network (`localhost`, `192.168.…` and the like), and it can't see pages behind a login. For those,
  open the page in your browser, choose **File → Save Page As…** (or **View Source**) and paste the
  code instead.
- **Other people's sites are for reference.** Recreating a site helps you study a layout or start a
  redesign. Don't publish someone else's branding, text or images as your own.
- The in-app AI chat (with an API key) can import pasted code, but not web addresses. URLs work
  through Claude Code only.

---

## Good to know

**Undo.** Press `⌘Z` in the Folio tab. Each burst of Claude's changes is one undo step, so one `⌘Z`
removes the last thing Claude did. You can also just tell Claude ("undo that", "go back to the
previous colours").

**Brand kits.** Folio can remember your brand (colours, fonts, logos, the way you talk) as a
**brand kit**, and Claude then designs with it automatically.

- *Make one by asking*: "Create a brand kit for my bakery: terracotta and cream, a friendly serif for
  headlines, warm and playful tone." Claude sets it up and makes it this document's brand. You can
  also create and edit kits yourself in the **Brand** tab on the right of the Folio window.
- *Designs stay linked to the kit.* Claude uses the kit's colours, fonts and corner sizes as links,
  not copies. Change a colour in the kit (or ask Claude: "make our main colour a deeper red") and
  every layer that uses it updates at once. Switching the document to another kit re-styles it.
- *Logos*: upload your logo files in the Brand tab and Claude will place them on your designs.
  Logos Claude designs for you are saved with the `save_logo` tool (see **Logos** below).
- Kit changes are undone with `⌘Z` like everything else. Kits are saved in the browser, and the
  `localhost:4317` tab has its own list, so use **Export .json** / **Import .json** in the Brand tab
  to move a kit between browsers or computers.

**Logos.** Ask "Design a logo for my pottery studio, Kiln." Claude asks a few questions, then draws
three different ideas as real vector (SVG) logos on a **Logo concepts** artboard. Each card shows the
logo large, at 64, 32 and 16 pixels tall, and on a dark background, so you can see whether it still
works small. Pick one ("go with the second, in dark green") and Claude saves it to your brand kit in
on-light, on-dark and one-colour versions, ready to place on any design. Claude only designs logos
when you ask. Before using one for real, check that nobody else has registered something similar
(a trademark search).

**Components.** For things that repeat, such as buttons, cards and nav bars, Claude makes one
**main component** and places linked copies (**instances**) of it.

- *Ask for a starter set*: "Add the starter components." Claude adds a **Components** artboard
  with buttons, badges, a card, inputs, a nav bar and avatars in your brand kit's colours and fonts.
- *Change one, change all*: "Make the main button rounder" edits the main component, and every
  button in your designs updates.
- *Variants*: one component can come in versions, for example Style (Primary, Secondary, Ghost)
  and Size (S, M, L). "Make that button the secondary style" switches the variant.
- Each copy can have its own text, colours, image and visibility. Layout and sizes come from the
  main, so for a copy that looks different Claude adds a variant. To change a single copy
  completely, ask Claude to **detach** it so it becomes ordinary layers.

**Pages.** A document can have several pages ("Website", "Social", "Ideas"), each with its own
artboards. Claude works on the page you're looking at, unless you ask ("put the posts on a Social
page"). The starter components go on a **Components** page and logo drafts on a **Logos** page
automatically. When Claude edits or checks something on another page, Folio switches to that page
so you can follow along. Claude asks before deleting a page that still has designs on it.

**Your work is saved in the browser.** Folio autosaves in the browser tab at `localhost:4317`.
That copy is separate from the one you get by double-clicking `index.html`, so use
**File → Save to file** to keep a `.folio.json` file you can open anywhere.

**Usage.** Claude's work in Folio counts toward your Claude subscription's usage limits, just like
any other Claude Code task. Big designs and screenshots use more. There are no extra charges, unless
you've set an `ANTHROPIC_API_KEY` in your Terminal, in which case Claude Code uses that key and
bills your API account instead. Type `/status` in Claude Code to see which login it's using.

**Using Folio from any folder (optional).** The steps above only work when you start `claude` inside
the Folio folder. To have Folio available everywhere, run this once (replace the path with your own;
dragging `folio-mcp.js` from Finder into Terminal types it for you):

```bash
claude mcp add folio --scope user -- node /absolute/path/to/folio/mcp/folio-mcp.js
```

**Privacy.** Folio's helper only accepts connections from your own Mac. The Folio link contains a
secret code (saved in `~/.folio/bridge.json`) so other websites can't control your canvas. To reset
it, delete that file and restart Claude Code.

---

## Troubleshooting

**"No Folio tab is connected"**
Claude shows a link like `http://localhost:4317/?bridge=…`. Copy it into Safari or Chrome, keep the
tab open, and ask Claude to try again. The pill in the bottom-left of the canvas should say
**"Claude Code connected"**.

**The browser didn't open**
Same fix: open the link Claude shows. You can also ask Claude to "open Folio".

**`/mcp` shows folio as failed (or folio isn't listed)**
- Run `node --version` (see step 1).
- Make sure you started `claude` **inside the Folio folder** (the one that contains `index.html`).
  Type `/exit`, `cd` into the folder, and run `claude` again.
- In `/mcp`, select **folio** and choose **Reconnect**.
- To see the error message, quit Claude Code and run this inside the Folio folder
  (press `Ctrl+C` to stop it):

  ```bash
  node mcp/folio-mcp.js
  ```

**"Port 4317 is busy"**
Folio uses the next free port (4318, 4319…) automatically and opens the right address for you. This
happens when two Claude Code windows are open at the same time: each one gets its own Folio tab. To
choose a port yourself:

```bash
FOLIO_PORT=4400 claude
```

**The pill says "Claude Code disconnected"**
Claude Code was closed or restarted. The tab reconnects by itself as soon as you start `claude`
again. Click the pill to retry right away.

**The pill says "Claude Code is using another Folio tab"**
You have Folio open in two tabs. Click the pill to use this tab instead, or close the other one.

**The pill says "Claude Code link expired"**
Ask Claude to "open Folio" to get a fresh link.

---

## Windows (short note)

The same steps work in **PowerShell** or **Windows Terminal**: install Node.js LTS (`.msi`) from
nodejs.org, `cd` into the Folio folder, run `claude`, and approve the **folio** server. Use `Ctrl`
where this guide says `⌘`. To pick a port, run `$env:FOLIO_PORT=4400; claude`.
