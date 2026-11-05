// Throwaway stand-in for src/svg.js (Folio.svg per SPEC "Logo designer") until the real one lands.
(function () {
  if (window.Folio.svg) return;
  const EL = 'svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask use title desc'.split(' ');
  const AT = 'fill stroke stroke-width stroke-linecap stroke-linejoin opacity fill-opacity stroke-opacity fill-rule clip-rule transform d x y x1 y1 x2 y2 cx cy r rx ry width height points offset stop-color stop-opacity gradientUnits gradientTransform font-family font-size font-weight letter-spacing text-anchor dominant-baseline clip-path mask id viewBox xmlns href xlink:href'.split(' ');
  function sanitize(markup) {
    if (typeof markup !== 'string' || markup.length > 200000) throw new Error('SVG missing or too large');
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error('That is not valid SVG markup.');
    const warnings = [];
    const walk = (el) => {
      [...el.children].forEach((c) => {
        if (!EL.includes(c.nodeName)) { warnings.push(`removed <${c.nodeName}>`); c.remove(); return; }
        walk(c);
      });
      [...el.attributes].forEach((a) => {
        const v = a.value;
        if (!AT.includes(a.name)) { warnings.push(`removed ${a.name}`); el.removeAttribute(a.name); return; }
        if (/href$/.test(a.name) && !/^#/.test(v)) { warnings.push('removed external href'); el.removeAttribute(a.name); }
        if (/url\(/.test(v) && !/^url\(#[\w-]+\)$/.test(v.trim())) { warnings.push('removed external url()'); el.removeAttribute(a.name); }
        const m = /^var\(--color-([\w-]+)\)$/.exec(v.trim());
        if (m && Folio.brand) el.setAttribute(a.name, Folio.brand.resolveColor(v) || '#111111');
      });
    };
    walk(root);
    if (!root.getAttribute('viewBox')) {
      const w = parseFloat(root.getAttribute('width')) || 100, h = parseFloat(root.getAttribute('height')) || 100;
      root.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return { svg: new XMLSerializer().serializeToString(root), warnings };
  }
  async function embedFonts(svg) {
    const fams = [...new Set([...svg.matchAll(/font-family="([^"]+)"/g)].map((m) => m[1].split(',')[0].replace(/['"]/g, '').trim()))];
    if (!fams.length) return svg;
    let css = '';
    for (const f of fams) {
      const r = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}:wght@100..900&display=swap`);
      const text = await r.text();
      const blocks = text.split('@font-face').filter((b) => /U\+0000-00FF/.test(b));
      for (const b of blocks) {
        const url = (/url\(([^)]+)\)/.exec(b) || [])[1];
        if (!url) continue;
        const buf = await (await fetch(url)).arrayBuffer();
        let bin = '';
        new Uint8Array(buf).forEach((x) => (bin += String.fromCharCode(x)));
        css += '@font-face' + b.replace(/\}\s*$/, '').replace(url, `data:font/woff2;base64,${btoa(bin)}`) + '}';
      }
    }
    return svg.replace(/(<svg[^>]*>)/, `$1<defs><style>${css.replace(/\/\*[^*]*\*\//g, '')}</style></defs>`);
  }
  const lum = (hex) => {
    const m = /^#?([0-9a-f]{6})/i.exec(hex);
    if (!m) return 0;
    const n = parseInt(m[1], 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  const expand = (c) => (/^#[0-9a-f]{3}$/i.test(c) ? '#' + c.slice(1).split('').map((x) => x + x).join('') : c);
  function recolor(svg, fn) {
    return svg.replace(/(fill|stroke|stop-color)="([^"]+)"/g, (all, k, v) => (v === 'none' || /^url/.test(v) ? all : `${k}="${fn(expand(v))}"`));
  }
  function versions(svg) {
    const hasFill = /<(path|rect|circle|ellipse|polygon|text)\b(?![^>]*fill=)/.test(svg);
    const base = hasFill ? svg.replace(/<svg\b/, '<svg fill="#111111"') : svg;
    return {
      'on-light': svg,
      'on-dark': recolor(base, (c) => (lum(c) < 0.35 ? '#ffffff' : c)),
      mono: recolor(base, () => '#111111'),
    };
  }
  const toDataUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  function size(svg) {
    const m = /viewBox="([^"]+)"/.exec(svg);
    const p = m ? m[1].trim().split(/[\s,]+/).map(Number) : [];
    return { width: p[2] || 0, height: p[3] || 0 };
  }
  async function fromNode(id) {
    const n = Folio.store.get(id);
    const src = n && n.image && n.image.src;
    if (src && /^data:image\/svg\+xml/.test(src)) return decodeURIComponent(src.slice(src.indexOf(',') + 1));
    throw new Error('stub fromNode only handles SVG images');
  }
  window.Folio.svg = { sanitize, embedFonts, recolor, versions, toDataUrl, size, fromNode, stub: true };
})();
