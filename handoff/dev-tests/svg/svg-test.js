// Folio.svg + brand-panel logo tests in the real index.html.
// Run: python3 -m http.server 8141 (repo root), then node .dev/svg/svg-test.js
const fs = require('fs');
const path = require('path');
const { open, check, failures } = require('./harness');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const WORDMARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120"><title>Crumb</title><text x="20" y="88" font-family="Fraunces, Georgia, serif" font-size="80" font-weight="700" fill="#431407" letter-spacing="-2">Crumb</text></svg>`;
const MONOGRAM = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="120">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" style="stop-color:#c2410c"/></linearGradient>
    <clipPath id="c"><circle cx="60" cy="60" r="56"/></clipPath>
  </defs>
  <g clip-path="url(#c)"><rect width="120" height="120" fill="url(#g)"/></g>
  <path id="m" d="M30 86V34l30 30 30-30v52" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  <use xlink:href="#m" transform="translate(0 4)" opacity=".2"/>
</svg>`;
// a badge: dark shape, white knockout text, orange accent
const BADGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><rect width="320" height="120" rx="60" fill="#1c1917"/><circle cx="60" cy="60" r="30" fill="#f59e0b"/><text x="110" y="78" font-family="Georgia" font-size="48" font-weight="700" fill="#ffffff">Crumb</text></svg>`;
const SIMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><path d="M10 70L40 10L70 70Z"/><text x="80" y="58" font-family="Georgia" font-size="40" fill="#1c1917">Peak</text><circle cx="185" cy="20" r="8" fill="#c2410c"/></svg>`;

const R = '<rect width="10" height="10"/>';
const HOSTILE = {
  script: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>window.__xss='script'</script><script><![CDATA[window.__xss='cdata']]></script>${R}</svg>`,
  onload: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="window.__xss='onload'"><rect width="10" height="10" onclick="window.__xss='click'" OnMouseOver="window.__xss='mo'"/></svg>`,
  jsLink: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><a href="javascript:window.__xss='a'"><rect width="10" height="10"/></a><a xlink:href="javascript:window.__xss='a2'">${R}</a></svg>`,
  xlinkExternal: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">${R}<use xlink:href="https://evil.test/sprite.svg#a"/><linearGradient id="g" xlink:href="https://evil.test/g.svg#g"/></svg>`,
  useHttps: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${R}<use href="https://evil.test/x.svg#a"/><use href="data:image/svg+xml,&lt;svg/&gt;#a"/><use href=" javascript:window.__xss='use'"/></svg>`,
  styleUrl: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" style="background:url(https://evil.test/bg.png)"><rect width="10" height="10" style="fill:#f00;behavior:url(https://evil.test/x.htc);mask:image-set('https://evil.test/m.png' 1x)"/><rect width="5" height="5" fill="url(https://evil.test/p.svg#p)" filter="url(https://evil.test/f.svg#f)" mask="image-set('https://evil.test/m.png' 1x)"/><circle r="3" fill="red;background:url(https://evil.test/c)" transform="url(https://evil.test/t)"/></svg>`,
  foreignObject: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${R}<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><img src="https://evil.test/x.png" onerror="window.__xss='fo'"/><iframe src="javascript:parent.__xss='iframe'"></iframe></div></foreignObject></svg>`,
  styleTag: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@import url(https://evil.test/a.css); rect { fill: url(https://evil.test/p) }</style><style>@font-face{font-family:x;src:url(https://evil.test/f.woff2)}</style>${R}</svg>`,
  image: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">${R}<image href="https://evil.test/i.png" width="10" height="10"/><image xlink:href="data:image/svg+xml;base64,PHN2Zy8+"/><feImage href="https://evil.test/fe.png"/></svg>`,
  animate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a><rect width="10" height="10"><set attributeName="onmouseover" to="window.__xss='set'"/><animate attributeName="href" values="javascript:window.__xss='anim'"/></rect></a><iframe/><embed src="https://evil.test/e"/><object data="https://evil.test/o"/></svg>`,
  foreignNs: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml" viewBox="0 0 10 10">${R}<h:script>window.__xss='hscript'</h:script><h:img src="x" onerror="window.__xss='himg'"/></svg>`,
  pi: `<?xml version="1.0"?><?xml-stylesheet href="https://evil.test/s.css" type="text/css"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- <script>window.__xss='comment'</script> -->${R}</svg>`,
  textBreakout: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text font-family="x&quot;;}&lt;/style&gt;&lt;script&gt;window.__xss=1&lt;/script&gt;">&lt;script&gt;window.__xss='text'&lt;/script&gt;</text>${R}</svg>`,
  useBomb: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><g id="a">${R}</g><g id="b"><use href="#a"/><use href="#a"/></g><g id="c"><use href="#b"/><use href="#b"/></g></defs><use href="#c"/><use href="#self" id="self"/><use href="#missing"/></svg>`,
  okDoctype: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${R}</svg>`,
  fontFaceOk: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><style>@font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 100 900; src: url(data:font/woff2;base64,d09GMgABAAAAAA==) format('woff2'); unicode-range: U+0000-00FF, U+0131; }</style></defs>${R}</svg>`,
  fontFaceSneaky: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@font-face { font-family: 'x'; src: url(data:font/woff2;base64,AAAA), url(https://evil.test/f.woff2); }</style><style>@font-face { font-family: 'x'; src: url(data:font/woff2;base64,AAAA) } * { fill: url(https://evil.test/x) }</style>${R}</svg>`,
};
const MUST_THROW = {
  entity: `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "<script>window.__xss='entity'</script>">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">&x;${R}</svg>`,
  laughs: `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>&lol3;</text></svg>`,
  externalEntity: `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>&xxe;</text></svg>`,
  undeclaredEntity: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>&nbsp;&x;</text>${R}</svg>`,
  huge: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${'<rect width="1" height="1"/>'.repeat(9000)}</svg>`,
  html: `<html><body><script>window.__xss='html'</script></body></html>`,
  xhtmlRoot: `<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 10 10">${R}</svg>`,
  broken: `<svg viewBox="0 0 10 10"><rect></svg>`,
  noSize: `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`,
  onlyScript: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>window.__xss='only'</script><foreignObject/></svg>`,
  deep: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${'<g>'.repeat(3000)}${R}${'</g>'.repeat(3000)}</svg>`,
  notString: null,
};

(async () => {
  const { browser, page, logs, evil } = await open();

  // ---------------- sanitize: hostile ----------------
  console.log('# sanitize — hostile inputs');
  const hostile = await page.evaluate(async (cases) => {
    const out = {};
    for (const [k, v] of Object.entries(cases)) {
      try {
        const r = Folio.svg.sanitize(v);
        // render it in the most dangerous places: inline in the page and as an <img>
        const div = document.createElement('div');
        div.innerHTML = r.svg;
        document.body.appendChild(div);
        div.querySelectorAll('*').forEach((e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true })) || e.dispatchEvent(new MouseEvent('mouseover')));
        const img = new Image();
        img.src = Folio.svg.toDataUrl(r.svg);
        await img.decode().catch(() => {});
        await new Promise((res) => setTimeout(res, 30));
        div.remove();
        out[k] = { svg: r.svg, warnings: r.warnings };
      } catch (e) {
        out[k] = { error: e.message };
      }
    }
    return { out, xss: window.__xss || null };
  }, HOSTILE);
  for (const [k, r] of Object.entries(hostile.out)) {
    if (r.error) {
      check(false, `${k}: sanitized without throwing`, r.error);
      continue;
    }
    const body = r.svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
    const bad = body.match(/<script|<style(?![^>]*>@font-face)|\son\w+=|javascript:|https?:|foreignObject|<image|<a[\s>]|<iframe|<set|<animate|<use[^>]*href="(?!#)|ENTITY|xml-stylesheet|behavior|image-set|filter=/i);
    check(!bad, `${k}: nothing dangerous left`, bad && [bad[0], r.svg]);
    check(/<rect/.test(r.svg), `${k}: the harmless shape survived`, r.svg);
  }
  check(!hostile.xss, 'no hostile payload executed', hostile.xss);
  check(/@font-face/.test(hostile.out.fontFaceOk.svg || ''), 'a strict @font-face with a data: font is kept (embedFonts output stays valid)', hostile.out.fontFaceOk);
  check(!/<style/.test(hostile.out.fontFaceSneaky.svg || ''), '@font-face with an external src or extra rules is dropped');
  const bomb = await page.evaluate((svg) => {
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    return [...root.querySelectorAll('use')].map((u) => { const t = root.querySelector(u.getAttribute('href')); return !t || !!t.querySelector('use') || t.localName === 'use'; });
  }, hostile.out.useBomb.svg);
  check(/<use href="#a"\/>/.test(hostile.out.useBomb.svg) && !bomb.some(Boolean) && !/#self|#missing|href="#b"/.test(hostile.out.useBomb.svg), '<use> keeps flat internal refs only (no fan-out, self or missing targets)', hostile.out.useBomb.svg);
  check(/fill="#f00"/.test(hostile.out.styleUrl.svg) && !/style=/.test(hostile.out.styleUrl.svg), 'safe style props become attributes; style= is gone', hostile.out.styleUrl.svg);
  check(hostile.out.textBreakout.svg.includes('&lt;script&gt;'), 'text stays text (escaped)', hostile.out.textBreakout.svg);
  check(hostile.out.styleUrl.warnings.length > 0 && hostile.out.script.warnings.some((w) => /script/.test(w)), 'warnings name what was removed', [hostile.out.script.warnings, hostile.out.styleUrl.warnings]);

  const thrown = await page.evaluate((cases) => {
    const out = {};
    for (const [k, v] of Object.entries(cases)) {
      const t0 = performance.now();
      try {
        out[k] = { svg: Folio.svg.sanitize(v).svg };
      } catch (e) {
        out[k] = { error: e.message };
      }
      out[k].ms = Math.round(performance.now() - t0);
    }
    return { out, xss: window.__xss || null };
  }, MUST_THROW);
  for (const [k, r] of Object.entries(thrown.out)) check(r.error && r.ms < 2000, `${k}: refused with a message (${r.ms} ms)`, r.error || r.svg);
  console.log('    e.g.', thrown.out.huge.error, '|', thrown.out.entity.error, '|', thrown.out.broken.error);
  check(!thrown.xss, 'no payload executed while refusing');

  // ---------------- sanitize: valid logos ----------------
  console.log('# sanitize — valid logos');
  const valid = await page.evaluate(([w, m, b]) => {
    const a = Folio.svg.sanitize(w);
    const mo = Folio.svg.sanitize(m);
    const lower = Folio.svg.sanitize('<svg width="40" height="20"><Rect width="40" height="20" FILL="red"/></svg>');
    return { w: a, m: mo, lower, size: Folio.svg.size(mo.svg), sizeW: Folio.svg.size(a.svg), b: Folio.svg.sanitize(b) };
  }, [WORDMARK, MONOGRAM, BADGE]);
  check(valid.w.warnings.length === 0 && /<text[^>]*font-family="Fraunces, Georgia, serif"[^>]*>Crumb<\/text>/.test(valid.w.svg) && /<title>Crumb<\/title>/.test(valid.w.svg), 'wordmark passes untouched (no warnings)', valid.w);
  check(/linearGradient/.test(valid.m.svg) && /clip-path="url\(#c\)"/.test(valid.m.svg) && /stop-color="#c2410c"/.test(valid.m.svg) && /<use href="#m"/.test(valid.m.svg), 'monogram keeps gradient, clipPath, style→stop-color and internal <use>', valid.m.svg);
  check(/viewBox="0 0 120 120"/.test(valid.m.svg) && valid.size.width === 120, 'viewBox added from width/height', valid.m.warnings);
  check(/width="400" height="120"/.test(valid.w.svg) && valid.sizeW.width === 400 && valid.sizeW.height === 120, 'width/height added from viewBox; size() reads viewBox', valid.sizeW);
  check(/<rect width="40" height="20" fill="red"/.test(valid.lower.svg) && /xmlns="http:\/\/www.w3.org\/2000\/svg"/.test(valid.lower.svg), 'missing xmlns + odd-case names are tolerated', valid.lower.svg);
  const tokens = await page.evaluate(() => {
    const b = Folio.brand.create('crumb-bakery') || Folio.brand.create({ name: 'Crumb', colors: { primary: '#c2410c' } });
    Folio.brand.setActive(b.id);
    return Folio.svg.sanitize('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="var(--color-primary)" stroke="var(--color-nope)"/><text font-family="var(--font-heading)">A</text></svg>');
  });
  check(/fill="#[0-9a-f]{6}"/.test(tokens.svg) && !/var\(/.test(tokens.svg) && !/stroke=/.test(tokens.svg), 'brand colour tokens resolve to literals; unknown tokens are dropped', tokens);
  check(/font-family="&quot;\w[\w ]*&quot;, /.test(tokens.svg) || /font-family="[^"]*serif/.test(tokens.svg), 'brand font token resolves to a family stack', tokens.svg);

  // ---------------- embedFonts ----------------
  console.log('# embedFonts');
  const emb = await page.evaluate(async (w) => {
    const clean = Folio.svg.sanitize(w).svg;
    const warnings = [];
    const t0 = performance.now();
    const out = await Folio.svg.embedFonts(clean, warnings);
    const again = Folio.svg.sanitize(out).svg; // must survive a second sanitize (Make versions does that)
    const twice = await Folio.svg.embedFonts(out);
    return { out, again, warnings, ms: Math.round(performance.now() - t0), kb: Math.round(out.length / 1024), styles: (twice.match(/<style/g) || []).length };
  }, WORDMARK);
  check(/@font-face/.test(emb.out) && /data:font\/woff2;base64,/.test(emb.out) && !emb.warnings.length, `@font-face inlined (${emb.kb} KB, ${emb.ms} ms)`, emb.warnings);
  check(emb.kb < 40, 'font is cut to the characters used (small)', emb.kb);
  check(emb.again === emb.out, 'sanitize(embedFonts(x)) keeps the embedded font unchanged');
  check(emb.styles === 1, 're-embedding replaces instead of stacking styles');
  // pixels: <img> with the embedded font vs. without, vs. the same text in HTML using the page's Fraunces
  await page.evaluate(async ([plain, embedded]) => {
    Folio.fonts.ensure('Fraunces');
    await document.fonts.load('700 80px Fraunces');
    const box = document.createElement('div');
    box.id = 'fontbox';
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;padding:10px;display:flex;flex-direction:column;gap:6px';
    const img = (svg, id) => Object.assign(document.createElement('img'), { id, src: Folio.svg.toDataUrl(svg), width: 400, height: 120 });
    const ref = document.createElement('div');
    ref.id = 'ref';
    ref.style.cssText = 'width:400px;height:120px;position:relative;';
    ref.innerHTML = '<svg width="400" height="120" viewBox="0 0 400 120" style="display:block"><text x="20" y="88" font-family="Fraunces" font-size="80" font-weight="700" fill="#431407" letter-spacing="-2">Crumb</text></svg>';
    box.append(img(plain, 'plain'), img(embedded, 'embedded'), ref);
    document.body.appendChild(box);
    await Promise.all([...box.querySelectorAll('img')].map((i) => i.decode()));
  }, [valid.w.svg, emb.out]);
  const shots = {};
  for (const id of ['plain', 'embedded', 'ref']) shots[id] = await page.locator('#' + id).screenshot({ path: path.join(OUT, `font-${id}.png`) });
  const diff = await page.evaluate(async (s) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
    const px = async (b64) => { const i = await load(b64); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
    const [a, b, r] = await Promise.all([px(s.plain), px(s.embedded), px(s.ref)]);
    const d = (p, q) => { let n = 0; for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) > 40) n++; return n; };
    return { embVsRef: d(b, r), plainVsRef: d(a, r) };
  }, Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, v.toString('base64')])));
  check(diff.embVsRef < diff.plainVsRef / 5, 'inside <img>, the embedded wordmark matches real Fraunces; the plain one does not', diff);
  await page.evaluate(() => document.getElementById('fontbox').remove());

  // ---------------- versions ----------------
  console.log('# versions');
  const vers = await page.evaluate(([badge, simple, mono]) => {
    const all = {};
    [['badge', badge], ['simple', simple], ['monogram', mono]].forEach(([k, s]) => (all[k] = Folio.svg.versions(Folio.svg.sanitize(s).svg, null)));
    const brand = { colors: [{ id: 'background', value: '#fff7ed' }, { id: 'text', value: '#292524' }] };
    all.branded = Folio.svg.versions(Folio.svg.sanitize(simple).svg, brand);
    const rc = Folio.svg.recolor('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="red" stroke="blue"/><stop/><mask id="m"><rect fill="#fff"/></mask></svg>', () => '#123456');
    return { all, rc };
  }, [BADGE, SIMPLE, MONOGRAM]);
  const fills = (s) => (s.match(/(fill|stroke|stop-color)="[^"]+"/g) || []).join(' ');
  check(/<rect[^>]*fill="#ffffff"/.test(vers.all.badge['on-dark']) && /<text[^>]*fill="#1c1917"/.test(vers.all.badge['on-dark']) && /#f59e0b/.test(vers.all.badge['on-dark']), 'badge on-dark: dark shape → white, white knockout text → the dark colour, accent kept', fills(vers.all.badge['on-dark']));
  check(/<svg[^>]*fill="#ffffff"/.test(vers.all.simple['on-dark']) && /<text[^>]*fill="#ffffff"/.test(vers.all.simple['on-dark']) && /#c2410c/.test(vers.all.simple['on-dark']), 'unpainted (default black) shapes and dark text turn white; brand accent stays', fills(vers.all.simple['on-dark']));
  check(fills(vers.all.simple.mono).split(' ').every((f) => /#111111/.test(f)), 'mono: one ink (#111111 without a brand)', fills(vers.all.simple.mono));
  check(/#fff7ed/.test(vers.all.branded['on-dark']) && /#292524/.test(vers.all.branded.mono), 'with a brand: on-dark uses the light brand background, mono the brand text colour', [fills(vers.all.branded['on-dark']), fills(vers.all.branded.mono)]);
  check(/<rect fill="#123456" stroke="#123456"/.test(vers.rc) && /<stop stop-color="#123456"/.test(vers.rc) && /<mask[^>]*>(<rect fill="#fff"\/>)/.test(vers.rc), 'recolor: fill/stroke/stop-color + default black; mask contents untouched', vers.rc);
  // look at them: each version on light and dark grounds
  await page.evaluate((all) => {
    const box = document.createElement('div');
    box.id = 'vbox';
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#888;padding:8px;display:grid;grid-template-columns:repeat(6, 190px);gap:6px;font:11px system-ui';
    Object.entries(all).forEach(([k, vs]) =>
      Object.entries(vs).forEach(([v, svg]) =>
        ['#ffffff', '#111111'].forEach((bg) => {
          const cell = document.createElement('div');
          cell.style.cssText = `background:${bg};height:90px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:${bg === '#ffffff' ? '#666' : '#aaa'}`;
          const img = Object.assign(document.createElement('img'), { src: Folio.svg.toDataUrl(svg) });
          img.style.cssText = 'max-width:160px;max-height:60px';
          cell.append(img, `${k} · ${v}`);
          box.append(cell);
        })
      )
    );
    document.body.appendChild(box);
  }, vers.all);
  await page.waitForTimeout(200);
  await page.locator('#vbox').screenshot({ path: path.join(OUT, 'versions.png') });
  await page.evaluate(() => document.getElementById('vbox').remove());

  // ---------------- fromNode on a Folio wordmark frame ----------------
  console.log('# fromNode');
  const fn = await page.evaluate(async () => {
    const s = Folio.store;
    const keep = Folio.brand.active().id;
    s.newDoc && s.newDoc();
    Folio.brand.setActive(keep);
    const b = Folio.brand.active();
    const root = s.createNode('frame', { name: 'Logo board', x: 0, y: 0, width: 600, height: 300, layout: { mode: 'flex', direction: 'column', justify: 'center', align: 'center' }, style: { fills: [{ type: 'solid', color: '#ffffff' }] } }, null);
    const mark = s.createNode('frame', { name: 'Crumb wordmark', sizing: { w: 'hug', h: 'hug' }, layout: { mode: 'flex', direction: 'row', gap: 14, padding: [14, 28, 14, 18], align: 'center' }, style: { radius: 999, fills: [{ type: 'linear', angle: 90, stops: [{ color: '#431407', pos: 0 }, { color: '#7c2d12', pos: 100 }] }], border: { width: 2, color: '#f59e0b', style: 'solid' } } }, root.id);
    s.createNode('frame', { name: 'Dot', width: 44, height: 44, sizing: { w: 'fixed', h: 'fixed' }, style: { radius: 9999, fills: [{ type: 'solid', color: b ? 'var(--color-accent)' : '#f59e0b' }] } }, mark.id);
    s.createNode('text', { name: 'Name', sizing: { w: 'hug', h: 'hug' }, text: { content: 'Crumb Bakery', font: 'Fraunces', size: 44, weight: 700, color: '#fff7ed', letterSpacing: -0.02, lineHeight: 1.1 } }, mark.id);
    s.commit('build');
    Folio.fonts.ensure('Fraunces');
    await document.fonts.load('700 44px Fraunces');
    await new Promise((r) => setTimeout(r, 300));
    const warnings = [];
    const raw = await Folio.svg.fromNode(mark.id, warnings);
    const clean = Folio.svg.sanitize(raw);
    // the same flow for an image whose src already is an SVG
    const img = s.createNode('image', { name: 'Svg image', width: 100, height: 30, image: { src: Folio.svg.toDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 3"><rect width="10" height="3" fill="#0a0"/></svg>'), fit: 'contain' } }, root.id);
    const own = await Folio.svg.fromNode(img.id);
    let rasterErr = null;
    const ras = s.createNode('image', { name: 'Raster', width: 40, height: 40, image: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } }, null);
    try { await Folio.svg.fromNode(ras.id); } catch (e) { rasterErr = e.message; }
    s.remove && s.remove([img.id, ras.id]);
    return { markId: mark.id, raw, clean, warnings, own, rasterErr };
  });
  check(/<text[^>]*font-family="[^"]*Fraunces/.test(fn.raw) && /Crumb Bakery/.test(fn.raw) && /linearGradient/.test(fn.raw) && /@font-face/.test(fn.raw), 'frame → real vectors: text (Fraunces), gradient, embedded font', fn.raw.slice(0, 600));
  check(fn.clean.warnings.length === 0 && fn.clean.svg.length > 0, 'fromNode output passes sanitize cleanly', fn.clean.warnings);
  check(/fill="#0a0"/.test(fn.own), 'an image that already is an SVG returns its own SVG', fn.own);
  check(fn.rasterErr && /vector/.test(fn.rasterErr), 'a raster image gives a plain error', fn.rasterErr);
  // compare canvas vs. <img> of the generated SVG
  await page.evaluate(async ([svg]) => {
    const box = document.createElement('div');
    box.id = 'fnbox';
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;padding:10px';
    const img = Object.assign(document.createElement('img'), { src: Folio.svg.toDataUrl(svg) });
    box.append(img);
    document.body.appendChild(box);
    await img.decode();
  }, [fn.clean.svg]);
  await page.locator('#fnbox img').screenshot({ path: path.join(OUT, 'fromnode-svg.png') });
  await page.evaluate(() => document.getElementById('fnbox').remove());
  await page.evaluate((id) => Folio.canvas.zoomToFit && Folio.canvas.zoomToFit([id]), fn.markId);
  await page.waitForTimeout(300);
  await page.evaluate(() => Folio.store.select([]));
  const markBox = await page.evaluate((id) => { const r = Folio.render.el(id).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, fn.markId);
  await page.screenshot({ path: path.join(OUT, 'fromnode-canvas.png'), clip: markBox });

  // ---------------- brand panel: save selection, make versions ----------------
  console.log('# brand panel');
  await page.evaluate((id) => { Folio.store.select([id]); Folio.brandPanel.show('brand'); }, fn.markId);
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => Folio.brand.active().logos.length);
  await page.locator('#brand-panel .bp-logo-save').click();
  await page.waitForFunction((n) => Folio.brand.active().logos.length >= n + 3, before, { timeout: 15000 });
  await page.waitForTimeout(200);
  const saved = await page.evaluate(() => {
    const ls = Folio.brand.active().logos.filter((l) => l.group);
    const groupEl = document.querySelector('#brand-panel .bp-logo-group');
    return {
      ls: ls.map((l) => ({ id: l.id, name: l.name, version: l.version, group: l.group, svg: l.src.startsWith('data:image/svg+xml'), w: l.width, h: l.height, kb: Math.round(l.src.length / 1024) })),
      labels: groupEl ? [...groupEl.querySelectorAll('.bp-logo__name')].map((e) => e.textContent) : null,
      head: groupEl && groupEl.querySelector('.bp-logo-group__name').textContent,
      dark: !!(groupEl && groupEl.querySelector('[data-version="on-dark"] .bp-logo__thumb.is-dark')),
      undo: Folio.store.history ? null : null,
    };
  });
  check(saved.ls.length === 3 && new Set(saved.ls.map((l) => l.group)).size === 1 && saved.ls.every((l) => l.svg && l.w > 0), 'Save selection as logo → 3 SVG logos in one group', saved.ls);
  check(JSON.stringify(saved.labels) === '["On light","On dark","Mono"]' && saved.head === 'Crumb wordmark' && saved.dark, 'panel shows the group with version labels (on-dark on a dark tile)', saved);
  await page.locator('#brand-panel [data-sec="logos"]').screenshot({ path: path.join(OUT, 'panel-logos.png') });
  // place the on-dark version, then Make versions must keep its id (and the layer link)
  const remade = await page.evaluate(async () => {
    const ls = Folio.brand.active().logos.filter((l) => l.group);
    const dark = ls.find((l) => l.version === 'on-dark');
    Folio.brandPanel.insertLogo(dark.id);
    const placed = Folio.store.primary().id;
    // tamper so we can see the rebuild
    Folio.brand.update(Folio.brand.active().id, { logos: Folio.brand.active().logos.map((l) => (l.id === dark.id ? { ...l, src: Folio.svg.toDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>') } : l)) });
    document.querySelector('#brand-panel .bp-logo-group__make').click();
    const after = Folio.brand.active().logos.filter((l) => l.group);
    return { ids: ls.map((l) => l.id).sort(), after: after.map((l) => l.id).sort(), restored: after.find((l) => l.id === dark.id).src === dark.src, link: Folio.store.get(placed).image.src };
  });
  check(JSON.stringify(remade.ids) === JSON.stringify(remade.after) && remade.restored && remade.link.startsWith('brand-logo:'), 'Make versions rebuilds in place (same ids; placed layer stays linked)', remade);
  // an uploaded (ungrouped) SVG logo gets a Make versions button that groups it
  const upl = await page.evaluate(async (badge) => {
    const b = Folio.brand.active();
    const prepared = await Folio.brand.prepareLogo(new File([badge], 'badge.svg', { type: 'image/svg+xml' }));
    const l = Folio.brand.addLogoSrc(b.id, prepared);
    Folio.store.commit('add');
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)));
    const btn = document.querySelector(`#brand-panel .bp-logo[data-id="${l.id}"] .bp-logo__ver`);
    btn && btn.click();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)));
    const mine = Folio.brand.active().logos.find((x) => x.id === l.id);
    const group = Folio.brand.active().logos.filter((x) => x.group && x.group === mine.group);
    return { hadBtn: !!btn, versions: group.map((x) => x.version), base: mine.version, names: group.map((x) => x.name) };
  }, BADGE);
  check(upl.hadBtn && upl.base === 'on-light' && upl.versions.sort().join() === 'mono,on-dark,on-light', 'uploaded SVG → Make versions groups it with on-dark + mono', upl);
  await page.mouse.move(900, 600);
  await page.waitForTimeout(150);
  const tiles = await page.evaluate(() => [...document.querySelectorAll('#brand-panel .bp-logo-group .bp-logo')].map((e) => e.dataset.version + ':' + getComputedStyle(e.querySelector('.bp-logo__thumb')).backgroundColor));
  check(tiles.filter((t) => t.startsWith('on-dark:')).every((t) => t.endsWith('rgb(11, 11, 13)')), 'on-dark tiles sit on a dark ground', tiles);
  await page.locator('#brand-panel [data-sec="logos"]').screenshot({ path: path.join(OUT, 'panel-logos-2.png'), scale: 'device' });
  // undo removes the versions in one step
  const undo = await page.evaluate(() => {
    const n = Folio.brand.active().logos.length;
    Folio.store.undo();
    return [n, Folio.brand.active().logos.length];
  });
  check(undo[1] === undo[0] - 2, 'one undo step removes the two generated versions', undo);
  await page.evaluate(() => Folio.store.redo());

  // ---------------- persistence ----------------
  console.log('# persistence');
  const snap = await page.evaluate(async () => {
    if (Folio.store.saveNow) Folio.store.saveNow();
    await new Promise((r) => setTimeout(r, 1500));
    return Folio.brand.active().logos.map((l) => [l.id, l.version || '', l.group || ''].join('|')).sort();
  });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready') && window.Folio && Folio.brand && Folio.brand.active());
  const afterReload = await page.evaluate(() => Folio.brand.active().logos.map((l) => [l.id, l.version || '', l.group || ''].join('|')).sort());
  check(JSON.stringify(snap) === JSON.stringify(afterReload) && snap.some((s) => s.includes('on-dark')), 'logos (with version/group) persist after reload', [snap, afterReload]);
  const file = await page.evaluate(() => {
    const text = Folio.store.serialize();
    localStorage.removeItem('folio:brands:v1');
    Folio.store.newDoc && Folio.store.newDoc();
    Folio.exporter.loadText(text, 'x.folio.json');
    const doc = JSON.parse(text);
    return { inFile: (doc.brand || (doc.doc && doc.doc.brand) || {}).logos.filter((l) => l.group).length, after: Folio.brand.active() ? Folio.brand.active().logos.map((l) => [l.id, l.version || '', l.group || ''].join('|')).sort() : null };
  });
  check(file.inFile >= 6 && JSON.stringify(file.after) === JSON.stringify(snap), 'File → Save/Open round-trip keeps version/group', file);
  // real File → Save download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => Folio.exporter.saveFile())]);
  const saveText = fs.readFileSync(await dl.path(), 'utf8');
  check(/"version":"on-dark"/.test(saveText.replace(/\s/g, '')) && /"group":"g_/.test(saveText.replace(/\s/g, '')), 'downloaded .folio.json carries logo versions');

  // ---------------- PNG export still works ----------------
  const png = await page.evaluate(async () => (await Folio.exporter.pngDataUrl(Folio.store.doc.roots[0], { maxSize: 400 })).length);
  check(png > 1000, 'pngDataUrl still renders', png);

  check(!evil.length, 'no request ever reached evil.test', evil);
  check(!logs.filter((l) => !/favicon|404/.test(l)).length, 'no console errors', logs);
  await browser.close();

  // ---------------- embedFonts failure path ----------------
  console.log('# embedFonts offline');
  const off = await open({ noFonts: true });
  const res = await off.page.evaluate(async (w) => {
    const clean = Folio.svg.sanitize(w).svg;
    const warnings = [];
    const out = await Folio.svg.embedFonts(clean, warnings);
    return { same: out === clean, warnings };
  }, WORDMARK);
  check(res.same && res.warnings.length === 1 && /Fraunces/.test(res.warnings[0]), 'offline: svg returned unchanged with a warning', res);
  await off.browser.close();

  console.log(failures() ? `\n${failures()} FAILED` : '\nall passed');
  process.exit(failures() ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
