// Stamp a new coherent offline-shell version whenever its source assets change.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../public');
const workerPath=path.join(root,'service-worker.js');
const source=fs.readFileSync(workerPath,'utf8');
const listSource=source.match(/const CORE_FILES = (\[[\s\S]*?\]);/)?.[1];
if (!listSource) throw new Error('Missing PWA static-shell list.');
const files=Array.from(listSource.matchAll(/'([^']+)'/g),match=>match[1]);
const hash=crypto.createHash('sha256');
for (const file of files) {hash.update(file+'\0');hash.update(fs.readFileSync(path.join(root,file)));}
hash.update(source.replace(/const BUILD_ID = '[^']+';/,"const BUILD_ID = '';"));
const build=hash.digest('hex').slice(0,16);
const updated=source.replace(/const BUILD_ID = '[^']+';/,`const BUILD_ID = '${build}';`);
if (source !== updated) fs.writeFileSync(workerPath,updated);
console.log(`Offline shell version: ${build}`);
