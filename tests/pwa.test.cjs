const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../public');
const workerSource=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
const base='https://ordrum.example/';
const audioURL=base+'audio/0123456789abcdef.m4a';
const pngSize=file=>{const bytes=fs.readFileSync(path.join(root,file));assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];};
const typeFor=url=>url===base?'text/html':({js:'application/javascript',css:'text/css',json:'application/json',webmanifest:'application/manifest+json',png:'image/png',svg:'image/svg+xml',m4a:'audio/mp4',html:'text/html'}[new URL(url).pathname.split('.').pop()]||'application/octet-stream');
function resource(url,body,headers={},extra={}) {
  const response=new Response(body===undefined?(url===base||url.endsWith('index.html')?'<main id="mode-content"></main><script src="app.js"></script>':`version-one:${url}`):body,{headers:{'content-type':typeFor(url),...headers},status:extra.status||200});
  for(const key of ['url','redirected','type'])if(key in extra||key==='url')Object.defineProperty(response,key,{value:extra[key]??url});
  return response;
}
function worker({network}={}) {
  const handlers=new Map(),stores=new Map(),fetches=[];
  let skipped=0,claimed=0,offline=false;
  const key=request=>typeof request==='string'?new URL(request,base).href:request.url;
  const caches={
    async open(name){if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);return {
      async put(request,response){if(response.status===206)throw new TypeError('Cache API rejects partial responses');entries.set(key(request),response.clone());},
      async match(request){return entries.get(key(request))?.clone();},
      async keys(){return [...entries.keys()].map(url=>new Request(url));},
    };},
    async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);},
  };
  const self={location:{href:base+'service-worker.js'},addEventListener(type,fn){handlers.set(type,fn);},clients:{async claim(){claimed++;}},async skipWaiting(){skipped++;}};
  const sandbox={self,caches,Request,Response,Headers,URL,Set,console,fetch:async request=>{
    const url=key(request);fetches.push({url,request});if(offline)throw new TypeError('offline');
    return network?network(url,request):resource(url);
  }};
  vm.createContext(sandbox);vm.runInContext(workerSource,sandbox,{filename:path.join(root,'service-worker.js')});
  async function event(type,extra={}) {const waits=[];const value={...extra,waitUntil(promise){waits.push(Promise.resolve(promise));}};handlers.get(type)(value);await Promise.all(waits);return value;}
  async function fetchEvent(url,{method='GET',mode='cors',headers={}}={}) {
    const request=new Request(new URL(url,base),{method,headers});Object.defineProperty(request,'mode',{value:mode});
    let response;const waits=[];
    handlers.get('fetch')({request,respondWith(value){response=Promise.resolve(value);},waitUntil(value){waits.push(Promise.resolve(value));}});
    const result=response?await response:undefined;await Promise.all(waits);return result;
  }
  return {stores,caches,fetches,event,fetchEvent,get skipped(){return skipped;},get claimed(){return claimed;},set offline(value){offline=value;}};
}
function client({secure=true,controlled=true}={}) {
  const nodes=new Map(),windowEvents=new Map(),workerEvents=new Map(),messages=[],saved=[];
  let reloads=0,registrations=0;
  function node(tag='div') {
    const events=new Map();return {tag,id:'',children:[],open:false,textContent:'',innerHTML:'',
      setAttribute(){},append(...values){this.children.push(...values);},addEventListener(type,fn){events.set(type,fn);},
      click(){events.get('click')?.({target:this});},remove(){nodes.delete(this.id);},showModal(){this.open=true;},close(){this.open=false;},
    };
  }
  nodes.set('install-app-button',node('button'));
  const document={getElementById:id=>nodes.get(id)||null,createElement:node,body:{appendChild(value){nodes.set(value.id,value);}},addEventListener(){},visibilityState:'visible'};
  const registration={waiting:{postMessage(value){messages.push(value);}},active:null,addEventListener(){},async update(){}};
  const serviceWorker={controller:controlled?{}:null,async register(){registrations++;return registration;},addEventListener(type,fn){workerEvents.set(type,fn);},ready:Promise.resolve(registration)};
  const navigator={serviceWorker,standalone:false};
  const window={navigator,isSecureContext:secure,matchMedia:()=>({matches:false}),addEventListener(type,fn){windowEvents.set(type,fn);},dispatchEvent(event){saved.push(event.type);windowEvents.get(event.type)?.(event);}};
  const sandbox={window,navigator,document,Event,location:{reload(){reloads++;}},console};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'pwa.js'),'utf8'),sandbox,{filename:path.join(root,'pwa.js')});
  return {window,nodes,messages,saved,workerEvents,get reloads(){return reloads;},get registrations(){return registrations;}};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
(async()=>{
  await test('manifest opens as a standalone app with correctly sized iPhone and app icons',()=>{
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
    assert.equal(manifest.display,'standalone');assert.equal(new URL(manifest.start_url,base).origin,new URL(base).origin);
    assert.equal(new URL(manifest.start_url,base).pathname,'/');assert.equal(manifest.scope,'./');
    for(const icon of manifest.icons){const expected=icon.sizes.split('x').map(Number);assert.deepEqual(pngSize(icon.src),expected);}
    assert.deepEqual(pngSize('icons/apple-touch-icon.png'),[180,180]);
    assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'&&icon.sizes==='512x512'));
    const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
    assert.match(html,/rel="manifest"[^>]*href="manifest.webmanifest"/);assert.match(html,/rel="apple-touch-icon"/);assert.match(html,/viewport-fit=cover/);
  });
  await test('the offline build fingerprint covers every currently shipped shell asset',()=>{
    const build=workerSource.match(/const BUILD_ID = '([^']+)'/)[1];
    const files=[...workerSource.match(/const CORE_FILES = (\[[\s\S]*?\]);/)[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
    const hash=crypto.createHash('sha256');
    for(const file of files){assert.ok(fs.existsSync(path.join(root,file)),file);hash.update(file+'\0');hash.update(fs.readFileSync(path.join(root,file)));}
    hash.update(workerSource.replace(/const BUILD_ID = '[^']+';/,"const BUILD_ID = '';"));
    assert.equal(build,hash.digest('hex').slice(0,16),'run the version stamp after changing the static shell');
  });
  await test('a complete shell installs without activating itself or preloading all audio',async()=>{
    const sw=worker();await sw.event('install');
    assert.equal(sw.skipped,0);assert.equal(sw.claimed,0);
    const cache=[...sw.stores.entries()].find(([name])=>name.startsWith('ordrum-shell-'))[1];
    assert.ok(cache.has(base));assert.ok(cache.has(base+'vocab.json'));assert.ok(cache.has(base+'cloud.js'));
    assert.ok(sw.fetches.every(({url})=>!url.includes('/audio/')));
  });
  await test('offline installation fetches the canonical root directly when the host redirects index.html',async()=>{
    const sw=worker({network:url=>url===base+'index.html'
      ?resource(url,'redirect',{'location':'/'},{status:307})
      :resource(url,undefined,url===base?{'cache-control':'public, max-age=0, must-revalidate'}:{})});
    await sw.event('install');
    assert.ok(sw.fetches.some(({url})=>url===base));
    assert.equal(sw.fetches.some(({url})=>url===base+'index.html'),false);
    const cache=[...sw.stores.entries()].find(([name])=>name.startsWith('ordrum-shell-'))[1];
    assert.ok(cache.has(base));assert.equal(cache.has(base+'index.html'),false);
    sw.offline=true;
    const response=await sw.fetchEvent(base+'?source=homescreen',{mode:'navigate'});
    assert.equal(response.status,200);assert.match(await response.text(),/id="mode-content"/);
  });
  await test('a failed install preserves the previous version and leaves no partial new shell',async()=>{
    const sw=worker({network:url=>url.endsWith('app.js')?resource(url,'unavailable',{}, {status:503}):resource(url)});
    await (await sw.caches.open('ordrum-shell-older')).put(base,resource(base,'old version'));
    await assert.rejects(sw.event('install'));
    assert.deepEqual([...sw.stores.keys()],['ordrum-shell-older']);assert.equal(sw.skipped,0);
  });
  await test('a sign-in page returned as the application shell is never cached',async()=>{
    const sw=worker({network:url=>resource(url,url===base?'<form>Sign in to your account</form>':undefined)});
    await assert.rejects(sw.event('install'));assert.equal(sw.stores.size,0);
  });
  await test('redirected, private or no-store shell responses reject offline installation',async()=>{
    for(const special of [{headers:{'cache-control':'private'}},{headers:{'cache-control':'no-store'}},{extra:{redirected:true,url:base+'signin-with-chatgpt'}},{headers:{'content-type':'text/html'}}]){
      const target=special.headers?.['content-type']?base+'app.js':base;
      const sw=worker({network:url=>url===target?resource(url,undefined,special.headers||{},special.extra||{}):resource(url)});
      await assert.rejects(sw.event('install'));assert.equal(sw.stores.size,0);
    }
  });
  await test('activation removes only obsolete Ordrum shell caches and retains downloaded audio',async()=>{
    const sw=worker();await sw.event('install');await sw.caches.open('ordrum-shell-old');await sw.caches.open('ordrum-audio-v1');await sw.caches.open('unrelated-app-cache');
    await sw.event('activate');assert.equal(sw.claimed,1);
    assert.equal(sw.stores.has('ordrum-shell-old'),false);assert.ok(sw.stores.has('ordrum-audio-v1'));assert.ok(sw.stores.has('unrelated-app-cache'));
  });
  await test('offline home-screen and browser navigation use the same complete shell version',async()=>{
    const sw=worker();await sw.event('install');const count=sw.fetches.length;sw.offline=true;
    for(const url of [base,base+'?source=homescreen',base+'index.html']){
      const response=await sw.fetchEvent(url,{mode:'navigate'});assert.equal(response.status,200);assert.match(await response.text(),/id="mode-content"/);
    }
    assert.match(await (await sw.fetchEvent(base+'app.js')).text(),/version-one/);assert.equal(sw.fetches.length,count);
  });
  await test('API, progress, account bridges, sign-in, callback and token-bearing navigation bypass the worker entirely',async()=>{
    const sw=worker();await sw.event('install');const count=sw.fetches.length;
    for(const url of ['/api/progress','/api/progress?revision=3','/progress','/sync-bridge','/sync-bridge?origin=http%3A%2F%2F127.0.0.1%3A8765&channel='+('c'.repeat(64)),'/sync-bridge.js','/signin-with-chatgpt','/signout-with-chatgpt','/callback?code=secret','/?auth=secret','/index.html?token=secret','/account','https://other.example/app.js']){
      assert.equal(await sw.fetchEvent(url,{mode:'navigate'}),undefined,url);
    }
    assert.equal(sw.fetches.length,count);
  });
  await test('fresh local launches bypass an installed shell and its stale scripts without clearing caches',async()=>{
    const sw=worker();await sw.event('install');const count=sw.fetches.length;
    const storesBefore=[...sw.stores.keys()];
    assert.equal(await sw.fetchEvent('/?launch=20261021-123-456',{mode:'navigate'}),undefined);
    for(const file of ['app.js','local-sync.js','cloud.js','study.js','session.js','pwa.js','style.css','study.css']) {
      assert.equal(await sw.fetchEvent(`/${file}?launch=20261021-123-456`),undefined,file);
    }
    assert.equal(sw.fetches.length,count);assert.deepEqual([...sw.stores.keys()],storesBefore);
    assert.match(await (await sw.fetchEvent('/app.js')).text(),/version-one/);
  });
  await test('authorized and non-GET requests bypass even allowlisted cached files',async()=>{
    const sw=worker();await sw.event('install');const count=sw.fetches.length;
    assert.equal(await sw.fetchEvent(base+'app.js',{headers:{Authorization:'Bearer test-only'}}),undefined);
    assert.equal(await sw.fetchEvent(audioURL,{headers:{Authorization:'Bearer test-only'}}),undefined);
    assert.equal(await sw.fetchEvent('/api/progress',{method:'POST'}),undefined);assert.equal(sw.fetches.length,count);
  });
  await test('successful audio is cached completely and can be replayed offline',async()=>{
    const bytes=new Uint8Array([0,1,2,3,4,5,6,7,8,9]);const sw=worker({network:url=>resource(url,bytes)});
    const first=await sw.fetchEvent(audioURL);assert.equal(first.status,200);assert.deepEqual([...new Uint8Array(await first.arrayBuffer())],[...bytes]);
    sw.offline=true;const cached=await sw.fetchEvent(audioURL);assert.equal(cached.status,200);assert.equal(sw.fetches.length,1);
  });
  await test('iPhone probe ranges fetch one complete clip and return exact 206 bytes',async()=>{
    const sw=worker({network:url=>resource(url,new Uint8Array([0,1,2,3,4,5,6,7,8,9]))});
    const first=await sw.fetchEvent(audioURL,{headers:{Range:'bytes=0-1'}});
    assert.equal(sw.fetches[0].request.headers.has('Range'),false);assert.equal(first.status,206);
    assert.equal(first.headers.get('content-range'),'bytes 0-1/10');assert.equal(first.headers.get('content-length'),'2');
    assert.deepEqual([...new Uint8Array(await first.arrayBuffer())],[0,1]);sw.offline=true;
    const later=await sw.fetchEvent(audioURL,{headers:{Range:'bytes=2-'}});assert.equal(later.status,206);assert.deepEqual([...new Uint8Array(await later.arrayBuffer())],[2,3,4,5,6,7,8,9]);
    assert.equal(sw.fetches.length,1);
  });
  await test('cached audio supports suffix ranges and rejects unsatisfiable ranges',async()=>{
    const sw=worker({network:url=>resource(url,new Uint8Array([0,1,2,3,4,5,6,7,8,9]))});await sw.fetchEvent(audioURL);sw.offline=true;
    const suffix=await sw.fetchEvent(audioURL,{headers:{Range:'bytes=-3'}});assert.equal(suffix.status,206);assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())],[7,8,9]);
    for(const range of ['bytes=10-','bytes=7-2','bytes=0-1,5-6']){
      const response=await sw.fetchEvent(audioURL,{headers:{Range:range}});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */10');
    }
  });
  await test('private or failed audio is never persisted for offline replay',async()=>{
    for(const options of [{headers:{'cache-control':'private,no-store'}},{extra:{status:401}},{extra:{redirected:true,url:base+'signin-with-chatgpt'}}]){
      const sw=worker({network:url=>resource(url,'private audio',options.headers||{},options.extra||{})});await sw.fetchEvent(audioURL);
      assert.equal(sw.stores.get('ordrum-audio-v1')?.size||0,0);sw.offline=true;
      assert.equal((await sw.fetchEvent(audioURL)).status,503);
    }
  });
  await test('an unplayed recording reports unavailable offline without caching an error response',async()=>{
    const sw=worker();sw.offline=true;const value=await sw.fetchEvent(audioURL);assert.equal(value.status,503);assert.equal(sw.stores.get('ordrum-audio-v1').size,0);
  });
  await test('only an explicit update message activates a waiting worker',async()=>{
    const sw=worker();await sw.event('message',{data:{type:'unrelated'}});assert.equal(sw.skipped,0);
    await sw.event('message',{data:{type:'ORDRUM_ACTIVATE_UPDATE'}});assert.equal(sw.skipped,1);
  });
  await test('offline readiness is reported only after shell installation',async()=>{
    const sw=worker(),messages=[];const ports=[{postMessage:value=>messages.push(value)}];
    await sw.event('message',{data:{type:'ORDRUM_CACHE_STATUS'},ports});assert.equal(messages.at(-1).ready,false);
    await sw.event('install');await sw.event('message',{data:{type:'ORDRUM_CACHE_STATUS'},ports});assert.equal(messages.at(-1).ready,true);assert.ok(messages.at(-1).build);
  });
  await test('an available update waits for approval and requests a local save before activation',async()=>{
    const app=client();await new Promise(resolve=>setImmediate(resolve));assert.equal(app.registrations,1);assert.deepEqual(app.messages,[]);
    const banner=app.nodes.get('pwa-update-banner');assert.ok(banner);banner.children[1].click();
    assert.deepEqual(app.saved,['ordrum:before-update']);assert.equal(app.messages[0].type,'ORDRUM_ACTIVATE_UPDATE');
  });
  await test('a controller update saves and reloads an existing tab exactly once',async()=>{
    const app=client();await new Promise(resolve=>setImmediate(resolve));app.workerEvents.get('controllerchange')();app.workerEvents.get('controllerchange')();
    assert.equal(app.reloads,1);assert.deepEqual(app.saved,['ordrum:before-update']);
  });
  await test('the first worker taking control does not unexpectedly reload the page',async()=>{
    const app=client({controlled:false});await new Promise(resolve=>setImmediate(resolve));app.workerEvents.get('controllerchange')();assert.equal(app.reloads,0);
  });
  await test('blocked phone audio offers a synchronous user-tap retry',()=>{
    const app=client();let calls=0;app.window.OrdrumPWA.offerAudioStart('ett barn',()=>calls++);assert.equal(calls,0);
    app.nodes.get('pwa-audio-banner').children[1].click();assert.equal(calls,1);assert.equal(app.nodes.has('pwa-audio-banner'),false);
  });
  await test('an insecure browser keeps install guidance available without attempting worker registration',()=>{
    const app=client({secure:false});assert.equal(app.registrations,0);app.window.OrdrumPWA.showInstallHelp();
    const html=app.nodes.get('pwa-install-dialog').innerHTML;assert.match(html,/添加到主屏幕/);assert.match(html,/没有完成离线准备/);assert.match(html,/同一账号/);
  });
  console.log(`\n${passed} PWA checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
