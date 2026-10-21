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
function commonsPage(overrides={}){return {title:'File:Sv-god.ogg',imageinfo:[{url:'https://upload.wikimedia.org/wikipedia/commons/8/86/Sv-god.ogg?utm_source=commons',mime:'application/ogg',extmetadata:{LicenseShortName:{value:'CC BY-SA 3.0'},Artist:{value:'<a href="x">Reader</a>'},Restrictions:{value:''}},...overrides}]};}

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
await test('IPA qualifiers and file templates stay Swedish and exclude other POS pronunciation',()=>{
  const value=sandbox().api.parse(fixture,{pos:'adjective'});
  assert.deepEqual(plain(value.pronunciations).map(x=>[x.text,x.label]),[['/ɡuːd/','IPA'],['/ɡuː/','colloquial']]);
  assert.deepEqual(plain(value.files),[{file:'Sv-god.ogg',label:'Sweden'}]);
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
await test('parser caps untrusted lists and rejects audio markup with control or query separators',()=>{
  const text='==Swedish==\n===Noun===\n# thing\n'+Array.from({length:20},(_,i)=>`#: {{ux|sv|ord ${i}|word ${i}}}\n#: {{syn|sv|term${i}}}\n* {{audio|sv|safe${i}.ogg}}`).join('\n')+'\n* {{audio|sv|bad\u0001.ogg}}\n* {{audio|sv|bad#file.ogg}}';
  const value=sandbox().api.parse(text,{pos:'noun'});assert.equal(value.examples.length,3);assert.equal(value.synonyms.length,6);assert.equal(value.files.length,4);
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
await test('Commons audio uses matching filenames, audio MIME, HTTPS upload host and explicit reusable license',async()=>{
  const env=sandbox(async()=>response({query:{pages:[commonsPage()]}}));
  const values=await env.api.audioInfo({files:[{file:'Sv-god.ogg',label:'Sweden'}]});
  assert.equal(values.length,1);assert.equal(values[0].url,'https://upload.wikimedia.org/wikipedia/commons/8/86/Sv-god.ogg');assert.equal(values[0].license,'CC BY-SA 3.0');assert.equal(values[0].author,'Reader');
  assert.equal(new URL(env.calls[0].url).origin,'https://commons.wikimedia.org');assert.equal(env.calls[0].options.credentials,'omit');
});
await test('ported CC licenses require a matching canonical Creative Commons license URL',async()=>{
  const metadata={LicenseShortName:{value:'CC BY 2.0 fr'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/2.0/fr/deed.en'},Restrictions:{value:''}};
  const env=sandbox(async()=>response({query:{pages:[commonsPage({extmetadata:metadata})]}}));
  const audio=await env.api.audioInfo({files:[{file:'Sv-god.ogg'}]});assert.equal(audio.length,1);assert.equal(audio[0].license,'CC BY 2.0 fr');
  for(const valid of ['http://creativecommons.org/licenses/by/2.0/fr/','https://creativecommons.org/licenses/by/2.0/fr/deed.zh-hans']){const canonical=sandbox(async()=>response({query:{pages:[commonsPage({extmetadata:{...metadata,LicenseUrl:{value:valid}}})]}}));assert.equal((await canonical.api.audioInfo({files:[{file:'Sv-god.ogg'}]})).length,1);}
  for(const url of ['https://creativecommons.org.evil.test/licenses/by/2.0/fr/','https://creativecommons.org/licenses/by-sa/2.0/fr/','https://creativecommons.org/licenses/by/3.0/fr/','https://creativecommons.org/licenses/by/2.0/de/','https://creativecommons.org/licenses/by/2.0/fr/deed.en/extra','javascript:alert(1)','']){
    const invalid=sandbox(async()=>response({query:{pages:[commonsPage({extmetadata:{...metadata,LicenseUrl:{value:url}}})]}}));assert.equal((await invalid.api.audioInfo({files:[{file:'Sv-god.ogg'}]})).length,0);
  }
  const unsupported=sandbox(async()=>response({query:{pages:[commonsPage({extmetadata:{...metadata,LicenseShortName:{value:'CC BY 2.0 fr unrestricted text'}}})]}}));assert.equal((await unsupported.api.audioInfo({files:[{file:'Sv-god.ogg'}]})).length,0);
});
await test('Commons refuses unrelated files, non-audio content, redirects hosts and misleading license strings',async()=>{
  const cases=[{url:'http://upload.wikimedia.org/wikipedia/commons/a/a/audio.ogg'},{url:'https://upload.wikimedia.org.evil.test/audio.ogg'},{url:'https://upload.wikimedia.org:8443/wikipedia/commons/a/a/audio.ogg'},{url:'https://upload.wikimedia.org/wikipedia/commons/a/a/image.svg'},{mime:'text/html'},{extmetadata:{LicenseShortName:{value:'No CC BY permission'}}},{extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},Restrictions:{value:'restricted'}}}];
  for(const bad of cases){const env=sandbox(async()=>response({query:{pages:[commonsPage(bad)]}}));assert.equal((await env.api.audioInfo({files:[{file:'Sv-god.ogg'}]})).length,0);}
  const unrelated=commonsPage();unrelated.title='File:Other.ogg';const env=sandbox(async()=>response({query:{pages:[unrelated]}}));assert.equal((await env.api.audioInfo({files:[{file:'Sv-god.ogg'}]})).length,0);
});
await test('cancel and immediate reenable cannot let an older aborted request clear the new loading state',async()=>{
  const first=deferred(),second=deferred();let n=0;const env=sandbox(()=>++n===1?first.promise:second.promise),host=new Host();
  env.api.mount(host,{lemma:'god',pos:'adjective'});host.click('examples');assert.equal(env.calls.length,1);host.click('examples');host.click('examples');assert.equal(env.calls.length,2);
  first.reject(new Error('old failure'));await tick();assert.match(host.innerHTML,/正在查询参考源/);assert.ok(!host.innerHTML.includes('old failure'));
  second.resolve(response(page(fixture)));await tick();assert.ok(host.innerHTML.includes('en god människa'));assert.ok(!host.innerHTML.includes('正在查询参考源'));env.api.unmount();
});
await test('late responses from an unmounted word cannot overwrite a later card',async()=>{
  const first=deferred(),env=sandbox(()=>first.promise),oldHost=new Host(),newHost=new Host();
  env.api.mount(oldHost,{lemma:'god',pos:'adjective'});oldHost.click('examples');env.api.mount(newHost,{lemma:'barn',pos:'noun'});const before=newHost.innerHTML;
  first.resolve(response(page(fixture)));await tick();assert.equal(newHost.innerHTML,before);assert.equal(env.calls[0].options.signal.aborted,true);env.api.unmount();
});
await test('toggling related text and remounting the same card preserve the exact audio element without autoplay',async()=>{
  const env=sandbox(async url=>response(url.startsWith('https://commons.')?{query:{pages:[commonsPage()]}}:page(fixture))),host=new Host();let stops=0;
  const word=Object.freeze({lemma:'god',pos:'adjective'});env.api.mount(host,word,{onStop(){stops++;}});host.click('pronunciations');await tick();
  assert.equal(host.audios.length,1);const audio=host.audios[0];assert.equal(audio.pauseCount,0);assert.ok(!host.innerHTML.includes('autoplay'));
  audio.events.play();assert.equal(stops,1);host.click('examples');assert.equal(host.audios[0],audio);assert.equal(audio.pauseCount,0);assert.equal(audio.loadCount,0);
  const writes=host.writes;env.api.mount(host,word);assert.equal(host.writes,writes);assert.equal(host.audios[0],audio);
  host.click('pronunciations');assert.equal(audio.pauseCount,1);assert.equal(audio.loadCount,1);assert.equal(audio.src,null);env.api.unmount();
});
await test('pending and failed Commons requests preserve text and IPA, with an audio-only retry',async()=>{
  const waiting=deferred();let audioCalls=0;
  const env=sandbox(async url=>{if(url.startsWith('https://commons.'))return ++audioCalls===1?waiting.promise:response({query:{pages:[commonsPage()]}});return response(page(fixture));}),host=new Host();
  env.api.mount(host,{lemma:'god',pos:'adjective'});host.click('examples');await tick();host.click('synonyms');host.click('pronunciations');await tick();
  assert.ok(host.innerHTML.includes('en god människa'));assert.ok(host.innerHTML.includes('välsmakande'));assert.ok(host.innerHTML.includes('/ɡuːd/'));assert.match(host.innerHTML,/正在查询录音来源/);
  assert.ok(!host.innerHTML.includes('此来源未提供读音版本'));
  waiting.resolve(response('{}',{status:503}));await tick();assert.ok(host.innerHTML.includes('en god människa'));assert.ok(host.innerHTML.includes('/ɡuːd/'));assert.match(host.innerHTML,/录音来源暂不可用/);
  const retry=host.querySelector('[data-extra-audio-retry]');assert.ok(retry);retry.events.click({stopPropagation(){}});await tick();
  assert.equal(host.audios.length,1);assert.ok(!host.innerHTML.includes('录音来源暂不可用'));assert.equal(audioCalls,2);assert.equal(env.calls.filter(x=>x.url.startsWith('https://en.wiktionary.')).length,1);env.api.unmount();
});
await test('initial pronunciation lookup shows verified IPA before the recording request finishes',async()=>{
  const waiting=deferred(),env=sandbox(async url=>url.startsWith('https://commons.')?waiting.promise:response(page(fixture))),host=new Host();
  env.api.mount(host,{lemma:'god',pos:'adjective'});host.click('pronunciations');await tick();
  assert.ok(host.innerHTML.includes('/ɡuːd/'));assert.match(host.innerHTML,/正在查询录音来源/);assert.ok(host.innerHTML.includes('Wiktionary 瑞典语条目'));
  host.click('examples');host.click('pronunciations');assert.ok(host.innerHTML.includes('en god människa'));assert.ok(!host.innerHTML.includes('extra-ipa'));assert.equal(env.calls[1].options.signal.aborted,true);
  waiting.resolve(response({query:{pages:[commonsPage()]}}));await tick();assert.ok(!host.innerHTML.includes('extra-ipa'));assert.ok(!host.innerHTML.includes('正在查询'));env.api.unmount();
});
await test('IPA remains visible with an explicit notice when no source recording passes verification',async()=>{
  const env=sandbox(async url=>response(url.startsWith('https://commons.')?{query:{pages:[commonsPage({extmetadata:{LicenseShortName:{value:'All rights reserved'}}})]}}:page(fixture))),host=new Host();
  env.api.mount(host,{lemma:'god',pos:'adjective'});host.click('pronunciations');await tick();
  assert.ok(host.innerHTML.includes('/ɡuːd/'));assert.ok(host.innerHTML.includes('此来源暂无可核对的录音版本'));assert.equal(host.audios.length,0);env.api.unmount();
});
await test('temporary toggles escape source content and remain separate from saved definitions',async()=>{
  const hostile='==Swedish==\n===Adjective===\n# safe\n#: {{ux|sv|&lt;img onerror=alert(1)&gt;|<img src=x onerror=alert(2)> bad}}';
  const env=sandbox(async()=>response(page(hostile))),host=new Host(),word=Object.freeze({lemma:'god',pos:'adjective',english:'original'});
  env.api.mount(host,word);host.click('examples');await tick();assert.ok(!host.innerHTML.includes('<img'));assert.ok(host.innerHTML.includes('&amp;lt;img'));assert.equal(word.english,'original');
  host.click('examples');assert.ok(!host.innerHTML.includes('extra-example'));assert.equal(word.english,'original');env.api.unmount();
});
await test('offline cached toggles work without network and offline uncached buttons explain availability',async()=>{
  const env=sandbox(),host=new Host();env.api.mount(host,{lemma:'god',pos:'adjective'});host.click('examples');await tick();const count=env.calls.length;
  env.window.navigator.onLine=false;env.events.offline();host.click('synonyms');assert.equal(env.calls.length,count);assert.ok(host.innerHTML.includes('本次会话缓存'));
  host.click('pronunciations');assert.equal(env.calls.length,count);assert.ok(host.innerHTML.includes('/ɡuːd/'));assert.ok(!host.innerHTML.includes('未找到可用缓存'));
  const other=new Host();env.api.mount(other,{lemma:'missing',pos:'noun'});assert.equal(other.querySelector('[data-extra="examples"]').disabled,true);assert.match(other.innerHTML,/联网后可查询/);env.api.unmount();
});
await test('memory cache expires after 24 hours and never persists or retains more than 40 results',async()=>{
  const env=sandbox(async url=>response(page(fixture,new URL(url).searchParams.get('titles'))));
  for(let i=0;i<41;i++){const host=new Host();env.api.mount(host,{lemma:'word'+i,pos:'adjective'});host.click('examples');await tick();}
  assert.equal(env.calls.length,41);let host=new Host();env.api.mount(host,{lemma:'word0',pos:'adjective'});await tick();assert.equal(env.calls.length,42);
  host=new Host();env.api.mount(host,{lemma:'word40',pos:'adjective'});await tick();assert.equal(env.calls.length,42);
  env.advance(24*60*60*1000+1);host=new Host();env.api.mount(host,{lemma:'word40',pos:'adjective'});await tick();assert.equal(env.calls.length,43);env.api.unmount();
});
console.log(`\n${passed} word extras checks passed${failed?`, ${failed} failed`:''}.`);if(failed)process.exitCode=1;
})();
