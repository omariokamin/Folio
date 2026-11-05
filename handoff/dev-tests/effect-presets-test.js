// Claude's {"effect":"liquid-glass"} / {"type":"mesh","preset":…} must equal the inspector's preset buttons.
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8191';
const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(base + '/index.html'); await p.waitForTimeout(900);
  const r = await p.evaluate(async () => {
    const s = Folio.store; s.newDoc(); s.commit('fresh');
    const run = (n, i) => Folio.aiTools.execute(n, i);
    const res = await run('create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Bg', width: 600, height: 400, style: { fills: [{ type: 'mesh', preset: 'lagoon' }, { type: 'noise', opacity: 0.12 }] }, children: [
      { type: 'frame', name: 'AI glass', width: 200, height: 120, style: { effect: 'liquid-glass' } },
      { type: 'frame', name: 'AI glass r12', width: 200, height: 120, style: { effect: 'dark-glass', radius: 12 } },
      { type: 'frame', name: 'UI glass', width: 200, height: 120 },
      { type: 'frame', name: 'Bad', width: 10, height: 10, style: { effect: 'sparkles', fills: [{ type: 'mesh', preset: 'Nope' }] } }] }] });
    const by = (n) => Object.values(s.doc.nodes).find((x) => x.name === n);
    const strip = (st) => JSON.stringify({ fills: st.fills, backdropBlur: st.backdropBlur, backdropSaturate: st.backdropSaturate, border: st.border, shadows: st.shadows, radius: st.radius });
    // click the inspector's Liquid glass button on "UI glass"
    s.select([by('UI glass').id]); await new Promise((r) => setTimeout(r, 300));
    const btn = [...document.querySelectorAll('.ins-glass__btn')].find((e) => /Liquid glass/.test(e.textContent));
    if (btn) btn.click(); await new Promise((r) => setTimeout(r, 200));
    const lag = Folio.effects.mesh('Lagoon');
    return {
      warn: JSON.stringify(res.content),
      bgMesh: JSON.stringify(by('Bg').style.fills[0].points) === JSON.stringify(lag.points) && by('Bg').style.fills[0].base === lag.base,
      same: strip(by('AI glass').style) === strip(by('UI glass').style),
      ai: strip(by('AI glass').style), ui: strip(by('UI glass').style),
      r12: by('AI glass r12').style.radius, dark: by('AI glass r12').style.fills[0].stops[0].color,
      btn: !!btn,
    };
  });
  check(r.bgMesh, 'mesh preset "lagoon" expands to the Lagoon preset');
  check(r.btn, 'inspector shows the Liquid glass button');
  check(r.same, 'Claude\'s liquid-glass equals the inspector button' + (r.same ? '' : `\n  ai=${r.ai}\n  ui=${r.ui}`));
  check(r.r12 === 12 && r.dark === '#ffffff1f', 'dark-glass applies and an explicit radius overrides');
  check(/sparkles/.test(r.warn) && /Nope/.test(r.warn), 'unknown effect and preset are warned about');
  await b.close();
})();
