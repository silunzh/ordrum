const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const sourcePath=path.resolve(__dirname,'../public/sync-bridge.js');
const source=fs.readFileSync(sourcePath,'utf8');
const routePath=path.resolve(__dirname,'../app/sync-bridge/route.ts');
const APP='ordrum-local-sync',CHANNEL='c'.repeat(64),ORIGIN='http://127.0.0.1:8765',MAX=1024*1024;
const PAGES='https://silunzh.github.io',PAGES_PATH='/ordrum/';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function bridge({origin=ORIGIN,sourcePath='',channel=CHANNEL,authenticated=true,network=async()=>Response.json({state:null,revision:0,accountId:'a'.repeat(64)})}={}){
  const events=new Map(),messages=[],requests=[],timers=new Map(),intervals=new Map();let sequence=0;
  const opener={closed:false,postMessage(value,target){messages.push({value:JSON.parse(JSON.stringify(value)),target});}};
  const controls=new Map(['bridge-status','bridge-connect','bridge-signin'].map(id=>[id,{hidden:false,textContent:'',addEventListener(type,fn){this[type]=fn;}}]));
  const window={opener,addEventListener(type,fn){events.set(type,fn);}};
  const sandbox={window,document:{body:{dataset:{localOrigin:origin,sourcePath,channel,authenticated:String(authenticated)}},getElementById:id=>controls.get(id)},URL,TextEncoder,AbortController,console,
    setTimeout(fn,delay){timers.set(++sequence,{fn,delay});return sequence;},clearTimeout(id){timers.delete(id);},
    setInterval(fn,delay){intervals.set(++sequence,{fn,delay});return sequence;},clearInterval(id){intervals.delete(id);},
    fetch:async(url,options)=>{const request={url,...options};requests.push(request);return network(request,requests.length);},
  };
  vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:sourcePath});
  function receive(message,extra={}){events.get('message')?.({source:opener,origin,data:{app:APP,channel,...(sourcePath?{sourcePath}:{}),...message},...extra});}
  return {events,opener,messages,requests,controls,intervals,click(){controls.get('bridge-connect').click?.();},receive,
    request(id=1,extra={}){receive({type:'request',id,method:'GET',...extra});},
    timeout(){for(const [id,{fn,delay}]of [...timers])if(delay===12000){timers.delete(id);fn();}},
    heartbeat(){for(const {fn}of [...intervals.values()])fn();},
    responses(id){return messages.filter(row=>row.value.type==='response'&&(id===undefined||row.value.id===id)).map(row=>row.value);},
  };
}
function route({user={userId:'private-user'},authError=false}={}){
  let authCalls=0;
  let code=stripTypeScriptTypes(fs.readFileSync(routePath,'utf8'),{mode:'transform'});
  code=code.replace(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];?/gm,'');
  code=code.replace(/^export\s+/gm,'');
  const sandbox={Request,Response,URL,URLSearchParams,console,async getChatGPTUser(){authCalls++;if(authError)throw new Error('private auth failure');return user;}};
  vm.createContext(sandbox);vm.runInContext(code+'\nglobalThis.handler=GET;',sandbox,{filename:routePath});
  return {get authCalls(){return authCalls;},get(query){return sandbox.handler(new Request(`https://ordrum.example/sync-bridge?${query}`));}};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
(async()=>{
  await test('the bridge waits for explicit consent before ready messages or authenticated requests',async()=>{
    const app=bridge();app.receive({type:'hello'});assert.equal(app.messages.length,0);
    app.request();await tick();assert.equal(app.requests.length,0);assert.equal(app.responses(1)[0].status,403);
    app.click();assert.equal(app.messages.at(-1).value.type,'ready');assert.equal(app.messages.at(-1).target,ORIGIN);
    app.request(2);await tick();assert.equal(app.requests.length,1);assert.equal(app.responses(2)[0].status,200);
  });
  await test('message source, exact local origin, application and channel must all match',async()=>{
    const app=bridge();app.click();const before=app.messages.length;
    for(const extra of [{source:{}},{origin:'http://localhost:8765'},{origin:'http://127.0.0.1:8766'},{origin:'https://127.0.0.1:8765'},{origin:ORIGIN+'.evil.example'}])app.receive({type:'request',id:2,method:'GET'},extra);
    await tick();assert.equal(app.requests.length,0);assert.equal(app.messages.length,before);
    const isolated=bridge();isolated.click();const count=isolated.messages.length;
    for(const message of [{app:'other'},{channel:'d'.repeat(64)},{channel:CHANNEL.toUpperCase()}])isolated.receive({type:'request',id:1,method:'GET',...message});
    isolated.receive({type:'request',id:1,method:'GET'},{source:null});await tick();
    assert.equal(isolated.requests.length,0);assert.equal(isolated.messages.length,count);assert.ok(before>0);
  });
  await test('the GitHub bridge requires its exact approved origin and project path',async()=>{
    for(const options of [{origin:PAGES},{origin:PAGES,sourcePath:'/'},{origin:PAGES,sourcePath:'/other/'},{origin:'https://other.github.io',sourcePath:PAGES_PATH},{origin:'https://silunzh.github.io.evil.example',sourcePath:PAGES_PATH},{origin:ORIGIN,sourcePath:PAGES_PATH}]){
      const app=bridge(options);app.click();app.request();await tick();assert.equal(app.messages.length,0);assert.equal(app.requests.length,0);assert.equal(app.controls.get('bridge-connect').hidden,true);
    }
    const app=bridge({origin:PAGES,sourcePath:PAGES_PATH});app.click();assert.equal(app.messages.at(-1).target,PAGES);assert.equal(app.messages.at(-1).value.sourcePath,PAGES_PATH);
    assert.match(app.controls.get('bridge-status').textContent,/GitHub/);app.request();await tick();assert.equal(app.requests.length,1);assert.equal(app.responses(1)[0].sourcePath,PAGES_PATH);
  });
  await test('GitHub messages cannot omit or substitute the project path even from the approved opener',async()=>{
    const app=bridge({origin:PAGES,sourcePath:PAGES_PATH});app.click();const before=app.messages.length;
    for(const sourcePath of [undefined,'/','/other/','/ordrum','/ordrum/index.html'])app.receive({type:'request',id:'invalid',method:'GET',sourcePath});
    app.receive({type:'hello',sourcePath:'/other/'});await tick();assert.equal(app.requests.length,0);assert.equal(app.messages.length,before);
    app.request('valid');await tick();assert.equal(app.requests.length,1);assert.equal(app.responses('valid')[0].status,200);
    const local=bridge();local.click();local.request('foreign',{sourcePath:PAGES_PATH});await tick();assert.equal(local.requests.length,0);
  });
  await test('the bridge accepts only bounded request IDs and GET or PUT methods',async()=>{
    const app=bridge();app.click();
    for(const id of ['', 'x'.repeat(129),-1,1.5,Number.MAX_SAFE_INTEGER+1,null,{},[]])app.request(id);
    app.request('valid',{method:'DELETE'});await tick();assert.equal(app.requests.length,0);assert.equal(app.responses('valid')[0].status,400);
  });
  await test('the bridge can fetch only its own progress API with uncached same-origin credentials',async()=>{
    const app=bridge();app.click();app.request(1,{url:'https://evil.example/api',headers:{Authorization:'leak'},credentials:'include'});await tick();
    assert.equal(app.requests.length,1);const request=app.requests[0];
    assert.equal(request.url,'/api/progress');assert.equal(request.credentials,'same-origin');assert.equal(request.cache,'no-store');assert.equal(request.redirect,'manual');
    assert.equal(request.headers.Authorization,undefined);assert.equal(app.messages.some(row=>JSON.stringify(row).includes('leak')),false);
  });
  await test('the one MiB payload boundary counts UTF-8 bytes and rejects oversize envelopes',async()=>{
    const app=bridge();app.click();
    app.request('large',{method:'PUT',body:{text:'x'.repeat(MAX)}});
    app.request('unicode',{method:'PUT',body:{text:'词'.repeat(Math.ceil(MAX/3))}});
    app.request('envelope',{extra:'x'.repeat(MAX+2048)});await tick();
    assert.equal(app.requests.length,0);for(const id of ['large','unicode','envelope'])assert.equal(app.responses(id)[0].status,413);
    const body={text:'x'.repeat(MAX-11)};assert.equal(new TextEncoder().encode(JSON.stringify(body)).length,MAX);
    app.request('exact',{method:'PUT',body});await tick();assert.equal(app.requests.length,1);assert.equal(app.responses('exact')[0].status,200);
  });
  await test('duplicate and excessive concurrent requests cannot issue extra API requests',async()=>{
    const pending=[];const app=bridge({network:()=>new Promise(resolve=>pending.push(resolve))});app.click();
    app.request('a');app.request('a');app.request('b');app.request('c');app.request('d');app.request('e');await tick();
    assert.equal(app.requests.length,4);assert.equal(app.responses('a')[0].status,409);assert.equal(app.responses('e')[0].status,429);
    for(const resolve of pending)resolve(Response.json({state:null}));await tick();
  });
  await test('a bridge request aborts after twelve seconds and releases its request slot',async()=>{
    let healthy=false;const app=bridge({network:entry=>healthy?Response.json({state:null}):new Promise((_,reject)=>entry.signal.addEventListener('abort',()=>reject(new Error('aborted'))))});
    app.click();app.request('timeout');await tick();app.timeout();await tick();
    assert.equal(app.requests[0].signal.aborted,true);assert.equal(app.responses('timeout')[0].status,503);assert.equal(app.responses('timeout')[0].body.error,'sync_timeout');
    healthy=true;app.request('retry');await tick();assert.equal(app.responses('retry')[0].status,200);
  });
  await test('expired login responses require top-level sign-in and stop connection heartbeats',async()=>{
    for(const response of [Response.json({error:'sign_in_required'},{status:401}),Response.redirect('https://ordrum.example/signin-with-chatgpt',307),new Response('<html>Login</html>',{headers:{'Content-Type':'text/html'}})]){
      const app=bridge({network:async()=>response});app.click();app.request();await tick();
      assert.equal(app.responses(1)[0].status,401);assert.ok(app.messages.some(row=>row.value.type==='signin'));
      assert.equal(app.controls.get('bridge-signin').hidden,false);assert.equal(app.intervals.size,0);
      app.request(2);await tick();assert.equal(app.requests.length,1);assert.equal(app.responses(2)[0].status,403);
    }
  });
  await test('oversize cloud responses are rejected without forwarding their contents',async()=>{
    const app=bridge({network:async()=>new Response(JSON.stringify({text:'x'.repeat(MAX+65536)}),{headers:{'Content-Type':'application/json'}})});
    app.click();app.request();await tick();assert.equal(app.responses(1)[0].status,503);assert.equal(app.responses(1)[0].body.error,'cloud_unavailable');
  });
  await test('heartbeats confirm the already consented connection without reading cloud progress',async()=>{
    const app=bridge();app.click();const before=app.messages.length;app.heartbeat();app.receive({type:'hello'});
    assert.equal(app.requests.length,0);assert.equal(app.messages.length,before+2);assert.ok(app.messages.every(row=>row.value.type==='ready'));
    app.events.get('beforeunload')();assert.equal(app.messages.at(-1).value.type,'disconnected');assert.equal(app.intervals.size,0);
  });
  await test('invalid local origins or channel values cannot create a bridge connection',async()=>{
    for(const origin of ['https://localhost:8765','http://evil.example','http://127.0.0.1.evil.example','http://127.0.0.1:8765/path','http://user@localhost:8765','http://localhost:80']){
      const app=bridge({origin});app.click();app.request();assert.equal(app.requests.length,0);assert.equal(app.messages.length,0);assert.equal(app.controls.get('bridge-connect').hidden,true);
    }
    const app=bridge({channel:'not-a-random-channel'});app.click();assert.equal(app.messages.length,0);
  });
  await test('anonymous bridge HTML has private uncached authentication state and a normal sign-in link',async()=>{
    const api=route({user:null});const query=new URLSearchParams({origin:ORIGIN,channel:CHANNEL});const response=await api.get(query);
    assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('vary'),'Cookie');
    const html=await response.text();assert.match(html,/data-authenticated="false"/);assert.match(html,/<a id="bridge-signin"[^>]+href="\/signin-with-chatgpt\?return_to=/);
    assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);assert.doesNotMatch(html,/private-user/);
    const href=html.match(/id="bridge-signin"[^>]+href="([^"]+)"/)[1].replace(/&amp;/g,'&');
    const returnTo=new URL(href,'https://ordrum.example').searchParams.get('return_to');const target=new URL(returnTo,'https://ordrum.example');
    assert.equal(target.pathname,'/sync-bridge');assert.equal(target.searchParams.get('origin'),ORIGIN);assert.equal(target.searchParams.get('channel'),CHANNEL);
  });
  await test('GitHub consent displays the exact project address and preserves it through login',async()=>{
    for(const user of [null,{userId:'private-user'}]){
      const api=route({user});const response=await api.get(new URLSearchParams({origin:PAGES,path:PAGES_PATH,channel:CHANNEL}));assert.equal(response.status,200);
      const html=await response.text();assert.match(html,/data-local-origin="https:\/\/silunzh.github.io"/);assert.match(html,/data-source-path="\/ordrum\/"/);assert.match(html,/<code id="bridge-origin">https:\/\/silunzh.github.io\/ordrum\/<\/code>/);
      assert.match(html,/src="\/sync-bridge\.js\?source=github-pages-v1"/,'the new Pages protocol must not reuse an older cached bridge script');
      assert.match(html,/连接 GitHub 单词室/);assert.match(html,/连接此 GitHub 网页/);assert.doesNotMatch(html,/private-user/);
      const href=html.match(/id="bridge-signin"[^>]+href="([^"]+)"/)[1].replace(/&amp;/g,'&');const returnTo=new URL(href,'https://ordrum.example').searchParams.get('return_to');const target=new URL(returnTo,'https://ordrum.example');
      assert.equal(target.pathname,'/sync-bridge');assert.equal(target.searchParams.get('origin'),PAGES);assert.equal(target.searchParams.get('path'),PAGES_PATH);assert.equal(target.searchParams.get('channel'),CHANNEL);
      assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
    }
  });
  await test('GitHub bridge queries reject foreign projects and ambiguous path parameters before authentication',async()=>{
    const api=route();
    for(const pathValue of [undefined,'','/','/other/','/ordrum','/ordrum/index.html','/ordrum/../','/%6frdrum/','https://evil.example/ordrum/']){
      const query=new URLSearchParams({origin:PAGES,channel:CHANNEL,...(pathValue===undefined?{}:{path:pathValue})});assert.equal((await api.get(query)).status,400);
    }
    for(const origin of ['https://other.github.io','http://silunzh.github.io','https://silunzh.github.io.evil.example','https://silunzh.github.io:443'])assert.equal((await api.get(new URLSearchParams({origin,path:PAGES_PATH,channel:CHANNEL}))).status,400);
    const duplicated=new URLSearchParams({origin:PAGES,path:PAGES_PATH,channel:CHANNEL});duplicated.append('path',PAGES_PATH);assert.equal((await api.get(duplicated)).status,400);
    assert.equal((await api.get(new URLSearchParams({origin:ORIGIN,path:PAGES_PATH,channel:CHANNEL}))).status,400);assert.equal(api.authCalls,0);
  });
  await test('the bridge route rejects foreign origins and ambiguous query parameters before authentication',async()=>{
    const api=route();
    for(const origin of ['https://localhost:8765','http://evil.example','http://127.0.0.1:8765/path','http://localhost:80','http://user@localhost:8765']){
      const response=await api.get(new URLSearchParams({origin,channel:CHANNEL}));assert.equal(response.status,400);assert.match(response.headers.get('cache-control'),/no-store/);
    }
    for(const query of [`origin=${encodeURIComponent(ORIGIN)}&channel=${CHANNEL}&channel=${CHANNEL}`,`origin=${encodeURIComponent(ORIGIN)}&origin=${encodeURIComponent(ORIGIN)}&channel=${CHANNEL}`,`origin=${encodeURIComponent(ORIGIN)}&channel=bad`])assert.equal((await api.get(query)).status,400);
    assert.equal(api.authCalls,0);
  });
  await test('authentication failures fail closed without exposing private details or caching login state',async()=>{
    const api=route({authError:true});const response=await api.get(new URLSearchParams({origin:ORIGIN,channel:CHANNEL}));
    assert.equal(response.status,503);assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.doesNotMatch(await response.text(),/private auth failure/);
  });
  console.log(`\n${passed} bridge checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
