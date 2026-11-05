const { open } = require('./harness');
(async () => {
  const { browser, page, logs } = await open();
  const r = await page.evaluate(async () => {
    try { await document.fonts.load('700 16px "Inter"'); } catch (e) {}
    const res = await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap').then(r => r.status).catch(e => 'ERR ' + e.message);
    return { inter: document.fonts.check('700 16px "Inter"'), fetch: res };
  });
  console.log(r, logs.slice(0, 10));
  await browser.close();
})();
