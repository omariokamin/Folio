/*
 * css.js — turns a Folio node into real CSS.
 *
 * This is the heart of the "design = code" idea: the canvas renders every layer
 * with exactly these CSS properties, and the code exporter prints the very same
 * properties. What you see on the canvas IS the code.
 *
 *   Folio.css.nodeStyles(node, { mode: 'canvas' | 'export' })  -> { 'css-prop': 'value', ... }
 *   Folio.css.toCssText(obj)                                     -> "prop: value; prop: value;"
 *   Folio.css.toCssBlock(obj, indent)                            -> multi-line CSS declarations
 */
window.Folio = window.Folio || {};

(function () {
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const px = (v) => r2(v) + 'px';

  function stopsCss(stops) {
    return (stops || [])
      .slice()
      .sort((a, b) => a.pos - b.pos)
      .map((s) => `${s.color} ${r2(s.pos)}%`)
      .join(', ');
  }

  function noiseUrl(opacity = 0.15) {
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>` +
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/>` +
      `<feColorMatrix type='saturate' values='0'/></filter>` +
      `<rect width='100%' height='100%' filter='url(#n)' opacity='${opacity}'/></svg>`;
    // Encode ( ) ' too, so tools like html-to-image don't mistake the inner url(#n) for a file.
    const enc = encodeURIComponent(svg).replace(/[()']/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    return `url("data:image/svg+xml;utf8,${enc}")`;
  }

  /**
   * Fills -> CSS background layers.
   * In Folio the LAST fill in the array is drawn on top (like the layers list).
   * In CSS the FIRST background layer is on top, so we reverse.
   */
  function fillsToCss(fills) {
    const vis = (fills || []).filter((f) => f && f.visible !== false);
    if (!vis.length) return {};
    if (vis.length === 1 && vis[0].type === 'solid') return { 'background-color': vis[0].color };

    const images = [];
    const sizes = [];
    const positions = [];
    const repeats = [];
    const push = (img, size = '100% 100%', pos = 'center', rep = 'no-repeat') => {
      images.push(img);
      sizes.push(size);
      positions.push(pos);
      repeats.push(rep);
    };

    vis
      .slice()
      .reverse()
      .forEach((f) => {
        switch (f.type) {
          case 'solid':
            push(`linear-gradient(${f.color}, ${f.color})`);
            break;
          case 'linear':
            push(`linear-gradient(${r2(f.angle ?? 180)}deg, ${stopsCss(f.stops)})`);
            break;
          case 'radial':
            push(`radial-gradient(circle at ${r2(f.cx ?? 50)}% ${r2(f.cy ?? 50)}%, ${stopsCss(f.stops)})`);
            break;
          case 'conic':
            push(`conic-gradient(from ${r2(f.angle ?? 0)}deg at 50% 50%, ${stopsCss(f.stops)})`);
            break;
          case 'mesh': {
            // A "mesh gradient": soft radial blobs of colour over a base colour.
            (f.points || []).forEach((p) =>
              push(`radial-gradient(at ${r2(p.x)}% ${r2(p.y)}%, ${p.color} 0px, transparent ${r2(f.spread ?? 55)}%)`)
            );
            push(`linear-gradient(${f.base}, ${f.base})`);
            break;
          }
          case 'image': {
            // brand logos (`brand-logo:<id>`) resolve to the logo's real src
            const src = String(f.src || '').startsWith('brand-logo:') ? (Folio.brand && Folio.brand.resolveSrc ? Folio.brand.resolveSrc(f.src) : '') : f.src;
            if (!src) break;
            const fit = f.fit || 'cover';
            const size = fit === 'fill' ? '100% 100%' : fit === 'tile' ? 'auto' : fit;
            push(`url("${String(src).replace(/"/g, '%22')}")`, size, 'center', fit === 'tile' ? 'repeat' : 'no-repeat');
            break;
          }
          case 'noise':
            push(noiseUrl(f.opacity ?? 0.15), '200px 200px', '0 0', 'repeat');
            break;
        }
      });

    if (!images.length) return {};
    const out = { 'background-image': images.join(', ') };
    if (sizes.some((s) => s !== 'auto')) out['background-size'] = sizes.join(', ');
    if (positions.some((p) => p !== '0% 0%')) out['background-position'] = positions.join(', ');
    out['background-repeat'] = repeats.join(', ');
    return out;
  }

  function radiusCss(radius) {
    if (typeof radius === 'string') return radius || null; // e.g. brand token var(--radius-md)
    if (Array.isArray(radius)) {
      if (radius.every((v) => !v)) return null;
      return radius.map(px).join(' ');
    }
    return radius ? px(radius) : null;
  }

  function adjustCss(a) {
    if (!a) return [];
    const parts = [];
    if (a.brightness != null && a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
    if (a.contrast != null && a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`);
    if (a.saturate != null && a.saturate !== 100) parts.push(`saturate(${a.saturate}%)`);
    if (a.grayscale) parts.push(`grayscale(${a.grayscale}%)`);
    if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
    return parts;
  }

  /** CSS for one sizing axis ('w' or 'h'). */
  function sizeAxis(out, node, parent, axis) {
    const prop = axis === 'w' ? 'width' : 'height';
    const value = axis === 'w' ? node.width : node.height;
    let mode = (node.sizing && node.sizing[axis]) || 'fixed';
    if (!parent && mode === 'fill') mode = 'fixed'; // top-level artboards can't fill the canvas

    if (mode === 'fixed') {
      out[prop] = px(value);
      return;
    }
    if (mode === 'hug') {
      if (axis === 'w') out[prop] = node.type === 'text' ? 'max-content' : 'fit-content';
      else out[prop] = 'auto';
      return;
    }
    // fill
    const parentFlex = parent && parent.layout && parent.layout.mode === 'flex';
    if (parentFlex) {
      const mainAxis = parent.layout.direction === 'row' ? 'w' : 'h';
      if (axis === mainAxis) {
        out['flex'] = '1 1 0px';
        out[axis === 'w' ? 'min-width' : 'min-height'] = '0px';
        out[prop] = 'auto';
      } else {
        out['align-self'] = 'stretch';
        out[prop] = 'auto';
      }
    } else {
      out[prop] = '100%';
    }
  }

  /**
   * The CSS properties for one node.
   * opts.mode: 'canvas' (top-level artboards are positioned on the infinite canvas)
   *            'export' (top-level artboard becomes the page container)
   * opts.parent: override the parent node (otherwise looked up in the store)
   */
  function nodeStyles(node, opts = {}) {
    const mode = opts.mode || 'canvas';
    const parent = opts.parent !== undefined ? opts.parent : Folio.store.getParent(node.id);
    const st = node.style || {};
    const out = { 'box-sizing': 'border-box' };

    // ---- position ----
    const parentFlex = parent && parent.layout && parent.layout.mode === 'flex';
    if (!parent) {
      if (mode === 'canvas') {
        out.position = 'absolute';
        out.left = px(node.x);
        out.top = px(node.y);
      } else {
        out.position = 'relative';
      }
    } else if (!parentFlex) {
      out.position = 'absolute';
      out.left = px(node.x);
      out.top = px(node.y);
    } else {
      out.position = 'relative';
      out['flex-shrink'] = '0';
    }

    // ---- size ----
    sizeAxis(out, node, parent, 'w');
    sizeAxis(out, node, parent, 'h');

    // ---- auto layout (frames) ----
    if (node.type === 'frame' && node.layout) {
      const L = node.layout;
      if (L.mode === 'flex') {
        out.display = 'flex';
        out['flex-direction'] = L.direction || 'column';
        if (L.wrap) out['flex-wrap'] = 'wrap';
        if (L.gap) out.gap = px(L.gap);
        if (L.justify && L.justify !== 'flex-start') out['justify-content'] = L.justify;
        if (L.align && L.align !== 'stretch') out['align-items'] = L.align;
        else if (L.align === 'stretch') out['align-items'] = 'stretch';
      }
      const p = L.padding || [0, 0, 0, 0];
      if (p.some((v) => v)) {
        out.padding =
          p[0] === p[2] && p[1] === p[3]
            ? p[0] === p[1]
              ? px(p[0])
              : `${px(p[0])} ${px(p[1])}`
            : p.map(px).join(' ');
      }
    }

    // ---- appearance ----
    Object.assign(out, fillsToCss(st.fills));
    const rad = radiusCss(st.radius);
    if (rad) out['border-radius'] = rad;
    if (st.border && st.border.width > 0) {
      out.border = `${px(st.border.width)} ${st.border.style || 'solid'} ${st.border.color}`;
    }
    const shadows = (st.shadows || []).filter((s) => s.visible !== false);
    if (shadows.length) {
      if (node.type === 'text') {
        out['text-shadow'] = shadows.map((s) => `${px(s.x)} ${px(s.y)} ${px(s.blur)} ${s.color}`).join(', ');
      } else {
        out['box-shadow'] = shadows
          .map((s) => `${s.inset ? 'inset ' : ''}${px(s.x)} ${px(s.y)} ${px(s.blur)} ${px(s.spread || 0)} ${s.color}`)
          .join(', ');
      }
    }
    if (st.opacity != null && st.opacity !== 1) out.opacity = String(r2(st.opacity));
    const filters = [];
    if (st.blur) filters.push(`blur(${px(st.blur)})`);
    filters.push(...adjustCss(st.adjust));
    if (filters.length) out.filter = filters.join(' ');
    const backdrop = [];
    if (st.backdropBlur) backdrop.push(`blur(${px(st.backdropBlur)})`);
    if (st.backdropSaturate != null && st.backdropSaturate !== 100) backdrop.push(`saturate(${r2(st.backdropSaturate)}%)`);
    if (backdrop.length) {
      out['backdrop-filter'] = backdrop.join(' ');
      out['-webkit-backdrop-filter'] = out['backdrop-filter'];
    }
    if (st.blend && st.blend !== 'normal') out['mix-blend-mode'] = st.blend;
    if (st.clip) out.overflow = 'hidden';
    if (st.rotation) out.transform = `rotate(${r2(st.rotation)}deg)`;

    // ---- typography ----
    if (node.type === 'text' && node.text) {
      const t = node.text;
      out.margin = '0px';
      out['font-family'] = Folio.fonts ? Folio.fonts.stack(t.font) : `"${t.font}", sans-serif`;
      out['font-size'] = px(t.size);
      out['font-weight'] = String(t.weight);
      out['line-height'] = String(r2(t.lineHeight));
      if (t.letterSpacing) out['letter-spacing'] = `${r2(t.letterSpacing)}em`;
      out.color = t.color;
      if (t.align && t.align !== 'left') out['text-align'] = t.align;
      if (t.transform && t.transform !== 'none') out['text-transform'] = t.transform;
      if (t.italic) out['font-style'] = 'italic';
      if (t.decoration && t.decoration !== 'none') out['text-decoration'] = t.decoration;
      out['white-space'] = 'pre-wrap';
      out['overflow-wrap'] = 'break-word';
    }

    // ---- images ----
    if (node.type === 'image') {
      out.display = 'block';
      out['object-fit'] = (node.image && node.image.fit) || 'cover';
    }

    return out;
  }

  function toCssText(obj) {
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${v};`)
      .join(' ');
  }

  function toCssBlock(obj, indent = '  ') {
    return Object.entries(obj)
      .map(([k, v]) => `${indent}${k}: ${v};`)
      .join('\n');
  }

  Folio.css = { nodeStyles, fillsToCss, toCssText, toCssBlock, noiseUrl, px };
})();
