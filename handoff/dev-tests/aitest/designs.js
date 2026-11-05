// Inputs written the way Claude would write them after reading Folio.aiPrompt.system.
const INK = '#0c1222';
const MUTED = '#5a6478';
const ACCENT = '#16a34a';
const LINE = '#e6e8ee';
const DISPLAY = 'Bricolage Grotesque';

const solid = (color) => ({ type: 'solid', color });
const label = (content, o = {}) => ({ type: 'text', name: o.name || 'Label', text: { content, size: o.size || 15, weight: o.weight || 600, color: o.color || '#ffffff' } });
const btn = (text, primary, o = {}) => ({
  type: 'frame',
  name: primary ? 'Button / Primary' : 'Button / Secondary',
  layout: { direction: 'row', align: 'center', gap: 8, padding: o.pad || [14, 22] },
  style: primary
    ? { fills: [solid(o.bg || INK)], radius: 10, shadows: [{ x: 0, y: 8, blur: 20, spread: -8, color: '#0c122266' }] }
    : { fills: [solid('#ffffff')], radius: 10, border: { width: 1, color: LINE } },
  children: [label(text, { color: primary ? '#ffffff' : INK, size: o.size || 15 })],
});

// ---- call 1: artboard + nav + hero
const landing1 = {
  parent_id: null,
  nodes: [
    {
      type: 'frame',
      name: 'Pulse — Landing',
      width: 1440,
      sizing: { h: 'hug' },
      layout: { mode: 'flex', direction: 'column', align: 'stretch' },
      style: { fills: [solid('#f7f8fa')] },
      children: [
        {
          type: 'frame',
          name: 'Nav',
          sizing: { w: 'fill' },
          layout: { direction: 'row', justify: 'space-between', align: 'center', padding: [24, 80] },
          children: [
            {
              type: 'frame',
              name: 'Logo',
              layout: { direction: 'row', gap: 10, align: 'center' },
              children: [
                { type: 'frame', name: 'Mark', width: 28, height: 28, style: { radius: 8, fills: [{ type: 'linear', angle: 135, stops: [{ color: '#22c55e', pos: 0 }, { color: '#0ea5e9', pos: 100 }] }] } },
                { type: 'text', name: 'Wordmark', text: { content: 'Pulse', font: DISPLAY, size: 22, weight: 700, letterSpacing: -0.02, color: INK } },
              ],
            },
            {
              type: 'frame',
              name: 'Links',
              layout: { direction: 'row', gap: 36 },
              children: ['Product', 'Pricing', 'Status pages', 'Docs'].map((t) => ({ type: 'text', name: t, text: { content: t, size: 15, weight: 500, color: '#384156' } })),
            },
            {
              type: 'frame',
              name: 'Actions',
              layout: { direction: 'row', gap: 20, align: 'center' },
              children: [{ type: 'text', name: 'Sign in', text: { content: 'Sign in', size: 15, weight: 500, color: INK } }, btn('Start monitoring', true, { pad: [11, 18], size: 14 })],
            },
          ],
        },
        {
          type: 'frame',
          name: 'Hero',
          sizing: { w: 'fill' },
          layout: { direction: 'column', align: 'center', gap: 56, padding: [72, 80, 96, 80] },
          children: [
            {
              type: 'frame',
              name: 'Copy',
              layout: { gap: 24, align: 'center' },
              width: 860,
              sizing: { w: 'fixed' },
              children: [
                {
                  type: 'frame',
                  name: 'Badge',
                  layout: { direction: 'row', gap: 8, align: 'center', padding: [6, 14, 6, 6] },
                  style: { fills: [solid('#ffffff')], radius: 999, border: { width: 1, color: LINE } },
                  children: [
                    { type: 'frame', name: 'Tag', layout: { direction: 'row', padding: [3, 10] }, style: { fills: [solid('#dcfce7')], radius: 999 }, children: [label('New', { size: 12, weight: 700, color: '#15803d' })] },
                    { type: 'text', name: 'Badge text', text: { content: 'SMS alerts are now included on every plan', size: 13, weight: 500, color: '#384156' } },
                  ],
                },
                {
                  type: 'text',
                  name: 'Headline',
                  sizing: { w: 'fill' },
                  text: { content: 'Know your site is down\nbefore your customers do.', font: DISPLAY, size: 72, weight: 700, lineHeight: 1.04, letterSpacing: -0.035, color: INK, align: 'center' },
                },
                {
                  type: 'text',
                  name: 'Subhead',
                  sizing: { w: 'fill' },
                  text: { content: 'Pulse checks your websites, APIs and cron jobs every 30 seconds from 12 regions, and calls the right person the moment something breaks.', size: 20, lineHeight: 1.55, color: MUTED, align: 'center' },
                },
                {
                  type: 'frame',
                  name: 'Buttons',
                  layout: { direction: 'row', gap: 12 },
                  children: [btn('Start free — no card needed', true, { bg: ACCENT, pad: [16, 26], size: 16 }), btn('See a live status page', false, { pad: [16, 26], size: 16 })],
                },
                { type: 'text', name: 'Proof', text: { content: 'Trusted by 4,800 teams · 99.99% monitoring uptime', size: 13, color: '#7b8496' } },
              ],
            },
            {
              type: 'frame',
              name: 'Dashboard mock',
              width: 1120,
              height: 460,
              layout: { direction: 'row', gap: 20, padding: 24 },
              style: {
                radius: 24,
                clip: true,
                fills: [
                  { type: 'mesh', base: '#0b1324', spread: 62, points: [{ color: '#16a34a', x: 6, y: 8 }, { color: '#0ea5e9', x: 94, y: 12 }, { color: '#1e3a8a', x: 12, y: 96 }, { color: '#14532d', x: 90, y: 92 }] },
                  { type: 'noise', opacity: 0.16 },
                ],
                shadows: [{ x: 0, y: 40, blur: 80, spread: -30, color: '#0c122266' }],
              },
              children: [
                {
                  type: 'frame',
                  name: 'Monitors',
                  width: 360,
                  sizing: { h: 'fill' },
                  layout: { gap: 10, padding: 18 },
                  style: { radius: 16, fills: [solid('#ffffff14')], border: { width: 1, color: '#ffffff26' }, backdropBlur: 16 },
                  children: [
                    { type: 'text', name: 'Title', text: { content: 'Monitors', size: 14, weight: 600, color: '#ffffffb3' } },
                    ...[
                      ['api.acme.com', '38 ms', '#4ade80'],
                      ['checkout.acme.com', '112 ms', '#4ade80'],
                      ['nightly-backup (cron)', 'late 4m', '#fbbf24'],
                      ['eu.cdn.acme.com', 'down', '#f87171'],
                      ['status.acme.com', '64 ms', '#4ade80'],
                    ].map(([n, v, c]) => ({
                      type: 'frame',
                      name: 'Row / ' + n,
                      sizing: { w: 'fill' },
                      layout: { direction: 'row', align: 'center', gap: 10, padding: [10, 12] },
                      style: { radius: 10, fills: [solid('#ffffff0d')] },
                      children: [
                        { type: 'frame', name: 'Status dot', width: 8, height: 8, style: { radius: 9999, fills: [solid(c)], shadows: [{ x: 0, y: 0, blur: 8, color: c }] } },
                        { type: 'text', name: 'Name', sizing: { w: 'fill' }, text: { content: n, size: 14, weight: 500, color: '#ffffff' } },
                        { type: 'text', name: 'Value', text: { content: v, size: 13, weight: 600, color: c } },
                      ],
                    })),
                  ],
                },
                {
                  type: 'frame',
                  name: 'Chart card',
                  sizing: { w: 'fill', h: 'fill' },
                  layout: { gap: 16, padding: 24, justify: 'space-between' },
                  style: { radius: 16, fills: [solid('#ffffff14')], border: { width: 1, color: '#ffffff26' }, backdropBlur: 16 },
                  children: [
                    {
                      type: 'frame',
                      name: 'Header',
                      sizing: { w: 'fill' },
                      layout: { direction: 'row', justify: 'space-between', align: 'flex-end' },
                      children: [
                        {
                          type: 'frame',
                          name: 'Metric',
                          layout: { gap: 4 },
                          children: [
                            { type: 'text', name: 'Label', text: { content: 'Response time · last 24h', size: 14, weight: 500, color: '#ffffffb3' } },
                            { type: 'text', name: 'Value', text: { content: '84 ms', font: DISPLAY, size: 48, weight: 700, lineHeight: 1.05, letterSpacing: -0.03, color: '#ffffff' } },
                          ],
                        },
                        {
                          type: 'frame',
                          name: 'Chip',
                          layout: { direction: 'row', padding: [6, 12] },
                          style: { radius: 999, fills: [solid('#22c55e33')], border: { width: 1, color: '#4ade8066' } },
                          children: [label('↓ 18% vs yesterday', { size: 13, color: '#bbf7d0' })],
                        },
                      ],
                    },
                    {
                      type: 'frame',
                      name: 'Bars',
                      sizing: { w: 'fill' },
                      height: 200,
                      layout: { direction: 'row', gap: 6, align: 'flex-end' },
                      children: [40, 52, 46, 60, 55, 72, 64, 58, 80, 70, 66, 90, 74, 62, 68, 84, 96, 78, 70, 64, 58, 66, 74, 60].map((h, i) => ({
                        type: 'frame',
                        name: 'Bar ' + (i + 1),
                        sizing: { w: 'fill' },
                        height: h * 2,
                        style: { radius: 4, fills: [solid(i === 16 ? '#4ade80' : '#ffffff40')] },
                      })),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ---- call 2: features
const feature = (title, body, a, b) => ({
  type: 'frame',
  name: 'Card / ' + title,
  sizing: { w: 'fill', h: 'fill' },
  layout: { gap: 14, padding: 32 },
  style: { fills: [solid('#ffffff')], radius: 20, border: { width: 1, color: LINE }, shadows: [{ x: 0, y: 12, blur: 32, spread: -16, color: '#0c122226' }] },
  children: [
    {
      type: 'frame',
      name: 'Icon',
      width: 44,
      height: 44,
      layout: { direction: 'row', justify: 'center', align: 'center' },
      style: { radius: 12, fills: [{ type: 'linear', angle: 135, stops: [{ color: a, pos: 0 }, { color: b, pos: 100 }] }] },
      children: [{ type: 'frame', name: 'Glyph', width: 16, height: 16, style: { radius: 5, fills: [solid('#ffffff')] } }],
    },
    { type: 'text', name: 'Title', text: { content: title, size: 20, weight: 600, letterSpacing: -0.01, color: INK } },
    { type: 'text', name: 'Body', sizing: { w: 'fill' }, text: { content: body, size: 15, lineHeight: 1.6, color: MUTED } },
  ],
});
const features = (artboardId) => ({
  parent_id: artboardId,
  nodes: [
    {
      type: 'frame',
      name: 'Features',
      sizing: { w: 'fill' },
      layout: { gap: 48, padding: [96, 80], align: 'center' },
      children: [
        {
          type: 'frame',
          name: 'Section header',
          layout: { gap: 12, align: 'center' },
          children: [
            { type: 'text', name: 'Eyebrow', text: { content: 'WHY TEAMS SWITCH', size: 13, weight: 700, letterSpacing: 0.14, color: ACCENT } },
            { type: 'text', name: 'Title', text: { content: 'Monitoring that stays out of your way', font: DISPLAY, size: 44, weight: 700, letterSpacing: -0.025, lineHeight: 1.1, color: INK } },
          ],
        },
        {
          type: 'frame',
          name: 'Cards',
          sizing: { w: 'fill' },
          layout: { direction: 'row', gap: 24, align: 'stretch' },
          children: [
            feature('Checks every 30 seconds', 'HTTP, keyword, SSL expiry, ping and cron heartbeats — from 12 regions, so one flaky network never pages you at 3 AM.', '#22c55e', '#15803d'),
            feature('Alerts the right person', 'On-call schedules, escalations and SMS, Slack or phone calls. Acknowledge from the notification in one tap.', '#38bdf8', '#2563eb'),
            feature('Status pages included', 'A branded page on your own domain that updates itself during incidents, with email updates for subscribers.', '#f59e0b', '#ea580c'),
          ],
        },
      ],
    },
  ],
});

// ---- call 3: stats band + testimonial
const stats = (artboardId) => ({
  parent_id: artboardId,
  nodes: [
    {
      type: 'frame',
      name: 'Proof',
      sizing: { w: 'fill' },
      layout: { direction: 'row', gap: 64, align: 'center', padding: [80, 80] },
      style: { fills: [solid(INK)] },
      children: [
        {
          type: 'frame',
          name: 'Quote',
          sizing: { w: 'fill' },
          layout: { gap: 24 },
          children: [
            { type: 'text', name: 'Quote text', sizing: { w: 'fill' }, text: { content: '“We used to hear about outages from angry tweets. With Pulse we fix them before anyone notices — our support tickets dropped by a third.”', font: DISPLAY, size: 30, weight: 500, lineHeight: 1.35, letterSpacing: -0.01, color: '#ffffff' } },
            {
              type: 'frame',
              name: 'Author',
              layout: { direction: 'row', gap: 14, align: 'center' },
              children: [
                { type: 'frame', name: 'Avatar', width: 44, height: 44, layout: { direction: 'row', justify: 'center', align: 'center' }, style: { radius: 9999, fills: [{ type: 'linear', angle: 135, stops: [{ color: '#f59e0b', pos: 0 }, { color: '#ec4899', pos: 100 }] }] }, children: [label('MR', { size: 15, weight: 700 })] },
                {
                  type: 'frame',
                  name: 'Meta',
                  layout: { gap: 2 },
                  children: [
                    { type: 'text', name: 'Name', text: { content: 'Maya Rodríguez', size: 15, weight: 600, color: '#ffffff' } },
                    { type: 'text', name: 'Role', text: { content: 'Head of Platform, Loop Commerce', size: 14, color: '#94a3b8' } },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'frame',
          name: 'Stats',
          layout: { direction: 'row', gap: 16 },
          children: [
            ['30s', 'check interval'],
            ['12', 'global regions'],
            ['< 60s', 'median time to alert'],
          ].map(([v, l]) => ({
            type: 'frame',
            name: 'Stat / ' + l,
            width: 170,
            layout: { gap: 6, padding: 24 },
            style: { radius: 16, fills: [solid('#ffffff0d')], border: { width: 1, color: '#ffffff1a' } },
            children: [
              { type: 'text', name: 'Value', text: { content: v, font: DISPLAY, size: 40, weight: 700, letterSpacing: -0.03, lineHeight: 1.05, color: '#4ade80' } },
              { type: 'text', name: 'Label', sizing: { w: 'fill' }, text: { content: l, size: 14, color: '#cbd5e1' } },
            ],
          })),
        },
      ],
    },
  ],
});

// ---- call 4: pricing
const plan = (name, price, blurb, items, featured) => ({
  type: 'frame',
  name: 'Plan / ' + name,
  sizing: { w: 'fill' },
  layout: { gap: 24, padding: 32 },
  style: featured
    ? { radius: 24, fills: [{ type: 'linear', angle: 160, stops: [{ color: '#0f2a1d', pos: 0 }, { color: INK, pos: 100 }] }], shadows: [{ x: 0, y: 24, blur: 48, spread: -16, color: '#16a34a55' }] }
    : { radius: 24, fills: [solid('#ffffff')], border: { width: 1, color: LINE } },
  children: [
    {
      type: 'frame',
      name: 'Header',
      sizing: { w: 'fill' },
      layout: { gap: 8 },
      children: [
        { type: 'text', name: 'Plan name', text: { content: name, size: 16, weight: 600, color: featured ? '#4ade80' : ACCENT } },
        {
          type: 'frame',
          name: 'Price',
          layout: { direction: 'row', gap: 6, align: 'flex-end' },
          children: [
            { type: 'text', name: 'Amount', text: { content: price, font: DISPLAY, size: 48, weight: 700, lineHeight: 1, letterSpacing: -0.03, color: featured ? '#ffffff' : INK } },
            { type: 'text', name: 'Per', text: { content: '/ month', size: 15, color: featured ? '#94a3b8' : MUTED } },
          ],
        },
        { type: 'text', name: 'Blurb', sizing: { w: 'fill' }, text: { content: blurb, size: 15, lineHeight: 1.5, color: featured ? '#cbd5e1' : MUTED } },
      ],
    },
    { type: 'frame', name: 'Divider', sizing: { w: 'fill' }, height: 1, style: { fills: [solid(featured ? '#ffffff1f' : LINE)] } },
    {
      type: 'frame',
      name: 'Features',
      sizing: { w: 'fill' },
      layout: { gap: 12 },
      children: items.map((t) => ({
        type: 'frame',
        name: 'Item',
        layout: { direction: 'row', gap: 10, align: 'center' },
        children: [
          { type: 'frame', name: 'Check', width: 18, height: 18, layout: { direction: 'row', justify: 'center', align: 'center' }, style: { radius: 9999, fills: [solid(featured ? '#22c55e40' : '#dcfce7')] }, children: [{ type: 'frame', name: 'Dot', width: 6, height: 6, style: { radius: 9999, fills: [solid(featured ? '#4ade80' : ACCENT)] } }] },
          { type: 'text', name: 'Text', text: { content: t, size: 15, color: featured ? '#e2e8f0' : '#384156' } },
        ],
      })),
    },
    {
      type: 'frame',
      name: featured ? 'Button / Primary' : 'Button / Secondary',
      sizing: { w: 'fill' },
      layout: { direction: 'row', justify: 'center', padding: [14, 22] },
      style: featured ? { radius: 10, fills: [solid(ACCENT)] } : { radius: 10, fills: [solid('#ffffff')], border: { width: 1, color: LINE } },
      children: [label(featured ? 'Start 14-day trial' : 'Choose ' + name, { color: featured ? '#ffffff' : INK })],
    },
  ],
});
const pricing = (artboardId) => ({
  parent_id: artboardId,
  nodes: [
    {
      type: 'frame',
      name: 'Pricing',
      sizing: { w: 'fill' },
      layout: { gap: 48, padding: [112, 80], align: 'center' },
      children: [
        {
          type: 'frame',
          name: 'Section header',
          layout: { gap: 12, align: 'center' },
          children: [
            { type: 'text', name: 'Eyebrow', text: { content: 'PRICING', size: 13, weight: 700, letterSpacing: 0.14, color: ACCENT } },
            { type: 'text', name: 'Title', text: { content: 'Simple plans. Every alert channel included.', font: DISPLAY, size: 44, weight: 700, letterSpacing: -0.025, lineHeight: 1.1, color: INK } },
          ],
        },
        {
          type: 'frame',
          name: 'Plans',
          width: 1080,
          layout: { direction: 'row', gap: 24, align: 'stretch' },
          children: [
            plan('Hobby', '$0', 'For side projects and personal sites.', ['10 monitors', '3-minute checks', 'Email + Slack alerts'], false),
            plan('Team', '$29', 'For product teams who are on call.', ['100 monitors', '30-second checks', 'SMS & phone alerts', 'Branded status page'], true),
            plan('Business', '$99', 'For companies with strict SLAs.', ['500 monitors', 'SSO & audit log', 'Dedicated support'], false),
          ],
        },
      ],
    },
  ],
});

// ---- call 5: CTA + footer
const footer = (artboardId) => ({
  parent_id: artboardId,
  nodes: [
    {
      type: 'frame',
      name: 'CTA',
      sizing: { w: 'fill' },
      layout: { padding: [0, 80, 96, 80] },
      children: [
        {
          type: 'frame',
          name: 'CTA card',
          sizing: { w: 'fill' },
          layout: { direction: 'row', justify: 'space-between', align: 'center', padding: [56, 64] },
          style: {
            radius: 28,
            clip: true,
            fills: [{ type: 'mesh', base: '#15803d', spread: 60, points: [{ color: '#22c55e', x: 10, y: 10 }, { color: '#0ea5e9', x: 90, y: 20 }, { color: '#14532d', x: 20, y: 90 }, { color: '#4ade80', x: 85, y: 90 }] }, { type: 'noise', opacity: 0.18 }],
          },
          children: [
            {
              type: 'frame',
              name: 'Copy',
              layout: { gap: 10 },
              children: [
                { type: 'text', name: 'Title', text: { content: 'Your first 10 monitors are free.', font: DISPLAY, size: 40, weight: 700, letterSpacing: -0.025, color: '#ffffff' } },
                { type: 'text', name: 'Body', text: { content: 'Set up in two minutes. No credit card, no sales call.', size: 18, color: '#dcfce7' } },
              ],
            },
            {
              type: 'frame',
              name: 'Button / Light',
              layout: { direction: 'row', padding: [16, 28] },
              style: { radius: 12, fills: [solid('#ffffff')], shadows: [{ x: 0, y: 12, blur: 24, spread: -8, color: '#052e1666' }] },
              children: [label('Create your account', { color: '#14532d', size: 16 })],
            },
          ],
        },
      ],
    },
    {
      type: 'frame',
      name: 'Footer',
      sizing: { w: 'fill' },
      layout: { direction: 'row', justify: 'space-between', align: 'center', padding: [28, 80] },
      style: { fills: [solid('#eef0f4')] },
      children: [
        { type: 'text', name: 'Copyright', text: { content: '© 2026 Pulse Monitoring, Inc.', size: 14, color: '#6b7280' } },
        { type: 'frame', name: 'Footer links', layout: { direction: 'row', gap: 28 }, children: ['Status', 'Security', 'Privacy', 'Twitter'].map((t) => ({ type: 'text', name: t, text: { content: t, size: 14, color: '#6b7280' } })) },
      ],
    },
  ],
});

// ---- Instagram post (one call)
const insta = {
  parent_id: null,
  nodes: [
    {
      type: 'frame',
      name: 'Instagram — Night Market',
      width: 1080,
      height: 1080,
      layout: { mode: 'none' },
      style: {
        clip: true,
        fills: [
          { type: 'mesh', base: '#120a24', spread: 58, points: [{ color: '#ff4d6d', x: 10, y: 8 }, { color: '#7c3aed', x: 92, y: 14 }, { color: '#f59e0b', x: 14, y: 94 }, { color: '#06b6d4', x: 94, y: 90 }] },
          { type: 'noise', opacity: 0.25 },
        ],
      },
      children: [
        { type: 'frame', name: 'Glow', x: 520, y: 300, width: 560, height: 560, style: { radius: 9999, fills: [solid('#ff7a59')], blur: 140, opacity: 0.5 } },
        { type: 'frame', name: 'Ring', x: 640, y: 90, width: 340, height: 340, style: { radius: 9999, border: { width: 3, color: '#ffffff40' } } },
        {
          type: 'frame',
          name: 'Content',
          x: 0,
          y: 0,
          width: 1080,
          height: 1080,
          layout: { mode: 'flex', direction: 'column', justify: 'space-between', padding: 80 },
          children: [
            {
              type: 'frame',
              name: 'Top row',
              sizing: { w: 'fill' },
              layout: { direction: 'row', justify: 'space-between', align: 'center' },
              children: [
                {
                  type: 'frame',
                  name: 'Pill',
                  layout: { direction: 'row', gap: 12, align: 'center', padding: [12, 22] },
                  style: { radius: 999, fills: [solid('#ffffff1f')], border: { width: 2, color: '#ffffff4d' }, backdropBlur: 10 },
                  children: [
                    { type: 'frame', name: 'Dot', width: 14, height: 14, style: { radius: 9999, fills: [solid('#4ade80')] } },
                    { type: 'text', name: 'Label', text: { content: 'EVERY FRIDAY', size: 24, weight: 700, letterSpacing: 0.16, color: '#ffffff' } },
                  ],
                },
                { type: 'text', name: 'Handle', text: { content: '@harbourmarket', size: 26, weight: 500, color: '#ffffffcc' } },
              ],
            },
            {
              type: 'frame',
              name: 'Message',
              sizing: { w: 'fill' },
              layout: { gap: 28 },
              children: [
                { type: 'text', name: 'Headline', text: { content: 'NIGHT\nMARKET', font: 'Bebas Neue', size: 250, lineHeight: 0.86, color: '#ffffff' } },
                { type: 'text', name: 'Subline', sizing: { w: 'fill' }, text: { content: '60 street-food stalls, live music and late-night makers on Harbour Pier.', font: DISPLAY, size: 36, weight: 600, lineHeight: 1.2, letterSpacing: -0.02, color: '#ffffffe6' } },
              ],
            },
            {
              type: 'frame',
              name: 'Bottom row',
              sizing: { w: 'fill' },
              layout: { direction: 'row', justify: 'space-between', align: 'center' },
              children: [
                {
                  type: 'frame',
                  name: 'CTA pill',
                  layout: { direction: 'row', padding: [24, 40] },
                  style: { radius: 999, fills: [solid('#ffffff')], shadows: [{ x: 0, y: 20, blur: 40, spread: -10, color: '#120a2466' }] },
                  children: [{ type: 'text', name: 'Label', text: { content: 'Fri 6 PM – midnight', size: 30, weight: 700, color: '#120a24' } }],
                },
                { type: 'text', name: 'Price', text: { content: 'Free entry', size: 30, weight: 600, color: '#ffffff' } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

module.exports = { landing1, features, stats, pricing, footer, insta };
