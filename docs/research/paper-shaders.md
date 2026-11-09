# Paper Shaders in Folio: license, size, rendering, export

Research for issue #3 (map #1). Checked 2026-11-09 against `@paper-design/shaders@0.0.82`
(latest on npm) and the GitHub repo at commit
[`b6e6e7f`](https://github.com/paper-design/shaders/tree/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0).
"Measured" means I unpacked the npm tarball in an empty folder under `/tmp` or ran it in headless
Chromium (Playwright 1.64). Nothing was installed into this repo.

## In plain words

Paper Shaders is a free, open-source set of 30 animated backgrounds (mesh gradient, liquid metal,
grain, halftone and more). Each one draws into a `<canvas>` with WebGL 2. Since June 2026 the
license is Apache 2.0, so Folio may copy and ship the code as long as it keeps Paper's license and
notice files. The library is published as modern JavaScript modules. A classic `<script>` tag can't
load it directly, but Folio's classic scripts can pull it in with one `import()` call, with no build
step. In an exported page, the layer keeps a normal CSS background (Folio's existing mesh
gradient), and a short script puts the moving shader on top when the browser can run it.

## 1. License

**Verdict: Apache-2.0, for versions 0.0.77 and later. Vendoring and redistribution are allowed. Earlier
versions were under other licenses, so don't use them.**

- The current LICENSE is the standard Apache 2.0 text. Measured: apart from one leading blank line,
  it is identical to <https://www.apache.org/licenses/LICENSE-2.0.txt>.
  Sources: [LICENSE](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/LICENSE),
  [packages/shaders/LICENSE](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/LICENSE),
  GitHub's license detection (`spdx_id: Apache-2.0`, from `gh api repos/paper-design/shaders/license`).
- The license changed twice. The history matters because Folio is a design tool like Paper:
  - Oct 2024: **MIT**, "Copyright (c) 2024 Lost Coast Labs, Inc. (Paper Design)"
    ([commit 2cf4d72f](https://github.com/paper-design/shaders/commit/2cf4d72f)).
  - Aug 2025: **PolyForm Shield 1.0.0**
    ([commit 8925330f](https://github.com/paper-design/shaders/commit/8925330f)). That license
    [forbids using the software in a product that competes with the licensor](https://polyformproject.org/licenses/shield/1.0.0/),
    and Folio arguably competes with Paper.
  - 27 Jun 2026: **Apache 2.0**, "Switching to Apache 2.0 open source license"
    ([commit 931beca6](https://github.com/paper-design/shaders/commit/931beca6)), followed by a
    "license clean up" that added the per-package LICENSE and NOTICE files
    ([commit f9f2a8b2, #270](https://github.com/paper-design/shaders/commit/f9f2a8b2)).
  - On npm, `license` is `Apache-2.0` from **0.0.77** (published 2026-07-02). Versions 0.0.76 and
    earlier say `SEE LICENSE IN https://github.com/paper-design/shaders/blob/main/LICENSE`, a link
    to a file that has since changed, so they carry no clear Apache grant (`npm view
    @paper-design/shaders@0.0.76 license`, [npm](https://www.npmjs.com/package/@paper-design/shaders)).
    **Pin 0.0.77 or later. Folio would use 0.0.82.**
- What Apache 2.0 allows: use, copy, modify and redistribute, commercially too, with no
  field-of-use restriction. In return Folio must
  ([Apache 2.0 §4](https://www.apache.org/licenses/LICENSE-2.0#redistribution)):
  (a) ship a copy of the license, (b) mark files it changes, (c) keep copyright notices, and
  (d) keep the NOTICE text in a NOTICE file, the docs, or the UI. The npm package's NOTICE reads
  "Paper Shaders / Copyright 2026 Paper / Powered by Paper Shaders: https://shaders.paper.design"
  (measured from the tarball). The repo-root
  [NOTICE](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/NOTICE)
  has only the last two lines. Section 6 gives no right to Paper's trademarks, so Folio's UI shouldn't
  use the name "Paper" except in the attribution.
- Paper's own reading, in the [README](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/README.md#license-and-use):
  end products don't need visible attribution. Anything that "redistribute[s] Paper Shaders code as
  part of another shader library, plugin, or tool" must keep LICENSE and NOTICE, and visible "Powered
  by Paper Shaders" credit is "appreciated". Folio is a tool, so the second rule applies.
- **The license is fine, but Folio's own rule is not.** SPEC.md v0.9 says "Inspiration only — no code
  copied from those projects." Vendoring is legal, but SPEC still forbids it. The user has to amend
  that line on purpose if Folio vendors. Folio already has a pattern for this:
  `third_party/ponytail-LICENSE`. It would gain `third_party/paper-shaders-LICENSE` and
  `third_party/paper-shaders-NOTICE`.

## 2. Size (measured, v0.0.82)

| What | Raw | gzip -9 |
|---|---|---|
| npm tarball (`.tgz`) | 224,539 B | (already compressed) |
| Unpacked package (`dist.unpackedSize`) | 880,848 B | |
| …of which source maps | 466,234 B | |
| …of which `.d.ts` types | 131,537 B | |
| All runtime JS in `dist/` (30 shaders + engine) | 270,850 B | 75,565 B |
| Engine `shader-mount.js` | 21,826 B | 6,046 B |
| Noise texture module (base64 PNG, used by 10 shaders, **not** mesh gradient) | 23,748 B | 17,902 B |
| **Mesh gradient only** (its exact import set: mount, vertex shader, utils, sizing, colour parser, mesh) | **38,549 B** | **10,251 B** |
| Liquid metal only (same set, liquid-metal instead of mesh) | | 14,874 B |

The package has zero dependencies (`"dependencies": {}` in its
[package.json](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/package.json)),
and `dist/` imports nothing outside itself (measured). The 10 shaders that need the noise texture
(measured, `grep -l u_noiseTexture`): dot-orbit, god-rays, grain-gradient, halftone-cmyk, metaballs,
pulsing-border, paper-texture, warp, smoke-ring, voronoi.

## 3. Can a no-build page load it?

- **It ships only as ES modules.** `"type": "module"`, and `exports` points `import` and `default` at
  `./dist/index.js`. There is no UMD or IIFE file (measured: the tarball holds only `dist/*.js` ES
  modules plus maps and types;
  [npm](https://www.npmjs.com/package/@paper-design/shaders?activeTab=code)). The files are plain
  JavaScript (no TypeScript or JSX) and import each other by relative path, for example
  `import { vertexShaderSource } from "./vertex-shader.js"`.
- A classic `<script src>` **can't** load it, because module syntax throws there. These ways work
  with no build step:
  1. **Dynamic `import()` from a classic script.** `import()` is allowed in classic scripts, so a
     Folio IIFE can run `import('https://cdn.jsdelivr.net/npm/@paper-design/shaders@0.0.82/dist/index.js')`
     on first use. It doesn't touch the classic-script convention. I didn't test this from Folio's
     own code; see Unconfirmed.
  2. **An inline `<script type="module">`** that imports the same pinned jsDelivr URL. Measured: it
     renders and animates, both from `http://localhost` and from a page opened as `file://`
     (jsDelivr sends CORS headers).
  3. **Vendored files in the repo, loaded by relative path.** This works when the page is served over
     HTTP (measured, served from localhost). It **fails from `file://`**, because module scripts
     loaded by relative path are blocked there. Don't use it for exported files people open by
     double-clicking.
  4. **A one-time bundle into one IIFE file** (for example
     `esbuild --bundle --format=iife --global-name=PaperShaders`), committed to `vendor/`. This is a
     one-off conversion, not an app build step, but it does need a tool to run once and redo on
     every upgrade. I didn't try it.
- Folio already loads a pinned library from jsDelivr: `index.html` line 45 loads
  `html-to-image@1.11.11`. The prototype export already puts a runtime `<script>` inside the exported
  HTML (`src/prototype.js`, `fileFor`). Options 1 and 2 follow those two patterns.

## 4. Shaders and their parameters (v0.0.82)

Parameter names come from each shader's `*Params` interface in `dist/shaders/*.d.ts` (measured).
Source for each one: `packages/shaders/src/shaders/<name>.ts` in the
[repo](https://github.com/paper-design/shaders/tree/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shaders).
Docs and live previews are at `https://shaders.paper.design/<name>`.

**Every shader** also takes the sizing parameters `fit` (`none|contain|cover`), `scale`, `rotation`,
`originX/Y`, `offsetX/Y` and `worldWidth/Height`
([shader-sizing.ts](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-sizing.ts)),
and the motion parameters `speed` (0 means static, and the animation loop stops) and `frame` (a fixed
time in ms, for the same picture every time).

Fill-like (no image needed), the likeliest fits for a Folio fill:

| Shader | Parameters |
|---|---|
| mesh-gradient | colors[] (max 10), distortion, swirl, grainMixer, grainOverlay |
| static-mesh-gradient | colors[], positions, waveX, waveXShift, waveY, waveYShift, mixing, grainMixer, grainOverlay |
| static-radial-gradient | colorBack, colors[], radius, focalDistance, focalAngle, falloff, mixing, distortion, distortionShift, distortionFreq, grainMixer, grainOverlay |
| grain-gradient | colorBack, colors[], softness, intensity, noise, shape |
| liquid-metal | colorBack, colorTint, image?, repetition, shiftRed, shiftBlue, contour, softness, distortion, angle, shape |
| warp | colors[], proportion, softness, shape, shapeScale, distortion, swirl, swirlIterations |
| swirl | colorBack, colors[], bandCount, twist, center, proportion, softness, noiseFrequency, noise |
| waves | colorFront, colorBack, rotation, shape, frequency, amplitude, spacing, proportion, softness |
| god-rays | colorBack, colorBloom, colors[], spotty, midSize, midIntensity, density, intensity, bloom |
| smoke-ring | colorBack, colors[], noiseScale, thickness, radius, innerShape, noiseIterations |
| metaballs | colorBack, colors[], count, size |
| neuro-noise | colorFront, colorMid, colorBack, brightness, contrast |
| perlin-noise | colorFront, colorBack, proportion, softness, octaveCount, persistence, lacunarity |
| simplex-noise | colors[], stepsPerColor, softness |
| voronoi | colors[], stepsPerColor, colorGap, colorGlow, distortion, gap, glow |
| dot-grid | colorBack, colorFill, colorStroke, size, gapX, gapY, strokeWidth, sizeRange, opacityRange, shape |
| dot-orbit | colorBack, colors[], size, sizeRange, spreading, stepsPerColor |
| dithering | colorBack, colorFront, shape, type, size |
| spiral | colorBack, colorFront, density, distortion, strokeWidth, strokeTaper, strokeCap, noise, noiseFrequency, softness |
| color-panels | colors[], colorBack, length, edges, blur, fadeIn, fadeOut, density, gradient |
| pulsing-border | colorBack, colors[], roundness, thickness, margin(+Left/Right/Top/Bottom), aspectRatio, softness, intensity, bloom, spots, spotSize, pulse, smoke, smokeSize |
| gem-smoke | colors[], colorBack, image?, innerDistortion, outerDistortion, outerGlow, innerGlow, colorInner, offset, angle, size, shape |

Image filters (they take an `image`), closer to an image effect than a fill:

| Shader | Parameters |
|---|---|
| halftone-dots | image, colorFront, colorBack, size, grid, radius, contrast, originalColors, inverted, grainMixer, grainOverlay, grainSize, type |
| halftone-cmyk | image, colorBack, colorC/M/Y/K, size, contrast, softness, grainSize, grainMixer, grainOverlay, gridNoise, floodC/M/Y/K, gainC/M/Y/K, type |
| image-dithering | image, colorFront, colorBack, colorHighlight, type, size, colorSteps, originalColors, inverted |
| paper-texture | image?, colorBack, colorPaper, colorShadow, blending, distortion, clip, angle, seed, roughness, roughnessSize, roughnessRows, fiber, fiberSize, folds, foldSizeX/Y, foldOffsetX/Y, wrinkles, wrinkleSize, crumples, crumpleCount, drops |
| fluted-glass | image, colorBack, colorShadow, colorHighlight, shadows, size, angle, distortion, shift, blur, edges, margin(+sides), stretch, distortionShape, highlights, shape, grainMixer, grainOverlay |
| water | image?, colorBack, colorHighlight, highlights, layering, edges, caustic, waves, size |
| lens-distortion | image?, spread, bias, angle, perspective, count, dispersion, dispersionShift, dispersionColor, focusCenter, focusEdges, swirl, noise, noiseFrequency, noiseOffset, lensBulge, lensCircle, grainMixer, grainOverlay, imageX, imageY |
| heatmap | image (required), contour, angle, noise, innerGlow, outerGlow, colorBack, colors[] |

Defaults: the vanilla package has no prop defaults. Defaults and presets live in the React wrapper.
For example, the mesh gradient default is colors `#e0eaff #241d9a #f75092 #9f50d3`, distortion 0.8,
swirl 0.1, grain 0, speed 1, with presets Default, Ink, Purple and Beach (measured,
`@paper-design/shaders-react@0.0.82` `dist/shaders/mesh-gradient.js`).

## 5. How it renders

All of this is from
[`shader-mount.ts`](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-mount.ts),
with the same behaviour seen in the 0.0.82 dist.

- **WebGL 2 only.** `canvasElement.getContext('webgl2', { antialias:false, depth:false, stencil:false, ...attrs })`
  ([L94](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-mount.ts#L94)).
  If WebGL 2 is missing, the constructor **throws** "WebGL is not supported in this browser". There
  is no WebGL 1 fallback, and every fragment shader starts with `#version 300 es` (measured, all 30).
  So the caller needs a `try/catch`, and the CSS fallback has to be there already.
- **The draw.** A canvas is prepended inside the layer's element, and one full-screen quad is drawn
  per frame. The library injects a style rule into `<head>` (inside `@layer paper-shaders`): the
  parent gets `isolation:isolate; position:relative`, and the canvas gets
  `position:absolute; inset:0; z-index:-1; width/height:100%; border-radius:inherit`
  ([L697–L705](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-mount.ts#L697-L705)).
  The canvas therefore sits **above the element's CSS background and below its children**.
- **Animation loop.** It uses `requestAnimationFrame`, and time advances by `dt * speed`. With
  `speed = 0` it draws once and stops the loop, so a static shader costs nothing after the first
  frame ([L344](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-mount.ts#L344),
  [L535](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-mount.ts#L535)).
  `frame` picks a fixed point in time.
- **Pausing.** Speed is forced to 0 while `document.hidden` is true or an `IntersectionObserver` says
  the element is off screen
  ([L215](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-mount.ts#L215),
  [L526](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-mount.ts#L526)).
- **Resolution and cost.** Canvas size comes from a `ResizeObserver` (device-pixel box when the
  browser supports it). It renders at `max(devicePixelRatio, minPixelRatio)` × pinch zoom, with
  `minPixelRatio = 2` by default (2× even on 1× screens, as antialiasing), and it is capped at
  `maxPixelCount = 1920*1080*4` ≈ 8.3 MP
  ([L3](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-mount.ts#L3),
  [L54](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-mount.ts#L54),
  [L248](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/packages/shaders/src/shader-mount.ts#L248)).
  The cost is one fragment-shader run per canvas pixel per frame, so a full-width 1440×900 hero at 2×
  is about 5.2 MP per frame at 60 fps. Both knobs can be passed to the constructor. I didn't measure
  frame times on real hardware.
- **Not handled** (measured: no matches for `webglcontextlost`, `prefers-reduced-motion` or `matchMedia`):
  - lost WebGL contexts (browsers cap live contexts per page, and one canvas = one context);
  - reduced-motion preferences.
  Folio has to handle both itself (AGENTS.md: never cut accessibility).
- **Teardown.** `dispose()` cancels the loop and disconnects the observers. The instance is stored on
  the element as `element.paperShaderMount`. `setUniforms`, `setSpeed`, `setFrame`,
  `setMaxPixelCount` and `setMinPixelRatio` update a live shader.

## 6. How Paper's own docs export and embed

- The docs site shows only **React** usage. On
  [shaders.paper.design/mesh-gradient](https://shaders.paper.design/mesh-gradient) the snippet is
  `import { MeshGradient } from '@paper-design/shaders-react'` with JSX props and a props table. It
  has no vanilla, script-tag, CDN, PNG or video export (WebFetch of that page; I checked only that
  one page).
- Every shader is also a **shadcn registry** item
  ([docs/registry.json](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/docs/registry.json),
  each one a `docs/registry/<name>-example.tsx` React component that depends on
  `@paper-design/shaders-react`).
- The README shows install commands for React and vanilla but only a React example. It says
  settings "can be configured in code or designed in Paper", and that "what you make is directly
  exportable as lightweight code"
  ([README](https://github.com/paper-design/shaders/blob/b6e6e7f73faf614f0c9f4e635451d4c3ed47bad0/README.md)).
  I didn't check what the Paper app's export produces.
- No static fallback is offered anywhere. The image-based shaders use transparent and empty pixel
  placeholders while images load, but nothing covers "no WebGL" or "no JS".

## 7. How a Folio shader fill could run and export

The data could look like this: a new fill type
`{type:'shader', shader:'mesh-gradient', params:{…}, speed, frame}`. (This is a proposal; SPEC
decides.)

**Layering, a hard constraint.** The canvas sits at `z-index:-1` inside an isolated parent (§5), so
it always covers the element's whole CSS background and stays under its children. A shader fill
can't sit in the middle of Folio's fill stack. It is the top-most fill, and **every fill below it
becomes the fallback** for free. Grain inside the shader comes from its own `grainMixer` and
`grainOverlay`; a Folio `noise` fill under it would be hidden.

**Fallback (recommended): Folio's existing CSS `mesh` fill, built from the same colours.** When a
mesh-gradient shader fill is added, Folio also keeps a `mesh` fill under it. Without JS, without
WebGL 2, offline, or while the script loads, the page shows that gradient (measured: with JS off,
the test page showed the CSS mesh and no canvas). A first-frame PNG is the heavier choice: one
400×300 frame was a ~380 KB data URL (measured), inlined per layer, and it goes stale whenever the
size changes. Skip it unless the user asks.

**Exported HTML (`export.js` `pageFor`).** Only when the page has a shader fill, append one script
before `</body>`. Each shader layer gets a `data-folio-shader='{"shader":"mesh-gradient",…}'`
attribute, and the CSS stays exactly as today, fallback included. The script, about 15 lines:

```html
<script type="module">
  // Paper Shaders 0.0.82, Apache-2.0, https://shaders.paper.design (LICENSE + NOTICE: see link)
  const S = await import('https://cdn.jsdelivr.net/npm/@paper-design/shaders@0.0.82/dist/index.js');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const el of document.querySelectorAll('[data-folio-shader]')) {
    const c = JSON.parse(el.dataset.folioShader);
    try {
      new S.ShaderMount(el, S[shaderExportName(c.shader)], toUniforms(S, c), {}, still ? 0 : c.speed, c.frame);
    } catch (e) { /* no WebGL 2: the CSS fallback stays */ }
  }
</script>
```

`toUniforms` maps params to `u_*` uniforms. Colours go through `S.getShaderColorFromString`, and
`fit` through `S.ShaderFitOptions`, the same way the React wrapper does it. Measured: this pattern
(inline module plus pinned jsDelivr import) rendered and animated from `file://`. There are two
choices:

| | CDN import (above) | Inline the code in the export |
|---|---|---|
| Export size | ~1 KB | +38 KB (mesh only) or more per shader type |
| Offline / `file://` without network | CSS fallback only | Works |
| Redistribution | Folio doesn't redistribute the code; jsDelivr serves npm's copy with its LICENSE | Folio redistributes it, so LICENSE and NOTICE text must ride along in the export (a comment block) |
| Needs | Pinned exact version (README warns that 0.0.x has breaking changes) | The IIFE bundle from §3 option 4, or a hand-built inline module |

Recommended: start with the CDN import. Inline only when someone asks for offline exports.

**Prototype export** (`prototype.js` `fileFor`) should add the same script. **Tailwind and React
export:** React emits `<MeshGradient … />` from `@paper-design/shaders-react@0.0.82` (same license)
plus that dependency. Tailwind HTML uses the plain-HTML script above.

**PNG export and screenshots.** Measured: html-to-image (Folio's PNG library) captured the live
shader canvas when the mount was created with `{ preserveDrawingBuffer: true }`. Folio's editor
should pass that attribute. It has a small GPU cost.

**In the editor:**
- Mount lazily through `import()` from a classic `Folio.shaders` IIFE (§3 option 1).
- Mount only artboards near the viewport, and `dispose()` the rest, because of the context cap.
- Listen for `webglcontextlost` and fall back to CSS.
- Pause in edit mode if it costs too much: `speed 0` plus a fixed `frame` makes it a static render.
- Folio zooms the canvas with CSS `transform`. The library sizes from the layout box, which ignores
  ancestor transforms, so at high zoom the shader may look soft until Folio raises `minPixelRatio`
  with zoom (untested).

## 8. Vendor the library or write our own WebGL?

**What the license allows:** vendoring, modifying and shipping 0.0.77+ in Folio and in its exports,
if LICENSE and NOTICE travel with it and modified files are marked. Visible credit isn't required
but is welcome. Folio may also study the code and write its own shaders. **What Folio's own SPEC
currently says:** "no code copied". So vendoring needs a deliberate SPEC v0.9 amendment.

| | Use Paper Shaders (0.0.82, pinned) | Write a minimal Folio WebGL |
|---|---|---|
| Code Folio writes | A mapping table (params to uniforms), a ~15-line export script, editor mount/dispose | A mount (~100 lines: context, quad, rAF, observers, DPR) plus each shader's GLSL |
| What you get | 30 tuned shaders now, including hard ones (liquid-metal 23 KB, paper-texture 17 KB of source) | Whatever we write. A mesh gradient is easy; liquid metal and halftone are real shader work |
| Browser reach | WebGL 2 only | Could target WebGL 1 too (wider old-device reach) |
| Conventions | ESM only, so `import()` or a one-off IIFE bundle | Native classic IIFE, matches the codebase |
| Upkeep | Pin and upgrade on purpose (0.0.x breaks); NOTICE files; CDN dependency in exports | All ours; no third-party notices |
| SPEC v0.9 rule | Must be amended | Kept |

**Recommendation: use Paper Shaders, pinned to 0.0.82. Load it with `import()` from jsDelivr, both in
the app and in exports, the same way Folio already loads html-to-image. Start with one shader
(`mesh-gradient`, ~10 KB gzip), with Folio's CSS mesh as the fallback. Amend the SPEC v0.9 line, and
add `third_party/paper-shaders-LICENSE` and `-NOTICE`.** Reason: the license now allows it, the
no-build loading path works (measured), and writing our own only pays off for the one easy shader,
while the effects people want from Paper (liquid metal, grain, halftone) are where the shader work
lies. Pick "write our own" if keeping the "no code copied" rule matters more, or if WebGL 1 reach or
offline exports by default are required.

Skipped (YAGNI): first-frame PNG fallback, inline offline export, the IIFE vendor bundle, image-based
shaders. Add them when someone asks.

## Unconfirmed

- Dynamic `import()` from Folio's own classic IIFE files. It is standard JavaScript, but I tested only
  `import()` inside a module script.
- Frame cost and battery on real devices; Safari, Firefox and mobile behaviour. I tested only
  headless Chromium, which renders WebGL in software.
- The exact live WebGL context limit per page (often cited as about 16 in Chrome; not measured), and
  how the library behaves when a context is lost.
- Sharpness under Folio's CSS-transform zoom.
- Whether html-to-image captures the canvas **without** `preserveDrawingBuffer` (only the `true` case
  was tested).
- What the Paper app's own "export code" produces. Only the docs site and README were checked, and
  only the mesh-gradient docs page was fetched.
- My reading of the Apache 2.0 obligations and PolyForm Shield's "competing" clause. This is not
  legal advice.
- Whether the one-off `esbuild --format=iife` bundle works unchanged (not tried).
