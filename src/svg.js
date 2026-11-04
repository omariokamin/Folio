/*
 * svg.js — safe SVG for logos (shared by the AI logo tools and the brand panel).
 *
 *   Folio.svg.sanitize(markup)        -> { svg, warnings }  (throws an Error with a plain message when unusable)
 *   Folio.svg.embedFonts(svg, warnings?) -> Promise<svg>    (@font-face with inlined font files, for <img> use)
 *   Folio.svg.recolor(svg, fn)        -> svg with every paint replaced by fn(colour)
 *   Folio.svg.versions(svg, brand?)   -> { 'on-light', 'on-dark', 'mono', 'metal' }
 *   Folio.svg.toDataUrl(svg) / size(svg) / decode(src)
 *   Folio.svg.fromNode(nodeId, warnings?) -> Promise<svg>   (a Folio layer drawn as real vectors)
 *
 * SVG is a script vector, so sanitize() rebuilds the document from a whitelist instead of
 * removing known-bad parts. Everything else here only handles svg that sanitize() produced.
 */
window.Folio = window.Folio || {};

(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const MAX_INPUT = 200 * 1024;
  const MAX_DEPTH = 64;

  const canon = (list) => new Map(list.map((n) => [n.toLowerCase(), n]));
  // filter primitives that only compute from the shape itself; never feImage (fetches) or anything with an href
  const FILTER_ELS = ['filter', 'feGaussianBlur', 'feOffset', 'feSpecularLighting', 'feDiffuseLighting', 'feDistantLight', 'fePointLight', 'feComposite', 'feMerge', 'feMergeNode', 'feColorMatrix', 'feTurbulence', 'feDisplacementMap', 'feFlood', 'feBlend'];
  const ELEMENTS = canon(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'use', 'title', 'desc', ...FILTER_ELS]);
  const TEXTY = new Set(['text', 'tspan', 'title', 'desc']);
  const SHAPES = 'path,rect,circle,ellipse,line,polyline,polygon,text,use';
  const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'clip-path', 'mask', 'filter', 'flood-color', 'flood-opacity', 'lighting-color', 'color-interpolation-filters'];
  // numeric filter attributes: [min, max, how many numbers]; clamped so a hostile value can't freeze rendering
  const NUM = { stdDeviation: [0, 100, 2], numOctaves: [0, 4, 1], baseFrequency: [0, 2, 2], seed: [0, 1e6, 1], surfaceScale: [-50, 50, 1], specularConstant: [0, 10, 1], specularExponent: [1, 128, 1], diffuseConstant: [0, 10, 1], azimuth: [-360, 360, 1], elevation: [-360, 360, 1], z: [-1e4, 1e4, 1], k1: [-10, 10, 1], k2: [-10, 10, 1], k3: [-10, 10, 1], k4: [-10, 10, 1], scale: [-200, 200, 1], values: [-100, 100, 20], 'flood-opacity': [0, 1, 1] };
  const INPUT = /^(SourceGraphic|SourceAlpha)$/;
  const ENUM = { operator: /^(over|in|out|atop|xor|arithmetic)$/, mode: /^(normal|multiply|screen|overlay|darken|lighten|color-dodge|color-burn|hard-light|soft-light|difference|exclusion|hue|saturation|color|luminosity)$/, type: /^(matrix|saturate|hueRotate|luminanceToAlpha|fractalNoise|turbulence)$/, stitchTiles: /^(stitch|noStitch)$/, xChannelSelector: /^[RGBA]$/, yChannelSelector: /^[RGBA]$/, filterUnits: /^(userSpaceOnUse|objectBoundingBox)$/, primitiveUnits: /^(userSpaceOnUse|objectBoundingBox)$/, 'color-interpolation-filters': /^(auto|sRGB|linearRGB)$/ };
  const ATTRS = canon([...STYLE_PROPS, ...Object.keys(NUM), ...Object.keys(ENUM), 'in', 'in2', 'result', 'transform', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'dx', 'dy', 'width', 'height', 'points', 'offset', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'preserveAspectRatio', 'id', 'viewBox', 'href']);
  const MAX_FILTER_PRIMITIVES = 64;
  const MAX_FILTERED = 16; // elements drawn through a filter (each <use> of a filtered shape counts again)
  /** A filter region or light position (x/y/width/height on filter elements): a clamped number or percentage. */
  function region(v) {
    const m = /^\s*(-?[\d.]+(?:e[-+]?\d+)?)(%?)\s*$/i.exec(v);
    if (!m || !isFinite(+m[1])) return null;
    const lim = m[2] ? 200 : 1e4;
    return Math.min(lim, Math.max(-lim, +m[1])) + m[2];
  }
  const PAINTS = ['fill', 'stroke', 'stop-color'];
  const URL_REF = /^url\(\s*(['"]?)#[A-Za-z_][\w.:-]*\1\s*\)$/i;
  const ID_RE = /^[A-Za-z_][\w.:-]{0,63}$/;
  // CSS functions that can fetch something; only url(#id) survives, and only where a reference belongs
  const FETCHY = /(url|image|image-set|cross-fade|element|src|expression)\s*\(|javascript:|[<>\\]/i;
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|inherit|initial)$/i;
  const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana'];

  // ---------- colours ----------
  let ctx2d = null;
  /** Any CSS colour → [r, g, b, a] (0–255, a 0–1), or null. */
  function rgba(c) {
    if (typeof c !== 'string' || !c.trim() || /currentcolor|var\(/i.test(c) || !CSS.supports('color', c)) return null;
    ctx2d = ctx2d || document.createElement('canvas').getContext('2d');
    ctx2d.fillStyle = '#000';
    ctx2d.fillStyle = c.trim();
    const v = ctx2d.fillStyle;
    if (v[0] === '#') return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(1);
    const m = v.match(/[\d.]+/g);
    return m ? [+m[0], +m[1], +m[2], m[3] != null ? +m[3] : 1] : null;
  }
  const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  /** Perceptual lightness (CIE L*, 0–1) — "dark" means it looks dark, so brand accents aren't mistaken for it. */
  function lightness(c) {
    const v = rgba(c);
    if (!v) return null;
    const lin = v.slice(0, 3).map((x) => ((x /= 255) <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    return (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y) / 100;
  }

  // ---------- sanitize ----------
  function cleanPaint(v) {
    v = v.trim();
    if (/^(none|currentColor|transparent)$/i.test(v) || URL_REF.test(v)) return v;
    const fb = /^(url\(\s*(['"]?)#[A-Za-z_][\w.:-]*\2\s*\))\s+(.+)$/i.exec(v); // url(#id) with a fallback colour
    if (fb) return cleanPaint(fb[3]) && !/^url/i.test(fb[3]) ? `${fb[1]} ${cleanPaint(fb[3])}` : null;
    if (/^var\(/i.test(v)) v = (Folio.brand && Folio.brand.resolveColor && Folio.brand.resolveColor(v)) || '';
    if (!v || FETCHY.test(v) || /var\(|[;{}]/i.test(v)) return null;
    return CSS.supports('color', v) ? v : null;
  }

  /** A whitelisted attribute's value, cleaned; null drops it. */
  function cleanValue(name, v) {
    v = String(v);
    if (PAINTS.includes(name)) return cleanPaint(v);
    if (name === 'href') return /^\s*#[A-Za-z_][\w.:-]*\s*$/.test(v) ? v.trim() : null;
    if (name === 'clip-path' || name === 'mask' || name === 'filter') return URL_REF.test(v.trim()) || v.trim() === 'none' ? v.trim() : null;
    if (name === 'id' || name === 'result') return ID_RE.test(v) ? v : null;
    if (name === 'in' || name === 'in2') return INPUT.test(v.trim()) || (ID_RE.test(v.trim()) && !/^(Background(Image|Alpha)|FillPaint|StrokePaint)$/.test(v.trim())) ? v.trim() : null;
    if (name === 'flood-color' || name === 'lighting-color') return /^url/i.test(v.trim()) ? null : cleanPaint(v);
    if (ENUM[name]) return ENUM[name].test(v.trim()) ? v.trim() : null;
    if (NUM[name]) {
      const [lo, hi, count] = NUM[name];
      const n = v.trim().split(/[\s,]+/).map(Number);
      if (!n.length || n.length > count || !n.every(isFinite)) return null;
      return n.map((x) => Math.min(hi, Math.max(lo, name === 'numOctaves' ? Math.round(x) : x))).join(' ');
    }
    if (name === 'font-family' && /var\(/i.test(v) && Folio.brand && Folio.fonts) v = Folio.fonts.stack(Folio.brand.resolveFont(v.trim()));
    return FETCHY.test(v) || /var\(/i.test(v) ? null : v;
  }

  /** True when css is nothing but @font-face rules whose files are inlined fonts (what embedFonts writes). */
  function fontFaceOnly(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = css.match(/@font-face\s*\{[^{}]*\}/g);
    if (!blocks || css.replace(/@font-face\s*\{[^{}]*\}/g, '').trim()) return false;
    const DATA = /^url\(\s*(['"]?)data:(font\/[\w.+-]+|application\/(font-woff2?|x-font-[\w-]+|octet-stream));base64,[A-Za-z0-9+/=]+\1\s*\)(\s*format\(\s*(['"]?)[\w-]+\5\s*\))?$/i;
    return blocks.every((b) =>
      b
        .slice(b.indexOf('{') + 1, -1)
        .replace(/;base64,/g, '\u0000')
        .split(';')
        .every((decl) => {
          decl = decl.replace(/\u0000/g, ';base64,').trim();
          if (!decl) return true;
          const i = decl.indexOf(':');
          const prop = decl.slice(0, i).trim().toLowerCase();
          const val = decl.slice(i + 1).trim();
          if (prop === 'src') return val.split(/,(?=\s*url\()/).every((s) => DATA.test(s.trim()));
          if (prop === 'font-family') return /^(['"])[^'"\\<>;{}()]{1,80}\1$|^[\w -]{1,80}$/.test(val);
          return ['font-style', 'font-weight', 'font-display', 'font-stretch', 'unicode-range'].includes(prop) && /^[\w\s,+?%.-]{1,2000}$/.test(val);
        })
    );
  }

  const nums = (v) => String(v || '').trim().split(/[\s,]+/).map(Number);
  const plen = (v) => (/^\s*[\d.]+\s*(px)?\s*$/.test(v || '') ? parseFloat(v) : NaN);

  function sanitize(markup) {
    if (typeof markup !== 'string' || !markup.trim()) throw new Error('No SVG markup was given.');
    if (markup.length > MAX_INPUT) throw new Error(`That SVG is too large (${Math.round(markup.length / 1024)} KB; the limit is 200 KB). Simplify the shapes.`);
    const warnings = [];
    let text = markup.trim();
    if (/<!ENTITY/i.test(text)) throw new Error('SVGs with <!ENTITY> declarations are not accepted.');
    if (/<!DOCTYPE/i.test(text)) {
      text = text.replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?\s*>/gi, '');
      if (/<!DOCTYPE/i.test(text)) throw new Error('That SVG has a DOCTYPE Folio cannot read.');
    }
    // hand-written SVG often forgets to declare the namespaces; the XML parser would refuse it
    if (/\bxlink:/.test(text) && !/xmlns:xlink\s*=/.test(text)) text = text.replace(/<svg\b/i, `<svg xmlns:xlink="${XLINK}"`);
    const src = new DOMParser().parseFromString(text, 'image/svg+xml');
    const err = src.querySelector('parsererror');
    if (err) throw new Error('That SVG could not be read: ' + ((err.textContent || '').match(/(line \d+ at column \d+: .*?)(?=Below is|\n|$)/) || ['', 'it is not well-formed XML'])[1].slice(0, 160));
    const inRoot = src.documentElement;
    if (!inRoot || inRoot.localName !== 'svg' || (inRoot.namespaceURI && inRoot.namespaceURI !== NS)) throw new Error('The markup must start with an <svg> element.');

    const out = document.implementation.createDocument(NS, 'svg', null);
    const root = out.documentElement;
    const dropped = new Set();
    const droppedAttrs = new Set();

    function copyAttrs(from, to) {
      const styled = {};
      for (const a of Array.from(from.attributes)) {
        if (a.namespaceURI === 'http://www.w3.org/2000/xmlns/' || a.name === 'xmlns') continue;
        let name = a.namespaceURI === XLINK && a.localName === 'href' ? 'href' : a.namespaceURI ? null : ATTRS.get(a.name.toLowerCase());
        if (a.name.toLowerCase() === 'style') {
          a.value.replace(/\/\*[\s\S]*?\*\//g, '').split(';').forEach((d) => {
            const i = d.indexOf(':');
            const prop = d.slice(0, i).trim().toLowerCase();
            if (i > 0 && STYLE_PROPS.includes(prop)) styled[prop] = d.slice(i + 1).replace(/!important/i, '').trim();
            else if (d.trim()) droppedAttrs.add('style:' + (prop || d.trim()).slice(0, 30));
          });
          continue;
        }
        if (!name || (name === 'href' && !/^(use|linearGradient|radialGradient)$/.test(to.localName))) {
          droppedAttrs.add(a.name);
          continue;
        }
        const v = FILTER_ELS.includes(to.localName) && /^(x|y|width|height)$/.test(name) ? region(a.value) : cleanValue(name, a.value);
        if (v == null) droppedAttrs.add(`${a.name}="${a.value.slice(0, 40)}"`);
        else to.setAttribute(name, v);
      }
      // style beats presentation attributes in CSS, so it is applied last
      Object.keys(styled).forEach((k) => {
        const v = cleanValue(k, styled[k]);
        if (v == null) droppedAttrs.add(`style:${k}`);
        else to.setAttribute(k, v);
      });
    }

    function copyKids(from, to, depth) {
      for (const c of Array.from(from.childNodes)) {
        if (c.nodeType === 3 || c.nodeType === 4) {
          if (TEXTY.has(to.localName)) to.appendChild(out.createTextNode(c.data));
          continue;
        }
        if (c.nodeType !== 1) continue; // comments, processing instructions
        const local = c.namespaceURI && c.namespaceURI !== NS ? null : c.localName;
        if (local === 'a') {
          copyKids(c, to, depth + 1); // keep a link's shapes, never the link
          dropped.add('a');
          continue;
        }
        if (local === 'style' && fontFaceOnly(c.textContent || '')) {
          to.appendChild(out.createElementNS(NS, 'style')).textContent = c.textContent;
          continue;
        }
        const name = local && ELEMENTS.get(local.toLowerCase());
        if (!name || depth > MAX_DEPTH) {
          dropped.add(depth > MAX_DEPTH ? 'deeply nested elements' : c.localName);
          continue;
        }
        const el = out.createElementNS(NS, name);
        copyAttrs(c, el);
        to.appendChild(el);
        copyKids(c, el, depth + 1);
      }
    }

    copyAttrs(inRoot, root);
    copyKids(inRoot, root, 1);

    // <use> may point only at an element in this file that has no <use> inside (no exponential fan-out)
    root.querySelectorAll('use').forEach((u) => {
      const id = (u.getAttribute('href') || '').slice(1);
      const t = id && Array.from(root.querySelectorAll('[id]')).find((e) => e.getAttribute('id') === id);
      if (!t || t.localName === 'use' || t.querySelector('use') || t.contains(u)) {
        u.remove();
        dropped.add('use (missing or nested target)');
      }
    });

    // filters: a bounded number of primitives, and filter= only where it names a <filter> in this file
    const prims = root.querySelectorAll(FILTER_ELS.slice(1).join(','));
    if (prims.length > MAX_FILTER_PRIMITIVES) {
      root.querySelectorAll('filter').forEach((f) => f.remove());
      dropped.add(`filters (more than ${MAX_FILTER_PRIMITIVES} steps)`);
    }
    const filterIds = new Set(Array.from(root.querySelectorAll('filter[id]')).map((f) => f.getAttribute('id')));
    root.querySelectorAll('[filter]').forEach((e) => {
      const m = /#([^'")\s]+)/.exec(e.getAttribute('filter'));
      if (m && !filterIds.has(m[1])) {
        e.removeAttribute('filter');
        dropped.add('filter (missing target)');
      }
    });
    // every filtered element is an offscreen render pass; thousands of them freeze the page
    const passes = (e) => (e && e.hasAttribute('filter') ? 1 : 0) + (e ? e.querySelectorAll('[filter]').length : 0);
    const byId = new Map(Array.from(root.querySelectorAll('[id]')).map((t) => [t.getAttribute('id'), t]));
    const uses = Array.from(root.querySelectorAll('use')).map((u) => passes(byId.get(u.getAttribute('href').slice(1))));
    if (root.querySelectorAll('[filter]').length + uses.reduce((a, b) => a + b, 0) > MAX_FILTERED) {
      root.querySelectorAll('[filter]').forEach((e) => e.removeAttribute('filter'));
      dropped.add(`filters (used on more than ${MAX_FILTERED} shapes)`);
    }

    // a viewBox is required; derive it from width/height when missing
    let vb = nums(root.getAttribute('viewBox'));
    if (!(vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0)) {
      const w = plen(root.getAttribute('width'));
      const hgt = plen(root.getAttribute('height'));
      if (!(w > 0 && hgt > 0)) throw new Error('The SVG needs a viewBox (or a numeric width and height).');
      vb = [0, 0, w, hgt];
      root.setAttribute('viewBox', vb.join(' '));
      warnings.push('Added viewBox="' + vb.join(' ') + '" from width/height.');
    }
    // a definite size so it never renders at the 300×150 default inside <img>
    if (!(plen(root.getAttribute('width')) > 0 && plen(root.getAttribute('height')) > 0)) {
      root.setAttribute('width', vb[2]);
      root.setAttribute('height', vb[3]);
    }
    if (!root.querySelector(SHAPES)) throw new Error('Nothing drawable is left in that SVG after removing unsupported parts' + (dropped.size ? ` (${[...dropped].slice(0, 6).join(', ')})` : '') + '.');

    if (dropped.size) warnings.push('Removed unsupported elements: ' + [...dropped].slice(0, 12).join(', ') + '.');
    if (droppedAttrs.size) warnings.push('Removed unsafe or unsupported attributes: ' + [...droppedAttrs].slice(0, 12).join(', ') + '.');
    return { svg: new XMLSerializer().serializeToString(root), warnings };
  }

  // ---------- helpers for internal (already sanitized) svg ----------
  function parse(svg) {
    const doc = new DOMParser().parseFromString(String(svg), 'image/svg+xml');
    if (doc.querySelector('parsererror') || !doc.documentElement || doc.documentElement.localName !== 'svg') throw new Error('Not a valid SVG.');
    return doc.documentElement;
  }
  const serialize = (root) => new XMLSerializer().serializeToString(root);

  const toDataUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  /** SVG text inside a data: URL (base64 or percent-encoded), or null when src isn't one. */
  function decode(src) {
    const m = /^data:image\/svg\+xml((?:;[\w=.-]+)*?)(;base64)?,(.*)$/is.exec(String(src || ''));
    if (!m) return null;
    try {
      return m[2] ? new TextDecoder().decode(Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0))) : decodeURIComponent(m[3]);
    } catch (e) {
      return m[2] ? null : m[3]; // a raw (unencoded) data URL with a stray %
    }
  }

  function size(svg) {
    try {
      const root = parse(svg);
      const vb = nums(root.getAttribute('viewBox'));
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
      return { width: plen(root.getAttribute('width')) || 0, height: plen(root.getAttribute('height')) || 0 };
    } catch (e) {
      return { width: 0, height: 0 };
    }
  }

  // ---------- fonts ----------
  const firstFamily = (v) => String(v || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');

  /** Inline @font-face (font files as data URLs, cut to the characters used) so text renders anywhere. */
  async function embedFonts(svg, warnings) {
    const warn = (msg, err) => {
      console.warn('[Folio] ' + msg, err || '');
      if (Array.isArray(warnings)) warnings.push(msg);
    };
    const root = parse(svg);
    const text = Array.from(root.querySelectorAll('text')).map((t) => t.textContent).join('');
    const fams = new Set();
    root.querySelectorAll('[font-family]').forEach((e) => {
      const f = firstFamily(e.getAttribute('font-family'));
      if (f && !GENERIC.test(f) && !SYSTEM_FONTS.includes(f)) fams.add(f);
    });
    if (!fams.size || !text.trim()) return svg;
    const ex = Folio.exporter;
    if (!ex || !ex.fontFaceCss) {
      warn('Fonts were not embedded (the exporter is not loaded).');
      return svg;
    }
    const css = (
      await Promise.all(
        [...fams].map((f) =>
          ex.fontFaceCss([f], text, { exact: true }).catch((e) => {
            warn(`Could not embed the font “${f}” (offline, or not a Google Font) — the logo will use a fallback font outside Folio.`, e);
            return '';
          })
        )
      )
    ).join('\n');
    if (!css.trim()) return svg;
    root.querySelectorAll('style').forEach((s) => s.remove()); // replace earlier embeds
    let defs = Array.from(root.children).find((c) => c.localName === 'defs');
    if (!defs) defs = root.insertBefore(root.ownerDocument.createElementNS(NS, 'defs'), root.firstChild);
    defs.insertBefore(root.ownerDocument.createElementNS(NS, 'style'), defs.firstChild).textContent = css;
    return serialize(root);
  }

  // ---------- colour versions ----------
  function recolor(svg, fn) {
    const root = parse(svg);
    const map = (v) => {
      const t = String(v).trim();
      if (!t || /^(none|transparent|inherit)$/i.test(t) || /^url\(/i.test(t)) return v;
      const r = fn(/^currentcolor$/i.test(t) ? '#000000' : t);
      return r == null ? v : r;
    };
    [root, ...root.querySelectorAll('*')].forEach((el) => {
      if (el.closest('mask')) return; // mask paints are luminance, not colour
      PAINTS.forEach((p) => el.hasAttribute(p) && el.setAttribute(p, map(el.getAttribute(p))));
    });
    // unpainted shapes inherit the default black fill; stops default to black too
    if (!root.hasAttribute('fill')) {
      root.setAttribute('fill', map('#000000'));
      root.querySelectorAll('mask:not([fill])').forEach((m) => m.setAttribute('fill', '#000000'));
    }
    root.querySelectorAll('stop:not([stop-color])').forEach((s) => !s.closest('mask') && s.setAttribute('stop-color', map('#000000')));
    return serialize(root);
  }

  const CHROME = [[0, '#fdfdfd'], [0.3, '#b9bec6'], [0.5, '#f4f5f7'], [0.72, '#5e646e'], [1, '#d9dce1']];

  /** Polished metal: every paint → one chrome gradient, under a specular sheen and a dark rim that holds the edge on white. */
  function metal(svg) {
    const root = parse(svg);
    const doc = root.ownerDocument;
    const mk = (tag, attrs, parent) => {
      const el = parent.appendChild(doc.createElementNS(NS, tag));
      Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
      return el;
    };
    const uid = (base) => {
      let id = base;
      while (root.querySelector(`[id="${id}"]`)) id += '_';
      return id;
    };
    const [gid, fid] = [uid('metal-chrome'), uid('metal-shine')];
    const paints = [];
    [root, ...root.querySelectorAll('*')].forEach((el) => !el.closest('mask') && ['fill', 'stroke'].forEach((p) => el.hasAttribute(p) && paints.push([el, p])));
    const light = (v) => (lightness(v) || 0) > 0.9;
    const solid = paints.filter(([el, p]) => !/^(none|transparent)$/i.test(el.getAttribute(p).trim()));
    // near-white knockouts (text on a badge) become dark steel when there is metal around them, so they stay readable
    const knockout = solid.some(([el, p]) => light(el.getAttribute(p))) && (!root.hasAttribute('fill') || solid.some(([el, p]) => !light(el.getAttribute(p))));
    // the fallback colour paints shapes with a zero-size box (a straight line), where a bounding-box gradient draws nothing
    const chrome = `url(#${gid}) #c3c7cd`;
    solid.forEach(([el, p]) => el.setAttribute(p, knockout && light(el.getAttribute(p)) ? '#2b2f36' : chrome));
    if (!root.hasAttribute('fill')) root.setAttribute('fill', chrome);

    const vb = nums(root.getAttribute('viewBox'));
    const s = r2(Math.max(0.3, Math.min(vb[2], vb[3]) * 0.02)); // bevel width follows the mark's size
    let defs = Array.from(root.children).find((c) => c.localName === 'defs');
    if (!defs) defs = root.insertBefore(doc.createElementNS(NS, 'defs'), root.firstChild);
    const grad = mk('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0.16, y2: 1 }, defs);
    CHROME.forEach(([o, c]) => mk('stop', { offset: o, 'stop-color': c }, grad));
    const f = mk('filter', { id: fid, x: '-5%', y: '-5%', width: '110%', height: '115%', 'color-interpolation-filters': 'sRGB' }, defs);
    mk('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: s, result: 'blur' }, f);
    const spec = mk('feSpecularLighting', { in: 'blur', surfaceScale: 3, specularConstant: 0.9, specularExponent: 22, 'lighting-color': '#ffffff', result: 'spec' }, f);
    mk('feDistantLight', { azimuth: 235, elevation: 48 }, spec);
    mk('feComposite', { in: 'spec', in2: 'SourceAlpha', operator: 'in', result: 'shine' }, f);
    mk('feComposite', { in: 'SourceAlpha', in2: 'blur', operator: 'arithmetic', k2: 1, k3: -1, result: 'edge' }, f);
    mk('feFlood', { 'flood-color': '#1b1e24', 'flood-opacity': 0.85 }, f);
    mk('feComposite', { in2: 'edge', operator: 'in', result: 'rim' }, f);
    // a soft contact shadow: invisible on dark grounds, it keeps the bright chrome from dissolving into white
    mk('feOffset', { in: 'blur', dy: r2(s * 0.6), result: 'drop' }, f);
    mk('feFlood', { 'flood-color': '#0b0d12', 'flood-opacity': 0.4 }, f);
    mk('feComposite', { in2: 'drop', operator: 'in', result: 'shadow' }, f);
    const merge = mk('feMerge', {}, f);
    ['shadow', 'SourceGraphic', 'rim', 'shine'].forEach((i) => mk('feMergeNode', { in: i }, merge));
    const g = doc.createElementNS(NS, 'g');
    g.setAttribute('filter', `url(#${fid})`);
    Array.from(root.childNodes).forEach((c) => !/^(defs|title|desc|style)$/.test(c.localName) && g.appendChild(c));
    root.appendChild(g);
    return serialize(root);
  }

  function versions(svg, brand) {
    if (brand === undefined) brand = Folio.brand && Folio.brand.active ? Folio.brand.active() : null;
    const col = (id) => {
      const c = brand && (brand.colors || []).find((x) => x.id === id);
      return c ? c.value : null;
    };
    const DARK = 0.35;
    const LIGHT = 0.9;
    const bg = col('background');
    const paper = bg && lightness(bg) > LIGHT ? bg : '#ffffff';
    const txt = col('text');
    const ink = txt && lightness(txt) < DARK ? txt : '#111111';
    let darkest = null;
    (String(svg).match(/(?:fill|stroke|stop-color)="[^"]+"/g) || []).forEach((a) => {
      const c = a.slice(a.indexOf('"') + 1, -1);
      const l = lightness(c);
      if (l != null && (!darkest || l < darkest.l)) darkest = { c, l };
    });
    const knockout = darkest && darkest.l < DARK ? darkest.c : null; // nothing dark turns light → light paints stay
    return {
      'on-light': svg,
      // dark paints turn light; near-white knockouts (text on a dark badge) take the dark colour so they stay readable
      'on-dark': recolor(svg, (c) => {
        const l = lightness(c);
        return l == null ? c : l < DARK ? paper : l > LIGHT && knockout ? knockout : c;
      }),
      // one ink; near-white knockouts stay paper-white
      mono: recolor(svg, (c) => {
        const l = lightness(c);
        return l != null && l > LIGHT ? '#ffffff' : ink;
      }),
      metal: metal(svg),
    };
  }

  // ---------- a Folio layer as vectors ----------
  const r2 = (v) => Math.round(v * 100) / 100;

  /** A colour for an SVG attribute: [#rrggbb, alpha] (brand tokens resolved). */
  function paint(c) {
    const lit = Folio.brand && Folio.brand.resolveColor ? Folio.brand.resolveColor(c) : c;
    const v = rgba(lit);
    return v ? [hex(v), r2(v[3])] : null;
  }

  async function fromNode(id, warnings) {
    const warn = (m) => Array.isArray(warnings) && !warnings.includes(m) && warnings.push(m);
    const store = Folio.store;
    const n = store && store.get(id);
    if (!n) throw new Error('No layer with id ' + id);
    const resolveSrc = (s) => (Folio.brand && Folio.brand.resolveSrc ? Folio.brand.resolveSrc(s) : s) || '';
    const svgOfImage = async (node) => {
      const src = resolveSrc(node.image && node.image.src);
      const own = decode(src);
      if (own || !/^https?:/i.test(src)) return own;
      try {
        const res = await fetch(src);
        const t = res.ok ? await res.text() : '';
        return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(t) ? t : null;
      } catch (e) {
        return null;
      }
    };
    if (n.type === 'image') {
      const own = await svgOfImage(n);
      if (own) return own;
    }

    if (Folio.render && Folio.render.sync) Folio.render.sync();
    const rootEl = Folio.render && Folio.render.el && Folio.render.el(id);
    if (!rootEl || !rootEl.isConnected || !rootEl.offsetWidth) throw new Error('That layer is not on the canvas (is it hidden?).');
    const box = rootEl.getBoundingClientRect();
    const scale = box.width / rootEl.offsetWidth || 1;
    const W = rootEl.offsetWidth;
    const H = rootEl.offsetHeight;
    const doc = document.implementation.createDocument(NS, 'svg', null);
    const root = doc.documentElement;
    const defs = doc.createElementNS(NS, 'defs');
    const mk = (tag, attrs, parent) => {
      const el = doc.createElementNS(NS, tag);
      Object.keys(attrs).forEach((k) => attrs[k] != null && el.setAttribute(k, attrs[k]));
      if (parent) parent.appendChild(el);
      return el;
    };
    let uid = 0;
    const setPaint = (el, attr, c) => {
      const p = paint(c);
      if (!p) return false;
      el.setAttribute(attr, p[0]);
      if (p[1] < 1) el.setAttribute(attr + '-opacity', p[1]);
      return true;
    };

    /** rect (uniform corners) or path (mixed corners) for a box with CSS-clamped radii. */
    function shape(x, y, w, h, radii, parent) {
      const sum = Math.max(radii[0] + radii[1], radii[3] + radii[2], 1e-9);
      const sumV = Math.max(radii[0] + radii[3], radii[1] + radii[2], 1e-9);
      const f = Math.min(1, w / sum, h / sumV);
      const [tl, tr, br, bl] = radii.map((r) => r2(Math.max(0, r * f)));
      if (tl === tr && tr === br && br === bl) return mk('rect', { x: r2(x), y: r2(y), width: r2(w), height: r2(h), rx: tl || null }, parent);
      const d = `M${r2(x + tl)} ${r2(y)}H${r2(x + w - tr)}A${tr} ${tr} 0 0 1 ${r2(x + w)} ${r2(y + tr)}V${r2(y + h - br)}A${br} ${br} 0 0 1 ${r2(x + w - br)} ${r2(y + h)}H${r2(x + bl)}A${bl} ${bl} 0 0 1 ${r2(x)} ${r2(y + h - bl)}V${r2(y + tl)}A${tl} ${tl} 0 0 1 ${r2(x + tl)} ${r2(y)}Z`;
      return mk('path', { d }, parent);
    }

    function stops(grad, list) {
      (list || []).slice().sort((a, b) => a.pos - b.pos).forEach((s) => {
        const st = mk('stop', { offset: r2((s.pos || 0) / 100) }, grad);
        setPaint(st, 'stop-color', s.color);
      });
    }

    function frame(node, el, x, y, w, h, g) {
      const cs = getComputedStyle(el);
      const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => parseFloat(cs['border' + k + 'Radius']) || 0);
      ((node.style && node.style.fills) || []).filter((f) => f && f.visible !== false).forEach((f) => {
        if (f.type === 'solid') return setPaint(shape(x, y, w, h, radii, g), 'fill', f.color);
        if (f.type === 'linear') {
          const a = ((f.angle == null ? 180 : f.angle) * Math.PI) / 180;
          const [dx, dy] = [Math.sin(a), -Math.cos(a)];
          const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2; // CSS gradient line length
          const [cx, cy] = [x + w / 2, y + h / 2];
          const grad = mk('linearGradient', { id: 'g' + ++uid, gradientUnits: 'userSpaceOnUse', x1: r2(cx - dx * half), y1: r2(cy - dy * half), x2: r2(cx + dx * half), y2: r2(cy + dy * half) }, defs);
          stops(grad, f.stops);
          return shape(x, y, w, h, radii, g).setAttribute('fill', `url(#g${uid})`);
        }
        if (f.type === 'radial') {
          const [cx, cy] = [x + (w * (f.cx == null ? 50 : f.cx)) / 100, y + (h * (f.cy == null ? 50 : f.cy)) / 100];
          const r = Math.max(...[[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => Math.hypot(px - cx, py - cy))); // farthest-corner
          const grad = mk('radialGradient', { id: 'g' + ++uid, gradientUnits: 'userSpaceOnUse', cx: r2(cx), cy: r2(cy), r: r2(r) }, defs);
          stops(grad, f.stops);
          return shape(x, y, w, h, radii, g).setAttribute('fill', `url(#g${uid})`);
        }
        warn(`“${node.name}”: ${f.type} fills can't be drawn as vectors and were left out.`);
      });
      const bw = parseFloat(cs.borderTopWidth) || 0;
      if (bw > 0 && cs.borderTopStyle !== 'none') {
        const s = shape(x + bw / 2, y + bw / 2, w - bw, h - bw, radii.map((r) => Math.max(0, r - bw / 2)), g);
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke-width', r2(bw));
        setPaint(s, 'stroke', cs.borderTopColor);
        if (cs.borderTopStyle === 'dashed') s.setAttribute('stroke-dasharray', `${r2(bw * 3)} ${r2(bw * 2)}`);
        if (cs.borderTopStyle === 'dotted') s.setAttribute('stroke-dasharray', `${r2(bw)} ${r2(bw)}`);
      }
      let kids = g;
      if (cs.overflow === 'hidden' || cs.overflowX === 'clip') {
        const clip = mk('clipPath', { id: 'c' + ++uid }, defs);
        shape(x, y, w, h, radii, clip);
        kids = mk('g', { 'clip-path': `url(#c${uid})` }, g);
      }
      return kids;
    }

    function text(node, el, g) {
      const tn = el.firstChild;
      if (!tn || tn.nodeType !== 3 || !tn.data.trim()) return;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize) || 16;
      ctx2d = ctx2d || document.createElement('canvas').getContext('2d');
      ctx2d.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      const m = ctx2d.measureText('Hg');
      const ascent = m.fontBoundingBoxAscent || size * 0.8;
      // one <text> per rendered line, found by measuring where each character landed
      const range = document.createRange();
      const lines = [];
      for (let i = 0; i < tn.data.length; ) {
        const len = tn.data.codePointAt(i) > 0xffff ? 2 : 1;
        range.setStart(tn, i);
        range.setEnd(tn, i + len);
        const rr = range.getClientRects()[0];
        const ch = tn.data.slice(i, i + len);
        i += len;
        if (!rr || ch === '\n') continue;
        const last = lines[lines.length - 1];
        const fresh = !last || Math.abs(rr.top - last.top) > 2 * scale;
        if (fresh && /\s/.test(ch)) continue; // spaces at a line start collapse; start the line at the first glyph
        if (fresh) lines.push({ top: rr.top, left: rr.left, s: ch });
        else last.s += ch;
      }
      const tt = cs.textTransform;
      const tf = (s) => (tt === 'uppercase' ? s.toUpperCase() : tt === 'lowercase' ? s.toLowerCase() : tt === 'capitalize' ? s.replace(/(^|\s)(\S)/g, (a, b, c) => b + c.toUpperCase()) : s);
      const t = mk('text', {
        'font-family': cs.fontFamily,
        'font-size': r2(size),
        'font-weight': cs.fontWeight,
        'font-style': cs.fontStyle === 'italic' ? 'italic' : null,
        'letter-spacing': cs.letterSpacing !== 'normal' ? r2(parseFloat(cs.letterSpacing)) : null,
      }, g);
      if (!setPaint(t, 'fill', cs.color)) t.setAttribute('fill', '#000000');
      lines.forEach((ln) => {
        mk('tspan', { x: r2((ln.left - box.left) / scale), y: r2((ln.top - box.top) / scale + ascent) }, t).textContent = tf(ln.s.replace(/\s+$/, ''));
      });
    }

    async function walk(nid, parent) {
      const node = store.get(nid);
      const el = Folio.render.el(nid);
      if (!node || node.visible === false || !el || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      const [x, y, w, h] = [(r.left - box.left) / scale, (r.top - box.top) / scale, el.offsetWidth, el.offsetHeight];
      if (node.style && node.style.rotation) warn(`“${node.name}”: rotation was left out.`);
      const op = Number(getComputedStyle(el).opacity);
      const g = op < 1 ? mk('g', { opacity: r2(op) }, parent) : parent;
      if (node.type === 'frame') {
        const kids = frame(node, el, x, y, w, h, g);
        for (const c of node.children || []) await walk(c, kids);
      } else if (node.type === 'text') text(node, el, g);
      else if (node.type === 'image') {
        const own = await svgOfImage(node);
        let inner = null;
        try {
          inner = own && parse(sanitize(own).svg);
        } catch (e) {}
        if (!inner) return warn(`“${node.name}”: only SVG images can become vectors; that image was left out.`);
        const fit = (node.image && node.image.fit) || 'cover';
        const g2 = mk('svg', { x: r2(x), y: r2(y), width: r2(w), height: r2(h), viewBox: inner.getAttribute('viewBox'), preserveAspectRatio: fit === 'fill' ? 'none' : fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice' }, g);
        Array.from(inner.childNodes).forEach((c) => g2.appendChild(doc.importNode(c, true)));
      }
    }

    root.setAttribute('viewBox', `0 0 ${W} ${H}`);
    root.setAttribute('width', W);
    root.setAttribute('height', H);
    root.appendChild(defs);
    await walk(id, root);
    if (!defs.firstChild) defs.remove();
    if (!root.querySelector(SHAPES)) throw new Error('That layer has nothing that can be drawn as a vector logo (raster images and effects are left out).');
    return embedFonts(serialize(root), warnings);
  }

  Folio.svg = { sanitize, embedFonts, recolor, versions, toDataUrl, size, decode, fromNode, lightness };
})();
