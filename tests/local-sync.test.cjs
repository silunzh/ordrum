const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const sourcePath=path.resolve(__dirname,'../public/local-sync.js');
const source=fs.readFileSync(sourcePath,'utf8');
const ONLINE='https://ordrum-rivstart-silun.genialcomet16.chatgpt.site',LOCAL='http://127.0.0.1:8765',KEY='ordrum.local.channel.v1',APP='ordrum-local-sync',MAX=1024*1024;
const PAGES='https://silunzh.github.io',PAGES_PATH='/ordrum/',PAGES_KEY='ordrum.rivstart.channel.v1';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({origin=LOCAL,pathname='/',storage=new Map(),blocked=false,denyStorage=false}={}){
  const events=new Map(),intervals=[],timers=new Map(),messages=[],opens=[],notices=[],controls=new Map();let timerSequence=0,updates=0;
  let clock=Date.now();class ClockDate extends Date{static now(){return clock;}}
  const popup={closed:false,focusCount:0,focus(){this.focusCount++;},postMessage(value,target){messages.push({value:JSON.parse(JSON.stringify(value)),target});}};
  const window={location:{origin,pathname},crypto:webcrypto,sessionStorage:{getItem(key){if(denyStorage)throw new Error('disabled');return storage.get(key)||null;},setItem(key,value){if(denyStorage)throw new Error('disabled');storage.set(key,value);}},
    open(url,name,features){opens.push({url,name,features});return blocked?null:popup;},addEventListener(type,fn){events.set(type,fn);},
    setInterval(fn){intervals.push(fn);return intervals.length;},OrdrumCloud:{updateConnectionStatus(){updates++;}},
  };
  const document={querySelector(selector){if(!controls.has(selector))controls.set(selector,{hidden:true,innerHTML:'',addEventListener(type,fn){this[type]=fn;}});return controls.get(selector);}};
  const sandbox={window,document,URL,TextEncoder,Uint8Array,Response,Date:ClockDate,console,
    setTimeout(fn,delay){timers.set(++timerSequence,{fn,delay});return timerSequence;},clearTimeout(id){timers.delete(id);},
  };
  vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:sourcePath});
  const api=window.OrdrumLocalSync;const options=api.cloudOptions(message=>notices.push(message));
  const pages=origin===PAGES&&[PAGES_PATH,`${PAGES_PATH}index.html`].includes(pathname);
  const channel=()=>storage.get(pages?PAGES_KEY:KEY)||new URL(opens.at(-1)?.url||ONLINE).searchParams.get('channel');
  function receive(message,extra={}){events.get('message')?.({origin:ONLINE,source:popup,data:{app:APP,channel:channel(),...(pages?{sourcePath:PAGES_PATH}:{}),...message},...extra});}
  return {api,options,window,events,popup,messages,opens,storage,notices,timers,controls,get updates(){return updates;},channel,
    ready(extra={}){receive({type:'ready'},extra);},receive,
    respond(id,extra={}){receive({type:'response',id,status:200,body:{state:null,revision:0,accountId:'a'.repeat(64)},contentType:'application/json',...extra});},
    close(){popup.closed=true;for(const callback of intervals)callback();},
    timeout(){for(const [id,{fn,delay}]of [...timers])if(delay===11000){timers.delete(id);fn();}},
    advance(ms){clock+=ms;for(const callback of intervals)callback();},
  };
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
(async()=>{
  await test('online or non-loopback pages keep their normal cloud transport without side effects',()=>{
    for(const origin of [ONLINE,'https://localhost:8765','http://evil.example','http://127.0.0.1.evil.example','http://localhost:80','http://user@localhost:8765']){
      const app=harness({origin});assert.equal(app.api.enabled,false);assert.equal(Object.keys(app.options).length,0);assert.equal(app.events.size,0);assert.equal(app.storage.size,0);assert.equal(app.opens.length,0);
    }
  });
  await test('only the exact GitHub project entry enables account pairing',()=>{
    for(const pathname of ['/','/other/','/ordrum','/ordrum-other/','/ordrum/nested/','/ordrum/%69ndex.html']){
      const app=harness({origin:PAGES,pathname});assert.equal(app.api.enabled,false);assert.equal(app.storage.size,0);assert.equal(app.opens.length,0);assert.equal(app.events.size,0);
    }
    for(const origin of ['http://silunzh.github.io','https://silunzh.github.io.evil.example','https://silunzh.github.io:443','https://other.github.io']){
      assert.equal(harness({origin,pathname:PAGES_PATH}).api.enabled,false);
    }
    for(const pathname of [PAGES_PATH,`${PAGES_PATH}index.html`])assert.equal(harness({origin:PAGES,pathname}).api.enabled,true);
  });
  await test('GitHub pairing uses its project channel and a fixed visible source path',()=>{
    const app=harness({origin:PAGES,pathname:PAGES_PATH});assert.match(app.storage.get(PAGES_KEY),/^[a-f0-9]{64}$/);assert.equal(app.storage.has(KEY),false);
    assert.match(app.controls.get('#local-sync-context').innerHTML,/GitHub/);assert.equal(app.options.localLabel,'连接账号并同步学习进度');
    app.api.connect();const url=new URL(app.opens[0].url);assert.equal(url.origin,ONLINE);assert.equal(url.pathname,'/sync-bridge');assert.equal(url.searchParams.get('origin'),PAGES);assert.equal(url.searchParams.get('path'),PAGES_PATH);
    assert.deepEqual([...url.searchParams.keys()].sort(),['channel','origin','path']);assert.match(app.notices.at(-1),/连接此 GitHub 网页/);
    app.ready();assert.equal(app.api.isConnected(),true);
  });
  await test('GitHub source paths must match on every ready response and request envelope',async()=>{
    const app=harness({origin:PAGES,pathname:PAGES_PATH});app.api.connect();
    for(const sourcePath of [undefined,'/','/other/','/ordrum','/ordrum/index.html'])app.ready({data:{app:APP,channel:app.channel(),type:'ready',sourcePath}});
    assert.equal(app.api.isConnected(),false);app.ready();assert.equal(app.api.isConnected(),true);
    app.api.connect();assert.equal(app.messages.at(-1).value.sourcePath,PAGES_PATH);
    const pending=app.api.transport('GET');const id=app.messages.at(-1).value.id;assert.equal(app.messages.at(-1).value.sourcePath,PAGES_PATH);
    let completed=false;pending.then(()=>{completed=true;});app.respond(id,{sourcePath:'/other/'});await tick();assert.equal(completed,false);
    app.respond(id);assert.equal((await pending).status,200);
  });
  await test('legacy loopback pairing keeps its original channel and rejects GitHub path packets',()=>{
    const app=harness();assert.ok(app.storage.has(KEY));assert.equal(app.storage.has(PAGES_KEY),false);app.api.connect();assert.equal(new URL(app.opens[0].url).searchParams.has('path'),false);
    app.receive({type:'ready',sourcePath:PAGES_PATH});assert.equal(app.api.isConnected(),false);app.ready();app.api.connect();assert.equal(Object.hasOwn(app.messages.at(-1).value,'sourcePath'),false);
  });
  await test('local pairing stores only a random per-tab channel and sends no progress before consent',async()=>{
    const app=harness();assert.equal(app.api.enabled,true);assert.match(app.channel(),/^[a-f0-9]{64}$/);assert.equal(app.storage.size,1);assert.equal(app.api.isConnected(),false);
    assert.equal(app.controls.get('#local-sync-context').hidden,false);assert.match(app.controls.get('#local-sync-context').innerHTML,/连接线上账号/);
    await assert.rejects(app.api.transport('GET'),error=>error.code==='LOCAL_SYNC_DISCONNECTED');assert.equal(app.opens.length,0);assert.equal(app.messages.length,0);
    assert.equal(app.api.connect(),true);assert.equal(app.opens.length,1);assert.equal(app.api.isConnected(),false);assert.equal(app.messages.length,0);
    const url=new URL(app.opens[0].url);assert.equal(url.origin,ONLINE);assert.equal(url.pathname,'/sync-bridge');assert.equal(url.searchParams.get('origin'),LOCAL);assert.equal(url.searchParams.get('channel'),app.channel());
    assert.deepEqual([...url.searchParams.keys()].sort(),['channel','origin']);
  });
  await test('only the exact online origin, popup source, app and channel can confirm a connection',()=>{
    const app=harness();app.api.connect();
    for(const extra of [{origin:'https://evil.example'},{origin:ONLINE+':443'},{source:{}},{source:null}])app.ready(extra);
    for(const message of [{app:'other'},{channel:'b'.repeat(64)},{channel:app.channel().toUpperCase()}])app.receive({type:'ready',...message});
    assert.equal(app.api.isConnected(),false);assert.equal(app.updates,0);
    app.ready();assert.equal(app.api.isConnected(),true);assert.equal(app.updates,1);app.ready();assert.equal(app.updates,1,'heartbeats must not start redundant syncs');
  });
  await test('paired transport sends bounded request envelopes only to the fixed online origin',async()=>{
    const app=harness();app.api.connect();app.ready();
    const state={marks:{word:{status:'review'}}};const pending=app.api.transport('PUT',{state,baseRevision:4,expectedAccountId:'a'.repeat(64)});
    const packet=app.messages.at(-1);assert.equal(packet.target,ONLINE);assert.match(packet.value.id,/^[a-f0-9]{64}$/);assert.equal(packet.value.method,'PUT');assert.equal(packet.value.body.state.marks.word.status,'review');
    assert.equal(packet.value.url,undefined);assert.equal(packet.value.credentials,undefined);assert.equal(packet.value.headers,undefined);
    app.respond(packet.value.id,{status:409,body:{state,revision:5,accountId:'a'.repeat(64)}});const response=await pending;
    assert.equal(response.status,409);assert.equal(response.headers.get('content-type'),'application/json');assert.equal((await response.json()).revision,5);
    await assert.rejects(app.api.transport('DELETE'),/Invalid sync method/);
  });
  await test('untrusted and unsolicited responses cannot complete a pending local request',async()=>{
    const app=harness();app.api.connect();app.ready();const pending=app.api.transport('GET');let completed=false;pending.then(()=>{completed=true;});
    const id=app.messages.at(-1).value.id;
    app.receive({type:'response',id,status:200,body:{wrong:true},contentType:'application/json'},{source:{}});
    app.receive({type:'response',id,status:200,body:{wrong:true},contentType:'application/json'},{origin:'https://evil.example'});
    app.respond('not-pending');await tick();assert.equal(completed,false);
    app.respond(id);await pending;assert.equal(completed,true);
  });
  await test('the local transport bounds UTF-8 request and response envelopes',async()=>{
    const app=harness();app.api.connect();app.ready();
    const tooLarge=await app.api.transport('PUT',{text:'词'.repeat(Math.ceil((MAX+2048)/3))});assert.equal(tooLarge.status,413);assert.equal(app.messages.length,0);
    const pending=app.api.transport('GET');const rejection=assert.rejects(pending,/too large/);app.respond(app.messages.at(-1).value.id,{body:{text:'x'.repeat(MAX+65536)}});await rejection;
    const circular={};circular.self=circular;await assert.rejects(app.api.transport('PUT',circular),/Invalid sync data/);
  });
  await test('malformed response status or content type rejects the pending request',async()=>{
    const app=harness();app.api.connect();app.ready();
    for(const extra of [{status:199},{status:600},{status:200.5},{status:204},{status:205},{status:304},{contentType:'text/html'},{body:undefined}]){
      const pending=app.api.transport('GET');const rejection=assert.rejects(pending,/Invalid sync response|too large/);app.respond(app.messages.at(-1).value.id,extra);await rejection;
    }
  });
  await test('cancelling or timing out a request removes it so late responses cannot affect the next retry',async()=>{
    const app=harness();app.api.connect();app.ready();const controller=new AbortController();
    const cancelled=app.api.transport('GET',undefined,{signal:controller.signal});const rejection=assert.rejects(cancelled,error=>error.name==='AbortError');const oldId=app.messages.at(-1).value.id;controller.abort();await rejection;
    app.respond(oldId);assert.equal(app.timers.size,0);
    const expired=app.api.transport('GET');const timeoutRejection=assert.rejects(expired,/timed out/);app.timeout();await timeoutRejection;
    assert.equal(app.api.isConnected(),false,'an unresponsive bridge must require a fresh handshake');
    app.api.connect();app.ready();
    const retry=app.api.transport('GET');app.respond(app.messages.at(-1).value.id);assert.equal((await retry).status,200);
    controller.abort();await assert.rejects(app.api.transport('GET',undefined,{signal:controller.signal}),error=>error.name==='AbortError');
  });
  await test('closing or signing out of the bridge rejects in-flight work without deleting local pairing data',async()=>{
    for(const event of ['signin','disconnected','closed']){
      const app=harness();app.api.connect();app.ready();const pending=app.api.transport('GET');const rejection=assert.rejects(pending,error=>error.code==='LOCAL_SYNC_DISCONNECTED');
      if(event==='closed')app.close();else app.receive({type:event});await rejection;
      assert.equal(app.api.isConnected(),false);assert.equal(app.updates,2);assert.match(app.storage.get(KEY),/^[a-f0-9]{64}$/);
    }
  });
  await test('a local reload can reattach the already consented bridge through its per-tab nonce',async()=>{
    const storage=new Map();const first=harness({storage});first.api.connect();first.ready();const channel=first.channel();
    const reloaded=harness({storage});assert.equal(reloaded.channel(),channel);assert.equal(reloaded.opens.length,0);assert.equal(reloaded.api.isConnected(),false);
    reloaded.ready({source:first.popup});assert.equal(reloaded.api.isConnected(),true);assert.equal(reloaded.updates,1);
    const otherTab=harness();assert.notEqual(otherTab.channel(),channel);otherTab.receive({type:'ready',channel},{source:first.popup});assert.equal(otherTab.api.isConnected(),false);
  });
  await test('a recently confirmed connection reuses the popup and blocked creation remains synchronous',()=>{
    const app=harness();app.api.connect();app.ready();app.api.connect();assert.equal(app.opens.length,1);assert.equal(app.popup.focusCount,1);assert.equal(app.messages.at(-1).value.type,'hello');assert.equal(app.messages.at(-1).target,ONLINE);
    const blocked=harness({blocked:true});assert.equal(blocked.api.connect(),false);assert.equal(blocked.api.isConnected(),false);assert.match(blocked.notices.at(-1),/弹出窗口/);
    const memoryOnly=harness({denyStorage:true});assert.equal(memoryOnly.api.connect(),true);assert.match(new URL(memoryOnly.opens[0].url).searchParams.get('channel'),/^[a-f0-9]{64}$/);
  });
  await test('the local header exposes one reliable connection action and updates its label',()=>{
    const app=harness();const button=app.controls.get('#sync-account-button');
    assert.equal(button.hidden,false);assert.equal(button.textContent,'连接线上账号');assert.equal(typeof button.onclick,'function');
    app.api.cloudOptions();app.api.cloudOptions();button.onclick();assert.equal(app.opens.length,1,'refreshing the controls must not duplicate click listeners');
    app.ready();assert.equal(button.textContent,'账号连接');app.receive({type:'disconnected'});assert.equal(button.textContent,'连接线上账号');
  });
  await test('a live unready popup is navigated back to the fixed consent page by an explicit reconnect',()=>{
    const app=harness();app.api.connect();const first=app.opens[0];
    app.api.connect();assert.equal(app.opens.length,2);assert.equal(app.opens[1].url,first.url);assert.equal(app.opens[1].name,first.name);
    assert.equal(app.api.isConnected(),false);assert.equal(app.messages.length,0,'no progress is sent before renewed consent');
    app.ready();assert.equal(app.api.isConnected(),true);
  });
  await test('background silence alone keeps pairing but an explicit click rebuilds a stale bridge',()=>{
    const app=harness();app.api.connect();app.ready();app.advance(10*60*1000);
    assert.equal(app.api.isConnected(),true,'background timer throttling must not unpair the user');assert.equal(app.opens.length,1);
    app.api.connect();assert.equal(app.opens.length,2);assert.equal(new URL(app.opens[1].url).pathname,'/sync-bridge');assert.equal(app.api.isConnected(),false);
    app.ready();assert.equal(app.api.isConnected(),true);
  });
  await test('a missed response invalidates the connection before the cloud deadline and reconnect restores it',async()=>{
    const app=harness();app.api.connect();app.ready();const request=app.api.transport('GET');const rejection=assert.rejects(request,/timed out/);const oldId=app.messages.at(-1).value.id;
    assert.ok([...app.timers.values()].some(timer=>timer.delay===11000));app.timeout();await rejection;
    assert.equal(app.api.isConnected(),false);assert.equal(app.timers.size,0);assert.match(app.notices.at(-1),/没有响应/);
    app.respond(oldId);assert.equal(app.api.isConnected(),false,'a late response cannot re-pair a failed bridge');
    app.api.connect();assert.equal(app.opens.length,2);app.ready();const retry=app.api.transport('GET');app.respond(app.messages.at(-1).value.id);assert.equal((await retry).status,200);
  });
  console.log(`\n${passed} local sync checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
