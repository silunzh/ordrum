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
  let current=clone(state),sequence=0;const timers=new Map(),requests=[],statuses=[],events=new Map(),documentEvents=new Map(),intervals=[];
  const label={textContent:'',dataset:{}};
  const window={navigator:{onLine:online},addEventListener(type,fn){events.set(type,fn);}};
  const localStorage={getItem:key=>storage.get(key)||null,setItem(key,value){if(denyStorage?.(key))throw new Error('storage full');storage.set(key,value);},removeItem(key){storage.delete(key);}};
  const sandbox={window,document:{visibilityState:'visible',querySelector:()=>label,addEventListener(type,fn){documentEvents.set(type,fn);}},localStorage,console,AbortController,
    setTimeout(fn,delay){timers.set(++sequence,{fn,delay});return sequence;},clearTimeout(id){timers.delete(id);},setInterval(fn,delay){intervals.push({fn,delay});return intervals.length;},
    fetch:async(url,options)=>{const entry={url,...options,payload:options.body?JSON.parse(options.body):undefined};requests.push(entry);return network(entry,requests.length);},
  };
  vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:path.resolve(__dirname,'../public/cloud.js')});
  const api=window.OrdrumCloud;
  function persistState(next,{commitId}={}){try{const marker=commitId||JSON.parse(storage.get(MAIN)||'{}')[MARKER];localStorage.setItem(MAIN,JSON.stringify({...clone(next),...(marker?{[MARKER]:marker}:{})}));return true;}catch(_){return false;}}
  const config={getState:()=>current,emptyState:empty,normalise:value=>clone(value)||empty(),applyState(next,details){current=clone(next);if(!persistState(current,details))throw new Error('storage full');},persistState,getLocalCommitId:()=>JSON.parse(storage.get(MAIN)||'{}')[MARKER],onStatus:code=>statuses.push(code),...options};
  return {api,storage,requests,statuses,events,documentEvents,intervals,label,window,async start(){return api.start(config);},get state(){return clone(current);},
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
  await test('concurrent mistake unit additions preserve all baseline members before deterministic overflow',()=>{
    const ids=Array.from({length:29},(_,i)=>`z${i}`);
    const unit=wordIds=>({notebookUnits:{'unit-a':{wordIds}}});
    const merged=pure.mergeThreeWay(unit(ids),unit([...ids,'a']),unit([...ids,'b']));
    assert.deepEqual(clone(merged.notebookUnits['unit-a'].wordIds),[...ids,'a','b']);
    assert.deepEqual(clone(merged.notebookUnits['unit-a'].wordIds.slice(0,30)),[...ids,'a']);
    assert.deepEqual(clone(pure.mergeThreeWay(unit(ids),unit([...ids,'b']),unit([...ids,'a']))),clone(merged));
  });
  await test('explicit mistake unit deletion wins over a concurrent membership addition',()=>{
    const base={notebookUnits:{'unit-a':{wordIds:['one']}}};
    const local={notebookUnits:{}};
    const remote={notebookUnits:{'unit-a':{wordIds:['one','two']}}};
    assert.deepEqual(clone(pure.mergeThreeWay(base,local,remote)),local);
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
    const html=fs.readFileSync(path.resolve(__dirname,'../public/index.html'),'utf8');
    const settings=fs.readFileSync(path.resolve(__dirname,'../public/settings.js'),'utf8');
    assert.match(html,/src="settings.js"/);
    assert.match(settings,/<a id="cloud-status"/);
    assert.ok(!html.includes('id="cloud-status"'));

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
  await test('an explicit provider migration merges both accounts and consumes only after a durable commit',async()=>{
    const oldBase={...empty(),marks:{old:known('2026-10-20T09:00:00Z')}},local={...oldBase,marks:{...oldBase.marks,unsent:known('2026-10-20T10:00:00Z')}};
    const remote={...empty(),marks:{target:known('2026-10-20T11:00:00Z')}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:3,base:oldBase})]]);let grant=true,completed=0;
    const app=harness({state:local,storage,options:{
      allowProviderMigration:pair=>grant&&pair.fromAccountId===A&&pair.toAccountId===B,
      onProviderMigrationCommitted(pair){
        assert.deepEqual(clone(pair),{fromAccountId:A,toAccountId:B});
        assert.equal(JSON.parse(storage.get(META)).accountId,B);
        assert.ok(JSON.parse(storage.get(MAIN)).marks.unsent);
        assert.equal(JSON.parse(storage.get(JOURNAL)).providerMigration,true);
        grant=false;completed++;return true;
      },
    },network:async entry=>entry.method==='GET'?reply(remote,5,B):reply(entry.payload.state,6,B)});
    await app.start();
    assert.deepEqual(Object.keys(app.state.marks).sort(),['old','target','unsent']);
    assert.deepEqual(Object.keys(app.requests[1].payload.state.marks).sort(),['old','target','unsent']);
    assert.equal(app.requests[1].payload.expectedAccountId,B);assert.equal(app.requests[1].payload.baseRevision,5);
    assert.ok(JSON.parse(storage.get('ordrum.account.'+A)).state.marks.unsent);
    assert.equal(completed,1);assert.equal(grant,false);assert.equal(storage.has(JOURNAL),false);assert.equal(app.statuses.at(-1),'synced');
  });
  await test('migrating to an empty provider uploads current records without reviving the old baseline',async()=>{
    const oldBase={...empty(),marks:{removed:known('2026-10-20T09:00:00Z')}},local={...empty(),marks:{unsent:known('2026-10-20T10:00:00Z')}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:2,base:oldBase})]]);
    const app=harness({state:local,storage,options:{allowProviderMigration:pair=>pair.fromAccountId===A&&pair.toAccountId===B},network:async entry=>entry.method==='GET'?reply(null,0,B):reply(entry.payload.state,1,B)});
    await app.start();assert.deepEqual(app.state,local);assert.equal(app.requests[1].payload.state.marks.removed,undefined);assert.ok(app.requests[1].payload.state.marks.unsent);
    assert.equal(JSON.parse(storage.get(META)).accountId,B);assert.equal(app.statuses.at(-1),'synced');
  });
  await test('a migration grant does not authorize later account switches or truthy asynchronous approvals',async()=>{
    const C='c'.repeat(64),local={...empty(),marks:{old:known('2026-10-20T10:00:00Z')}};
    let account=B,remote=null,revision=0,grant=true,completed=0;
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:1,base:empty()})]]);
    const app=harness({state:local,storage,options:{allowProviderMigration:pair=>grant&&pair.fromAccountId===A&&pair.toAccountId===B,onProviderMigrationCommitted(){grant=false;completed++;}},network:async entry=>{
      if(entry.method==='GET')return reply(remote,revision,account);
      remote=clone(entry.payload.state);return reply(remote,++revision,account);
    }});
    await app.start();app.local({...app.state,marks:{...app.state.marks,lateB:known('2026-10-20T12:00:00Z')}});
    account=C;remote={...empty(),marks:{privateC:known('2026-10-20T13:00:00Z')}};revision=8;
    const requestsBeforeSwitch=app.requests.length;await app.api.sync();
    assert.deepEqual(app.state,remote);assert.equal(app.requests.length,requestsBeforeSwitch+1);assert.equal(completed,1);
    assert.ok(JSON.parse(storage.get('ordrum.account.'+B)).state.marks.lateB);
    for(const approval of ['yes',Promise.resolve(true)]){
      const isolated=harness({state:local,storage:new Map([[META,JSON.stringify({accountId:A,revision:1,base:empty()})]]),options:{allowProviderMigration:()=>approval},network:async()=>reply(empty(),0,B)});
      await isolated.start();assert.deepEqual(isolated.state,empty());assert.equal(isolated.requests.length,1);
    }
  });
  await test('a provider migration preserves archived target edits while merging current records',async()=>{
    const targetBase={...empty(),notebook:{removed:{count:2,status:'pending'}}},targetLocal={...empty(),marks:{savedB:known('2026-10-20T10:00:00Z')}};
    const local={...empty(),marks:{oldA:known('2026-10-20T11:00:00Z')}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:2,base:empty()})],['ordrum.account.'+B,JSON.stringify({state:targetLocal,metadata:{accountId:B,revision:5,base:targetBase}})]]);
    const app=harness({state:local,storage,options:{allowProviderMigration:()=>true},network:async entry=>entry.method==='GET'?reply(targetBase,5,B):reply(entry.payload.state,6,B)});
    await app.start();assert.deepEqual(Object.keys(app.state.marks).sort(),['oldA','savedB']);assert.equal(app.state.notebook.removed,undefined);assert.equal(app.requests[1].payload.state.notebook.removed,undefined);
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
  await test('provider polling and debounce can be slower without changing the legacy defaults',async()=>{
    for(const [options,poll,delay]of [[{},20000,1000],[{pollIntervalMs:120000,debounceMs:3000},120000,3000],[{pollIntervalMs:0,debounceMs:-1},20000,1000]]){
      const app=harness({options,network:async()=>reply(empty(),1)});await app.start();assert.equal(app.intervals[0].delay,poll);
      app.api.schedule();assert.equal(app.fireDelay(delay),1);await new Promise(resolve=>setImmediate(resolve));
    }
    const disconnected=harness({options:{isConnected:()=>false}});await disconnected.start();
    assert.equal(disconnected.label.href,'#');assert.equal(disconnected.label.textContent,'进度已保存本机 · 连接账号后同步');
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
    assert.equal(first.statuses.at(-1),'error');assert.ok(first.state.notebook.word);assert.equal(first.api.getHealth().recoveryPending,true);
    const journal=JSON.parse(storage.get(JOURNAL));assert.equal(JSON.parse(storage.get(MAIN))[MARKER],journal.id);
    first.local({...first.state,notebook:{}});blockMetadata=false;
    const state=JSON.parse(storage.get(MAIN));delete state[MARKER];
    const second=harness({state,storage,network:async entry=>entry.method==='GET'?reply(remote,5):reply(entry.payload.state,6)});await second.start();
    assert.equal(second.state.notebook.word,undefined);assert.equal(second.requests[1].payload.state.notebook.word,undefined);
    assert.equal(storage.has(JOURNAL),false);assert.equal(JSON.parse(storage.get(META)).revision,6);assert.equal(second.api.getHealth().recoveryPending,false);
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
  await test('metadata failure does not consume migration consent and recovery preserves later deletions',async()=>{
    const local={...empty(),marks:{oldA:known('2026-10-20T10:00:00Z')}},remote={...empty(),notebook:{removed:{count:2,status:'pending'}}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:1,base:empty()})]]);let blockMetadata=true,completed=0,grant=true;
    const options={allowProviderMigration:pair=>grant&&pair.fromAccountId===A&&pair.toAccountId===B,onProviderMigrationCommitted(){completed++;grant=false;}};
    const first=harness({state:local,storage,options,denyStorage:key=>blockMetadata&&key===META,network:async()=>reply(remote,5,B)});await first.start();
    assert.equal(first.requests.length,1);assert.equal(first.statuses.at(-1),'error');assert.equal(completed,0);assert.equal(grant,true);
    assert.equal(JSON.parse(storage.get(JOURNAL)).providerMigration,true);assert.equal(JSON.parse(storage.get(META)).accountId,A);
    first.local({...first.state,notebook:{},marks:{...first.state.marks,lateB:known('2026-10-20T12:00:00Z')}});blockMetadata=false;
    const state=JSON.parse(storage.get(MAIN));delete state[MARKER];
    const second=harness({state,storage,options,network:async entry=>entry.method==='GET'?reply(remote,5,B):reply(entry.payload.state,6,B)});await second.start();
    assert.equal(second.state.notebook.removed,undefined);assert.ok(second.state.marks.oldA);assert.ok(second.state.marks.lateB);
    assert.equal(second.requests[1].payload.state.notebook.removed,undefined);assert.equal(second.requests[1].payload.state[MARKER],undefined);
    assert.equal(completed,1);assert.equal(grant,false);assert.equal(storage.has(JOURNAL),false);assert.equal(JSON.parse(storage.get(META)).accountId,B);
  });
  await test('migration recovery retains old-account edits made before its atomic state commit',async()=>{
    const local={...empty(),marks:{oldA:known('2026-10-20T10:00:00Z')}},remote={...empty(),marks:{remoteB:known('2026-10-20T11:00:00Z')}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:1,base:empty()})],[MAIN,JSON.stringify(local)]]);let blockMain=true,completed=0;
    const options={allowProviderMigration:pair=>pair.fromAccountId===A&&pair.toAccountId===B,onProviderMigrationCommitted(){completed++;}};
    const first=harness({state:local,storage,options,denyStorage:key=>blockMain&&key===MAIN,network:async()=>reply(remote,7,B)});await first.start();
    assert.equal(first.statuses.at(-1),'error');assert.equal(completed,0);assert.equal(JSON.parse(storage.get(MAIN)).marks.remoteB,undefined);
    const later={...local,marks:{lateA:known('2026-10-20T12:00:00Z')}};storage.set(MAIN,JSON.stringify(later));blockMain=false;
    const second=harness({state:later,storage,options:{...options,allowProviderMigration:()=>false},network:async entry=>entry.method==='GET'?reply(remote,7,B):reply(entry.payload.state,8,B)});await second.start();
    assert.deepEqual(Object.keys(second.state.marks).sort(),['lateA','remoteB']);assert.equal(second.requests[1].payload.state.marks.oldA,undefined);
    assert.ok(JSON.parse(storage.get('ordrum.account.'+A)).state.marks.lateA);assert.equal(completed,1);assert.equal(storage.has(JOURNAL),false);
  });
  await test('a failed migration-grant cleanup leaves a recoverable commit without losing subsequent edits',async()=>{
    const local={...empty(),marks:{oldA:known('2026-10-20T10:00:00Z')}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:1,base:empty()})]]);let cleanupFails=true,completed=0;
    const options={allowProviderMigration:pair=>pair.fromAccountId===A&&pair.toAccountId===B,onProviderMigrationCommitted(){if(cleanupFails)return false;completed++;return true;}};
    const first=harness({state:local,storage,options,network:async()=>reply(null,0,B)});await first.start();
    assert.equal(first.requests.length,1);assert.equal(first.statuses.at(-1),'error');assert.equal(JSON.parse(storage.get(META)).accountId,B);assert.equal(storage.has(JOURNAL),true);
    first.local({...first.state,marks:{lateB:known('2026-10-20T12:00:00Z')}});cleanupFails=false;
    const state=JSON.parse(storage.get(MAIN));delete state[MARKER];
    const second=harness({state,storage,options,network:async entry=>entry.method==='GET'?reply(null,0,B):reply(entry.payload.state,1,B)});await second.start();
    assert.deepEqual(Object.keys(second.state.marks),['lateB']);assert.equal(completed,1);assert.equal(storage.has(JOURNAL),false);assert.equal(second.statuses.at(-1),'synced');
  });
  await test('health distinguishes local records from uploaded records while offline and signed out',async()=>{
    const baseline=empty(),local={...empty(),marks:{word:known('2026-10-21T10:00:00Z')}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:4,base:baseline})]]);
    let connected=true;const app=harness({state:local,storage,online:false,options:{isConnected:()=>connected}});
    await app.start();let health=app.api.getHealth();
    assert.equal(health.status,'offline');assert.equal(health.pending.knownBaseline,true);assert.equal(health.pending.count,1);assert.equal(health.pending.groups.marks,1);assert.equal(health.lastSuccessAt,null);
    app.window.navigator.onLine=true;connected=false;await app.api.sync();health=app.api.getHealth();
    assert.equal(health.status,'local');assert.equal(health.pending.count,1);assert.equal(health.accountId,A);assert.equal(health.action,'reconnect');assert.equal(app.requests.length,0);
  });
  await test('an equal remote confirmation persists an account scoped success time without a PUT',async()=>{
    const stamp='2026-10-21T11:00:00.000Z';const storage=new Map();
    const app=harness({storage,options:{now:()=>stamp},network:async()=>reply(empty(),7)});await app.start();
    assert.equal(app.requests.length,1);assert.equal(app.api.getHealth().lastSuccessAt,stamp);assert.equal(app.api.getHealth().pending.count,0);
    const reloaded=harness({state:app.state,storage,online:false});await reloaded.start();assert.equal(reloaded.api.getHealth().lastSuccessAt,stamp);
    const otherStamp='2026-10-21T12:00:00.000Z';
    const other=harness({state:app.state,storage,options:{now:()=>otherStamp},network:async()=>reply(empty(),3,B)});await other.start();
    assert.equal(other.api.getHealth().accountId,B);assert.equal(other.api.getHealth().lastSuccessAt,otherStamp);
    const back=harness({state:other.state,storage,network:async()=>Response.json({error:'revoked'},{status:403})});await back.start();
    assert.equal(back.api.getHealth().accountId,B);assert.equal(back.api.getHealth().lastSuccessAt,otherStamp);assert.equal(back.api.getHealth().status,'signin');
    const times=JSON.parse(storage.get('ordrum.cloud.health.v1')).accounts;assert.equal(times[A],stamp);assert.equal(times[B],otherStamp);
  });
  await test('failed CAS retries never clear pending changes or claim a successful upload',async()=>{
    const baseline=empty(),local={...empty(),notebook:{word:{count:1,status:'pending'}}};
    const storage=new Map([[META,JSON.stringify({accountId:A,revision:1,base:baseline})]]);
    const app=harness({state:local,storage,network:async entry=>entry.method==='GET'?reply(baseline,1):reply(baseline,2,A,409)});await app.start();
    assert.equal(app.api.getHealth().status,'error');assert.equal(app.api.getHealth().pending.groups.notebook,1);assert.equal(app.api.getHealth().lastSuccessAt,null);
  });
  await test('health keeps queued edits visible after an earlier snapshot succeeds in flight',async()=>{
    let finish,remote=null;const stamp='2026-10-21T13:00:00.000Z';
    const app=harness({state:{...empty(),marks:{one:known(stamp)}},options:{now:()=>stamp},network:async entry=>{
      if(entry.method==='GET')return reply(remote,0);
      return new Promise(resolve=>{finish=()=>{remote=clone(entry.payload.state);resolve(reply(remote,1));};});
    }});
    const starting=app.start();await new Promise(resolve=>setImmediate(resolve));
    app.local({...app.state,marks:{...app.state.marks,two:known(stamp)}});finish();await starting;
    const health=app.api.getHealth();assert.equal(health.status,'pending');assert.equal(health.pending.groups.marks,1);assert.equal(health.lastSuccessAt,stamp);assert.ok(app.state.marks.two);assert.equal(remote.marks.two,undefined);
  });
  await test('health subscriptions report only diagnostics and can unsubscribe safely',async()=>{
    const records=[],app=harness({options:{onHealth:health=>records.push(health)},network:async()=>reply(empty(),2)});
    let count=0;const stop=app.api.onHealth(()=>count++);await app.start();const before=count;stop();app.api.schedule();
    assert.equal(count,before);assert.ok(records.length>1);assert.equal(records.at(-1).status,'synced');
    assert.deepEqual(Object.keys(records.at(-1)).sort(),['accountId','action','connected','lastSuccessAt','online','pending','recoveryPending','status']);
    assert.equal(JSON.stringify(records).includes('token'),false);assert.equal(records.at(-1).state,undefined);
  });
  await test('immutable review event union survives ancestor shortcuts and old clients omitting history',()=>{
    const event={id:'review-one',wordId:'word',sessionId:'round-one',mode:'dictation',outcome:'wrong',at:'2026-10-21T09:00:00.000Z',day:'2026-10-21'};
    const base={reviewEvents:{'review-one':event}},missing={reviewEvents:{}};
    assert.deepEqual(clone(pure.mergeThreeWay(base,clone(base),missing).reviewEvents),base.reviewEvents);
    assert.deepEqual(clone(pure.mergeThreeWay(base,missing,clone(base)).reviewEvents),base.reviewEvents);
    assert.deepEqual(clone(pure.mergeThreeWay(base,missing,missing).reviewEvents),{});
  });
  await test('review event collisions select one canonical whole event and match the review engine',()=>{
    const a={id:'review-same',wordId:'word-a',sessionId:'round-a',mode:'dictation',outcome:'wrong',at:'2026-10-21T09:00:00Z',day:'2026-10-21',untrusted:'discard'};
    const b={day:'2026-10-21',at:'2026-10-21T10:00:00.000Z',outcome:'correct',mode:'dictation',sessionId:'round-b',wordId:'word-b',id:'review-same'};
    const left={reviewEvents:{'review-same':a}},right={reviewEvents:{'review-same':b}};
    const reviewWindow={};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/review.js'),'utf8'),{window:reviewWindow,console,Date});
    const expected=clone(reviewWindow.OrdrumReview.mergeEvents(left.reviewEvents,right.reviewEvents));
    const result=clone(pure.mergeThreeWay(undefined,left,right));assert.deepEqual(result.reviewEvents,expected);assert.deepEqual(clone(pure.mergeThreeWay(undefined,right,left)),result);
    assert.equal(result.reviewEvents['review-same'].untrusted,undefined);assert.equal(result.reviewEvents['review-same'].wordId,'word-a');assert.equal(result.reviewEvents['review-same'].outcome,'wrong');
  });
  await test('review preferences choose the latest whole update with deterministic normalized timestamp ties',()=>{
    const base={reviewPreferences:{reviewLimit:20,newLimit:5,intervals:[1,3,7,14,30],paused:false,updatedAt:'2026-10-20T09:00:00Z'}};
    const local={reviewPreferences:{...base.reviewPreferences,reviewLimit:8,updatedAt:'2026-10-21T09:00:00Z'}};
    const remote={reviewPreferences:{...base.reviewPreferences,newLimit:2,paused:true,updatedAt:'2026-10-21T10:00:00Z'}};
    const result=clone(pure.mergeThreeWay(base,local,remote).reviewPreferences);assert.equal(result.reviewLimit,20);assert.equal(result.newLimit,2);assert.equal(result.paused,true);assert.equal(result.updatedAt,'2026-10-21T10:00:00.000Z');
    const tied={reviewPreferences:{...remote.reviewPreferences,updatedAt:local.reviewPreferences.updatedAt}};
    assert.deepEqual(clone(pure.mergeThreeWay(base,local,tied)),clone(pure.mergeThreeWay(base,tied,local)));
    const omitted=pure.mergeThreeWay(base,local,{marks:{}});assert.equal(omitted.reviewPreferences.reviewLimit,8);
  });
  await test('first sync preserves local review history preferences and notebook units even without old progress fields',async()=>{
    const event={id:'review-first',wordId:'word',sessionId:'round-first',mode:'flashcard',outcome:'known',at:'2026-10-21T09:00:00Z',day:'2026-10-21'};
    const remote={...empty(),mode:'dictation',marks:{remote:known('2026-10-20T09:00:00Z')}};
    for(const extra of [{reviewEvents:{'review-first':event}},{reviewPreferences:{reviewLimit:9,updatedAt:'2026-10-21T09:00:00Z'}},{notebookUnits:{'unit-one':{wordIds:['word']}}}]){
      const app=harness({state:{...empty(),...extra},network:async entry=>entry.method==='GET'?reply(remote,4):reply(entry.payload.state,5)});await app.start();
      assert.equal(app.requests.length,2);assert.ok(app.state.marks.remote);
      if(extra.reviewEvents)assert.ok(app.requests[1].payload.state.reviewEvents['review-first']);
      if(extra.reviewPreferences)assert.equal(app.requests[1].payload.state.reviewPreferences.reviewLimit,9);
      if(extra.notebookUnits)assert.deepEqual(app.requests[1].payload.state.notebookUnits,extra.notebookUnits);
    }
  });
  await test('default normalized review preferences still allow a fresh phone to adopt the complete remote snapshot',async()=>{
    const defaults={method:'recall',targetMinutes:60,chunkSize:20,reviewLimit:90,newLimit:30,intervals:[1,3,7,14,30],scope:{kind:'selected',chapterIds:[],notebookChapterIds:[]},paused:false,updatedAt:'1970-01-01T00:00:00.000Z'};
    const remote={...empty(),mode:'dictation',reviewPreferences:{...defaults,reviewLimit:7,updatedAt:'2026-10-21T09:00:00.000Z'}};
    const app=harness({state:{...empty(),reviewPreferences:defaults,reviewEvents:{},notebookUnits:{}},network:async()=>reply(remote,5)});await app.start();assert.equal(app.requests.length,1);assert.equal(app.state.mode,'dictation');assert.deepEqual(app.state.reviewPreferences,remote.reviewPreferences);
  });
  await test('plan records and immutable first answers survive ancestor shortcuts and omitted snapshots',()=>{
    const plan={id:'plan-one',status:'active',stageIndex:0,elapsedMs:1000,updatedAt:'2026-10-21T09:00:00Z',stages:[{id:'stage-one'}],results:{'stage-one':{word:{outcome:'wrong',at:'2026-10-21T09:00:00Z'}}}};
    const base={planSessions:{'plan-one':plan}},missing={planSessions:{}};
    for(const [left,right] of [[base,missing],[missing,base],[missing,missing]]){
      const merged=clone(pure.mergeThreeWay(base,clone(left),clone(right)));assert.equal(merged.planSessions['plan-one'].results['stage-one'].word.outcome,'wrong');assert.equal(merged.planSessions['plan-one'].elapsedMs,1000);
    }
  });
  await test('concurrent plan progress unions stages and first attempts with deterministic complete metadata',()=>{
    const make=(updatedAt,status,results)=>({id:'plan-one',method:status==='paused'?'dictation':'recall',status,updatedAt,createdAt:'2026-10-21T08:00:00Z',wordIds:['one','two','three'],preferences:{label:status},stages:[{id:'stage-one'},{id:'stage-two'},{id:'stage-three'}],results,stageIndex:99});
    const left=make('2026-10-21T09:00:00Z','active',{'stage-one':{one:{outcome:'wrong',at:'2026-10-21T08:30:00Z'}},'stage-two':{two:{outcome:'correct',at:'2026-10-21T08:50:00Z'}}});
    Object.assign(left,{elapsedMs:60000,completedStages:{'stage-one':true},resolvedStages:{'stage-one':['two','one']},stageSessions:{'stage-two':{deck:['one','two'],draft:'old',updatedAt:'2026-10-21T08:00:00Z'}}});
    const right=make('2026-10-21T10:00:00Z','paused',{'stage-one':{one:{outcome:'correct',at:'2026-10-21T09:30:00Z'},two:{outcome:'known',at:'2026-10-21T09:00:00Z'}}});
    Object.assign(right,{elapsedMs:40000,completedStages:{'stage-two':true},resolvedStages:{'stage-one':['three','one']},stageSessions:{'stage-two':{deck:['three'],draft:'new',updatedAt:'2026-10-21T10:00:00Z'}}});
    const l={planSessions:{'plan-one':left}},r={planSessions:{'plan-one':right}},before=JSON.stringify([l,r]);
    const merged=clone(pure.mergeThreeWay(undefined,l,r)),row=merged.planSessions['plan-one'];
    assert.deepEqual(clone(pure.mergeThreeWay(undefined,r,l)),merged);assert.equal(JSON.stringify([l,r]),before);
    assert.equal(row.status,'paused');assert.equal(row.method,'dictation');assert.deepEqual(row.preferences,{label:'paused'});assert.equal(row.results['stage-one'].one.outcome,'wrong');assert.ok(row.results['stage-two'].two);
    assert.equal(row.stageIndex,2);assert.equal(row.elapsedMs,60000);assert.deepEqual(row.stageSessions['stage-two'],right.stageSessions['stage-two']);assert.deepEqual([...row.resolvedStages['stage-one']].sort(),['one','three','two']);
  });
  await test('merged plan stage index stops at the first unfinished stage despite a later completed stage',()=>{
    const l={planSessions:{p:{id:'p',stageIndex:99,stages:[{id:'first'},{id:'second'},{id:'third'}],completedStages:{third:true},updatedAt:'2026-10-21T10:00:00Z'}}};
    assert.equal(pure.mergeThreeWay(undefined,l,{}).planSessions.p.stageIndex,0);
    const r={planSessions:{p:{...l.planSessions.p,completedStages:{first:true}}}};
    assert.equal(pure.mergeThreeWay(undefined,l,r).planSessions.p.stageIndex,1);
  });
  await test('resolved plan stages preserve frozen baseline order before concurrent additional words',()=>{
    const make=ids=>({planSessions:{p:{id:'p',stages:[{id:'stage'}],resolvedStages:{stage:ids},updatedAt:'2026-10-21T10:00:00Z'}}});
    const base=make(['z','a']),left=make(['z','a','c']),right=make(['z','a','b']);
    const row=pure.mergeThreeWay(base,left,right).planSessions.p;assert.deepEqual(clone(row.resolvedStages.stage),['z','a','b','c']);assert.deepEqual(clone(pure.mergeThreeWay(base,right,left).planSessions),clone(pure.mergeThreeWay(base,left,right).planSessions));
    assert.deepEqual(clone(pure.mergeThreeWay(undefined,make(['z','a']),{}).planSessions.p.resolvedStages.stage),['z','a']);
  });
  await test('same plan attempt timestamp conflicts select a canonical whole answer and reject unsafe IDs',()=>{
    const make=outcome=>({planSessions:{p:{id:'p',stages:[{id:'stage'}],results:{stage:{word:{outcome,at:'2026-10-21T10:00:00Z',extra:'discard'},invalid:{outcome:'correct',at:'bad'}}}}}});
    const left=make('wrong'),right=make('correct');left.planSessions.constructor={id:'constructor'};
    const a=clone(pure.mergeThreeWay(undefined,left,right)),b=clone(pure.mergeThreeWay(undefined,right,left));assert.deepEqual(a,b);assert.equal(a.planSessions.p.results.stage.word.outcome,'correct');assert.deepEqual(Object.keys(a.planSessions.p.results.stage.word),['outcome','at']);assert.equal(a.planSessions.p.results.stage.invalid,undefined);assert.equal(Object.hasOwn(a.planSessions,'constructor'),false);
  });
  await test('a plan-only local snapshot is merged and uploaded instead of being treated as an empty new device',async()=>{
    const plan={id:'plan-local',wordIds:['word'],stages:[{id:'stage'}],status:'paused',updatedAt:'2026-10-21T10:00:00Z'},local={...empty(),planSessions:{'plan-local':plan},activePlanId:'plan-local'};
    const remote={...empty(),marks:{remote:known('2026-10-21T09:00:00Z')}};
    const app=harness({state:local,network:async entry=>entry.method==='GET'?reply(remote,4):reply(entry.payload.state,5)});await app.start();
    assert.equal(app.requests.length,2);assert.ok(app.requests[1].payload.state.planSessions['plan-local']);assert.equal(app.state.activePlanId,'plan-local');assert.ok(app.state.marks.remote);
  });
  await test('plan records and active plan positions have distinct sync health change groups',()=>{
    const plan={id:'p',wordIds:['word']};const result=clone(pure.changeSummary({planSessions:{},activePlanId:null},{planSessions:{p:plan},activePlanId:'p'}));
    assert.deepEqual(result.groups,{planSessions:1,positions:1});assert.equal(result.count,2);
  });
  await test('standalone cloud memory-method preferences exactly match the review engine normalizer',()=>{
    const reviewWindow={};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/review.js'),'utf8'),{window:reviewWindow,console,Date});
    for(const input of [undefined,{}, {reviewLimit:20,newLimit:5}, {method:'quick',reviewLimit:160,newLimit:40,targetMinutes:60,chunkSize:25,scope:{kind:'chapters',chapterIds:[3,1,3],notebookChapterIds:['today','constructor']}}, {method:'bad',targetMinutes:0,chunkSize:999,reviewLimit:999,newLimit:-1,intervals:[1,2,5,12,30],scope:{kind:'bad'},updatedAt:'bad'}]){
      const expected=clone(reviewWindow.OrdrumReview.cleanPreferences(input));const merged=clone(pure.mergeThreeWay(undefined,{reviewPreferences:input || {}},{}).reviewPreferences);assert.deepEqual(merged,expected);
    }
  });
  await test('legacy untouched daily defaults also allow complete remote adoption without a blank overwrite',async()=>{
    const defaults={reviewLimit:20,newLimit:5,intervals:[1,3,7,14,30],paused:false,updatedAt:'1970-01-01T00:00:00.000Z'},remote={...empty(),mode:'dictation'};
    const app=harness({state:{...empty(),reviewPreferences:defaults},network:async()=>reply(remote,5)});await app.start();assert.equal(app.requests.length,1);assert.equal(app.state.mode,'dictation');
  });
  console.log(`\n${passed} cloud checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
