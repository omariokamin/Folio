  // Hero example: left-aligned copy, flat primary button plus a text link, a believable UI fragment as the visual.
  const pill = (name, label, bg, ink) => ({ type: 'frame', name, layout: { padding: [4, 10] }, style: { fills: [{ type: 'solid', color: bg }], radius: 9999 }, children: [{ type: 'text', name: 'Label', text: { content: label, size: 13, weight: 500, color: ink } }] });
  const row = (client, amount, status, selected) => ({
    type: 'frame',
    name: 'Row',
    sizing: { w: 'fill' },
    layout: { direction: 'row', gap: 16, align: 'center', padding: [14, 16] },
    ...(selected ? { style: { radius: 10, fills: [{ type: 'solid', color: '#f4f3ef' }] } } : {}),
    children: [
      { type: 'text', name: 'Client', sizing: { w: 'fill' }, text: { content: client, size: 15, weight: 500 } },
      { type: 'text', name: 'Amount', text: { content: amount, size: 15 } },
      status,
    ],
  });
  const EXAMPLE = {
    type: 'frame',
    name: 'Hero',
    sizing: { w: 'fill' },
    layout: { direction: 'row', gap: 72, align: 'center', padding: [112, 80, 128, 80] },
    style: { fills: [{ type: 'solid', color: '#f4f3ef' }] },
    children: [
      {
        type: 'frame',
        name: 'Copy',
        sizing: { w: 'fill' },
        layout: { gap: 40 },
        children: [
          { type: 'text', name: 'Headline', sizing: { w: 'fill' }, text: { content: 'Get paid without\nchasing clients', font: 'Bricolage Grotesque', size: 76, weight: 500, lineHeight: 1, letterSpacing: -0.035, color: '#16181d' } },
          { type: 'text', name: 'Supporting line', sizing: { w: 'fill' }, text: { content: 'Ledgerly sends polite reminders on your schedule and matches every payment to its invoice. Built for design studios.', font: 'Bricolage Grotesque', size: 20, lineHeight: 1.5, color: '#55585f' } },
          {
            type: 'frame',
            name: 'Actions',
            layout: { direction: 'row', gap: 28, align: 'center' },
            children: [
              { type: 'frame', name: 'Button / Primary', layout: { direction: 'row', align: 'center', padding: [14, 22] }, style: { fills: [{ type: 'solid', color: '#16181d' }], radius: 8 }, children: [{ type: 'text', name: 'Label', text: { content: 'Send an invoice', font: 'Bricolage Grotesque', size: 16, weight: 600, color: '#ffffff' } }] },
              { type: 'text', name: 'Link', text: { content: 'See pricing', font: 'Bricolage Grotesque', size: 16, weight: 500, color: '#16181d', decoration: 'underline' } },
            ],
          },
        ],
      },
      {
        type: 'frame',
        name: 'Invoices',
        width: 540,
        layout: { gap: 4, padding: 16 },
        style: { fills: [{ type: 'solid', color: '#ffffff' }], radius: 16 },
        children: [
          row('Hollis & Pine', '$4,200', pill('Status', 'Paid', '#dcfae5', '#04250e')),
          row('Northfield Co.', '$2,400', pill('Status', 'Overdue', '#fde4dc', '#5c1608'), true),
          {
            type: 'frame',
            name: 'Total',
            sizing: { w: 'fill' },
            layout: { direction: 'row', justify: 'space-between', padding: 16 },
            children: [
              { type: 'text', name: 'Label', text: { content: 'Outstanding', size: 15, color: '#55585f' } },
              { type: 'text', name: 'Value', text: { content: '$2,400', size: 15, weight: 600 } },
            ],
          },
        ],
      },
    ],
  };
