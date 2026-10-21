// Export the static learning app only; the authenticated API stays on Sites.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const project = path.resolve(__dirname, '..');
const source = path.join(project, 'public');
const parent = path.join(project, 'outputs');
const output = path.join(parent, 'github-pages');
const extensions = new Set(['.html', '.css', '.js', '.json', '.webmanifest', '.md', '.svg', '.png', '.ico', '.m4a', '.mp3']);

function exportPages() {
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error('The public source must not be a symlink.');
  const files = [];
  function collect(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlinks cannot be exported: ${name}`);
      if (entry.name.startsWith('.') || entry.name.toUpperCase() === 'CNAME' || name === 'sync-bridge.js') continue;
      if (entry.isDirectory()) collect(file, name);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) files.push(name);
    }
  }
  collect(source);
  if (!files.includes('index.html') || !files.includes('service-worker.js')) throw new Error('The learning app shell is missing.');
  // The only replaceable directory is this project's generated Pages artifact.
  if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('The output parent must not be a symlink.');
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error('The output directory must not be a symlink.');
  fs.mkdirSync(parent, {recursive: true});
  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output);
  for (const name of files) {
    const destination = path.join(output, name);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(path.join(source, name), destination);
  }
  fs.writeFileSync(path.join(output, '.nojekyll'), '');

  // Fingerprint the exported shell without changing authored public/ files.
  const workerPath = path.join(output, 'service-worker.js');
  const worker = fs.readFileSync(workerPath, 'utf8');
  const list = worker.match(/const CORE_FILES = (\[[\s\S]*?\]);/)?.[1];
  if (!list) throw new Error('Missing offline shell asset list.');
  const hash = crypto.createHash('sha256');
  for (const match of list.matchAll(/'([^']+)'/g)) {
    const name = match[1];
    if (path.isAbsolute(name) || name.split('/').includes('..')) throw new Error('Invalid offline shell asset path.');
    hash.update(name + '\0');
    hash.update(fs.readFileSync(path.join(output, name)));
  }
  hash.update(worker.replace(/const BUILD_ID = '[^']+';/, "const BUILD_ID = '';"));
  const build = hash.digest('hex').slice(0, 16);
  fs.writeFileSync(workerPath, worker.replace(/const BUILD_ID = '[^']+';/, `const BUILD_ID = '${build}';`));
  return {directory: output, files: files.length + 1, build};
}

if (require.main === module) {
  if (process.argv.length > 2) throw new Error('export-pages.cjs takes no arguments.');
  const result = exportPages();
  console.log(`GitHub Pages artifact: ${result.directory} (${result.files} files, offline shell ${result.build})`);
}
module.exports = {exportPages};
