const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {stripTypeScriptTypes} = require('node:module');
const {DatabaseSync} = require('node:sqlite');
const {webcrypto,createHash} = require('node:crypto');
const {drizzle} = require('drizzle-orm/sqlite-proxy');
const orm = require('drizzle-orm');
const sqliteCore = require('drizzle-orm/sqlite-core');

// Exercise the actual route and ORM-generated SQL against SQLite. Only the
// platform authentication boundary and D1 transport are substituted locally.
const database = new DatabaseSync(':memory:');
const migrationDirectory=path.resolve(__dirname,'../drizzle');
for(const file of fs.readdirSync(migrationDirectory).filter(file=>file.endsWith('.sql')).sort())database.exec(fs.readFileSync(path.join(migrationDirectory,file),'utf8'));
const db = drizzle(async (query,parameters,method)=>{
  const statement=database.prepare(query);
  if(method==='run') {statement.run(...parameters);return {rows:[]};}
  return {rows:statement.all(...parameters).map(row=>Object.values(row))};
});
function compiled(sourcePath,dependencies,exportNames) {
  let code=stripTypeScriptTypes(fs.readFileSync(sourcePath,'utf8'),{mode:'transform'});
  code=code.replace(/^import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/gm,(_all,names,module)=>`const {${names}}=dependencies[${JSON.stringify(module)}];`);
  code=code.replace(/^export\s+/gm,'');
  const sandbox={dependencies,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,console};
  vm.createContext(sandbox);
  vm.runInContext(code+`\nglobalThis.result={${exportNames.join(',')}};`,sandbox,{filename:sourcePath});
  return sandbox.result;
}
const {progressSnapshots}=compiled(path.resolve(__dirname,'../db/schema.ts'),{'drizzle-orm/sqlite-core':sqliteCore},['progressSnapshots']);
function account(userId) {return {userId,email:`${userId}@example.test`,displayName:userId,fullName:null};}
function route(user,{unavailable=false,authError=false}={}) {
  const handlers=compiled(path.resolve(__dirname,'../app/api/progress/route.ts'),{
    'drizzle-orm':orm,'../../../db':{getDb(){if(unavailable)throw new Error('private database binding');return db;}},
    '../../../db/schema':{progressSnapshots},'../../chatgpt-auth':{async getChatGPTUser(){if(authError)throw new Error('private auth detail');return user;}},
  },['GET','PUT']);
  return {...handlers,request:(state={},baseRevision=0,options={})=>request(state,baseRevision,{expectedAccountId:createHash('sha256').update(user?.userId||'anonymous').digest('hex'),...options})};
}
const origin='https://ordrum.example';
function request(state={},baseRevision=0,{headers={},body,expectedAccountId}={}) {
  return new Request(`${origin}/api/progress`,{method:'PUT',headers:{origin,'content-type':'application/json',...headers},body:body===undefined?JSON.stringify({state,baseRevision,expectedAccountId}):body});
}
async function response(result,status) {
  assert.equal(result.status,status);
  assert.match(result.headers.get('cache-control'),/private/);
  assert.match(result.headers.get('cache-control'),/no-store/);
  assert.equal(result.headers.get('vary'),'Cookie');
  return result.json();
}
let passed=0;
async function test(name,fn) {await fn();passed++;console.log(`PASS ${name}`);}

(async()=>{
  await test('anonymous reads and writes require sign-in and cannot be cached',async()=>{
    const anonymous=route(null);
    assert.equal((await response(await anonymous.GET(),401)).error,'sign_in_required');
    assert.equal((await response(await anonymous.PUT(anonymous.request()),401)).error,'sign_in_required');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM progress_snapshots').get().count,0);
  });
  await test('a new signed-in account has its own empty revision zero snapshot',async()=>{
    const value=await response(await route(account('empty')).GET(),200);
    assert.equal(value.state,null);assert.equal(value.revision,0);assert.equal(value.lastUpdated,null);
    assert.equal(value.accountId,createHash('sha256').update('empty').digest('hex'));
    assert.notEqual(value.accountId,'empty');
  });
  await test('the first snapshot persists and is readable only by its authenticated account',async()=>{
    const a=route(account('isolation-a')),b=route(account('isolation-b'));
    const state={marks:{word:{status:'known'}},tasks:[],notebook:{}};
    const saved=await response(await a.PUT(a.request(state)),200);
    assert.equal(saved.revision,1);assert.deepEqual(saved.state,state);
    assert.deepEqual((await response(await a.GET(),200)).state,state);
    const other=await response(await b.GET(),200);assert.equal(other.state,null);assert.equal(other.revision,0);
  });
  await test('client-provided account identifiers cannot choose another account partition',async()=>{
    const a=route(account('identity-a')),b=route(account('identity-b'));
    const malicious={state:{marks:{},userId:'identity-b'},baseRevision:0,expectedAccountId:createHash('sha256').update('identity-a').digest('hex'),userId:'identity-b',accountId:'identity-b'};
    await response(await a.PUT(a.request({},0,{body:JSON.stringify(malicious)})),200);
    assert.equal((await response(await b.GET(),200)).state,null);
    assert.equal((await response(await a.GET(),200)).state.userId,'identity-b');
  });

  await test('an account switch between GET and PUT cannot upload the previous account data',async()=>{
    const a=route(account('race-account-a')),b=route(account('race-account-b'));
    const before=await response(await a.GET(),200);
    const rejected=await response(await b.PUT(b.request({privateNote:'account A progress'},before.revision,{expectedAccountId:before.accountId})),409);
    assert.equal(rejected.state,null);assert.equal(rejected.revision,0);
    assert.notEqual(rejected.accountId,before.accountId);
    assert.equal((await response(await b.GET(),200)).state,null);
    assert.equal((await response(await a.GET(),200)).state,null);
  });
  await test('every mutation requires an explicit account precondition from a previous GET',async()=>{
    const api=route(account('precondition'));
    const value=await response(await api.PUT(api.request({},0,{expectedAccountId:undefined})),400);
    assert.equal(value.error,'account_precondition_required');
    await response(await api.PUT(api.request({},0,{expectedAccountId:'not-an-account-hash'})),400);
    assert.equal((await response(await api.GET(),200)).revision,0);
  });

  await test('writes reject missing, foreign, or cross-site origins',async()=>{
    const api=route(account('csrf'));
    const missing=request();missing.headers.delete('origin');
    assert.equal((await response(await api.PUT(missing),403)).error,'same_origin_required');
    await response(await api.PUT(api.request({},0,{headers:{origin:'https://other.example'}})),403);
    await response(await api.PUT(api.request({},0,{headers:{origin:`${origin}:444`}})),403);
    await response(await api.PUT(api.request({},0,{headers:{'sec-fetch-site':'cross-site'}})),403);
    assert.equal((await response(await api.GET(),200)).revision,0);
  });
  await test('writes require JSON while accepting a valid JSON charset parameter',async()=>{
    const api=route(account('content-type'));
    assert.equal((await response(await api.PUT(api.request({},0,{headers:{'content-type':'text/plain'}})),415)).error,'json_required');
    await response(await api.PUT(api.request({},0,{headers:{'content-type':'application/json; charset=utf-8'}})),200);
  });
  await test('malformed JSON and malformed UTF-8 do not create snapshots',async()=>{
    const api=route(account('malformed'));
    assert.equal((await response(await api.PUT(api.request({},0,{body:'{"broken"'})),400)).error,'invalid_payload');
    await response(await api.PUT(api.request({},0,{body:new Uint8Array([0xff])})),400);
    await response(await api.PUT(api.request({},0,{body:'[]'})),400);
    assert.equal((await response(await api.GET(),200)).revision,0);
  });
  await test('invalid revisions and invalid state collections are rejected without changing progress',async()=>{
    const api=route(account('invalid'));
    for(const revision of [-1,0.5,'0',null,Number.MAX_SAFE_INTEGER])await response(await api.PUT(api.request({},revision)),400);
    for(const state of [null,[],{marks:[]},{overrides:[]},{notebook:[]},{tasks:[null]},{selectedChapters:[0]},{studySession:[]}])await response(await api.PUT(api.request(state)),400);
    assert.equal((await response(await api.GET(),200)).revision,0);
  });
  await test('prototype keys and excessive nesting cannot enter a synced snapshot',async()=>{
    const api=route(account('structure'));
    await response(await api.PUT(api.request({},0,{body:'{"baseRevision":0,"state":{"__proto__":{"polluted":true}}}'})),400);
    let deep={};for(let index=0;index<34;index++)deep={nested:deep};
    await response(await api.PUT(api.request(deep)),400);
    assert.equal((await response(await api.GET(),200)).revision,0);
    await response(await api.PUT(api.request({},0,{body:'{"baseRevision":0,"state":{"value":1e400}}'})),400);
  });
  await test('the size limit applies to both declared and actual request bytes',async()=>{
    const api=route(account('large'));
    const declared=await response(await api.PUT(api.request({},0,{headers:{'content-length':String(1024*1024+1)}})),413);
    assert.equal(declared.error,'state_too_large');assert.equal(declared.maxBytes,1024*1024);
    await response(await api.PUT(api.request({note:'x'.repeat(1024*1024)})),413);
    assert.equal((await response(await api.GET(),200)).revision,0);
  });
  await test('a stale revision returns the current snapshot instead of overwriting it',async()=>{
    const api=route(account('revision'));
    await response(await api.PUT(api.request({marks:{a:{status:'known'}}})),200);
    const updated=await response(await api.PUT(api.request({marks:{a:{status:'review'}}},1)),200);
    assert.equal(updated.revision,2);
    const conflict=await response(await api.PUT(api.request({marks:{b:{status:'known'}}},1)),409);
    assert.equal(conflict.revision,2);assert.deepEqual(conflict.state,{marks:{a:{status:'review'}}});
    assert.deepEqual((await response(await api.GET(),200)).state,conflict.state);
  });
  await test('simultaneous initial writes cannot both create revision one',async()=>{
    const api=route(account('initial-race'));
    const results=await Promise.all([api.PUT(api.request({device:'phone'})),api.PUT(api.request({device:'desktop'}))]);
    assert.deepEqual(results.map(value=>value.status).sort(),[200,409]);
    const winner=await results.find(value=>value.status===200).json();
    const saved=await response(await api.GET(),200);assert.equal(saved.revision,1);assert.deepEqual(saved.state,winner.state);
  });
  await test('simultaneous edits at the same revision commit exactly one mutation',async()=>{
    const api=route(account('update-race'));
    await response(await api.PUT(api.request({device:'initial'})),200);
    const results=await Promise.all([api.PUT(api.request({device:'phone'},1)),api.PUT(api.request({device:'desktop'},1))]);
    assert.deepEqual(results.map(value=>value.status).sort(),[200,409]);
    const winner=await results.find(value=>value.status===200).json();
    const saved=await response(await api.GET(),200);assert.equal(saved.revision,2);assert.deepEqual(saved.state,winner.state);
  });
  await test('unrelated accounts can update independently at the same revision',async()=>{
    const a=route(account('parallel-a')),b=route(account('parallel-b'));
    await Promise.all([a.PUT(a.request({device:'A'})),b.PUT(b.request({device:'B'}))]);
    const [one,two]=await Promise.all([response(await a.GET(),200),response(await b.GET(),200)]);
    assert.deepEqual(one.state,{device:'A'});assert.deepEqual(two.state,{device:'B'});
    assert.notEqual(one.accountId,two.accountId);
  });
  await test('database or authentication outages fail closed without private error details',async()=>{
    for(const options of [{unavailable:true},{authError:true}]){
      const api=route(account('unavailable'),options);
      assert.deepEqual(await response(await api.GET(),503),{error:'cloud_unavailable'});
      assert.deepEqual(await response(await api.PUT(api.request()),503),{error:'cloud_unavailable'});
    }
  });
  console.log(`\n${passed} server checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>database.close());
