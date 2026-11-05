# Handoff: from the cloud session to Claude Code on your laptop

This folder is **temporary**. It carries the context of the cloud session that built Folio
v0.1 → v0.11, so Claude Code on the laptop can keep building without starting from zero.
`CLAUDE.md` imports this file for now, so Claude reads it automatically at the start of a session.

## What to clear after the handoff

Once the local session has read this and you've confirmed things run (see "First steps"):

1. Delete the folder: `git rm -r handoff/`
2. Remove the line `@handoff/README.md` from `CLAUDE.md` (keep `@AGENTS.md`).
3. Commit: `git commit -m "Remove cloud handoff"` and push.

Before deleting, you may want to keep the test scripts: `cp -r handoff/dev-tests/. .dev/`
(`.dev/` is gitignored, so they stay on your laptop only). The session logs are the only
copy of the full conversation; save `handoff/session-logs.tar.gz` somewhere outside the repo
if you want it later. Deleting files still leaves them in git history. If you ever make the
repo public, rewrite that history first, or start a fresh repo.

## What's in here

| Path | What it is |
|---|---|
| `README.md` | This note: project state, conventions, open items |
| `session-logs.tar.gz` | The cloud session's Claude Code transcripts (JSONL): the main conversation plus every sub-agent. 38 MB compressed. Scanned for API keys/tokens before committing (none found; one fake `sk-ant-test-123` from a test). Contains your email address in session metadata. |
| `dev-tests/` | The throwaway test scripts from `.dev/` (Playwright + Node), without screenshots, vendored packages or outputs |

To read the logs: `mkdir -p /tmp/folio-logs && tar -xzf handoff/session-logs.tar.gz -C /tmp/folio-logs`.
The main file is `-home-user-folio/30d67173-….jsonl` (one JSON event per line; large, so search
it with `grep`, don't open it whole). Sub-agent transcripts are in the `subagents/` folder next to it.

## The project in one paragraph

Folio is a personal, original browser design tool (inspired by paper.design) where every
layer is real HTML/CSS. Plain JavaScript, classic `<script>` tags, global `window.Folio`, no
build step, no npm dependencies in the app. `SPEC.md` is the contract between modules: read the
section for an area before touching it. `AGENTS.md` holds the coding rules (Ponytail: smallest
complete change, never cut validation/security/accessibility, a small test for new logic, end
replies with what was skipped and any risk). Claude can design inside Folio in two ways: the
in-app chat (needs an API key) or Claude Code over MCP (`mcp/folio-mcp.js`, registered in
`.mcp.json`, uses your Claude subscription; setup in `docs/claude-code.md`).

## Versions built (all on `main`)

| Version | Feature |
|---|---|
| 0.1 | Core canvas: frames/text/images, auto layout, inspector, layers, export, undo |
| 0.2 | AI designer (in-app chat) + Claude Code MCP bridge |
| 0.3 | Brand kits (colours incl. On primary/Success/Danger, fonts, logos, voice, style) |
| 0.4 | Components & variants, starter kit, design-principles guide |
| 0.5 | Logo designer (SVG sanitizer, logo versions incl. metal) |
| 0.6 | Pages |
| 0.7 | HTML import (paste, file, URL via Claude) |
| 0.8 | Smart guides / snapping |
| 0.9 | CSS-only effects: liquid glass, shader-style mesh gradients, metal logos |
| 0.10 | Tailwind v4 export (HTML + React) and the `export_code` tool |
| 0.11 | Prototyping: navigate/back/link/overlays, hover from `State=Hover` variants, scroll frames, Play mode (⌥⌘↵), Export → Prototype (HTML), `set_interactions` tool |

## First steps on the laptop

```bash
git pull
python3 -m http.server 8191   # then open http://localhost:8191
```

Claude Code + Folio: follow `docs/claude-code.md` step by step (run `claude` in the repo, approve
the `folio` MCP server, check `/mcp` shows it connected, then open Folio from the link Claude gives).

Tests: `cp -r handoff/dev-tests/. .dev/`, then `npm i -D playwright && npx playwright install chromium`
(or use a global Playwright). Most browser tests expect the repo served on a fixed port written at
the top of each script (e.g. 8191, 8237, 8473, 8132, 8151, 8123, 8112). Serve on that port first.
`.dev/tailwind/fidelity.js` needs `@tailwindcss/browser@4.3.3` unpacked in
`.dev/tailwind/vendor/` (`cd .dev/tailwind/vendor && npm pack @tailwindcss/browser@4.3.3 && tar xzf *.tgz`).
Known stale check: `.dev/export-code/mcp-e2e.js` expects `export_code` to be the last tool;
`set_interactions` now comes after it, so 4 of its checks fail by design.

## How the cloud session worked (keep doing this)

- Feature branch per feature (`tailwind`, `prototyping`, …), write the SPEC section first, then
  build with 2–3 parallel sub-agents on separate files, run every test together, do a **mock run**
  (build a small branded design with the tools, screenshot it), then fast-forward `main`. No force pushes.
- Claude's tool list in `src/ai-prompt.js` is append-only (new tools go at the end) so prompt
  caching stays valid; tests compare earlier tool definitions byte-for-byte with `main`.
- The user is a beginner who wants to learn: plain language, short explanations of new
  concepts, ask questions before big features (scope, behaviour, UI).

## Open items / ideas

- Next feature candidates offered: responsive breakpoints, version history; smart animate for
  prototypes was deliberately skipped in v0.11.
- Unanswered question to the user: add a **metal** option to "Save selection as logo"?
- Old branches on GitHub can all be deleted: every feature branch is merged into `main`
  (`ai-designer`, `brand-kit`, `components`, `logo-designer`, `pages`, `html-import`, `smart-guides`,
  `effects`, `tailwind`, `prototyping`, `improve/*`), and `grid-snapping` is a stale, unmerged draft
  that smart guides replaced.
- The git remote in the cloud still used the old lowercase URL (`omariokamin/folio`); GitHub
  redirects to `omariokamin/Folio`. On the laptop, clone from `https://github.com/omariokamin/Folio`.
- A server-side "Folio improvement loop" scheduled task (every 2 hours) exists in the cloud
  account and is **paused**. It can be deleted or resumed from claude.ai.
- Known v0.11 limits: React output only syntax-checked (never rendered in React); Tailwind
  `@theme` radius/font tokens override Tailwind defaults in the target project; player not
  tested on touch devices, Safari or Firefox; overlays are placed when opened (not re-placed
  while a tall screen scrolls); possible existing bug: pressing Enter in an inspector text field
  can trigger the "select child" shortcut.
