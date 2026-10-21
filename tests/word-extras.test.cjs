const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../public/word-extras.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function response(value,options={}){const text=typeof value==='string'?value:JSON.stringify(value);return {ok:options.status?options.status<400:true,status:options.status||200,headers:{get:name=>name==='content-length'?options.length||null:null},text:async()=>text,...options};}
function page(text,title='god'){return {query:{pages:[{ns:0,title,revisions:[{revid:123,slots:{main:{content:text}}}]}]}};}
const fixture=`==English==
===Noun===
# English-only.
#: {{ux|en|Not Swedish|No}}
==Swedish==
===Pronunciation===
* {{IPA|sv|/ɡuːd/|/ɡuː/|q2=colloquial}}
* {{audio|sv|Sv-god.ogg|Sweden}}
===Adjective===
{{sv-adj}}
# [[good]], [[morally]] [[commendable]]
#: {{ux|sv|en '''god''' människa|a '''good''' person}}
#: {{syn|sv|snäll|go<q:colloquial>|q1=usually}}
#: {{ant|sv|elak}}
## [[tasty]]
##: {{ux|sv|Det är {{l|sv|gott||tasty}}.|It is good.}}
====Antonyms====
* {{antsense|not evil}} {{l|sv|ond}} {{q|formal}}
* {{sense|tasty}} [[äcklig]]
* {{l|sv|dålig||bad}}
====Synonyms====
* {{sense|tasty}} {{l|sv|välsmakande}} {{qualifier|less common}}
* {{l|sv|go|gott|good}}
====Quotations====
#* {{quote-book|sv|passage=Quoted author text|translation=Quoted translation}}
===Noun===
# a noun sense
#: {{ux|sv|Fel substantiv.|Wrong noun.}}
#: {{syn|sv|substantivord}}
====Pronunciation====
* {{IPA|sv|/noun-only/}}
===Etymology 2===
====Synonyms====
* {{l|sv|unassigned}}
==West Frisian==
===Adjective===
#: {{ux|sv|Wrong language section|Bad example}}
#: {{syn|sv|frisian-only}}
`;
class Host{
  constructor(){this.isConnected=true;this.buttons=[];this.audios=[];this.writes=0;this._html='';}
  set innerHTML(html){this._html=html;this.writes++;this.buttons=[];this.audios=[];
    for(const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
      const attrs=m[1],node={dataset:{},events:{},disabled:/\bdisabled\b/.test(attrs),addEventListener(type,fn){this.events[type]=fn;},focus(){this.focused=true;}};
      const extra=attrs.match(/data-extra="([^"]+)"/);if(extra)node.dataset.extra=extra[1];
      if(/data-extra-retry/.test(attrs))node.retry=true;if(/data-extra-audio-retry/.test(attrs))node.audioRetry=true;this.buttons.push(node);
    }
    for(const m of html.matchAll(/<audio\b[^>]*src="([^"]+)"[^>]*><\/audio>/g)){
      const host=this,node={src:m[1],events:{},pauseCount:0,loadCount:0,addEventListener(type,fn){this.events[type]=fn;},getAttribute(name){return name==='src'?this.src:null;},removeAttribute(name){if(name==='src')this.src=null;},pause(){this.pauseCount++;},load(){this.loadCount++;},replaceWith(old){host.audios[host.audios.indexOf(this)]=old;}};this.audios.push(node);
    }
  }
  get innerHTML(){return this._html;}
  querySelectorAll(selector){return selector==='audio'?this.audios:selector==='[data-extra]'?this.buttons.filter(x=>x.dataset.extra):[];}
  querySelector(selector){if(selector==='[data-extra-retry]')return this.buttons.find(x=>x.retry)||null;if(selector==='[data-extra-audio-retry]')return this.buttons.find(x=>x.audioRetry)||null;const type=selector.match(/^\[data-extra="([^"]+)"\]$/)?.[1];return this.buttons.find(x=>x.dataset.extra===type)||null;}
  click(type){const node=this.querySelector(`[data-extra="${type}"]`);assert.ok(node,'button exists');assert.equal(node.disabled,false);node.events.click({stopPropagation(){}});}
}
function sandbox(fetch=async()=>response(page(fixture))){
  const calls=[],timers=new Map(),events={};let serial=0,clock=1000;
  class Clock extends Date{static now(){return clock;}}
  const window={navigator:{onLine:true},fetch:async(url,options)=>{calls.push({url,options});return fetch(url,options);},addEventListener(type,fn){events[type]=fn;}};
  Object.defineProperties(window,{localStorage:{get(){throw Error('must not access learning storage');}},sessionStorage:{get(){throw Error('must not access credentials storage');}}});
  const context={window,console,URL,URLSearchParams,TextDecoder,TextEncoder,AbortController,Date:Clock,setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  vm.createContext(context);vm.runInContext(source,context);
  return {api:window.OrdrumWordExtras,window,calls,timers,events,advance(ms){clock+=ms;}};
}
(async()=>{
await test('parser isolates Swedish and the requested part of speech with nested definitions',()=>{
  const {api}=sandbox(),value=api.parse(fixture,{lemma:'god',pos:'adjective'},{title:'god',revision:123});
  assert.deepEqual(plain(value.examples).map(x=>x.sv),['en god människa','Det är gott.']);
  assert.equal(value.examples[0].sense,'good, morally commendable');assert.equal(value.examples[1].sense,'tasty');
  assert.equal(value.examples[0].pos,'adjective');assert.ok(value.url.endsWith('?oldid=123#Swedish'));
  assert.ok(!JSON.stringify(value).includes('Wrong language'));assert.ok(!JSON.stringify(value).includes('Quoted author'));
});
await test('related terms retain local sense and qualifiers without borrowing the preceding definition',()=>{
  const value=sandbox().api.parse(fixture,{lemma:'god',pos:'adjective'});
  assert.deepEqual(plain(value.antonyms).map(x=>[x.term,x.sense,x.note]),[['elak','good, morally commendable',''],['ond','not evil','formal'],['äcklig','tasty',''],['dålig','bad','']]);
  assert.deepEqual(plain(value.synonyms).map(x=>[x.term,x.note]),[['snäll','usually'],['go','colloquial'],['välsmakande','less common'],['gott','']]);
  assert.ok(!value.synonyms.some(x=>['unassigned','substantivord','frisian-only'].includes(x.term)));
});
await test('noun and phrase queries cannot borrow adjective examples or synonym sections',()=>{
  const {api}=sandbox();assert.deepEqual(plain(api.parse(fixture,{pos:'noun'}).examples).map(x=>x.sv),['Fel substantiv.']);
  assert.deepEqual(plain(api.parse(fixture,{pos:'phrase'}).examples),[]);
  assert.deepEqual(plain(api.parse(fixture,{pos:'unknown'}).synonyms),[]);
  const numeral='==Swedish==\n===Numeral===\n# three\n#: {{ux|sv|tre barn|three children}}';
  assert.equal(api.parse(numeral,{pos:'number'}).examples.length,1);
});
await test('only explicitly Swedish IPA is extracted and recordings and qualifier labels are omitted',()=>{
  const value=sandbox().api.parse(fixture,{pos:'adjective'});
  assert.deepEqual(plain(value.pronunciations),[{text:'/ɡuːd/',kind:'ipa'},{text:'/ɡuː/',kind:'ipa'}]);
  assert.equal(value.files,undefined);assert.equal(sandbox().api.audioInfo,undefined);
});
await test('language headings require exactly Swedish while CRLF and a final language section work',()=>{
  const {api}=sandbox();assert.equal(api.parse('== Swedish ==\r\n===Verb===\r\n# act\r\n#: {{ux|sv|Jag gör.|I do.}}',{pos:'verb'}).examples.length,1);
  for(const name of ['Swedishness','Swedish\n','French'])assert.equal(api.parse(`==${name}==\n===Verb===\n#: {{ux|sv|Bad|Bad}}`,{pos:'verb'}).examples.length,0);
});
await test('commented and nowiki example templates never become dictionary examples',()=>{
  const text='==Swedish==\n===Verb===\n# act\n<!--\n#: {{ux|sv|Hidden comment|Hidden}}\n-->\n<nowiki>{{ux|sv|Literal markup|Literal}}</nowiki>\n#: {{ux|sv|Jag gör.|I do.}}';
  assert.deepEqual(plain(sandbox().api.parse(text,{pos:'verb'}).examples).map(x=>x.sv),['Jag gör.']);
});
await test('dictionary namespaces and URL references are never shown as related Swedish words',()=>{
  const text='==Swedish==\n===Noun===\n# a thing\n#: {{syn|sv|Thesaurus:thing|https://example.test|sak}}\n====Antonyms====\n* [[Category:Swedish]] [[#Swedish]] [[motsats]]';
  const value=sandbox().api.parse(text,{pos:'noun'});assert.deepEqual(plain(value.synonyms).map(x=>x.term),['sak']);assert.deepEqual(plain(value.antonyms).map(x=>x.term),['motsats']);
});
await test('nested templates use displayed Swedish terms and numeric parameters are supported',()=>{
  const {api}=sandbox(),value=api.parse('==Swedish==\n===Verb===\n# act\n#: {{ux|1=sv|2=Jag {{l|sv|göra|gör|do}}.|3=I do.}}',{pos:'verb'});
  assert.equal(value.examples[0].sv,'Jag gör.');assert.equal(value.examples[0].en,'I do.');
});
await test('parser caps untrusted lists and entirely ignores audio templates',()=>{
  const text='==Swedish==\n===Noun===\n# thing\n'+Array.from({length:20},(_,i)=>`#: {{ux|sv|ord ${i}|word ${i}}}\n#: {{syn|sv|term${String.fromCharCode(97+i)}}}\n* {{audio|sv|safe${i}.ogg}}`).join('\n')+'\n* {{audio|sv|bad\u0001.ogg}}\n* {{audio|sv|bad#file.ogg}}';
  const value=sandbox().api.parse(text,{pos:'noun'});assert.equal(value.examples.length,3);assert.equal(value.synonyms.length,6);assert.equal(value.files,undefined);
});
await test('dictionary request is CORS public-only, credential-free and preserves original word objects',async()=>{
  const {api,calls,timers}=sandbox();const word=Object.freeze({swedish:'en god',lemma:'god',pos:'adjective',english:'original',overrides:Object.freeze({english:'custom'})});
  const value=await api.load(word);assert.equal(value.lemma,'god');assert.equal(word.english,'original');assert.equal(word.overrides.english,'custom');
  assert.equal(calls.length,1);const u=new URL(calls[0].url);assert.equal(u.origin,'https://en.wiktionary.org');assert.equal(u.searchParams.get('titles'),'god');assert.equal(u.searchParams.get('origin'),'*');
  assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.referrerPolicy,'no-referrer');assert.equal(timers.size,0);
});
await test('missing, non-main-namespace and non-Swedish dictionary pages are rejected',async()=>{
  for(const p of [{ns:0,title:'missing'},{ns:1,title:'Talk:god',revisions:[{slots:{main:{content:fixture}}}]},{ns:0,title:'god',revisions:[{slots:{main:{content:'==English==\nword'}}}]}]){
    const {api}=sandbox(async()=>response({query:{pages:[p]}}));await assert.rejects(api.load({lemma:'god'}),/没有找到/);
  }
});
await test('offline requests do not touch the network and active requests have a 12 second abort limit',async()=>{
  const waiting=deferred(),env=sandbox(async(_,options)=>{options.signal.addEventListener('abort',()=>waiting.reject(new Error('aborted')),{once:true});return waiting.promise;});
  env.window.navigator.onLine=false;await assert.rejects(env.api.load({lemma:'god'}),/离线/);assert.equal(env.calls.length,0);
  env.window.navigator.onLine=true;const pending=env.api.load({lemma:'god'});await tick();const limit=Array.from(env.timers.values()).find(x=>x.ms===12000);assert.ok(limit);limit.fn();await assert.rejects(pending,/aborted/);assert.equal(env.timers.size,0);
});
await test('caller abort is forwarded to the public dictionary request',async()=>{
  const env=sandbox(async(_,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))),controller=new AbortController();
  const pending=env.api.load({lemma:'god'},controller.signal);controller.abort();await assert.rejects(pending,/aborted/);assert.equal(env.timers.size,0);
});
await test('oversized declared and streamed bodies are bounded before parsing',async()=>{
  let reads=0,cancelled=0,released=0;
  const declared=sandbox(async()=>response('{}',{length:700001}));await assert.rejects(declared.api.load({lemma:'god'}),/过大/);
  const streamed=sandbox(async()=>response('{}',{body:{getReader:()=>({async read(){reads++;return {done:false,value:new Uint8Array(350001)};},async cancel(){cancelled++;},releaseLock(){released++;}})}}));
  await assert.rejects(streamed.api.load({lemma:'god'}),/过大/);assert.equal(reads,2);assert.equal(cancelled,1);assert.equal(released,1);
});
await test('rate limits and malformed or API error responses surface safe source failures',async()=>{
  const rate=sandbox(async()=>response('{}',{status:429}));await assert.rejects(rate.api.load({lemma:'god'}),/稍后/);
  const apiError=sandbox(async()=>response({error:{info:'<script>unsafe</script>'}}));await assert.rejects(apiError.api.load({lemma:'god'}),/繁忙/);
  const invalid=sandbox(async()=>response('<html>error</html>'));await assert.rejects(invalid.api.load({lemma:'god'}));
});
await test('cancel and immediate reenable cannot let an older aborted request clear the new loading state',async()=>{
  const first=deferred(),second=deferred();let n=0;const env=sandbox(()=>++n===1?first.promise:second.promise),host=new Host();
  env.api.mount(host,{lemma:'god',pos:'adjective'});host.click('examples');assert.equal(env.calls.length,1);host.click('examples');host.click('examples');assert.equal(env.calls.length,2);
  first.reject(new Error('old failure'));await tick();assert.match(host.innerHTML,/正在查询…/);assert.ok(!host.innerHTML.includes('old failure'));
  second.resolve(response(page(fixture)));await tick();assert.ok(host.innerHTML.includes('en god människa'));assert.ok(!host.innerHTML.includes('正在查询…'));env.api.unmount();
});
await test('late responses from an unmounted word cannot overwrite a later card',async()=>{
  const first=deferred(),env=sandbox(()=>first.promise),oldHost=new Host(),newHost=new Host();
  env.api.mount(oldHost,{lemma:'god',pos:'adjective'});oldHost.click('examples');env.api.mount(newHost,{lemma:'barn',pos:'noun'});const before=newHost.innerHTML;
  first.resolve(response(page(fixture)));await tick();assert.equal(newHost.innerHTML,before);assert.equal(env.calls[0].options.signal.aborted,true);env.api.unmount();
});
await test('temporary toggles escape source content and remain separate from saved definitions',async()=>{
  const hostile='==Swedish==\n===Adjective===\n# safe\n#: {{ux|sv|&lt;img onerror=alert(1)&gt;|<img src=x onerror=alert(2)> bad}}';
  const env=sandbox(async()=>response(page(hostile))),host=new Host(),word=Object.freeze({lemma:'god',pos:'adjective',english:'original'});
  env.api.mount(host,word);host.click('examples');await tick();assert.ok(!host.innerHTML.includes('<img'));assert.ok(host.innerHTML.includes('&amp;lt;img'));assert.equal(word.english,'original');
  host.click('examples');assert.ok(!host.innerHTML.includes('extra-example'));assert.equal(word.english,'original');env.api.unmount();
});
await test('offline cached toggles work without network and offline uncached buttons explain availability',async()=>{
  const env=sandbox(),host=new Host();env.api.mount(host,{lemma:'god',pos:'adjective'});host.click('examples');await tick();const count=env.calls.length;
  env.window.navigator.onLine=false;env.events.offline();host.click('synonyms');assert.equal(env.calls.length,count);assert.ok(host.innerHTML.includes('välsmakande'));assert.ok(!host.innerHTML.includes('extras-source'));
  host.click('pronunciations');assert.equal(env.calls.length,count);assert.ok(host.innerHTML.includes('/ɡuːd/'));assert.ok(!host.innerHTML.includes('未找到可用缓存'));
  const other=new Host();env.api.mount(other,{lemma:'missing',pos:'noun'});assert.equal(other.querySelector('[data-extra="examples"]').disabled,true);assert.match(other.innerHTML,/联网后可查询/);env.api.unmount();
});
await test('memory cache expires after 24 hours and never persists or retains more than 40 results',async()=>{
  const env=sandbox(async url=>response(page(fixture,new URL(url).searchParams.get('titles'))));
  for(let i=0;i<41;i++){const host=new Host();env.api.mount(host,{lemma:'word'+String.fromCharCode(97+Math.floor(i/26))+String.fromCharCode(97+i%26),pos:'adjective'});host.click('examples');await tick();}
  assert.equal(env.calls.length,41);let host=new Host();env.api.mount(host,{lemma:'wordaa',pos:'adjective'});await tick();assert.equal(env.calls.length,42);
  host=new Host();env.api.mount(host,{lemma:'wordbo',pos:'adjective'});await tick();assert.equal(env.calls.length,42);
  env.advance(24*60*60*1000+1);host=new Host();env.api.mount(host,{lemma:'wordbo',pos:'adjective'});await tick();assert.equal(env.calls.length,43);env.api.unmount();
});
await test('button and rendered section order remains fixed regardless of activation order',async()=>{
  const env=sandbox(),host=new Host();env.api.mount(host,{swedish:'god',lemma:'god',pos:'adjective'});
  assert.deepEqual(host.buttons.map(x=>x.dataset.extra),['synonyms','antonyms','pronunciations','examples']);
  for(const type of ['examples','pronunciations','antonyms','synonyms']){host.click(type);await tick();}
  assert.deepEqual(Array.from(host.innerHTML.matchAll(/data-extra-section="([^"]+)"/g),m=>m[1]),['synonyms','antonyms','pronunciations','examples']);
  assert.equal(env.calls.length,1);assert.equal(host.audios.length,0);assert.ok(!host.innerHTML.includes('出处'));assert.ok(!host.innerHTML.includes('Wiktionary'));assert.ok(!host.innerHTML.includes('CC BY'));env.api.unmount();
});
await test('current inflected Swedish form is tried first and missing categories use the exact authored lemma',async()=>{
  const inflected='==Swedish==\n===Pronunciation===\n* {{IPA|sv|/ɡɔt/}}\n===Adjective===\n# {{inflection of|sv|god||n|s|indef}}';
  const env=sandbox(async url=>{const title=new URL(url).searchParams.get('titles');return response(page(title==='gott'?inflected:fixture,title));});
  const word=Object.freeze({swedish:'ett gott (adjektiv)',lemma:'god',pos:'adjective'}),value=await env.api.load(word);
  assert.deepEqual(env.calls.map(x=>new URL(x.url).searchParams.get('titles')),['gott','god']);
  assert.equal(value.examples[0].sv,'en god människa');assert.deepEqual(plain(value.pronunciations),[{text:'/ɡɔt/',kind:'ipa'}]);assert.equal(word.swedish,'ett gott (adjektiv)');
  const refs=plain(env.api.getCredits());assert.deepEqual(refs.map(x=>x.title),['gott','god']);assert.deepEqual(Object.keys(refs[0]),['source','title','revision','url','license']);
  refs[0].title='changed';assert.equal(env.api.getCredits()[0].title,'gott');
});
await test('missing and foreign current entries fall back only to a validated authored lemma',async()=>{
  for(const current of [{query:{pages:[{ns:0,title:'gott',missing:true}]}},page('==English==\n===Adjective===\n#: {{ux|sv|Wrong|Wrong}}','gott')]){
    const env=sandbox(async url=>response(new URL(url).searchParams.get('titles')==='gott'?current:page(fixture)));
    const value=await env.api.load({swedish:'gott',lemma:'god',pos:'adjective'});assert.equal(value.examples[0].sv,'en god människa');assert.equal(env.calls.length,2);assert.ok(!JSON.stringify(value).includes('Wrong'));
  }
  const invalid=sandbox(async()=>response(page('==English==\nword','gott')));await assert.rejects(invalid.api.load({swedish:'gott',lemma:'https://evil.test',pos:'adjective'}),/没有找到/);assert.equal(invalid.calls.length,1);
});
await test('fully populated current form avoids fallback and repeated form/lemma never duplicates a request',async()=>{
  const env=sandbox(async()=>response(page(fixture,'gott')));await env.api.load({swedish:'gott',lemma:'god',pos:'adjective'});assert.equal(env.calls.length,1);
  const same=sandbox();await same.api.load({swedish:'en god (adj.)',lemma:'god',pos:'adjective'});assert.equal(same.calls.length,1);
});
await test('wrong-POS and foreign lemma entries never supply examples or relations',async()=>{
  const env=sandbox(async url=>response(page(new URL(url).searchParams.get('titles')==='gott'?'==Swedish==\n===Adjective===\n# {{inflection of|sv|god}}':'==English==\n===Adjective===\n#: {{ux|sv|foreign|bad}}','gott')));
  const value=await env.api.load({swedish:'gott',lemma:'god',pos:'adjective'});assert.equal(value.examples.length,0);assert.equal(value.synonyms.length,0);assert.equal(env.calls.length,2);
  const wrong=sandbox(async()=>response(page(fixture)));const noun=await wrong.api.load({swedish:'god',lemma:'god',pos:'phrase'});assert.equal(noun.examples.length,0);assert.equal(noun.synonyms.length,0);
});
await test('pronunciation display cannot leak unmarked, foreign-language or audio content',async()=>{
  const text='==English==\n===Pronunciation===\n* {{IPA|en|/bad-en/}}\n==Swedish==\n===Pronunciation===\n* {{IPA|en|/bad-section/}}\n* {{IPA|/unmarked/}}\n* {{IPA|sv|/ɡuːd/|[ɡʊd]|not IPA|/broken}}\n* {{audio|sv|Sv-god.ogg|Sweden}}\n==French==\n* {{IPA|sv|/bad-fr/}}';
  const env=sandbox(async()=>response(page(text))),host=new Host();env.api.mount(host,{swedish:'god',lemma:'god',pos:'adjective'});host.click('pronunciations');await tick();
  assert.ok(host.innerHTML.includes('/ɡuːd/'));assert.ok(host.innerHTML.includes('[ɡʊd]'));assert.ok(!host.innerHTML.includes('bad-'));assert.ok(!host.innerHTML.includes('unmarked'));assert.equal(host.audios.length,0);assert.equal(env.calls.length,1);assert.ok(env.calls.every(x=>new URL(x.url).hostname==='en.wiktionary.org'));env.api.unmount();
});
await test('every related word links safely to its Swedish dictionary section and preserves lexical phrases',async()=>{
  const text='==Swedish==\n===Adjective===\n# safe\n#: {{syn|sv|snäll|en gång|javascript:alert(1)|https://evil.test|<img src=x onerror=alert(1)>}}\n#: {{ant|sv|elak}}';
  const env=sandbox(async()=>response(page(text))),host=new Host();env.api.mount(host,{lemma:'god',pos:'adjective'});host.click('synonyms');host.click('antonyms');await tick();
  for(const term of ['snäll','en gång','elak'])assert.ok(host.innerHTML.includes('href="https://en.wiktionary.org/wiki/'+encodeURIComponent(term)+'#Swedish" target="_blank" rel="noopener noreferrer"'));
  assert.ok(!host.innerHTML.includes('evil.test'));assert.ok(!host.innerHTML.includes('javascript:'));assert.ok(!host.innerHTML.includes('<img'));assert.equal(env.api.lookupUrl('en gång'),'https://en.wiktionary.org/wiki/en%20g%C3%A5ng#Swedish');assert.equal(env.api.lookupUrl('javascript:alert(1)'),'');env.api.unmount();
});
await test('cancelling the current form response prevents a lemma fallback and any stale credit entry',async()=>{
  const waiting=deferred(),env=sandbox(()=>waiting.promise),controller=new AbortController();const pending=env.api.load({swedish:'gott',lemma:'god',pos:'adjective'},controller.signal);
  controller.abort();waiting.resolve(response(page('==English==\nword','gott')));await assert.rejects(pending,/取消/);assert.equal(env.calls.length,1);assert.equal(env.api.getCredits().length,0);
});
await test('credits remain bounded, ephemeral and do not read learning or token storage',async()=>{
  const env=sandbox(async url=>response(page(fixture,new URL(url).searchParams.get('titles'))));
  for(let i=0;i<81;i++)await env.api.load({lemma:'ord'+String.fromCharCode(97+Math.floor(i/26))+String.fromCharCode(97+i%26),pos:'adjective'});
  assert.equal(env.api.getCredits().length,80);assert.equal(sandbox().api.getCredits().length,0);assert.ok(!source.includes('commons.wikimedia.org'));assert.ok(!source.includes('audioInfo'));assert.ok(!source.includes('localStorage'));assert.ok(!source.includes('sessionStorage'));
});
console.log(`\n${passed} word extras checks passed${failed?`, ${failed} failed`:''}.`);if(failed)process.exitCode=1;
})();
