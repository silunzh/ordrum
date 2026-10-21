const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../public/sync-health.js'),'utf8');
const A='a'.repeat(64),B='b'.repeat(64),KEY='ordrum.recovery.v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const scope={accountId:A,bookId:'rivstart-a1-a2'};
function harness({storage=new Map(),denyStorage=false,health={status:'offline',online:false,pending:{knownBaseline:true,count:1,groups:{marks:1}}}}={}){
  let listener;
  const window={localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){if(denyStorage)throw new Error('quota');storage.set(key,value);}},document:{activeElement:null},OrdrumCloud:{getHealth:()=>health,onHealth(fn){listener=fn;fn(health);return()=>{listener=null;};}}};
  vm.runInNewContext(source,{window,console,Date},{filename:'public/sync-health.js'});
  return {api:window.OrdrumSyncHealth,storage,window,setHealth(value){health=value;listener?.(value);}};
}
function target(){
  let html='';const buttons=new Map();
  return {get innerHTML(){return html;},set innerHTML(value){html=value;buttons.clear();for(const action of [...value.matchAll(/data-health-action="([^"]+)"/g)].map(match=>match[1]))buttons.set(action,{dataset:{healthAction:action},addEventListener(_,fn){this.click=fn;},focus(){this.focused=true;}});},querySelectorAll(){return [...buttons.values()];},querySelector(selector){return buttons.get(selector.match(/="([^"]+)"/)?.[1])||null;},contains(){return false;},buttons};
}
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('comparison counts records honestly and separates added changed removed fields',()=>{
  const {api}=harness();
  const before={tasks:[{id:'a',name:'A'},{id:'gone',name:'G'}],marks:{a:'review'},notebook:{a:{count:1}},reviewEvents:{old:{id:'old'}}};
  const after={tasks:[{id:'a',name:'Renamed'},{id:'new',name:'N'}],marks:{a:'known',b:'review'},notebook:{a:{count:1}},reviewEvents:{old:{id:'old'},next:{id:'next'}},mode:'flashcard'};
  const originals=JSON.stringify([before,after]);const result=clone(api.preview(before,after));
  assert.deepEqual(result.tasks,{added:1,changed:1,removed:1,total:3});
  assert.deepEqual(result.marks,{added:1,changed:1,removed:0,total:2});
  assert.equal(result.notebook.total,0);assert.equal(result.reviewEvents.added,1);assert.equal(result.other.total,1);assert.equal(result.count,7);assert.equal(JSON.stringify([before,after]),originals);
  assert.match(api.previewMarkup(result),/不代表不同单词数/);
});
test('snapshot allowlist preserves learning data and strips secrets and commit markers recursively',()=>{
  const {api}=harness();
  const state=JSON.parse('{"marks":{"åäö":{"status":"known","accessToken":"bad"}},"reviewEvents":{"event":{"id":"event","wordId":"åäö"}},"tasks":[{"id":"task-token-allowed","name":"A","password":"bad","session":{"__cloudCommitId":"private","draft":"hej"}}],"selectedBook":"notebook","reviewPreferences":{"dailyLimit":20},"token":"top-secret","connection":{"token":"secret"},"__proto__":{"polluted":true},"__cloudCommitId":"internal"}');
  const clean=clone(api.safeState(state));
  assert.ok(clean.marks['åäö']);assert.ok(clean.reviewEvents.event);assert.equal(clean.tasks[0].session.draft,'hej');assert.equal(clean.selectedBook,'notebook');assert.equal(clean.reviewPreferences.dailyLimit,20);
  assert.equal(JSON.stringify(clean).includes('secret'),false);assert.equal(JSON.stringify(clean).includes('private'),false);assert.equal(JSON.stringify(clean).includes('password'),false);assert.equal({}.polluted,undefined);
});
test('recovery snapshots are scoped by opaque account and book and export normal version one backups',()=>{
  const {api}=harness();const stamp='2026-10-21T12:00:00Z';
  const saved=api.saveRecovery({tasks:[{id:'a'}],reviewEvents:{event:{wordId:'åäö'}}},{...scope,now:stamp,reason:'import'});
  assert.equal(saved.ok,true);const record=api.getRecovery(scope);assert.equal(record.backup.app,'ordrum');assert.equal(record.backup.version,1);assert.equal(record.backup.book,scope.bookId);assert.equal(record.backup.state.tasks[0].id,'a');
  assert.equal(api.getRecovery({...scope,accountId:B}),null);assert.equal(api.getRecovery({...scope,accountId:null}),null);assert.equal(api.getRecovery({...scope,bookId:'another'}),null);
  record.backup.state.tasks[0].id='mutated';assert.equal(api.getRecovery(scope).backup.state.tasks[0].id,'a');
});
test('anonymous recovery cannot be fetched through an invalid account scope',()=>{
  const {api}=harness();assert.equal(api.saveRecovery({marks:{word:'known'}},{bookId:'rivstart',accountId:null}).ok,true);
  assert.ok(api.getRecovery({bookId:'rivstart'}));assert.equal(api.getRecovery({bookId:'rivstart',accountId:'invalid'}),null);assert.equal(api.saveRecovery({},{bookId:'rivstart',accountId:'invalid'}).ok,false);
});
test('failed backup persistence preserves the earlier recovery point and prevents reporting success',()=>{
  const storage=new Map(),first=harness({storage});first.api.saveRecovery({marks:{old:'known'}},scope);
  const blocked=harness({storage,denyStorage:true});const result=blocked.api.saveRecovery({marks:{new:'known'}},scope);
  assert.equal(result.ok,false);assert.equal(result.error,'storage-unavailable');assert.ok(blocked.api.getRecovery(scope).backup.state.marks.old);assert.equal(blocked.api.getRecovery(scope).backup.state.marks.new,undefined);
});
test('oversized or deeply malformed snapshots are bounded before storage',()=>{
  const {api,storage}=harness();assert.equal(api.saveRecovery({overrides:{word:{english:'x'.repeat(1900000)}}},scope).error,'too-large');assert.equal(storage.has(KEY),false);
  let nested={};for(let i=0;i<26;i++)nested={next:nested};assert.equal(api.saveRecovery({studySession:nested},scope).ok,false);assert.equal(storage.has(KEY),false);
});
test('storage retains only the latest recovery per scope with at most six account book scopes',()=>{
  const {api,storage}=harness();for(let i=0;i<8;i++)assert.equal(api.saveRecovery({marks:{[i]:'known'}},{...scope,bookId:'book-'+i,now:`2026-10-21T12:0${i}:00Z`}).ok,true);
  assert.equal(Object.keys(JSON.parse(storage.get(KEY)).records).length,6);assert.equal(api.getRecovery({...scope,bookId:'book-0'}),null);assert.ok(api.getRecovery({...scope,bookId:'book-7'}));
  api.saveRecovery({marks:{replacement:'review'}},{...scope,bookId:'book-7',now:'2020-01-01T00:00:00Z'});assert.ok(api.getRecovery({...scope,bookId:'book-7'}).backup.state.marks.replacement);assert.equal(Object.keys(JSON.parse(storage.get(KEY)).records).length,6);
});
test('corrupt storage and injected cross account records do not produce recovery exports',()=>{
  const storage=new Map([[KEY,'{bad']]);let app=harness({storage});assert.equal(app.api.getRecovery(scope),null);
  app.api.saveRecovery({marks:{word:'known'}},scope);let store=JSON.parse(storage.get(KEY));const key=Object.keys(store.records)[0];store.records[key].scope.accountId=B;storage.set(KEY,JSON.stringify(store));assert.equal(app.api.getRecovery(scope),null);
});
test('recovery reads reconstruct the backup envelope instead of exporting arbitrary stored metadata',()=>{
  const app=harness();app.api.saveRecovery({marks:{word:'known'}},scope);const stored=JSON.parse(app.storage.get(KEY));const row=Object.values(stored.records)[0];row.backup.token='must-not-export';row.secret='private';row.backup.state.connection={token:'hidden'};app.storage.set(KEY,JSON.stringify(stored));
  const record=app.api.getRecovery(scope);assert.ok(record.backup.state.marks.word);assert.equal(JSON.stringify(record).includes('must-not-export'),false);assert.equal(JSON.stringify(record).includes('private'),false);assert.equal(JSON.stringify(record).includes('hidden'),false);
});
test('health panel does not confuse unknown baseline with known upload counts and escapes the target',()=>{
  const app=harness({health:{status:'local',online:true,pending:{knownBaseline:false,count:27,groups:{marks:27}}}});const element=target();let reconnect=0;
  app.api.mount(element,{getScope:()=>scope,getTarget:()=>'<img src=x>',onReconnect(){reconnect++;}});
  assert.match(element.innerHTML,/连接并核对后显示/);assert.ok(!element.innerHTML.includes('27 项记录变化'));assert.match(element.innerHTML,/&lt;img src=x&gt;/);element.buttons.get('reconnect')?.click();
  app.setHealth({status:'signin',action:'reconnect',online:true,pending:{knownBaseline:true,count:2,groups:{marks:1,notebook:1}}});
  assert.match(element.innerHTML,/2 项记录变化待上传/);assert.match(element.innerHTML,/重新连接/);element.buttons.get('reconnect').click();assert.equal(reconnect,1);
});
test('recovery actions recheck current account scope before exporting or restoring',()=>{
  const app=harness();app.api.saveRecovery({marks:{a:'known'}},scope);let active=scope,exported=null,restored=null;const element=target();
  app.api.mount(element,{getScope:()=>active,onExportRecovery(value){exported=value;},onRestoreRecovery(value){restored=value;}});
  element.buttons.get('export').click();assert.ok(exported.state.marks.a);element.buttons.get('restore').click();assert.ok(restored.state.marks.a);
  exported=null;active={...scope,accountId:B};element.buttons.get('export').click();assert.equal(exported,null);app.api.refresh();assert.ok(!element.buttons.has('restore'));
});
test('an incomplete sync journal hides recovery restore until durable account adoption completes',()=>{
  const app=harness();app.api.saveRecovery({marks:{a:'known'}},scope);const element=target();app.api.mount(element,{getScope:()=>scope});assert.ok(element.buttons.has('restore'));
  app.setHealth({status:'error',online:true,recoveryPending:true,pending:{knownBaseline:true,count:1,groups:{marks:1}}});assert.equal(element.buttons.has('restore'),false);assert.match(element.innerHTML,/同步恢复记录尚未提交/);
});
test('recovery snapshots preserve complete plan progress and active plan position without nested credentials',()=>{
  const app=harness(),plan={id:'p',status:'paused',results:{stage:{word:{outcome:'wrong',at:'2026-10-21T12:00:00Z'}}},resolvedStages:{stage:['word']},stageSessions:{stage:{draft:'åäö',updatedAt:'2026-10-21T12:00:00Z',token:'secret'}},completedStages:{stage:true},preferences:{method:'quick',chunkSize:25}};
  assert.equal(app.api.saveRecovery({planSessions:{p:plan},activePlanId:'p'},scope).ok,true);
  const state=clone(app.api.getRecovery(scope).backup.state);assert.equal(state.activePlanId,'p');assert.equal(state.planSessions.p.results.stage.word.outcome,'wrong');assert.equal(state.planSessions.p.stageSessions.stage.draft,'åäö');assert.equal(state.planSessions.p.stageSessions.stage.token,undefined);assert.equal(state.planSessions.p.preferences.method,'quick');
});
test('recovery comparison reports plan records separately and includes active plan position changes',()=>{
  const {api}=harness(),before={planSessions:{old:{id:'old'},same:{id:'same',status:'paused'}},activePlanId:'old'},after={planSessions:{next:{id:'next'},same:{id:'same',status:'completed'}},activePlanId:'next'};
  const comparison=clone(api.preview(before,after));assert.deepEqual(comparison.planSessions,{added:1,changed:1,removed:1,total:3});assert.equal(comparison.other.total,1);assert.equal(comparison.count,4);assert.match(api.previewMarkup(comparison),/学习计划/);
});
test('pending sync health labels plan sessions without exposing their content',()=>{
  const app=harness({health:{status:'pending',online:true,pending:{knownBaseline:true,count:2,groups:{planSessions:1,positions:1}}}}),element=target();app.api.mount(element,{getScope:()=>scope});assert.match(element.innerHTML,/学习计划 1/);assert.match(element.innerHTML,/学习位置 1/);
});
console.log(`\n${passed} sync health checks passed.`);
