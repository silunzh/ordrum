const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../public/cloud.js'),'utf8');
const A='a'.repeat(64),B='b'.repeat(64),META='ordrum.cloud.v1',MAIN='ordrum.rivstart.v1',JOURNAL='ordrum.cloud.journal.v1',MARKER='__cloudCommitId';
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const empty=()=>({marks:{},overrides:{},tasks:[],notebook:{},activeTaskId:null,studySession:null,reviewSession:null,selectedChapters:[1],mode:'preview'});
const known=updated=>({status:'known',updated});
const reply=(state,revision=0,accountId=A,status=200)=>Response.json({state,revision,accountId},{status});
function harness({state=empty(),storage=new Map(),network=async()=>reply(null),online=true,denyStorage,options={}}={}){
  let current=clone(state),sequence=0;const timers=new Map(),requests=[],statuses=[],events=new Map(),documentEvents=new Map();
  const label={textContent:'',dataset:{}};
  const window={navigator:{onLine:online},addEventListener(type,fn){events.set(type,fn);}};
  const localStorage={getItem:key=>storage.get(key)||null,setItem(key,value){if(denyStorage?.(key))throw new Error('storage full');storage.set(key,value);},removeItem(key){storage.delete(key);}};
  const sandbox={window,document:{visibilityState:'visible',querySelector:()=>label,addEventListener(type,fn){documentEvents.set(type,fn);}},localStorage,console,AbortController,
    setTimeout(fn,delay){timers.set(++sequence,{fn,delay});return sequence;},clearTimeout(id){timers.delete(id);},setInterval(){return 1;},
    fetch:async(url,options)=>{const entry={url,...options,payload:options.body?JSON.parse(options.body):undefined};requests.push(entry);return network(entry,requests.length);},
  };
  vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:path.resolve(__dirname,'../public/cloud.js')});
  const api=window.OrdrumCloud;
  function persistState(next,{commitId}={}){try{const marker=commitId||JSON.parse(storage.get(MAIN)||'{}')[MARKER];localStorage.setItem(MAIN,JSON.stringify({...clone(next),...(marker?{[MARKER]:marker}:{})}));return true;}catch(_){return false;}}
  const config={getState:()=>current,emptyState:empty,normalise:value=>clone(value)||empty(),applyState(next,details){current=clone(next);if(!persistState(current,details))throw new Error('storage full');},persistState,getLocalCommitId:()=>JSON.parse(storage.get(MAIN)||'{}')[MARKER],onStatus:code=>statuses.push(code),...options};
  return {api,storage,requests,statuses,events,documentEvents,label,window,async start(){return api.start(config);},get state(){return clone(current);},
    local(next){current=clone(next);if(!persistState(current))throw new Error('storage full');api.schedule();},
    fireDelay(delay){const queued=[...timers].filter(([,timer])=>timer.delay===delay);for(const [id,timer]of queued){timers.delete(id);timer.fn();}return queued.length;},
    async flush(){for(let round=0;timers.size&&round<6;round++){const queued=[...timers.values()];timers.clear();for(const {fn}of queued)await fn();}},
  };
}
const pure=harness().api;
let passed=0;
async function test(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
(async()=>{
  await test('initial merge combines independent legacy and cloud progress without mutating either',()=>{
    const local={...empty(),marks:{local:known('2026-10-20T10:00:00Z')}},remote={...empty(),marks:{remote:known('2026-10-20T11:00:00Z')}};
    const originals=JSON.stringify([local,remote]);const result=pure.mergeThreeWay(undefined,local,remote);
    assert.deepEqual(Object.keys(result.marks).sort(),['local','remote']);assert.equal(JSON.stringify([local,remote]),originals);
  });
  await test('deleting a notebook word is not undone by an unchanged remote copy',()=>{
    const base={notebook:{word:{count:2,status:'pending'}}},local={notebook:{}},remote=clone(base);
    assert.deepEqual(clone(pure.mergeThreeWay(base,local,remote)),local);
  });
  await test('deleting a task wins over a concurrent edit to that same task',()=>{
    const base={tasks:[{id:'task-a',name:'A',marks:{}}]},local={tasks:[]},remote={tasks:[{id:'task-a',name:'A',marks:{word:known('2026-10-20T11:00:00Z')}}]};
    assert.deepEqual(clone(pure.mergeThreeWay(base,local,remote)),{tasks:[]});
  });
  await test('resetting a task preserves the reset instead of reviving old progress or its checkpoint',()=>{
    const base={tasks:[{id:'task-a',marks:{word:known('2026-10-20T09:00:00Z')},errors:{word:{count:2}},session:{deck:['word'],flipped:true}}]};
    const local={tasks:[{id:'task-a',marks:{},errors:{},session:null}]};
    assert.deepEqual(clone(pure.mergeThreeWay(base,local,clone(base))),local);
  });
  await test('concurrent edits to different tasks and different words are retained',()=>{
    const base={tasks:[{id:'task-a',marks:{}}],marks:{}};
    const local={tasks:[{id:'task-a',marks:{one:known('2026-10-20T10:00:00Z')}}],marks:{one:known('2026-10-20T10:00:00Z')}};
    const remote={tasks:[{id:'task-a',marks:{two:known('2026-10-20T11:00:00Z')}},{id:'task-b',marks:{}}],marks:{two:known('2026-10-20T11:00:00Z')}};
    const value=clone(pure.mergeThreeWay(base,local,remote));
    assert.equal(value.tasks.length,2);assert.deepEqual(Object.keys(value.tasks.find(task=>task.id==='task-a').marks).sort(),['one','two']);assert.deepEqual(Object.keys(value.marks).sort(),['one','two']);
  });
  await test('simultaneous marks use their latest timestamp rather than a fixed device priority',()=>{
    const base={marks:{word:known('2026-10-20T09:00:00Z')}};
    const local={marks:{word:{status:'review',updated:'2026-10-20T10:00:00Z'}}},remote={marks:{word:known('2026-10-20T11:00:00Z')}};
    assert.equal(pure.mergeThreeWay(base,local,remote).marks.word.status,'known');
    assert.equal(pure.mergeThreeWay(base,remote,local).marks.word.status,'known');
  });
  await test('a session conflict selects one complete latest checkpoint without mixing deck and answer fields',()=>{
    const base={studySession:{deck:['old'],dictationIndex:0,updatedAt:'2026-10-20T09:00:00Z'}};
    const local={studySession:{deck:['a','b'],dictationIndex:1,draft:'local',updatedAt:'2026-10-20T10:00:00Z'}};
    const remote={studySession:{deck:['c'],dictationIndex:0,draft:'remote',updatedAt:'2026-10-20T11:00:00Z'}};
    assert.deepEqual(clone(pure.mergeThreeWay(base,local,remote).studySession),remote.studySession);
    assert.deepEqual(clone(pure.mergeThreeWay(undefined,{studySession:null},remote).studySession),remote.studySession);
  });
  await test('notebook conflicts preserve error history, the latest mastery status and all task associations',()=>{
    const local={notebook:{word:{count:5,status:'pending',updatedAt:'2026-10-20T10:00:00Z',lastWrongAt:'2026-10-20T10:00:00Z',lastAnswer:'wrong',taskIds:['a']}}};
    const remote={notebook:{word:{count:3,status:'mastered',updatedAt:'2026-10-20T11:00:00Z',lastWrongAt:'2026-10-19T10:00:00Z',lastAnswer:'older',taskIds:['b']}}};
    const word=pure.mergeThreeWay(undefined,local,remote).notebook.word;
    assert.equal(word.count,5);assert.equal(word.status,'mastered');assert.equal(word.lastAnswer,'wrong');assert.deepEqual([...word.taskIds].sort(),['a','b']);
  });
  await test('a fresh phone adopts the complete cloud task and checkpoint without uploading blank defaults',async()=>{
    const remote={...empty(),mode:'dictation',selectedChapters:[2],marks:{word:known('2026-10-20T10:00:00Z')},tasks:[{id:'task-a',marks:{}}],activeTaskId:'task-a',studySession:{deck:['word'],mode:'dictation',draft:'part',updatedAt:'2026-10-20T10:00:00Z'}};
    const app=harness({network:async()=>reply(remote,7)});await app.start();
    assert.deepEqual(app.state,remote);assert.equal(app.requests.length,1);assert.equal(app.statuses.at(-1),'synced');
    assert.equal(JSON.parse(app.storage.get(META)).revision,7);
  });
  await test('unsigned or non-JSON login responses never cause a progress upload',async()=>{
    for(const response of [Response.json({error:'sign_in_required'},{status:401}),new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}})]){
      const state={...empty(),marks:{local:known('2026-10-20T10:00:00Z')}};
      const app=harness({state,network:async()=>response});await app.start();assert.equal(app.requests.length,1);assert.deepEqual(app.state,state);assert.equal(app.storage.has(META),false);
    }
  });
  await test('expired installed-app sessions expose a native sign-in link without uploading or following auth redirects',async()=>{
    const opaque=new Response(null);
    Object.defineProperties(opaque,{type:{value:'opaqueredirect'},status:{value:0},ok:{value:false}});
    const followed=Response.json({unexpected:'login page'});Object.defineProperty(followed,'redirected',{value:true});
    for(const response of [opaque,Response.redirect('https://ordrum.example/signin-with-chatgpt',307),followed,new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}})]){
      const state={...empty(),marks:{local:known('2026-10-20T10:00:00Z')}};
      const app=harness({state,network:async()=>response});await app.start();
      assert.equal(app.requests.length,1);assert.equal(app.requests[0].method,'GET');assert.deepEqual(app.state,state);
      assert.equal(app.statuses.at(-1),'signin');assert.equal(app.label.href,'/signin-with-chatgpt?return_to=%2F');
      let prevented=false;app.documentEvents.get('click')({target:{closest:()=>app.label},preventDefault(){prevented=true;}});
      assert.equal(prevented,false,'sign-in must retain normal top-level anchor navigation');
      assert.equal(app.storage.has(META),false);
    }
    assert.match(fs.readFileSync(path.resolve(__dirname,'../public/index.html'),'utf8'),/<a id="cloud-status"/);
  });
  await test('cloud requests bypass HTTP caches and inspect redirects manually with same-origin credentials',async()=>{
    const state={...empty(),marks:{word:known('2026-10-20T10:00:00Z')}};
    const app=harness({state,network:async entry=>entry.method==='GET'?reply(null):reply(entry.payload.state,1)});await app.start();
    for(const entry of app.requests){assert.equal(entry.cache,'no-store');assert.equal(entry.redirect,'manual');assert.equal(entry.credentials,'same-origin');}
    assert.equal(app.requests[1].payload.expectedAccountId,A);assert.equal(app.requests[1].payload.baseRevision,0);
  });
  await test('409 retries advance the merge baseline so another device deletion cannot be resurrected',async()=>{
    const baseState=empty(),local={...empty(),marks:{local:known('2026-10-20T10:00:00Z')}};
    const firstRemote={...empty(),marks:{removed:known('2026-10-20T09:00:00Z')}},nextRemote=empty();let puts=0;
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:0,base:baseState})]]);
    const app=harness({state:local,storage,network:async entry=>{
      if(entry.method==='GET')return reply(firstRemote,1);
      if(++puts===1){assert.ok(entry.payload.state.marks.removed);return reply(nextRemote,2,A,409);}
      assert.equal(entry.payload.baseRevision,2);assert.equal(entry.payload.state.marks.removed,undefined);assert.ok(entry.payload.state.marks.local);return reply(entry.payload.state,3);
    }});
    await app.start();assert.equal(puts,2);assert.equal(app.state.marks.removed,undefined);assert.ok(app.state.marks.local);assert.equal(app.statuses.at(-1),'synced');
  });
  await test('an offline edit survives reload and uploads after connectivity returns',async()=>{
    const baseline=empty(),local={...empty(),marks:{word:known('2026-10-20T10:00:00Z')}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:3,base:baseline})],[MAIN,JSON.stringify(local)]]);
    const offline=harness({state:local,storage,online:false});await offline.start();assert.equal(offline.requests.length,0);assert.equal(offline.statuses.at(-1),'offline');
    const reloaded=harness({state:JSON.parse(storage.get(MAIN)),storage,network:async entry=>entry.method==='GET'?reply(baseline,3):reply(entry.payload.state,4)});await reloaded.start();
    assert.equal(reloaded.requests[1].payload.state.marks.word.status,'known');assert.equal(JSON.parse(storage.get(META)).revision,4);
  });
  await test('a failed upload preserves a local deletion across the next browser reload',async()=>{
    const baseline={...empty(),notebook:{word:{count:2,status:'pending'}}},local=empty();
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:5,base:baseline})],[MAIN,JSON.stringify(local)]]);
    const first=harness({state:local,storage,network:async entry=>{if(entry.method==='GET')return reply(baseline,5);throw new Error('network disconnected');}});await first.start();
    assert.equal(first.state.notebook.word,undefined);assert.equal(first.statuses.at(-1),'error');
    const second=harness({state:JSON.parse(storage.get(MAIN)),storage,network:async entry=>entry.method==='GET'?reply(baseline,5):reply(entry.payload.state,6)});await second.start();
    assert.equal(second.state.notebook.word,undefined);assert.equal(second.requests[1].payload.state.notebook.word,undefined);
  });
  await test('edits made while PUT is in flight remain local and are uploaded on the next pass',async()=>{
    let resolvePut,remote=null,revision=0;let writes=0;
    const state={...empty(),marks:{first:known('2026-10-20T10:00:00Z')}};
    const app=harness({state,network:async entry=>{
      if(entry.method==='GET')return reply(remote,revision);
      if(++writes===1)return new Promise(resolve=>{resolvePut=()=>{remote=clone(entry.payload.state);revision=1;resolve(reply(remote,revision));};});
      remote=clone(entry.payload.state);revision++;return reply(remote,revision);
    }});
    const starting=app.start();await new Promise(resolve=>setImmediate(resolve));assert.ok(resolvePut);
    app.local({...app.state,marks:{...app.state.marks,second:known('2026-10-20T11:00:00Z')}});resolvePut();await starting;
    assert.ok(app.state.marks.second);await app.flush();assert.ok(remote.marks.second);assert.equal(writes,2);
  });
  await test('switching accounts archives unsynced old progress and never sends it to the new account',async()=>{
    const oldBase={...empty(),marks:{old:known('2026-10-20T09:00:00Z')}},oldLocal={...oldBase,marks:{...oldBase.marks,unsent:known('2026-10-20T10:00:00Z')}};
    const newState={...empty(),marks:{new:known('2026-10-20T11:00:00Z')}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:1,base:oldBase})]]);
    const app=harness({state:oldLocal,storage,network:async()=>reply(newState,4,B)});await app.start();
    assert.deepEqual(app.state,newState);assert.equal(app.requests.length,1);assert.equal(JSON.parse(storage.get('ordrum.account.'+A)).state.marks.unsent.status,'known');
    assert.equal(JSON.parse(storage.get(META)).accountId,B);
  });
  await test('a server-detected account switch during PUT adopts the new account without retrying old data',async()=>{
    const state={...empty(),marks:{privateA:known('2026-10-20T10:00:00Z')}},newState={...empty(),marks:{privateB:known('2026-10-20T11:00:00Z')}};let gets=0,puts=0;
    const app=harness({state,network:async entry=>{
      if(entry.method==='GET')return ++gets===1?reply(null,0,A):reply(newState,0,B);
      puts++;assert.equal(entry.payload.expectedAccountId,A);return reply(newState,0,B,409);
    }});await app.start();await app.flush();assert.equal(puts,1);assert.deepEqual(app.state,newState);
    assert.equal(JSON.parse(app.storage.get('ordrum.account.'+A)).state.marks.privateA.status,'known');
  });
  await test('a failed local baseline write prevents any server mutation',async()=>{
    const state={...empty(),marks:{word:known('2026-10-20T10:00:00Z')}};
    const app=harness({state,denyStorage:key=>key===META,network:async()=>reply(null)});await app.start();
    assert.equal(app.requests.length,1);assert.equal(app.statuses.at(-1),'error');assert.deepEqual(app.state,state);
  });
  await test('a failed account archive prevents switching or uploading the previous account data',async()=>{
    const state={...empty(),marks:{private:known('2026-10-20T10:00:00Z')}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:1,base:empty()})]]);
    const app=harness({state,storage,denyStorage:key=>key==='ordrum.account.'+A,network:async()=>reply(empty(),0,B)});await app.start();
    assert.deepEqual(app.state,state);assert.equal(app.requests.length,1);assert.equal(app.statuses.at(-1),'error');assert.equal(JSON.parse(storage.get(META)).accountId,A);
  });
  await test('a server size rejection keeps all local progress and exposes a retryable limit status',async()=>{
    const state={...empty(),marks:{word:known('2026-10-20T10:00:00Z')}};
    const app=harness({state,network:async entry=>entry.method==='GET'?reply(null):Response.json({error:'state_too_large'},{status:413})});await app.start();
    assert.deepEqual(app.state,state);assert.equal(app.statuses.at(-1),'limit');
  });
  await test('an unpaired local page makes no API request until its supplied connection is ready',async()=>{
    let connected=false,transportCalls=0;
    const app=harness({network:async()=>{throw new Error('Local pages must use the paired transport');},options:{isConnected:()=>connected,transport:async()=>{transportCalls++;return reply(empty(),3);}}});
    await app.start();app.api.schedule();await app.flush();
    assert.equal(app.requests.length,0);assert.equal(transportCalls,0);assert.equal(app.statuses.at(-1),'local');
    connected=true;await app.api.updateConnectionStatus();
    assert.equal(app.requests.length,0);assert.equal(transportCalls,1);assert.equal(app.statuses.at(-1),'synced');
  });
  await test('the local sync link opens its connection synchronously inside the trusted click',async()=>{
    let connected=false,clickActive=false,openedInsideClick=false;
    const app=harness({options:{isConnected:()=>connected,connect(){openedInsideClick=clickActive;connected=true;return Promise.resolve();},transport:async()=>reply(empty(),1)}});
    await app.start();let prevented=false;clickActive=true;
    app.documentEvents.get('click')({target:{closest:()=>app.label},preventDefault(){prevented=true;}});
    clickActive=false;
    assert.equal(prevented,true);assert.equal(openedInsideClick,true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(app.requests.length,0);assert.equal(app.statuses.at(-1),'synced');
  });
  await test('a paired local sign-in link reconnects synchronously while hosted sign-in stays a normal anchor',async()=>{
    let activeClick=false,connectedInsideClick=false;
    const app=harness({options:{transport:async()=>Response.json({error:'sign_in_required'},{status:401}),connect(){connectedInsideClick=activeClick;return false;},signInLabel:'Reconnect account',signInHref:'#'}});
    await app.start();assert.equal(app.statuses.at(-1),'signin');assert.equal(app.label.textContent,'Reconnect account');assert.equal(app.label.href,'#');
    let prevented=false;activeClick=true;app.documentEvents.get('click')({target:{closest:()=>app.label},preventDefault(){prevented=true;}});activeClick=false;
    assert.equal(prevented,true);assert.equal(connectedInsideClick,true);assert.equal(app.requests.length,0);
  });
  await test('a hung request aborts at twelve seconds and the next sync can retry',async()=>{
    let healthy=false,signal;
    const app=harness({network:async entry=>{signal=entry.signal;if(!healthy)return new Promise(()=>{});return reply(empty(),2);}});
    const starting=app.start();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(app.requests.length,1);assert.equal(signal.aborted,false);
    assert.equal(app.fireDelay(12000),1);await starting;
    assert.equal(signal.aborted,true);assert.equal(app.statuses.at(-1),'error');
    healthy=true;await app.api.sync();
    assert.equal(app.requests.length,2);assert.equal(app.statuses.at(-1),'synced');
  });
  await test('going offline interrupts an in-flight request and ignores its late login response',async()=>{
    let finish,signal;
    const app=harness({network:async entry=>{signal=entry.signal;return new Promise(resolve=>{finish=resolve;});}});
    const starting=app.start();await new Promise(resolve=>setImmediate(resolve));
    app.window.navigator.onLine=false;app.events.get('offline')();await starting;
    assert.equal(signal.aborted,true);assert.equal(app.statuses.at(-1),'offline');
    finish(Response.json({error:'sign_in_required'},{status:401}));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(app.statuses.at(-1),'offline');assert.equal(app.storage.has(META),false);
  });
  await test('a failed recovery journal write prevents both local adoption and server mutation',async()=>{
    const state={...empty(),marks:{local:known('2026-10-20T10:00:00Z')}};
    const remote={...empty(),marks:{remote:known('2026-10-20T11:00:00Z')}};
    const app=harness({state,denyStorage:key=>key===JOURNAL,network:async()=>reply(remote,3)});await app.start();
    assert.deepEqual(app.state,state);assert.equal(app.requests.length,1);assert.equal(app.storage.has(META),false);assert.equal(app.statuses.at(-1),'error');
  });
  await test('a failed app state write leaves a recoverable journal and prevents any upload',async()=>{
    const state={...empty(),marks:{local:known('2026-10-20T10:00:00Z')}};
    const app=harness({state,denyStorage:key=>key===MAIN,network:async()=>reply(null)});await app.start();
    assert.equal(app.requests.length,1);assert.equal(app.storage.has(JOURNAL),true);assert.equal(app.storage.has(META),false);assert.equal(app.statuses.at(-1),'error');
  });
  await test('a metadata failure after state commit preserves later deletions when the journal recovers',async()=>{
    const remote={...empty(),notebook:{word:{count:2,status:'pending'}}};let blockMetadata=true;
    const storage=new Map();
    const first=harness({storage,denyStorage:key=>blockMetadata&&key===META,network:async()=>reply(remote,5)});await first.start();
    assert.equal(first.statuses.at(-1),'error');assert.ok(first.state.notebook.word);
    const journal=JSON.parse(storage.get(JOURNAL));assert.equal(JSON.parse(storage.get(MAIN))[MARKER],journal.id);
    first.local({...first.state,notebook:{}});blockMetadata=false;
    const state=JSON.parse(storage.get(MAIN));delete state[MARKER];
    const second=harness({state,storage,network:async entry=>entry.method==='GET'?reply(remote,5):reply(entry.payload.state,6)});await second.start();
    assert.equal(second.state.notebook.word,undefined);assert.equal(second.requests[1].payload.state.notebook.word,undefined);
    assert.equal(storage.has(JOURNAL),false);assert.equal(JSON.parse(storage.get(META)).revision,6);
    assert.equal(second.requests[1].payload.state[MARKER],undefined,'the atomic local commit marker must never leave this device');
  });
  await test('journal recovery finishes an interrupted account switch before requesting or uploading data',async()=>{
    const oldState={...empty(),marks:{privateA:known('2026-10-20T10:00:00Z')}};
    const remote={...empty(),notebook:{privateB:{count:2,status:'pending'}}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:1,base:empty()})]]);let blockMetadata=true;
    const first=harness({state:oldState,storage,denyStorage:key=>blockMetadata&&key===META,network:async()=>reply(remote,7,B)});await first.start();
    assert.deepEqual(first.state,remote);assert.equal(first.requests.length,1);assert.equal(JSON.parse(storage.get(META)).accountId,A);
    assert.equal(JSON.parse(storage.get('ordrum.account.'+A)).state.marks.privateA.status,'known');
    first.local({...first.state,notebook:{},marks:{newB:known('2026-10-20T12:00:00Z')}});blockMetadata=false;
    const state=JSON.parse(storage.get(MAIN));delete state[MARKER];
    const second=harness({state,storage,network:async entry=>entry.method==='GET'?reply(remote,7,B):reply(entry.payload.state,8,B)});await second.start();
    assert.equal(second.requests[1].payload.expectedAccountId,B);assert.equal(second.requests[1].payload.state.marks.privateA,undefined);
    assert.equal(second.requests[1].payload.state.notebook.privateB,undefined);assert.ok(second.requests[1].payload.state.marks.newB);
    assert.equal(JSON.parse(storage.get(META)).accountId,B);assert.equal(storage.has(JOURNAL),false);
  });
  await test('a switch interrupted before its atomic state write archives later old-account edits without leaking them',async()=>{
    const oldState={...empty(),marks:{privateA:known('2026-10-20T10:00:00Z')}},remote={...empty(),marks:{privateB:known('2026-10-20T11:00:00Z')}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:1,base:empty()})],[MAIN,JSON.stringify(oldState)]]);let blockMain=true;
    const first=harness({state:oldState,storage,denyStorage:key=>blockMain&&key===MAIN,network:async()=>reply(remote,7,B)});await first.start();
    assert.equal(first.statuses.at(-1),'error');assert.equal(JSON.parse(storage.get(MAIN)).marks.privateB,undefined);
    const stillA={...oldState,marks:{...oldState.marks,lateA:known('2026-10-20T12:00:00Z')}};storage.set(MAIN,JSON.stringify(stillA));blockMain=false;
    const second=harness({state:stillA,storage,network:async()=>reply(remote,7,B)});await second.start();
    assert.deepEqual(second.state,remote);assert.equal(second.requests.length,1);assert.equal(JSON.parse(storage.get('ordrum.account.'+A)).state.marks.lateA.status,'known');
    assert.equal(JSON.parse(storage.get(META)).accountId,B);assert.equal(storage.has(JOURNAL),false);
  });
  console.log(`\n${passed} cloud checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
