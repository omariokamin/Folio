# Image generation providers Folio can call with the user's own key

Research for issue #4. Checked on 2026-11-09. Prices and model names in this space change monthly, so
re-check the linked pages before building.

**Short answer.** Three providers answer a browser page's CORS check (tested): **Google Gemini
(Nano Banana)**, **fal.ai** and **OpenAI**. Gemini and fal return CORS headers even on error responses.
OpenAI passes the preflight but leaves CORS headers off its image-route error responses. **Replicate**,
**Black Forest Labs** and **BytePlus (Seedream)** block browser calls. All six work from the Node bridge,
because CORS only applies in browsers. Recommendation: put image generation in the bridge (like
`import_url`), with a browser-direct fallback for Gemini and fal in the in-app chat.

How to read the evidence:

- **Tested** means I ran a `curl` CORS check on 2026-11-09 with `Origin: http://localhost:8191`, through
  Cloudflare's Amsterdam edge. I sent no real keys. The only key I sent was the fake `sk-fake-folio-test`,
  to get error responses back. The commands are in the appendix.
- **Documented** means the provider's own docs say so, with a link.
- **Unconfirmed** items are listed at the end.

## What a browser needs

A page can call an API directly only if the API allows it through CORS (cross-origin resource sharing).
There are three separate checks:

1. **Preflight.** The browser first asks the server whether it accepts a POST from this origin with an
   `Authorization` (or `x-key` / `x-goog-api-key`) header. The answer must list that origin (or `*`) and
   that header.
2. **Response headers.** The real response must carry `Access-Control-Allow-Origin` too. If it doesn't,
   the browser hides the body. The call may still cost money, and the page sees only a generic "network
   error".
3. **The image file.** If the API returns a URL, an `<img>` can show it without CORS. Folio's PNG export
   and the AI `screenshot` tool are different: they use html-to-image, which re-downloads every image
   with `fetch`. That download needs CORS on the image host. (I inferred this from how html-to-image
   works and did not test it in Folio.)

## Comparison

| Provider | Endpoint (text-to-image / edit) | Auth header | Browser CORS (tested) | Bridge (Node) | Output | URL lifetime |
|---|---|---|---|---|---|---|
| **OpenAI** | `POST https://api.openai.com/v1/images/generations`, `/v1/images/edits` (multipart) | `Authorization: Bearer sk-…` | Preflight OK (`*`). 401 on `/v1/images/*` and `/v1/responses` has **no** ACAO (but `/v1/models` 401 does). Success response not tested | Yes | base64 only (`b64_json`) | n/a |
| **Google Gemini** (Nano Banana) | `POST https://generativelanguage.googleapis.com/v1beta/interactions` (current docs); `…/models/{model}:generateContent` also passes CORS | `x-goog-api-key: …` | Preflight OK (echoes origin) and ACAO on real 400 responses. Sending the `Api-Revision` header makes the preflight fail (403) | Yes | inline base64 | n/a |
| **fal.ai** | `POST https://fal.run/<model-id>` (sync) or `https://queue.fal.run/<model-id>` (queue) | `Authorization: Key …` | Preflight OK, ACAO on real 401, queue status GET OK. `v3.fal.media` files send `*` | Yes | URL on `fal.media`, or a data URI with `sync_mode: true` | "at least 7 days" by default; per-request header can change it |
| **Replicate** | `POST https://api.replicate.com/v1/models/{owner}/{name}/predictions` | `Authorization: Bearer r8_…` | **Blocked**: no CORS headers on preflight or responses | Yes | HTTPS URL on `replicate.delivery` | 1 hour |
| **Black Forest Labs** (FLUX) | `POST https://api.bfl.ai/v1/flux-3-image` (also FLUX.2 / Kontext paths), then GET `polling_url` | `x-key: …` | **Blocked**: allow-list of origins. `https://bfl.ai` passes; `localhost` and `example.com` get 400 "Disallowed CORS origin" | Yes | signed URL (`result.sample`) | **10 minutes**; no CORS on delivery URLs |
| **ByteDance Seedream** via BytePlus ModelArk | `POST https://ark.ap-southeast.bytepluses.com/api/v3/images/generations` | `Authorization: Bearer …` | **Blocked**: allows origin `*` but not the `Authorization` header | Yes | `url` (default) or `b64_json` | 24 hours (documented by Volcengine) |
| Seedream via Volcengine Ark (China) | `POST https://ark.cn-beijing.volces.com/api/v3/images/generations` | `Authorization: Bearer …` | Preflight OK, but 401 has no ACAO (same gap as OpenAI). China-region account | Yes | `url` or `b64_json` | 24 hours |

## Models, sizes, prices, editing

| Provider | Models (ids) | Sizes | Price per image (USD) | Edit / inpaint |
|---|---|---|---|---|
| OpenAI | `gpt-image-2.6-flare`, `gpt-image-2.6-sunburst`, `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1-mini` (`gpt-image-1` shut down 2026-10-23) | 1024×1024, 1536×1024, 1024×1536 recommended; custom sizes in multiples of 16, ratio 1:3 to 3:1, max edge 3840, 655,360 to 8,294,400 pixels | 2.5 / 2.6: token-billed, $30 per 1M image output tokens (no per-image table found). Legacy per-image prices at 1024²: gpt-image-2 low $0.006 / medium $0.053 / high $0.211; gpt-image-1.5 $0.009 / $0.034 / $0.133; 1-mini $0.005 / $0.011 / $0.036 | Yes: `/v1/images/edits`, several reference images, prompt-based mask on the first image (needs an alpha channel, <50 MB), "markup" edits on 2.5 / 2.6. Also outputs PNG / JPEG / WebP, transparent background, SVG and GIF |
| Gemini | `gemini-3-pro-image` (Nano Banana Pro), `gemini-3.1-flash-image` (Nano Banana 2), `gemini-nano-banana-2.1`, `gemini-3.1-flash-lite-image`, `gemini-2.5-flash-image` (deprecated, shuts down 2027-03-15). Imagen is listed as "legacy … (shut down)" | 1K / 2K / 4K (uppercase K), 512px on 3.1 Flash only; ratios such as 1:1, 5:4, 16:9 (plus 1:4, 4:1, 1:8, 8:1 on 2.1 / 3.1 Flash) | Pro: $0.134 (1K–2K), $0.24 (4K). 3.1 Flash: $0.045 (0.5K), $0.067 (1K), $0.101 (2K), $0.151 (4K). 2.1: $0.0336 / $0.0504 / $0.113. Flash-lite $0.0336 (1K). 2.5 Flash $0.039. No free tier for image output | Yes: text-plus-image editing, multi-turn editing, up to 14 reference images. No mask. Every image carries a SynthID watermark |
| fal.ai | Hosts many models: `fal-ai/flux-2`, `fal-ai/nano-banana-pro` (+ `/edit`), `fal-ai/bytedance/seedream/v4.5/text-to-image`, and others | Per model | flux-2 $0.012 per megapixel; nano-banana-pro $0.15 (4K $0.30); Seedream 4.5 $0.04 | Per model (edit endpoints exist for Nano Banana Pro, FLUX.2, Seedream) |
| Replicate | Hosts many models, e.g. `black-forest-labs/flux-2-pro` | Per model (flux-2-pro: inputs up to 9 MP, edits up to 4 MP) | Not found on the model page (see Unconfirmed) | Per model |
| BFL | FLUX 3 Image, FLUX 3 Klein, FLUX.2 [pro] / [flex] / [max] / [klein], Kontext [pro] / [max] | `resolution` `768sq`, `1k`, `1.5k`, `2k`, `4k`, or width / height 256 to 6256 | At 1 MP: FLUX 3 $0.048, FLUX 3 Klein $0.009, FLUX.2 pro $0.03 (edit $0.045), flex $0.05 ($0.10), max $0.07 ($0.10), klein 9B $0.015, Kontext pro $0.04, max $0.08 | Yes: `images` field takes 1 to 10 reference images (URL or base64). No mask on FLUX 3 |
| Seedream | `doubao-seedream-5-0-260128`, `doubao-seedream-5-0-lite-260128`, `doubao-seedream-4-5-251128`, `doubao-seedream-4-0-250828` (Volcengine ids; BytePlus ids not confirmed) | 4.5: 2K / 4K or W×H, 2560×1440 to 4096×4096 pixels, ratio 1:16 to 16:1 | Official price not found. Resellers charge about $0.04 (fal, OpenRouter) | Yes: up to 14 reference images, image sets (`sequential_image_generation`), optional "AI-generated" watermark |

## Provider notes

**OpenAI.** OpenAI's own JS SDK disables browsers by default and asks you to opt in with
`dangerouslyAllowBrowser: true`. The README calls this "dangerous" because the key is exposed, but says it
can be acceptable for a user's own key ([openai-node README](https://github.com/openai/openai-node#requirements)).
This matches how Folio already treats the Anthropic key. Tested problem: a 401 from the image routes
carries no `Access-Control-Allow-Origin`, so in a browser a wrong key looks like a network error, not
"invalid key". Validate the key first with `GET /v1/models` (its 401 does carry ACAO) to get a readable
error. Output is always base64. "Complex prompts may take up to 2 minutes." Sources:
[image generation guide](https://developers.openai.com/api/docs/guides/image-generation),
[pricing](https://developers.openai.com/api/docs/pricing).

**Google Gemini (Nano Banana).** This is the easiest browser case. The API echoes the page's origin on
preflights and real responses. The REST docs now use the `interactions` endpoint with
`x-goog-api-key` and an `Api-Revision: 2026-05-20` header. A browser can't send that header, because the
preflight returns 403 when it's included. Without it, the preflight passes. Whether the API needs it was
not tested, and `:generateContent` passes the CORS checks either way. Output is base64 in
`output_image.data`. Sources: [image generation docs](https://aistudio.google.com/docs/image-generation),
[pricing](https://aistudio.google.com/docs/pricing).

**fal.ai.** It works from a browser, and the image files on `fal.media` send `Access-Control-Allow-Origin: *`,
so Folio's export can read them. fal's official stance on browser use: "Yes, but you should not expose your API key in
client-side code". It recommends a server proxy ([FAQ](https://fal.ai/docs/documentation/model-apis/faq.md),
[server-side guide](https://fal.ai/docs/model-endpoints/server-side)). With a user-held key, that is the
same trade-off as OpenAI. Files stay "at least 7 days by default". The header
`X-Fal-Object-Lifecycle-Preference` changes that per request
([media expiration](https://fal.ai/docs/documentation/model-apis/media-expiration)). Pass
`sync_mode: true` to get a data URI back instead of a URL. New accounts can run 2 requests at once. fal
is the one key that reaches FLUX.2, Nano Banana Pro and Seedream 4.5, so it covers most of Paper's list.

**Replicate.** Not callable from a browser. No CORS headers came back (tested). A Replicate maintainer
said: "Replicate's API doesn't support CORS, so this library can't interact with the API directly from a
browser" ([replicate-javascript#164](https://github.com/replicate/replicate-javascript/issues/164),
closed 2025-03-26). From the bridge it's straightforward: `Prefer: wait` holds the request open for up
to 60 s ([HTTP API](https://replicate.com/docs/reference/http)). Output files expire after one hour
([output files](https://replicate.com/docs/topics/predictions/output-files)), so download them straight
away.

**Black Forest Labs.** Not callable from a browser. CORS is limited to BFL's own sites (tested). The
API is asynchronous: submit, then poll `polling_url`. Results "expire after 10 minutes", and "We do not
enable CORS on delivery URLs". BFL says to download the image and serve it yourself
([integration guidelines](https://docs.bfl.ml/api_integration/integration_guidelines.md),
[FLUX 3 API](https://docs.bfl.ml/api-reference/utility/generate-an-image-with-flux-3.md),
[pricing](https://bfl.ai/pricing)). Regional hosts are `api.eu.bfl.ai` and `api.us.bfl.ai`.

**ByteDance Seedream.** The official APIs are BytePlus ModelArk (international) and Volcengine Ark
(China). BytePlus blocks browsers because its CORS reply leaves `Authorization` off the allowed
headers (tested). Volcengine passes the preflight, but its 401 has no ACAO, and it needs a China-region
account. Use `response_format: "b64_json"` to skip the 24-hour URL. Source:
[Volcengine Seedream API](https://docs.volcengine.com/docs/6492/2172373?lang=en). The BytePlus doc pages
render with JavaScript and could not be read (see Unconfirmed).

## How Paper does it

Paper runs image generation **through its own backend**. Users don't bring a key. The plans meter
usage: Free gets "Limited image generation", and Pro ($16/editor/month yearly) gets "100x more image gen
per week" ([pricing](https://paper.design/pricing)). Paper's subprocessor list names the providers:
**OpenAI** ("Image generation and editing"), **Replicate** ("Image generation"), **xAI**, **Recraft** and
**Quiver AI** (SVG), with Cloudflare Workers / R2 and Fly.io for hosting
([subprocessors](https://paper.design/legal/subprocessors)). fal, BFL, Google and ByteDance are not on
that list. Flux 2, Nano Banana Pro and Seedream 4.5 are all on Replicate, so Paper most likely calls them
through Replicate. That is an inference; Paper doesn't say so. The changelog dates these models to
2025-12-19, with later updates in 2026 (GPT Image 2, Nano Banana 2 / 2.1, xAI, image generation over MCP)
([build log](https://paper.design/build-log)).

## Recommendation for Folio

1. **Bridge first, mirroring `import_url`.** Add one bridge-handled tool, for example
   `generate_image { prompt, provider, size, reference_ids? }`. Node calls the provider with a key from an
   environment variable or `~/.folio/` (never from the page), downloads the result, then forwards it to the
   tab as a normal `create_nodes` / `update_nodes` image. This reaches all six providers, and short-lived
   URLs (BFL's 10 minutes, Replicate's 1 hour) never end up in a document. In the in-app chat, the tool
   returns a clear error, the same way `import_url` does today.
2. **Browser-direct fallback, only for Gemini and fal.** Both send CORS headers on real responses, and
   both need just a key header. Store the key the way `src/ai.js` stores the Anthropic key (`folio:ai:key`
   pattern, "Remember on this device"). OpenAI can come third: check the key first with `GET /v1/models`
   so a wrong key gives a readable error.
3. **Always store the image, never the provider URL.** Turn every result into a data URL, but first
   **downscale and re-encode** it. Use the brand logo path as the model: longest side 1024 px, at most
   1.5 MB (`LOGO_MAX_BYTES` in `src/brand.js`), saved as WebP or JPEG. This matters because `image.src`
   data URLs autosave into localStorage (`folio:autosave:v1`). A 1024² PNG is roughly 1.5 to 4 MB as
   base64, and browsers allow about 5 MB per origin, so two raw results already trigger the "Autosave failed
   (file too large — large images?)" toast in `state.js`. Moving autosave to IndexedDB would fix this
   properly, but that's out of scope here.
4. **Default provider: Gemini.** It is the only option that is browser-safe, needs one key, and offers
   editing with reference images, at $0.034 to $0.134 per image. fal is the "many models, one key" choice,
   and it covers the Paper lineup.

Skipped: masks / inpainting UI, image sets, streaming previews. Add them when a real edit flow needs them.

## Unconfirmed

- **OpenAI success responses:** I didn't test whether a successful `/v1/images/*` response carries
  `Access-Control-Allow-Origin`, because that needs a real key. The preflight passes and the SDK documents
  browser use, but the 401s on these routes had no ACAO.
- **OpenAI per-image cost for 2.5 / 2.6 models:** only the token rate ($30 per 1M output tokens) was
  found. The tokens-per-image table was not in the parts of the guide I could read.
- **Gemini:** whether `interactions` needs the `Api-Revision` header (browsers can't send it). Whether
  `:generateContent` still serves the current image models. The maximum inline input image size.
- **Volcengine:** whether success responses carry ACAO. Its doc also shows a different host
  (`operator.las.ap-southeast-1.volces.com`) that didn't answer my preflight.
- **BytePlus:** official Seedream price, exact BytePlus model ids, and its own URL-lifetime statement. The
  docs pages render with JavaScript and the fetch got only navigation. The roughly $0.04 figure comes from
  resellers.
- **Replicate:** prices for `flux-2-pro` and the other models (not on the model page I fetched). CORS on
  real `replicate.delivery` files (my probe hit a 404 without CORS headers).
- **BFL:** the per-model endpoint paths other than `/v1/flux-3-image`.
- **fal:** the media-expiration page says "Configurable", but the FAQ says "at least 7 days", so the docs
  disagree.
- **Paper:** which provider serves each model. The Replicate routing is an inference from the subprocessor
  list.
- **Folio export:** that html-to-image fails on non-CORS image hosts is inferred and was not tested in
  Folio. Storing data URLs (recommendation 3) avoids the issue either way.

## Appendix: tests run (2026-11-09)

All commands used `-H 'Origin: http://localhost:8191' -H 'Access-Control-Request-Method: POST'` and
`-H 'Access-Control-Request-Headers: authorization,content-type'` unless noted.

```
OPTIONS api.openai.com/v1/images/generations        200  ACAO: *               allow-headers: authorization,content-type
OPTIONS api.openai.com/v1/images/edits              200  ACAO: *
POST    api.openai.com/v1/images/generations (fake key)  401  no ACAO
POST    api.openai.com/v1/images/edits / v1/responses    401  no ACAO
GET     api.openai.com/v1/models (fake key)         401  ACAO: *
OPTIONS generativelanguage…/models/gemini-3-pro-image-preview:generateContent  200  ACAO: <origin>
OPTIONS generativelanguage…/models/imagen-4.0-generate-001:predict             200  ACAO: <origin>
OPTIONS generativelanguage…/v1beta/interactions [x-goog-api-key,content-type]  200  ACAO: <origin>
OPTIONS generativelanguage…/v1beta/interactions [+ api-revision]              403
POST    generativelanguage…/gemini-2.5-flash-image:generateContent (fake key) 400  ACAO: <origin>
POST    generativelanguage…/v1beta/interactions (fake key)                     400  ACAO: <origin>
OPTIONS fal.run/fal-ai/flux-2 and queue.fal.run/fal-ai/flux-2                 200  ACAO: <origin> (any origin echoed)
OPTIONS queue.fal.run/…/requests/abc/status (GET)                              200  ACAO: <origin>
POST    fal.run/fal-ai/flux-2 (fake key)            401  ACAO: <origin>
HEAD    v3.fal.media/files/…                        404  ACAO: *
OPTIONS api.replicate.com/v1/predictions, /v1/models/…/predictions             200  no CORS headers
POST    api.replicate.com/v1/predictions (no key)   401  no ACAO
OPTIONS api.bfl.ai/v1/flux-2-pro [x-key,content-type]  400 "Disallowed CORS origin"
        same with Origin https://bfl.ai or https://dashboard.bfl.ai           200  ACAO: that origin
        same with Origin https://example.com or http://localhost:3000        400
OPTIONS ark.ap-southeast.bytepluses.com/api/v3/images/generations  204  ACAO: *  allow-headers: Origin,Content-Length,Content-Type
POST    ark.ap-southeast.bytepluses.com/… (fake key)               401  no ACAO
OPTIONS ark.cn-beijing.volces.com/api/v3/images/generations        200  ACAO: <origin>  allow-headers: authorization,content-type
POST    ark.cn-beijing.volces.com/… (fake key)                     401  no ACAO
OPTIONS api.anthropic.com/v1/messages (baseline, Folio's current API)          200  ACAO: *
```
