const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');
const sourcePath=path.resolve(__dirname,'../public/github-sync.js');
const source=fs.readFileSync(sourcePath,'utf8');
const KEY='ordrum.github.connection.v1',GRANT='ordrum.github.migration.v1';
const token='github_pat_'+'a'.repeat(50);
const config={owner:'silunzh',repo:'ordrum-progress',token,remember:false};
const accountId=createHash('sha256').update('ordrum:github:7:12').digest('hex');
const prior='a'.repeat(64);
const sha=number=>number.toString(16).padStart(40,'0');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function response(value,status=200,headers={}) {return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});}
function storage(map,{deny=false,denyRemove=false}={}) {return {getItem(key){return map.get(key)||null;},setItem(key,value){if(deny)throw new Error('no storage');map.set(key,value);},removeItem(key){if(denyRemove)throw new Error('no remove');map.delete(key);}};}
function harness({session=new Map(),local=new Map(),saved=true,fetchHook,localOptions={},sourceOverride=source}={}) {
  if(saved&&!session.has(KEY)&&!local.has(KEY))session.set(KEY,JSON.stringify(config));
  const requests=[],notices=[],controls=new Map();let writes=0;
  const server={private:true,repoStatus:200,userStatus:200,branchStatus:200,record:null,revision:0,sha:null,fileOverride:null,writeStatus:200,visibility:'private',repoId:12};
  function file(record=server.record,blobSha=server.sha) {
    if(!record)return response({message:'missing'},404);
    const text=JSON.stringify(record),data=Buffer.from(text);
    return response({type:'file',encoding:'base64',size:data.length,sha:blobSha,content:data.toString('base64')});
  }
  function commit(state,revision=server.revision+1,version=1){server.revision=revision;server.sha=sha(revision);server.record={version,accountId,revision,updatedAt:'2026-10-21T12:00:00.000Z',state};}
  const window={crypto:webcrypto,AbortController,setTimeout,clearTimeout,btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary'),
    sessionStorage:storage(session),localStorage:storage(local,localOptions),OrdrumCloud:{updateConnectionStatus(){}},
    async fetch(url,options){
      const request={url,options,body:options.body?JSON.parse(options.body):null};requests.push(request);
      if(fetchHook){const custom=await fetchHook(request,{server,commit,file});if(custom)return custom;}
      const target=new URL(url);
      if(target.pathname==='/user')return response({id:7,login:'silunzh'},server.userStatus);
      if(target.pathname==='/repos/silunzh/ordrum-progress')return response({id:server.repoId,private:server.private,visibility:server.visibility,default_branch:'main',full_name:'silunzh/ordrum-progress'},server.repoStatus);
      if(target.pathname==='/repos/silunzh/ordrum-progress/git/ref/heads/main')return response({object:{sha:sha(999)}},server.branchStatus);
      if(target.pathname==='/repos/silunzh/ordrum-progress/contents/progress.json'){
        if(options.method==='GET')return server.fileOverride?response(server.fileOverride):file();
        if(options.method==='PUT'){
          writes++;
          if(server.writeStatus!==200)return response({message:'failure'},server.writeStatus);
          if((server.sha&&request.body.sha!==server.sha)||(!server.sha&&request.body.sha))return response({message:'sha mismatch'},409);
          server.record=JSON.parse(Buffer.from(request.body.content,'base64').toString('utf8'));server.revision=server.record.revision;server.sha=sha(server.revision);
          return response({content:{sha:server.sha},commit:{sha:sha(1000+server.revision)}},201);
        }
      }
      if(target.pathname.startsWith('/repos/silunzh/ordrum-progress/git/blobs/')){
        const text=JSON.stringify(server.record);return response({sha:server.sha,encoding:'base64',size:Buffer.byteLength(text),content:Buffer.from(text).toString('base64')});
      }
      throw new Error('Unexpected endpoint '+target.pathname);
    }};
  const document={querySelector(selector){if(!controls.has(selector))controls.set(selector,{hidden:true,textContent:'',onclick:null});return controls.get(selector);}};
  vm.runInNewContext(sourceOverride,{window,document,URL,Response,TextEncoder,TextDecoder,Uint8Array,Date,console},{filename:sourcePath});
  const api=window.OrdrumGitHubSync;const options=api.cloudOptions(message=>notices.push(message));
  return {api,options,window,server,requests,notices,controls,session,local,commit,file,get writes(){return writes;}};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  await test('unconfigured pages preserve local learning and expose a connection action',async()=>{
    const app=harness({saved:false});assert.equal(app.api.isConnected(),false);assert.equal(app.requests.length,0);
    assert.equal(app.controls.get('#sync-account-button').textContent,'连接 GitHub 同步');
    await assert.rejects(app.api.transport('GET'),error=>error.code==='GITHUB_DISCONNECTED');
    assert.equal(app.options.pollIntervalMs,120000);assert.equal(app.options.debounceMs,5000);
  });
  await test('reads an empty initialized private repository with exact authentication and request policy',async()=>{
    const app=harness();const result=await app.api.transport('GET');const data=await result.json();assert.equal(data.accountId,accountId);assert.equal(data.revision,0);assert.equal(data.state,null);
    assert.ok(app.requests.some(r=>r.url.includes('/git/ref/heads/main')));
    for(const {url,options}of app.requests){assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.headers['X-GitHub-Api-Version'],'2026-03-10');}
    assert.equal(JSON.stringify(data).includes(token),false);assert.equal(JSON.stringify(app.api.getStatus()).includes(token),false);
  });
  await test('reads and writes Swedish UTF-8 snapshots with revision and blob-SHA preconditions',async()=>{
    const app=harness();app.commit({marks:{'åäö':{status:'known'}},tasks:[]},4);
    const first=await(await app.api.transport('GET')).json();assert.equal(first.state.marks['åäö'].status,'known');
    const written=await(await app.api.transport('PUT',{state:{marks:{'Ångström':{status:'known'}}},baseRevision:4,expectedAccountId:accountId})).json();
    assert.equal(written.revision,5);assert.equal(app.server.record.version,2);assert.equal(app.server.record.state.marks['Ångström'].status,'known');assert.equal(app.requests.find(r=>r.options.method==='PUT').body.sha,sha(4));assert.equal(app.writes,1);
    assert.equal(JSON.stringify(app.server.record).includes(token),false);assert.equal(own(written,'sha'),false);
  });
  await test('version 1 progress upgrades to version 2 while preserving notebook units and account identity',async()=>{
    const app=harness();const units={'unit-1':{id:'unit-1',name:'错词单元 1',wordIds:['å','ä','ö'],updatedAt:'2026-10-21T12:00:00.000Z'}};
    app.commit({marks:{},notebookUnits:units},7,1);
    const priorRecord=await(await app.api.transport('GET')).json();assert.deepEqual(priorRecord.state.notebookUnits,units);
    const nextState={...priorRecord.state,marks:{å:{status:'known'}}};
    await app.api.transport('PUT',{state:nextState,baseRevision:7,expectedAccountId:accountId});
    assert.equal(app.server.record.version,2);assert.equal(app.server.record.revision,8);assert.equal(app.server.record.accountId,accountId);assert.deepEqual(app.server.record.state.notebookUnits,units);
    const reread=await(await app.api.transport('GET')).json();assert.deepEqual(reread.state.notebookUnits,units);assert.equal(reread.state.marks.å.status,'known');
    await app.api.transport('PUT',{state:reread.state,baseRevision:8,expectedAccountId:accountId});assert.equal(app.server.record.version,2);assert.equal(app.server.record.revision,9);
  });
  await test('new empty repositories start with a version 2 progress envelope',async()=>{
    const app=harness();await app.api.transport('PUT',{state:{marks:{},notebookUnits:{}},baseRevision:0,expectedAccountId:accountId});
    assert.equal(app.server.record.version,2);assert.equal(app.server.record.revision,1);assert.deepEqual(app.server.record.state.notebookUnits,{});
  });
  await test('the deployed version 1 reader contract rejects version 2 before any stale-client write',async()=>{
    // Keep the exact legacy version guard inline so this compatibility check
    // also runs in a shallow Pages checkout without historical Git objects.
    const guard='![1,RECORD_VERSION].includes(record.version)';assert.equal(source.split(guard).length,2);
    const legacyReader=source.replace(guard,'record.version !== 1');
    const app=harness({sourceOverride:legacyReader});const units={'unit-1':{wordIds:['å','ä','ö']}};
    app.commit({marks:{},notebookUnits:units},8,2);
    await assert.rejects(app.api.transport('GET'),error=>error.code==='GITHUB_INVALID_FILE');
    await assert.rejects(app.api.transport('PUT',{state:{marks:{å:{status:'known'}}},baseRevision:8,expectedAccountId:accountId}),error=>error.code==='GITHUB_INVALID_FILE');
    assert.equal(app.writes,0);assert.equal(app.requests.some(request=>request.options.method==='PUT'),false);assert.equal(app.server.record.version,2);assert.deepEqual(app.server.record.state.notebookUnits,units);
  });
  await test('a stale revision or different account returns current state without writing',async()=>{
    const app=harness();app.commit({tasks:[{id:'remote'}]},3);
    for(const body of [{state:{tasks:[]},baseRevision:2,expectedAccountId:accountId},{state:{tasks:[]},baseRevision:3,expectedAccountId:prior}]){
      const res=await app.api.transport('PUT',body);assert.equal(res.status,409);assert.equal((await res.json()).state.tasks[0].id,'remote');
    }
    assert.equal(app.writes,0);
  });
  await test('a concurrent writer after the fresh read causes a conflict response with the newer snapshot',async()=>{
    let raced=false;const app=harness({fetchHook(request,{commit}){if(request.options.method==='PUT'&&!raced){raced=true;commit({marks:{other:{status:'known'}}},2);return response({message:'conflict'},409);}}});
    app.commit({marks:{}},1);const res=await app.api.transport('PUT',{state:{marks:{mine:{status:'known'}}},baseRevision:1,expectedAccountId:accountId});
    assert.equal(res.status,409);assert.equal((await res.json()).revision,2);assert.equal(app.server.record.state.marks.other.status,'known');
  });
  await test('public repositories are refused before any progress read or write',async()=>{
    const app=harness();app.server.private=false;app.server.visibility='public';
    await assert.rejects(app.api.transport('GET'),error=>error.code==='GITHUB_PUBLIC_REPO');assert.equal(app.writes,0);assert.equal(app.requests.some(r=>r.url.includes('/contents/')),false);
  });
  await test('repository privacy is checked again immediately before a write',async()=>{
    let metadataReads=0;const app=harness({fetchHook(request,{server}){if(new URL(request.url).pathname==='/repos/silunzh/ordrum-progress'&&++metadataReads===2){server.private=false;server.visibility='public';}}});
    app.commit({marks:{}},1);await assert.rejects(app.api.transport('PUT',{state:{marks:{a:{}}},baseRevision:1,expectedAccountId:accountId}),error=>error.code==='GITHUB_PUBLIC_REPO');assert.equal(app.writes,0);
  });
  await test('repository and Contents authorization failures cannot be mistaken for a new empty account',async()=>{
    for(const status of [401,403,404]){const app=harness();app.server.repoStatus=status;await assert.rejects(app.api.transport('GET'));assert.equal(app.requests.some(r=>r.url.includes('/contents/')),false);}
    const app=harness();app.server.branchStatus=404;await assert.rejects(app.api.transport('GET'),error=>error.code==='GITHUB_REPO_NOT_FOUND');assert.equal(app.writes,0);
  });
  await test('malformed, truncated, wrong-account and invalid-UTF8 files fail closed',async()=>{
    const original={version:1,accountId,revision:1,state:{marks:{}}};const text=JSON.stringify(original),bytes=Buffer.from(text);
    const base={type:'file',encoding:'base64',size:bytes.length,sha:sha(1),content:bytes.toString('base64')};
    const bad=[{...base,truncated:true},{...base,content:'%%%='},{...base,size:bytes.length+1},{...base,sha:'oops'},
      {...base,size:2,content:Buffer.from([255,255]).toString('base64')},
      ...[{...original,accountId:prior},{...original,revision:1.5},{...original,version:99},{...original,state:{__cloudCommitId:'private'}}].map(record=>{const b=Buffer.from(JSON.stringify(record));return {...base,size:b.length,content:b.toString('base64')};})];
    for(const file of bad){const app=harness();app.server.fileOverride=file;await assert.rejects(app.api.transport('GET'));assert.equal(app.writes,0);}
  });
  await test('large Contents objects use an immutable blob read instead of an arbitrary download URL',async()=>{
    const app=harness();app.commit({marks:{},large:'å'.repeat(600000)},1);const text=JSON.stringify(app.server.record);
    app.server.fileOverride={type:'file',encoding:'none',size:Buffer.byteLength(text),sha:app.server.sha,content:'',download_url:'https://evil.example/'};
    const got=await(await app.api.transport('GET')).json();assert.equal(got.state.large.length,600000);assert.ok(app.requests.some(r=>r.url.includes('/git/blobs/')));assert.equal(app.requests.some(r=>r.url.startsWith('https://evil.example')),false);
    assert.equal(app.requests.find(r=>r.url.includes('/contents/')).options.headers.Accept,'application/vnd.github.object+json');
  });
  await test('GitHub-style wrapped base64 near the 3 MB state limit remains readable within a bounded response',async()=>{
    const app=harness({fetchHook(request,{server}){if(request.url.includes('/git/blobs/')){const text=JSON.stringify(server.record),raw=Buffer.from(text).toString('base64');return response({sha:server.sha,encoding:'base64',size:Buffer.byteLength(text),content:raw.match(/.{1,60}/g).join('\n')+'\n'});}}});
    app.commit({large:'x'.repeat(3*1024*1024-1000)},1);const bytes=Buffer.byteLength(JSON.stringify(app.server.record));
    app.server.fileOverride={type:'file',encoding:'none',size:bytes,sha:app.server.sha,content:''};
    assert.equal((await(await app.api.transport('GET')).json()).state.large.length,3*1024*1024-1000);
  });
  await test('invalid state, credential-shaped state, unsupported methods and oversize payloads never write',async()=>{
    const app=harness();for(const state of [{token},{authorization:'secret'},JSON.parse('{"__proto__":{"polluted":true}}'),{__cloudCommitId:'marker'}])await assert.rejects(app.api.transport('PUT',{state,baseRevision:0,expectedAccountId:accountId}));
    await assert.rejects(app.api.transport('DELETE'));
    const res=await app.api.transport('PUT',{state:{large:'词'.repeat(1100000)},baseRevision:0,expectedAccountId:accountId});assert.equal(res.status,413);assert.equal(app.writes,0);
  });
  await test('redirects and invalid content types are rejected without accepting external destinations',async()=>{
    for(const mode of ['redirect','html']){const app=harness({fetchHook(){return mode==='redirect'?{redirected:true,status:200,headers:new Headers()}:new Response('<html>',{headers:{'Content-Type':'text/html'}});}});await assert.rejects(app.api.transport('GET'));assert.equal(app.requests.length,1);assert.equal(app.writes,0);}
  });
  await test('GitHub rate limits delay retries and explain that local data is safe',async()=>{
    const app=harness({fetchHook(){return response({message:'rate limit'},403,{'X-RateLimit-Remaining':'0','Retry-After':'90'});}});
    await assert.rejects(app.api.transport('GET'),error=>error.code==='GITHUB_RATE_LIMIT');assert.ok(app.api.getStatus().retryAt>Date.now()+60000);assert.match(app.notices.at(-1),/记录已保存在此设备/);
    await assert.rejects(app.api.transport('GET'),error=>error.code==='GITHUB_RATE_LIMIT');assert.equal(app.requests.length,1);
  });
  await test('connection config defaults to session storage and persistent storage requires explicit opt-in',async()=>{
    const app=harness({saved:false});await app.api.configure(config);assert.equal(app.session.has(KEY),true);assert.equal(app.local.has(KEY),false);
    await app.api.configure({...config,remember:true});assert.equal(app.session.has(KEY),false);assert.equal(app.local.has(KEY),true);
    app.api.disconnect();assert.equal(app.local.has(KEY),false);assert.equal(app.session.has(KEY),false);assert.equal(app.api.getStatus().accountId,null);
  });
  await test('only an exact old-account/new-account pair receives explicit migration permission',async()=>{
    const app=harness({saved:false});app.local.set('ordrum.cloud.v1',JSON.stringify({accountId:prior,revision:2,base:{tasks:[]}}));
    await app.api.configure({...config,migrateExisting:true});const pair={fromAccountId:prior,toAccountId:accountId};assert.equal(app.options.allowProviderMigration(pair),true);
    assert.equal(app.options.allowProviderMigration({...pair,fromAccountId:'b'.repeat(64)}),false);assert.equal(app.options.allowProviderMigration({...pair,toAccountId:'c'.repeat(64)}),false);
    assert.equal(app.local.has(GRANT),true);app.options.onProviderMigrationCommitted(pair);assert.equal(app.local.has(GRANT),false);assert.equal(app.options.onProviderMigrationCommitted(pair),true);
    assert.equal(app.local.get('ordrum.cloud.v1').includes(prior),true);
  });
  await test('migration grant is retained if local storage cannot durably consume it',async()=>{
    const app=harness({saved:false,localOptions:{denyRemove:true}});app.local.set('ordrum.cloud.v1',JSON.stringify({accountId:prior}));await app.api.configure({...config,migrateExisting:true});
    assert.throws(()=>app.options.onProviderMigrationCommitted({fromAccountId:prior,toAccountId:accountId}),error=>error.code==='GITHUB_STORAGE');assert.equal(app.local.has(GRANT),true);
  });
  await test('disconnecting aborts in-flight requests and prevents a late response from applying',async()=>{
    let release;const app=harness({fetchHook(request){if(request.url.endsWith('/user'))return new Promise(resolve=>{release=()=>resolve(response({id:7,login:'silunzh'}));});}});
    const pending=app.api.transport('GET');const rejected=assert.rejects(pending,error=>error.code==='GITHUB_CONNECTION_CHANGED'||error.name==='AbortError');await tick();const signal=app.requests[0].options.signal;app.api.disconnect();assert.equal(signal.aborted,true);release();await rejected;assert.equal(app.writes,0);assert.equal(app.api.getStatus().accountId,null);
  });
  await test('disconnecting while credentials are being validated cannot reconnect the old request later',async()=>{
    let release;const app=harness({saved:false,fetchHook(request){if(request.url.endsWith('/user'))return new Promise(resolve=>{release=()=>resolve(response({id:7,login:'silunzh'}));});}});
    const pending=app.api.configure(config);const rejected=assert.rejects(pending,error=>error.code==='GITHUB_CONNECTION_CHANGED');await tick();app.api.disconnect();release();await rejected;assert.equal(app.api.isConnected(),false);assert.equal(app.session.has(KEY),false);
  });
  await test('a successful HTTP response without a Git commit confirmation never marks a write as successful',async()=>{
    const app=harness({fetchHook(request){if(request.options.method==='PUT')return response({});}});
    await assert.rejects(app.api.transport('PUT',{state:{marks:{}},baseRevision:0,expectedAccountId:accountId}),error=>error.code==='GITHUB_INVALID_RESPONSE');
  });
  await test('repository replacement does not silently start a new sync account',async()=>{
    const app=harness();await app.api.transport('GET');app.server.repoId=99;await assert.rejects(app.api.transport('GET'),error=>error.code==='GITHUB_IDENTITY_CHANGED');assert.equal(app.writes,0);
  });
  console.log(`\n${passed} GitHub sync checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
function own(value,key){return Object.prototype.hasOwnProperty.call(value,key);}
