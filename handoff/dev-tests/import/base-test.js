const { open, ok, fails } = require('./harness');
(async () => {
  const { browser, page } = await open();
  const r = await page.evaluate(async () => {
    const m = Folio.importer.sanitize('<img src="a.png"><p>x</p>', 'https://example.com/dir/');
    const res = await Folio.importer.fromHtml('<img src="img/a.png" width="40" height="40"><div style="width:30px;height:30px;background:url(b.png)"></div>', { baseUrl: 'https://example.com/dir/' });
    const S = Folio.store;
    const ns = S.descendants(res.rootId).map((i) => S.get(i));
    return { base: /<base href="https:\/\/example.com\/dir\/">/.test(m), img: ns.filter((n) => n.type === 'image').map((n) => n.image.src), fill: ns.flatMap((n) => n.style.fills.filter((f) => f.type === 'image').map((f) => f.src)) };
  });
  ok(r.base, 'base URL survives sanitising');
  ok(r.img[0] === 'https://example.com/dir/img/a.png' && r.fill[0] === 'https://example.com/dir/b.png', 'relative image URLs resolve against the base URL', r);
  await browser.close();
  process.exit(fails() ? 1 : 0);
})();
