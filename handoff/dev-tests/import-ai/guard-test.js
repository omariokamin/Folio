// Unit tests for import_url's fetcher in mcp/folio-mcp.js: node .dev/import-ai/guard-test.js
process.env.HOME = '/tmp/claude-0/-home-user-folio/30d67173-e7fe-53a5-9734-b219c5d6bd04/scratchpad/guardhome';
delete process.env.FOLIO_ALLOW_LOCAL_FETCH;
const http = require('http');
const zlib = require('zlib');
const { fetchPage, blockedReason } = require('../../mcp/folio-mcp.js');
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let fails = 0;
const ok = (c, m) => { if (!c) fails++; out((c ? 'ok  ' : 'FAIL') + ' ' + m); };
const refuses = async (url, re, m) => {
  try { await fetchPage(url); ok(false, m + ' (was fetched)'); } catch (e) { ok(re.test(e.message), `${m}: ${e.message}`); }
};

const big = Buffer.alloc(3.5 * 1024 * 1024, 'a');
const srv = http.createServer((req, res) => {
  const p = req.url;
  const html = (body, type = 'text/html; charset=utf-8') => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };
  if (p === '/ok') return html('<!doctype html><title>Hi</title><h1>Héllo ✓</h1><p>ua=' + req.headers['user-agent'] + '</p>');
  if (p === '/latin1') return html(Buffer.from('<p>caf\xe9</p>', 'latin1'), 'text/html; charset=windows-1252');
  if (p === '/meta') return html(Buffer.concat([Buffer.from('<meta charset="shift_jis"><p>'), Buffer.from([0x93, 0xfa, 0x96, 0x7b]), Buffer.from('</p>')]), 'text/html');
  if (p === '/badcharset') return html('<p>ok ✓</p>', 'text/html; charset=nonsense-9');
  if (p === '/gzip') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); return res.end(zlib.gzipSync('<p>zipped</p>')); }
  if (p === '/bomb') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); return res.end(zlib.gzipSync(Buffer.alloc(50 * 1024 * 1024, 'b'))); }
  if (p === '/big') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(big); }
  if (p === '/xhtml') return html('<p>x</p>', 'application/xhtml+xml');
  if (p === '/json') return html('{}', 'application/json');
  if (p === '/notype') { res.writeHead(200); return res.end('<p>x</p>'); }
  if (p === '/404') { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('nope'); }
  if (p === '/slow') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write('<p>'); return; } // never ends
  const m = /^\/hop(\d+)$/.exec(p);
  if (m) { const n = +m[1]; res.writeHead(302, { Location: n > 0 ? '/hop' + (n - 1) : '/ok' }); return res.end(); }
  const to = /^\/to\?(.*)$/.exec(p);
  if (to) { res.writeHead(301, { Location: decodeURIComponent(to[1]) }); return res.end(); }
  res.writeHead(500); res.end();
});

(async () => {
  // --- address classification
  const blocked = ['0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255', '169.254.169.254', '127.0.0.1', '127.8.9.10', '100.64.0.1', '100.127.255.255', '224.0.0.1', '255.255.255.255', '::', '::1', '::7f00:1', 'fe80::1', 'febf::1', 'fc00::1', 'fdff::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:192.168.1.1', '::ffff:169.254.169.254', '::ffff:100.64.0.1', '::ffff:a00:1', '::ffff:c0a8:101', 'not-an-ip'];
  blocked.forEach((ip) => ok(!!blockedReason(ip), 'blocked ' + ip));
  ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8', '::ffff:808:808'].forEach((ip) => ok(!blockedReason(ip), 'public ' + ip));

  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const L = `http://127.0.0.1:${port}`;

  // --- without the test flag, the local server is unreachable however it is spelled
  for (const u of [`${L}/ok`, `http://localhost:${port}/ok`, `http://[::1]:${port}/ok`, `http://2130706433:${port}/ok`, `http://0x7f.1:${port}/ok`, `http://[::ffff:127.0.0.1]:${port}/ok`, `http://0.0.0.0:${port}/ok`, 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://100.64.0.1/', 'http://[fd00::1]/', 'http://[fe80::1]/'])
    await refuses(u, /local or private/, 'refused ' + u);
  for (const u of ['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'data:text/html,hi', 'not a url', ''])
    await refuses(u, /only http|not a valid/, 'refused scheme ' + JSON.stringify(u));

  // --- with the test flag: loopback only, everything else still blocked
  process.env.FOLIO_ALLOW_LOCAL_FETCH = '1';
  ok(!blockedReason('127.0.0.1') && !blockedReason('::1'), 'flag allows loopback');
  ok(!!blockedReason('10.0.0.1') && !!blockedReason('169.254.169.254') && !!blockedReason('::ffff:10.0.0.1') && !!blockedReason('fd00::1'), 'flag keeps private ranges blocked');
  let r = await fetchPage(`${L}/ok`);
  ok(r.html.includes('Héllo ✓') && r.url === `${L}/ok` && !r.truncated, 'happy path utf-8');
  ok(/ua=Mozilla\/5\.0 \(Macintosh.*Chrome\/\d/.test(r.html) && !/folio|node/i.test(r.html.split('ua=')[1]), 'browser-like UA: ' + r.html.split('ua=')[1].slice(0, 60));
  r = await fetchPage(`http://localhost:${port}/ok`);
  ok(r.html.includes('Héllo'), 'localhost name resolves to loopback (flag on)');
  r = await fetchPage(`http://user:secret@127.0.0.1:${port}/ok`);
  ok(!r.url.includes('secret'), 'credentials stripped from the final URL: ' + r.url);
  ok((await fetchPage(`${L}/latin1`)).html.includes('café'), 'charset from header (windows-1252)');
  ok((await fetchPage(`${L}/meta`)).html.includes('日本'), 'charset from <meta> (shift_jis)');
  ok((await fetchPage(`${L}/badcharset`)).html.includes('ok ✓'), 'unknown charset falls back to utf-8');
  ok((await fetchPage(`${L}/gzip`)).html.includes('zipped'), 'gzip decoded');
  ok((await fetchPage(`${L}/xhtml`)).html.includes('<p>x</p>'), 'application/xhtml+xml accepted');
  r = await fetchPage(`${L}/big`);
  ok(r.truncated && r.bytes === 3 * 1024 * 1024 && r.html.length === 3 * 1024 * 1024, 'stops at 3 MB: ' + r.bytes);
  r = await fetchPage(`${L}/bomb`);
  ok(r.truncated && r.bytes === 3 * 1024 * 1024, 'gzip bomb capped after decompression');
  await refuses(`${L}/json`, /not a web page/, 'non-HTML type');
  await refuses(`${L}/notype`, /not a web page.*missing/, 'missing type');
  await refuses(`${L}/404`, /HTTP 404/, '404');
  r = await fetchPage(`${L}/hop4`);
  ok(r.url === `${L}/ok` && r.html.includes('Héllo'), '5 redirects followed, final URL ' + r.url);
  await refuses(`${L}/hop5`, /more than 5/, '6 redirects');
  for (const t of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://192.168.0.1/admin', 'http://[::ffff:192.168.0.1]/', 'http://[fc00::1]/', 'http://100.100.100.200/', 'file:///etc/passwd'])
    await refuses(`${L}/to?${encodeURIComponent(t)}`, /local or private|only http/, 'redirect to ' + t);
  const t0 = Date.now();
  await refuses(`${L}/slow`, /within 15 seconds/, 'slow body');
  const took = Date.now() - t0;
  ok(took >= 14500 && took < 17000, `timeout after ${took} ms`);
  srv.close();
  out(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { out('crash', e.stack); process.exit(1); });
