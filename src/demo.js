/*
 * demo.js — the starter document you see the first time you open Folio.
 *
 * Three artboards, built from plain nested objects with store.buildFromTree():
 *   1. Desktop landing page (1440 wide, auto layout all the way down)
 *   2. Instagram post 1080×1080 (mesh gradient + grain, big display type)
 *   3. Mobile app screen 390×844 (header, stat cards, list rows, tab bar)
 *
 * It's also a good reference for how a design is described in Folio — try
 * copying one of these trees and changing it.
 */
window.Folio = window.Folio || {};

(function () {
  // ---------- tiny builders ----------
  /** Remove undefined values so they don't overwrite defaults when merged. */
  function prune(o) {
    if (Array.isArray(o)) return o.map(prune);
    if (!o || typeof o !== 'object') return o;
    const out = {};
    Object.keys(o).forEach((k) => {
      if (o[k] !== undefined) out[k] = prune(o[k]);
    });
    return out;
  }

  const solid = (color) => ({ type: 'solid', color, visible: true });
  const linear = (angle, ...colors) => ({
    type: 'linear',
    angle,
    visible: true,
    stops: colors.map((c, i) => ({ color: c, pos: colors.length === 1 ? 0 : (i / (colors.length - 1)) * 100 })),
  });
  const mesh = (base, points, spread = 55) => ({
    type: 'mesh',
    base,
    spread,
    visible: true,
    points: points.map(([color, x, y]) => ({ color, x, y })),
  });
  const noise = (opacity) => ({ type: 'noise', opacity, visible: true });
  const shadow = (x, y, blur, spread, color) => ({ x, y, blur, spread, color, inset: false, visible: true });

  /**
   * Frame. o: { name, w, h, sw, sh (sizing), dir, gap, pad, justify, align, wrap,
   *             fills, radius, border, shadows, clip, opacity, blur, backdropBlur, x, y, free }
   */
  function F(o, children = []) {
    const layout = o.free
      ? { mode: 'none' }
      : {
          mode: 'flex',
          direction: o.dir || 'column',
          gap: o.gap || 0,
          justify: o.justify || 'flex-start',
          align: o.align || 'flex-start',
          wrap: !!o.wrap,
          padding: o.pad == null ? [0, 0, 0, 0] : typeof o.pad === 'number' ? [o.pad, o.pad, o.pad, o.pad] : o.pad.length === 2 ? [o.pad[0], o.pad[1], o.pad[0], o.pad[1]] : o.pad,
        };
    return prune({
      type: 'frame',
      name: o.name || 'Frame',
      x: o.x,
      y: o.y,
      width: o.w != null ? o.w : 100,
      height: o.h != null ? o.h : 100,
      sizing: { w: o.sw || (o.w != null ? 'fixed' : 'hug'), h: o.sh || (o.h != null ? 'fixed' : 'hug') },
      layout,
      style: {
        fills: o.fills || [],
        radius: o.radius || 0,
        border: o.border ? { width: o.border[0], color: o.border[1], style: 'solid' } : undefined,
        shadows: o.shadows || [],
        clip: !!o.clip,
        opacity: o.opacity,
        blur: o.blur,
        backdropBlur: o.backdropBlur,
        blend: o.blend,
      },
      children,
    });
  }

  /** Text. o: { font, size, weight, color, lh, ls, align, transform, sw ('fill' to wrap), name, opacity } */
  function T(content, o = {}) {
    return prune({
      type: 'text',
      name: o.name || content.replace(/\s+/g, ' ').slice(0, 32),
      x: o.x,
      y: o.y,
      width: o.w || 200,
      height: 24,
      sizing: { w: o.sw || (o.w ? 'fixed' : 'hug'), h: 'hug' },
      text: {
        content,
        font: o.font || 'Inter',
        size: o.size || 16,
        weight: o.weight || 400,
        lineHeight: o.lh || 1.4,
        letterSpacing: o.ls || 0,
        color: o.color || '#111111',
        align: o.align || 'left',
        transform: o.transform || 'none',
      },
      style: o.opacity != null ? { opacity: o.opacity } : undefined,
    });
  }

  const ink = '#0f0e17';
  const muted = '#5b5b66';
  const violet = '#6d5efc';
  const DISPLAY = 'Bricolage Grotesque';

  // ---------- 1. desktop landing page ----------
  function landing(x) {
    const pillBtn = (label, primary) =>
      F(
        {
          name: primary ? 'Button / Primary' : 'Button / Secondary',
          dir: 'row',
          align: 'center',
          pad: [16, 26],
          radius: 12,
          fills: [solid(primary ? violet : '#ffffff')],
          border: primary ? undefined : [1, '#e4e4ea'],
          shadows: primary ? [shadow(0, 10, 28, -6, '#6d5efc80')] : [shadow(0, 1, 2, 0, '#0f0e170d')],
        },
        [T(label, { size: 16, weight: 600, color: primary ? '#ffffff' : ink, name: 'Label' })]
      );

    const nav = F(
      { name: 'Nav', dir: 'row', sw: 'fill', align: 'center', justify: 'space-between', pad: [28, 80] },
      [
        F({ name: 'Logo', dir: 'row', gap: 10, align: 'center' }, [
          F({ name: 'Mark', w: 30, h: 30, radius: 9, fills: [linear(135, '#8b7fff', '#ff7a59')] }),
          T('Lumen', { font: DISPLAY, size: 22, weight: 700, color: ink, ls: -0.02 }),
        ]),
        F(
          { name: 'Links', dir: 'row', gap: 36, align: 'center' },
          ['Product', 'Pricing', 'Customers', 'Changelog'].map((l) => T(l, { size: 15, weight: 500, color: '#3f3f4a' }))
        ),
        F({ name: 'Actions', dir: 'row', gap: 20, align: 'center' }, [
          T('Sign in', { size: 15, weight: 500, color: ink }),
          F({ name: 'Button / Dark', dir: 'row', pad: [11, 18], radius: 999, fills: [solid(ink)] }, [
            T('Get started', { size: 14, weight: 600, color: '#ffffff', name: 'Label' }),
          ]),
        ]),
      ]
    );

    const bars = [38, 54, 46, 70, 62, 88, 100].map((hgt, i) =>
      F({ name: 'Bar ' + (i + 1), w: 22, h: hgt, radius: 6, fills: [solid(i === 6 ? '#ffffff' : '#ffffff8c')] })
    );

    const heroCard = F(
      {
        name: 'Hero card',
        w: 560,
        h: 540,
        justify: 'space-between',
        pad: 28,
        radius: 32,
        clip: true,
        fills: [
          mesh('#5b3df5', [
            ['#ff8a5b', 12, 14],
            ['#c26bff', 88, 10],
            ['#3d8bff', 16, 92],
            ['#ffd36e', 92, 86],
          ], 60),
          noise(0.22),
        ],
        shadows: [shadow(0, 40, 80, -24, '#5b3df566')],
      },
      [
        F({ name: 'Top', dir: 'row', sw: 'fill', justify: 'space-between', align: 'center' }, [
          F({ name: 'Chip', dir: 'row', gap: 8, align: 'center', pad: [8, 14], radius: 999, fills: [solid('#ffffff2e')], border: [1, '#ffffff4d'], backdropBlur: 12 }, [
            F({ name: 'Dot', w: 8, h: 8, radius: 9999, fills: [solid('#7dffb3')] }),
            T('Live', { size: 13, weight: 600, color: '#ffffff' }),
          ]),
          T('+24% this week', { size: 14, weight: 600, color: '#ffffff' }),
        ]),
        F(
          {
            name: 'Glass card',
            sw: 'fill',
            gap: 18,
            pad: 26,
            radius: 22,
            fills: [solid('#ffffff26')],
            border: [1, '#ffffff59'],
            backdropBlur: 20,
            shadows: [shadow(0, 20, 40, -12, '#1a0b5a40')],
          },
          [
            F({ name: 'Numbers', dir: 'row', sw: 'fill', justify: 'space-between', align: 'flex-end' }, [
              F({ name: 'Revenue', gap: 4 }, [
                T('Monthly revenue', { size: 14, weight: 500, color: '#ffffffcc' }),
                T('$48,290', { font: DISPLAY, size: 48, weight: 700, color: '#ffffff', lh: 1.05, ls: -0.03 }),
              ]),
              F({ name: 'Chart', dir: 'row', gap: 8, align: 'flex-end', h: 100, sh: 'fixed' }, bars),
            ]),
          ]
        ),
      ]
    );

    const hero = F({ name: 'Hero', dir: 'row', sw: 'fill', gap: 64, align: 'center', pad: [56, 80, 96, 80] }, [
      F({ name: 'Copy', sw: 'fill', gap: 28 }, [
        F({ name: 'Badge', dir: 'row', gap: 10, align: 'center', pad: [5, 14, 5, 5], radius: 999, fills: [solid('#ffffff')], border: [1, '#e7e7ee'] }, [
          F({ name: 'Tag', dir: 'row', pad: [3, 10], radius: 999, fills: [solid(violet)] }, [T('New', { size: 12, weight: 600, color: '#ffffff' })]),
          T('Auto layout that is just flexbox  →', { size: 13, weight: 500, color: '#4a4a55' }),
        ]),
        T('Design in real CSS.\nShip what you see.', {
          name: 'Headline',
          font: DISPLAY,
          size: 76,
          weight: 700,
          lh: 1.02,
          ls: -0.035,
          color: ink,
          sw: 'fill',
        }),
        T(
          'Every layer is a real DOM element and every style is real CSS — so the export is clean HTML you could have written yourself.',
          { name: 'Subhead', size: 20, lh: 1.55, color: muted, sw: 'fill' }
        ),
        F({ name: 'Buttons', dir: 'row', gap: 12, align: 'center' }, [pillBtn('Start designing — free', true), pillBtn('Watch the demo', false)]),
        T('Loved by 12,000+ designers and developers', { size: 13, color: '#8a8a96' }),
      ]),
      heroCard,
    ]);

    const feature = (title, body, colors, glyph) =>
      F(
        {
          name: 'Card / ' + title,
          sw: 'fill',
          sh: 'fill',
          gap: 16,
          pad: 32,
          radius: 22,
          fills: [solid('#ffffff')],
          border: [1, '#ececf2'],
          shadows: [shadow(0, 12, 32, -16, '#0f0e1726')],
        },
        [
          F({ name: 'Icon', w: 48, h: 48, radius: 14, dir: 'row', justify: 'center', align: 'center', fills: [linear(135, ...colors)] }, [
            F({ name: glyph === 'circle' ? 'Ellipse' : 'Shape', w: 18, h: 18, radius: glyph === 'circle' ? 9999 : 5, fills: [solid('#ffffff')] }),
          ]),
          T(title, { size: 20, weight: 600, color: ink, ls: -0.01 }),
          T(body, { size: 15, lh: 1.6, color: muted, sw: 'fill', name: 'Body' }),
        ]
      );

    const features = F({ name: 'Features', sw: 'fill', gap: 40, pad: [24, 80, 112, 80] }, [
      F({ name: 'Section header', gap: 12 }, [
        T('WHY LUMEN', { size: 13, weight: 700, ls: 0.14, color: violet, name: 'Eyebrow' }),
        T('Everything you need, nothing you don’t.', { font: DISPLAY, size: 44, weight: 700, ls: -0.025, lh: 1.1, color: ink, name: 'Title' }),
      ]),
      F({ name: 'Cards', dir: 'row', sw: 'fill', gap: 24, align: 'stretch' }, [
        feature('Real auto layout', 'Frames are flexbox. Gap, padding and alignment behave exactly like they do in the browser.', ['#8b7fff', '#5b3df5'], 'square'),
        feature('Gradients & grain', 'Mesh gradients, noise, blurs and blend modes — all exported as plain CSS backgrounds.', ['#ff9a6b', '#ff5f8f'], 'circle'),
        feature('Code you would write', 'Readable class names, semantic tags and tidy CSS. Copy it, or download a full page.', ['#3dd6c6', '#2b8cff'], 'square'),
      ]),
    ]);

    const footer = F(
      { name: 'Footer', dir: 'row', sw: 'fill', justify: 'space-between', align: 'center', pad: [28, 80], fills: [solid('#f1f0ec')] },
      [
        T('© 2026 Lumen Labs', { size: 14, color: '#777783' }),
        F({ name: 'Footer links', dir: 'row', gap: 28 }, ['Twitter', 'GitHub', 'Privacy'].map((l) => T(l, { size: 14, color: '#777783' }))),
      ]
    );

    return F(
      {
        name: 'Desktop — Landing',
        x,
        y: 0,
        w: 1440,
        h: 1300,
        sh: 'hug',
        align: 'stretch',
        clip: true,
        fills: [solid('#fafaf7')],
      },
      [nav, hero, features, footer]
    );
  }

  // ---------- 2. instagram post ----------
  function instagram(x) {
    return F(
      {
        name: 'Instagram Post',
        x,
        y: 0,
        w: 1080,
        h: 1080,
        free: true,
        clip: true,
        fills: [
          mesh('#1b0b3a', [
            ['#ff5f6d', 8, 10],
            ['#7b2ff7', 90, 18],
            ['#ffc371', 18, 92],
            ['#00c6ff', 92, 88],
          ], 62),
          noise(0.28),
        ],
      },
      [
        F({ name: 'Glow ellipse', x: 560, y: 380, w: 520, h: 520, radius: 9999, fills: [solid('#ff7a59')], blur: 120, opacity: 0.55, free: true }),
        F({ name: 'Content', x: 0, y: 0, w: 1080, h: 1080, justify: 'space-between', pad: 84 }, [
          F({ name: 'Top row', dir: 'row', sw: 'fill', justify: 'space-between', align: 'center' }, [
            F({ name: 'Brand pill', dir: 'row', gap: 12, align: 'center', pad: [12, 22], radius: 999, fills: [solid('#ffffff1f')], border: [2, '#ffffff4d'], backdropBlur: 10 }, [
              F({ name: 'Ellipse', w: 14, h: 14, radius: 9999, fills: [solid('#7dffb3')] }),
              T('LUMEN', { size: 24, weight: 700, ls: 0.22, color: '#ffffff' }),
            ]),
            T('@lumen.design', { size: 26, weight: 500, color: '#ffffffcc' }),
          ]),
          F({ name: 'Message', gap: 28, sw: 'fill' }, [
            T('DESIGN\nIN REAL\nCSS.', { name: 'Headline', font: 'Bebas Neue', size: 230, weight: 400, lh: 0.86, color: '#ffffff', ls: 0.005 }),
            T('The canvas that speaks code. Launching March 14.', {
              name: 'Subline',
              font: DISPLAY,
              size: 34,
              weight: 600,
              lh: 1.2,
              ls: -0.02,
              color: '#ffffffe6',
              sw: 'fill',
            }),
          ]),
          F({ name: 'Bottom row', dir: 'row', sw: 'fill', justify: 'space-between', align: 'center' }, [
            F({ name: 'CTA pill', dir: 'row', align: 'center', gap: 14, pad: [24, 40], radius: 999, fills: [solid('#ffffff')], shadows: [shadow(0, 20, 40, -10, '#1b0b3a66')] }, [
              T('Join the waitlist  →', { size: 30, weight: 700, color: '#1b0b3a', ls: -0.01, name: 'Label' }),
            ]),
            T('lumen.design', { size: 28, weight: 600, color: '#ffffff' }),
          ]),
        ]),
      ]
    );
  }

  // ---------- 3. mobile app screen ----------
  function mobile(x) {
    const card = '#1a1a22';
    const stat = (label, value, delta, color) =>
      F({ name: 'Stat / ' + label, sw: 'fill', gap: 10, pad: 16, radius: 20, fills: [solid(card)], border: [1, '#ffffff0f'] }, [
        F({ name: 'Icon', w: 34, h: 34, radius: 11, dir: 'row', justify: 'center', align: 'center', fills: [solid(color + '33')] }, [
          F({ name: 'Ellipse', w: 12, h: 12, radius: 9999, fills: [solid(color)] }),
        ]),
        F({ name: 'Text', gap: 2 }, [
          T(label, { size: 12, weight: 500, color: '#9a9aa6' }),
          T(value, { font: DISPLAY, size: 22, weight: 700, color: '#ffffff', ls: -0.02 }),
        ]),
        T(delta, { size: 11, weight: 600, color }),
      ]);

    const row = (title, sub, amount, color, positive) =>
      F({ name: 'Row / ' + title, dir: 'row', sw: 'fill', gap: 12, align: 'center', pad: [9, 10] }, [
        F({ name: 'Avatar', w: 42, h: 42, radius: 14, dir: 'row', justify: 'center', align: 'center', fills: [linear(135, color, color + '99')] }, [
          T(title.charAt(0), { size: 16, weight: 700, color: '#ffffff', name: 'Initial' }),
        ]),
        F({ name: 'Details', sw: 'fill', gap: 2 }, [
          T(title, { size: 15, weight: 600, color: '#ffffff' }),
          T(sub, { size: 12, color: '#7c7c88' }),
        ]),
        T(amount, { size: 15, weight: 600, color: positive ? '#4ade80' : '#ffffff' }),
      ]);

    const tab = (label, active) =>
      F({ name: 'Tab / ' + label, gap: 5, align: 'center' }, [
        F({ name: 'Icon', w: 22, h: 22, radius: 7, fills: [solid(active ? '#8b7fff' : '#4a4a56')] }),
        T(label, { size: 11, weight: 600, color: active ? '#ffffff' : '#7c7c88' }),
      ]);

    return F(
      { name: 'Mobile — Wallet', x, y: 0, w: 390, h: 844, gap: 14, pad: [52, 20, 20, 20], align: 'stretch', clip: true, fills: [solid('#0d0d12')] },
      [
        F({ name: 'Header', dir: 'row', sw: 'fill', justify: 'space-between', align: 'center' }, [
          F({ name: 'Greeting', gap: 2 }, [
            T('Good morning', { size: 14, color: '#9a9aa6' }),
            T('Maya Chen', { font: DISPLAY, size: 26, weight: 700, color: '#ffffff', ls: -0.02 }),
          ]),
          F({ name: 'Avatar ellipse', w: 44, h: 44, radius: 9999, dir: 'row', justify: 'center', align: 'center', fills: [linear(135, '#ff9a6b', '#c26bff')], border: [2, '#ffffff33'] }, [
            T('MC', { size: 15, weight: 700, color: '#ffffff' }),
          ]),
        ]),
        F(
          {
            name: 'Balance card',
            sw: 'fill',
            gap: 6,
            pad: 20,
            radius: 26,
            clip: true,
            fills: [mesh('#4b2fe0', [['#8b5cff', 10, 10], ['#2b8cff', 90, 20], ['#ff6fb5', 80, 95], ['#5b3df5', 10, 90]], 60), noise(0.18)],
            shadows: [shadow(0, 20, 40, -16, '#5b3df5aa')],
          },
          [
            T('Total balance', { size: 13, weight: 500, color: '#ffffffcc' }),
            T('$24,562.80', { font: DISPLAY, size: 38, weight: 700, color: '#ffffff', ls: -0.03, lh: 1.1 }),
            F({ name: 'Row', dir: 'row', gap: 8, align: 'center' }, [
              F({ name: 'Chip', dir: 'row', pad: [4, 10], radius: 999, fills: [solid('#ffffff2e')] }, [T('+3.2%', { size: 12, weight: 700, color: '#ffffff' })]),
              T('vs last month', { size: 12, color: '#ffffffb3' }),
            ]),
          ]
        ),
        F({ name: 'Stats', dir: 'row', sw: 'fill', gap: 12 }, [stat('Income', '$8,240', '↑ 12% this month', '#4ade80'), stat('Spending', '$3,105', '↓ 4% this month', '#ff7a8a')]),
        F({ name: 'Section title', dir: 'row', sw: 'fill', justify: 'space-between', align: 'center' }, [
          T('Recent activity', { size: 16, weight: 600, color: '#ffffff' }),
          T('See all', { size: 13, weight: 600, color: '#8b7fff' }),
        ]),
        F({ name: 'Activity list', sw: 'fill', gap: 2, pad: 6, radius: 22, fills: [solid('#15151c')], border: [1, '#ffffff0d'] }, [
          row('Spotify', 'Subscription · Today', '−$11.99', '#1ed760', false),
          row('Freelance invoice', 'Transfer · Yesterday', '+$2,400', '#8b7fff', true),
          row('Blue Bottle', 'Coffee · Mon', '−$6.50', '#3d8bff', false),
        ]),
        F({ name: 'Spacer', sh: 'fill', w: 10, h: 10, sw: 'fill' }),
        F({ name: 'Tab bar', dir: 'row', sw: 'fill', justify: 'space-between', align: 'center', pad: [12, 30], radius: 24, fills: [solid('#1a1a22e6')], border: [1, '#ffffff12'], backdropBlur: 16 }, [
          tab('Home', true),
          tab('Cards', false),
          tab('Stats', false),
          tab('Profile', false),
        ]),
      ]
    );
  }

  /** Replace the current document with the demo (history is reset, like opening a file). */
  function build() {
    const store = Folio.store;
    store.load({ version: 1, name: 'Folio demo', nodes: {}, roots: [] });
    const gap = 120;
    let x = 0;
    [landing, instagram, mobile].forEach((make) => {
      const tree = make(x);
      const node = store.buildFromTree(tree);
      x += node.width + gap;
    });
    ['Inter', DISPLAY, 'Bebas Neue'].forEach((f) => Folio.fonts && Folio.fonts.ensure(f));
    store.load(store.doc); // reset history so the demo is the starting point
    store.scheduleSave();
    return store.doc;
  }

  Folio.demo = { build, trees: { landing, instagram, mobile } };
})();
