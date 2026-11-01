#!/usr/bin/env node
/* Runs every browser test against a local copy of the app.
 *   node tests/e2e/run.js          (needs: npm install, npx playwright install chromium)
 * Serves the repo on http://localhost:8768 and fails if any check fails or any page error appears. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..'), PORT = 8768;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
function runSuite(file) {
  // async, so the server above keeps answering while the suite runs
  return new Promise(resolve => {
    const ch = spawn(process.execPath, [path.join(__dirname, file)], { env: process.env });
    let out = '';
    ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => ch.kill('SIGKILL'), 300000);
    ch.on('close', code => { clearTimeout(t); resolve({ code, out }); });
  });
}
server.listen(PORT, async () => {
  const suites = fs.readdirSync(__dirname).filter(f => f.endsWith('.e2e.js')).sort();
  let bad = 0;
  for (const f of suites) {
    const { code, out } = await runSuite(f);
    const oks = (out.match(/^ok -/gm) || []).length;
    const failed = code !== 0 || /^FAIL|CHECK FAILED|^ERRORS:|Error:|TimeoutError/m.test(out) || oks === 0;
    if (failed) { bad++; console.log('FAIL ' + f + ' (' + oks + ' checks passed)\n' + out.split('\n').filter(l => !/^ok -/.test(l)).slice(0, 30).join('\n')); }
    else console.log('ok   ' + f + ' (' + oks + ' checks)');
  }
  server.close();
  console.log(bad ? bad + ' browser suite(s) failed' : 'all browser suites passed');
  process.exit(bad ? 1 : 0);
});
