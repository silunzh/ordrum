const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {exportPages} = require('../scripts/export-pages.cjs');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public');
const before = fs.readFileSync(path.join(source, 'service-worker.js'));
const result = exportPages();
const output = result.directory;
const base = 'https://silunzh.github.io/ordrum/';
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

test('Pages exports static learning assets and attribution without server or runtime files', () => {
  for (const name of ['index.html', 'app.js', 'plan.js', 'plan.css', 'plan-core.js', 'plan-session.js', 'github-sync.js', 'vocab.json', 'audio-map.json', 'DICTIONARY-SOURCES.md', 'dictionary-provenance.json', 'audio-provenance.json', '.nojekyll']) assert.ok(fs.existsSync(path.join(output, name)), name);
  for (const name of ['sync-bridge.js', 'local-sync.js', 'progress.json', 'CNAME', '.openai', '.git', '.wrangler', 'app', 'db', 'drizzle', 'package.json', 'node_modules']) assert.ok(!fs.existsSync(path.join(output, name)), name);
  assert.deepEqual(fs.readFileSync(path.join(source, 'service-worker.js')), before);
  const vocabulary = JSON.parse(fs.readFileSync(path.join(output, 'vocab.json')));
  assert.equal(vocabulary.words.length, 1332); assert.equal(vocabulary.chapters.length, 20);
  assert.equal(fs.readdirSync(path.join(output, 'audio')).length, 1065);
});

test('all HTML asset references resolve inside the independent /ordrum/ project site', () => {
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
    const url = new URL(match[1], base);
    assert.equal(url.origin, new URL(base).origin); assert.ok(url.pathname.startsWith('/ordrum/'), match[1]);
    assert.ok(fs.statSync(path.join(output, url.pathname.slice('/ordrum/'.length))).isFile(), match[1]);
  }
  assert.match(html, /class="brand" href="\.\/"/);
  assert.ok(!html.includes('<base '));
});

test('manifest identity, launch URL, scope and icons stay under /ordrum/', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.webmanifest')));
  for (const value of [manifest.id, manifest.start_url, manifest.scope, ...manifest.icons.map(icon => icon.src)]) {
    const url = new URL(value, base);
    assert.equal(url.origin, new URL(base).origin); assert.ok(url.pathname.startsWith('/ordrum/'), value);
  }
  assert.equal(new URL(manifest.scope, base).pathname, '/ordrum/');
  assert.equal(new URL(manifest.start_url, base).pathname, '/ordrum/');
});

test('service worker registration and cached shell never claim the personal homepage', () => {
  const pwa = fs.readFileSync(path.join(output, 'pwa.js'), 'utf8');
  assert.ok(pwa.includes("register('service-worker.js',{scope:'./'"));
  const worker = fs.readFileSync(path.join(output, 'service-worker.js'), 'utf8');
  const context = {URL, Set, self: {location: {href: base + 'service-worker.js'}, addEventListener() {}}};
  vm.createContext(context); vm.runInContext(worker, context);
  const urls = vm.runInContext('Array.from(CORE_URLS)', context);
  assert.ok(urls.includes(base));
  for (const url of urls) { assert.ok(url.startsWith(base), url); assert.notEqual(new URL(url).pathname, '/'); }
  assert.equal(vm.runInContext(`isAppNavigation(new URL('${base}'),{mode:'navigate'})`, context), true);
  assert.equal(vm.runInContext(`isAppNavigation(new URL('https://silunzh.github.io/'),{mode:'navigate'})`, context), false);
  assert.ok(!urls.some(url => /api\/progress|sync-bridge|signin-with-chatgpt/.test(url)));
});

test('the exported service-worker fingerprint matches its exact static assets', () => {
  const worker = fs.readFileSync(path.join(output, 'service-worker.js'), 'utf8');
  const list = worker.match(/const CORE_FILES = (\[[\s\S]*?\]);/)[1];
  const hash = crypto.createHash('sha256');
  for (const match of list.matchAll(/'([^']+)'/g)) { hash.update(match[1] + '\0'); hash.update(fs.readFileSync(path.join(output, match[1]))); }
  hash.update(worker.replace(/const BUILD_ID = '[^']+';/, "const BUILD_ID = '';"));
  assert.equal(worker.match(/const BUILD_ID = '([^']+)'/)[1], hash.digest('hex').slice(0, 16));
});

test('deployment workflow is scoped to this repository and pins official Pages actions', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.ok(workflow.includes('path: outputs/github-pages')); assert.ok(workflow.includes('needs: build'));
  assert.ok(workflow.includes('pages: write')); assert.ok(workflow.includes('id-token: write'));
  assert.ok(workflow.includes('name: github-pages')); assert.ok(workflow.includes('persist-credentials: false'));
  const actions = [...workflow.matchAll(/uses: (actions\/[\w-]+)@([a-f0-9]{40})/g)];
  assert.equal(actions.length, 5);
  assert.ok(!/secrets\.|CNAME|SilunZhang\.github\.io|repository:\s|git push|site-workflow/.test(workflow));
});

console.log(`\n${passed} GitHub Pages checks passed.`);
