const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {once} = require('node:events');

const project = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ordrum-local-server-'));
const publicDir = path.join(fixture, 'public');
fs.mkdirSync(path.join(fixture, 'scripts'));
fs.mkdirSync(publicDir);
fs.copyFileSync(path.join(project, 'scripts/serve.cjs'), path.join(fixture, 'scripts/serve.cjs'));
for (const file of fs.readdirSync(path.join(project, 'public'))) {
  if (fs.statSync(path.join(project, 'public', file)).isFile()) fs.copyFileSync(path.join(project, 'public', file), path.join(publicDir, file));
}
const protectedMarkup = `<script src="service-worker.js"></script><script src="sync-bridge.js"></script><script src="/api/progress"></script><script src="https://external.example/app.js"></script><link rel="stylesheet" href="https://external.example/style.css"><link rel="manifest" href="manifest.webmanifest"><link rel="preload" as="script" href="app.js"><a href="/signin-with-chatgpt?return_to=%2F">登录</a><a href="./">其他首页链接</a>`;
const original = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8').replace('</head>', protectedMarkup + '</head>');
fs.writeFileSync(path.join(publicDir, 'index.html'), original);
const secret = 'This fixture file is outside public and must never be served.';
fs.writeFileSync(path.join(fixture, 'private.txt'), secret);
fs.mkdirSync(path.join(fixture, 'private'));
fs.writeFileSync(path.join(fixture, 'private/secret.txt'), secret);
fs.symlinkSync(path.join(fixture, 'private.txt'), path.join(publicDir, 'escape.txt'));
fs.symlinkSync(path.join(fixture, 'private'), path.join(publicDir, 'escape-dir'));
fs.writeFileSync(path.join(publicDir, 'empty.css'), '');

let child, output = '', passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
async function unusedPort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

(async () => {
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(fixture, 'scripts/serve.cjs')], {env: {...process.env, ORDRUM_PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Local server exited: ${output}`);
    try { const response = await fetch(base + '/'); await response.arrayBuffer(); if (response.ok) { ready = true; break; } } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.ok(ready, `Local server did not start: ${output}`);
  const token = '1712345678901-123-456';
  let launchHtml;
  await test('canonical root and index preserve the authored PWA shell byte for byte', async () => {
    for (const entry of ['/', '/index.html', '/?source=homescreen']) {
      const response = await fetch(base + entry);
      assert.equal(response.status, 200); assert.equal(await response.text(), original);
      assert.equal(response.headers.get('clear-site-data'), null);
    }
    assert.match(original, /src="app\.js"/);
  });
  await test('a fresh launch loads current relative scripts and styles on the same origin', async () => {
    const response = await fetch(base + '/?launch=' + token);
    launchHtml = await response.text();
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('clear-site-data'), null); assert.equal(response.headers.get('set-cookie'), null);
    for (const file of ['app.js', 'cloud.js', 'github-sync.js', 'study.js', 'session.js', 'pwa.js', 'style.css', 'study.css']) {
      assert.ok(launchHtml.includes(`"${file}?launch=${token}"`), file);
      const asset = await fetch(`${base}/${file}?launch=${token}`);
      assert.equal(asset.status, 200); assert.equal(await asset.text(), fs.readFileSync(path.join(publicDir, file), 'utf8'));
      assert.equal(new URL(asset.url).origin, base);
    }
  });
  await test('only the brand home link retains the fresh-launch token', async () => {
    assert.match(launchHtml, new RegExp(`class="brand" href="\\./\\?launch=${token}"`));
    assert.ok(launchHtml.includes('<a href="./">其他首页链接</a>'));
    assert.ok((await (await fetch(`${base}/index.html?launch=${token}`)).text()).includes(`href="./?launch=${token}"`));
  });
  await test('fresh launch leaves worker, bridge, authentication and external URLs unchanged', async () => {
    assert.ok(launchHtml.includes(protectedMarkup));
    assert.ok(!launchHtml.includes(`service-worker.js?launch=${token}`));
    assert.ok(!launchHtml.includes(`sync-bridge.js?launch=${token}`));
    const pwa = await (await fetch(`${base}/pwa.js?launch=${token}`)).text();
    assert.ok(pwa.includes("register('service-worker.js'"));
    const worker = await (await fetch(`${base}/service-worker.js?launch=${token}`)).text();
    assert.equal(worker, fs.readFileSync(path.join(publicDir, 'service-worker.js'), 'utf8'));
  });
  await test('launch tokens are bounded, non-reflective and reject duplicate values', async () => {
    for (const query of ['launch=', 'launch=' + 'x'.repeat(65), 'launch=%22%3E%3Csvg%3E', 'launch=two%20words', 'launch=a&launch=b', 'launch=a%26b']) {
      const response = await fetch(base + '/?' + query);
      assert.equal(response.status, 400, query); assert.ok(!(await response.text()).includes('<svg>'));
    }
    assert.equal((await fetch(base + '/app.js?launch=%22bad')).status, 400);
    assert.equal((await fetch(base + '/?launch=' + 'x'.repeat(64))).status, 200);
  });
  await test('fresh HTML HEAD and byte ranges use the rewritten byte length', async () => {
    const expected = Buffer.from(launchHtml);
    const head = await fetch(`${base}/?launch=${token}`, {method: 'HEAD'});
    assert.equal(Number(head.headers.get('content-length')), expected.length); assert.equal((await head.text()).length, 0);
    const partial = await fetch(`${base}/?launch=${token}`, {headers: {Range: 'bytes=0-63'}});
    assert.equal(partial.status, 206); assert.deepEqual(Buffer.from(await partial.arrayBuffer()), expected.subarray(0, 64));
    assert.equal((await fetch(base + '/empty.css')).status, 200);
  });
  await test('launch queries cannot bypass traversal or symlink boundaries', async () => {
    for (const entry of ['/..%2fprivate.txt', '/escape.txt', '/escape-dir/secret.txt', '/.git/config']) {
      const response = await fetch(`${base}${entry}?launch=${token}`);
      assert.ok([403, 404].includes(response.status), entry); assert.ok(!(await response.text()).includes(secret));
    }
    const denied = await fetch(base + '/', {method: 'POST'}); assert.equal(denied.status, 405);
  });
  await test('the Mac launcher opens a unique fresh Node URL and documents Python fallback', () => {
    const launcher = fs.readFileSync(path.join(project, '启动网页.command'), 'utf8');
    assert.match(launcher, /launch_token="\$\(date \+%s\)-\$\$-\$RANDOM"/);
    assert.ok(launcher.includes('open_url="$url/?launch=$launch_token"'));
    assert.ok(launcher.includes('/usr/bin/open "$open_url"'));
    assert.ok(launcher.includes('--directory public')); assert.ok(launcher.includes('当前使用 Python 启动'));
  });
  console.log(`\n${passed} local server checks passed.`);
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(async () => {
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  fs.rmSync(fixture, {recursive: true, force: true});
});
