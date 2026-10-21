(function (global) {
  'use strict';
  const API = 'https://en.wiktionary.org/w/api.php';
  const TTL = 24 * 60 * 60 * 1000;
  const MAX_BYTES = 700000;
  const cache = new Map(), enabled = new Map(), credits = new Map();
  const TYPES = {synonyms:'同义词',antonyms:'反义词',pronunciations:'读音版本',examples:'例句'};
  let current = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clean = value => String(value || '').normalize('NFC').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>|<ref\b[^>]*\/>/gi,'').replace(/<[^>]*>/g,'').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2').replace(/\[\[([^\]]+)\]\]/g,'$1').replace(/'{2,5}/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
  function queryTerm(value,strip=true) {
    const raw=String(value||'').normalize('NFC');
    const text=(strip?raw.replace(/^\(?(?:en|ett|att)\)?\s+/i,'').replace(/(?:\s*\([^)]*\))+\s*$/,''):raw).replace(/\s+/g,' ').trim();
    // Dictionary titles are public lexical terms, never namespaces, fragments or URLs.
    return text.length<=100&&/^[\p{L}\p{M}][\p{L}\p{M}\s’'\-]*$/u.test(text)?text:'';
  }
  function lemma(word) { return queryTerm(word?.lemma || word?.swedish); }
  function currentForm(word) { return queryTerm(word?.swedish) || lemma(word); }
  function lookupUrl(term) { const title=queryTerm(term,false);return title?'https://en.wiktionary.org/wiki/'+encodeURIComponent(title)+'#Swedish':''; }
  function templates(text) {
    const out = []; let stack = [];
    for (let i=0;i<text.length-1;i++) {
      if (text.slice(i,i+2)==='{{') { if(stack.length<12) stack.push(i); i++; }
      else if(text.slice(i,i+2)==='}}' && stack.length) { const start=stack.pop(); if(!stack.length) out.push(text.slice(start+2,i)); i++; }
    }
    return out.map(text => {
      const parts=[]; let start=0, depth=0, link=0;
      for(let i=0;i<text.length;i++) {
        const pair=text.slice(i,i+2);
        if(pair==='{{'){depth++;i++;} else if(pair==='}}'){depth--;i++;}
        else if(pair==='[['){link++;i++;} else if(pair===']]'){link--;i++;}
        else if(text[i]==='|'&&!depth&&!link){parts.push(text.slice(start,i).trim());start=i+1;}
      }
      parts.push(text.slice(start).trim());
      const named={}, positional=[];let next=0;
      parts.slice(1).forEach(p=>{const namedMatch=p.match(/^([a-zA-Z][\w-]*|[1-9]\d*)=([\s\S]*)$/);if(namedMatch){if(/^\d+$/.test(namedMatch[1])){const index=Number(namedMatch[1])-1;if(index<100)positional[index]=namedMatch[2];}else named[namedMatch[1]]=namedMatch[2];}else positional[next++]=p;});
      return {name:parts[0].toLowerCase(),args:positional,named};
    });
  }
  function plain(text) {
    let value=String(text||'');
    // Only display a small known set of textual templates. Unknown markup is omitted.
    for(let n=0;n<8&&value.includes('{{');n++)value=value.replace(/\{\{([^{}]*)\}\}/g,(_,inner)=>{
      const t=templates('{{'+inner+'}}')[0];
      if(!t)return '';
      if(['l','m','link','mention'].includes(t.name))return t.args[2]||t.args[1]||'';
      if(['lb','label','q','qualifier','sense','gloss','i'].includes(t.name))return '('+t.args.slice(t.args[0]==='sv'?1:0).join(', ')+')';
      return '';
    });
    return clean(value).slice(0,700);
  }
  const relatedTerm=value=>queryTerm(plain(value),false);
  function parse(text, word, meta={}) {
    const markup=String(text||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<(nowiki|pre|syntaxhighlight)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
    const swedish=markup.match(/^==[ \t]*Swedish[ \t]*==[ \t]*\r?$([\s\S]*?)(?=^==[^=]|$(?![\s\S]))/m)?.[1]||'';
    const revision=Number.isSafeInteger(meta.revision)&&meta.revision>0?meta.revision:null,title=queryTerm(meta.title,false)||currentForm(word);
    const result={lemma:title,revision,source:'Wiktionary',url:'https://en.wiktionary.org/wiki/'+encodeURIComponent(title)+(revision?'?oldid='+revision:'')+'#Swedish',license:'CC BY-SA 4.0',hasSwedish:!!swedish,examples:[],antonyms:[],synonyms:[],pronunciations:[]};
    if(!swedish)return result;
    const wanted=String(word?.pos||'').toLowerCase()==='number'?'numeral':String(word?.pos||'').toLowerCase();
    const knownPOS=new Set(['noun','proper noun','verb','adjective','adverb','pronoun','preposition','conjunction','interjection','article','determiner','numeral','particle','phrase','proverb']);
    let pos='', posLevel=0, section='', sense='';
    const push=(kind,value)=>{if(value && result[kind].length<8&&!result[kind].some(v=>JSON.stringify(v)===JSON.stringify(value)))result[kind].push(value);};
    for(const line of swedish.split('\n')) {
      const heading=line.match(/^(={3,6})\s*(.*?)\s*\1\s*$/);
      if(heading){section=heading[2].toLowerCase().replace(/\s+\d+$/,'');const level=heading[1].length;if(knownPOS.has(section)){pos=section;posLevel=level;sense='';}else if(level<=posLevel){pos='';posLevel=0;sense='';}if(['synonyms','antonyms'].includes(section))sense='';continue;}
      if(/^#+\s+/.test(line))sense=plain(line.replace(/^#+\s+/,''));
      const relevant=!!pos&&(!wanted||pos===wanted);
      const list=['synonyms','antonyms'].includes(section), ts=templates(line);
      const qualifier=ts.filter(t=>['q','qualifier','i'].includes(t.name)).map(t=>plain(t.args.join(', '))).filter(Boolean).join('; ');
      const explicitSense=ts.find(t=>['sense','antsense','synsense'].includes(t.name));
      const listSense=explicitSense?plain(explicitSense.args.join(', ')):'';
      for(const t of ts) {
        if(t.args[0]!=='sv')continue;
        if(!pos||relevant){
          if(t.name==='ipa')t.args.slice(1).forEach(value=>{const ipa=plain(value);if(/^(?:\/[^/\r\n]+\/|\[[^\]\r\n]+\])$/.test(ipa))push('pronunciations',{text:ipa,kind:'ipa'});});
        }
        if(!relevant)continue;
        if(['ux','uxi','usex'].includes(t.name)) {
          const sv=plain(t.args[1]),en=plain(t.named.t||t.args[2]);
          if(sv&&en&&!/\{\{|\}\}/.test(sv+en))push('examples',{sv,en,sense,pos});
        }
        if(t.name==='syn'||t.name==='ant')t.args.slice(1).forEach((value,index)=>{
          const term=relatedTerm(value).replace(/<[^>]*>/g,'').trim();
          const inlineNotes=Array.from(String(value||'').matchAll(/<(?:q|qq):([^<>]+)>/g),match=>plain(match[1]));
          if(term&&!/\{\{|\}\}/.test(term))push(t.name==='syn'?'synonyms':'antonyms',{term,sense:list?listSense:sense,pos,note:uniqueText([plain(t.named['q'+(index+1)]||t.named.q||qualifier),...inlineNotes])});
        });
        if(list&&['l','m','link'].includes(t.name)) {
          const term=relatedTerm(t.args[2]||t.args[1]);if(term)push(section,{term,sense:listSense||plain(t.named.t||t.args[3]||''),pos,note:plain(t.named.q||qualifier)});
        }
      }
      if(relevant&&list&&/^\*/.test(line)) {
        // Raw links inside a template's gloss/qualifier are not additional related words.
        const withoutTemplates=line.replace(/\{\{(?:[^{}]|\{\{[^{}]*\}\})*\}\}/g,'');
        for(const match of withoutTemplates.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)){const term=relatedTerm(match[2]||match[1]);if(term)push(section,{term,sense:listSense,pos,note:qualifier});}
      }
    }
    result.examples=result.examples.slice(0,3);result.synonyms=result.synonyms.slice(0,6);result.antonyms=result.antonyms.slice(0,6);
    return result;
  }
  function uniqueText(values){return Array.from(new Set(values.filter(Boolean))).join('; ');}
  async function request(endpoint,params,signal) {
    if(global.navigator?.onLine===false)throw new Error('当前离线，联网后可查询参考源。');
    const controller=new AbortController(), abort=()=>controller.abort();
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,12000);
    try{
    const query=new URLSearchParams({...params,format:'json',formatversion:'2',origin:'*',maxlag:'5'});
    const response=await global.fetch(endpoint+'?'+query,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(response.status===429?'查询较多，请稍后再试。':'参考源暂时无法访问。');
    if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('参考条目过大，请打开来源查看。');
    let text='';
    if(response.body?.getReader){const reader=response.body.getReader();const decoder=new TextDecoder();let bytes=0;try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();throw new Error('参考条目过大，请打开来源查看。');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
    else {text=await response.text();if(new TextEncoder().encode(text).length>MAX_BYTES)throw new Error('参考条目过大，请打开来源查看。');}
    let value;try{value=JSON.parse(text);}catch(_){throw new Error('参考源返回了无法识别的数据，请稍后再试。');}if(value.error)throw new Error('参考源繁忙，请稍后再试。');return value;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function load(word,signal) {
    const title=currentForm(word),base=lemma(word);if(!title)throw new Error('这个词没有可查询的词形。');
    async function query(candidate) {
      if(signal?.aborted)throw new Error('查询已取消。');
      const response=await request(API,{action:'query',prop:'revisions',rvprop:'content|ids',rvslots:'main',titles:candidate,redirects:'1'},signal);
      const page=response.query?.pages?.[0],revision=page?.revisions?.[0];
      if(!revision||page.ns!==0||!queryTerm(page.title,false)||!revision.slots?.main?.content)return null;
      const value=parse(revision.slots.main.content,word,{title:page.title,revision:revision.revid});
      return value.hasSwedish?value:null;
    }
    let value=await query(title),fallback=null;
    // Form-of entries often lack examples and relations. Fill missing categories only.
    if(base&&base!==title&&(!value||Object.keys(TYPES).some(type=>!value[type].length)))fallback=await query(base);
    if(!value&&!fallback)throw new Error('没有找到该词的瑞典语条目。');
    if(signal?.aborted)throw new Error('查询已取消。');
    const selected=[];
    if(value&&Object.keys(TYPES).some(type=>value[type].length))selected.push(value);
    if(fallback) {
      if(!value){value=fallback;selected.push(fallback);}
      else {
        let used=false;
        Object.keys(TYPES).forEach(type=>{if(!value[type].length&&fallback[type].length){value[type]=fallback[type];used=true;}});
        if(used)selected.push(fallback);
      }
    }
    if(!selected.length)selected.push(value);
    selected.forEach(record=>{
      const entry={source:record.source,title:record.lemma,revision:record.revision,url:record.url,license:record.license};
      credits.set(record.url,entry);while(credits.size>80)credits.delete(credits.keys().next().value);
    });
    return value;
  }
  function key(word){return currentForm(word)+'|'+lemma(word)+'|'+(word?.pos||'');}
  function cached(word){const id=key(word),entry=cache.get(id);if(entry&&Date.now()-entry.at<TTL)return entry;cache.delete(id);return null;}
  function remember(word,value){cache.set(key(word),{at:Date.now(),value});while(cache.size>40)cache.delete(cache.keys().next().value);}
  function stop(){if(!current)return;const old=current;current=null;old.controller?.abort();}
  function mount(host,word,options={}) {
    if(current&&current.host===host&&key(current.word)===key(word)){current.options=options;current.draw();return;}
    stop();if(!host||!word)return;
    const id=key(word), active=enabled.get(id)||new Set();enabled.set(id,active);while(enabled.size>80)enabled.delete(enabled.keys().next().value);
    const view={host,word,active,options,controller:null,loading:false,error:'',markup:null,draw:null,fetch:null};current=view;
    function draw(){
      if(current!==view||!host.isConnected)return;
      const value=cached(word)?.value,offline=global.navigator?.onLine===false;
      const loadingNotice=view.loading?'<p class="extras-notice">正在查询…</p>':'';
      const errorNotice=view.error?`<p class="extras-notice">${esc(view.error)} <button type="button" data-extra-retry>重试</button></p>`:'';
      const content=active.size?loadingNotice+errorNotice+(value?Object.keys(TYPES).filter(type=>active.has(type)).map(type=>section(type,value)).join(''):''):'';
      const markup=`<div class="extras-buttons" role="group" aria-label="临时扩展词义">${Object.entries(TYPES).map(([type,label])=>`<button type="button" data-extra="${type}" aria-pressed="${active.has(type)}" ${offline&&!value&&!active.has(type)?'disabled':''}>${esc(label)}</button>`).join('')}</div><div class="extras-content" aria-live="polite">${content}</div>${offline&&!value?'<p class="extras-notice">联网后可查询。</p>':''}`;
      if(markup===view.markup)return;
      view.markup=markup;host.innerHTML=markup;
      host.querySelectorAll('[data-extra]').forEach(button=>button.addEventListener('click',event=>{
        event.stopPropagation();const type=button.dataset.extra;
        if(active.has(type))active.delete(type);else active.add(type);
        if(!active.size){const controller=view.controller;view.controller=null;controller?.abort();view.loading=false;view.error='';}
        draw();if(active.size)fetchIfNeeded();
        host.querySelector(`[data-extra="${type}"]`)?.focus({preventScroll:true});
      }));
      host.querySelector('[data-extra-retry]')?.addEventListener('click',event=>{event.stopPropagation();view.error='';fetchIfNeeded(true);});
    }
    function section(type,value){
      const values=value[type]||[];
      if(!values.length)return `<section class="extra-section" data-extra-section="${type}"><h4>${TYPES[type]}</h4><p class="extras-notice">暂无${type==='pronunciations'?'瑞典语音标':TYPES[type]}。</p></section>`;
      return `<section class="extra-section" data-extra-section="${type}"><h4>${TYPES[type]}</h4>${type==='examples'?values.map(x=>`<div class="extra-example"><p lang="sv">${esc(x.sv)}</p><p lang="en">${esc(x.en)}</p></div>`).join(''):type==='pronunciations'?values.map(x=>`<p class="extra-ipa" lang="sv">${esc(x.text)}</p>`).join(''):values.map(x=>`<div class="extra-term"><a lang="sv" href="${esc(lookupUrl(x.term))}" target="_blank" rel="noopener noreferrer">${esc(x.term)}</a>${x.note?` <span>${esc(x.note)}</span>`:''}${x.sense?`<small lang="en">${esc(x.sense)}</small>`:''}</div>`).join('')}</section>`;
    }
    async function fetchIfNeeded(force=false){
      if(current!==view||!active.size||view.loading)return;
      const entry=cached(word);
      if(entry&&!force){view.error='';draw();return;}
      if(global.navigator?.onLine===false){view.error=entry?'':'当前离线，联网后重试。';draw();return;}
      const controller=new AbortController();view.controller=controller;view.loading=true;view.error='';draw();
      const timer=setTimeout(()=>controller.abort(),12000);
      try {
        const value=await load(word,controller.signal);
        if(controller.signal.aborted||current!==view||view.controller!==controller)return;
        remember(word,value);
      }catch(error){if(current===view&&view.controller===controller&&active.size)view.error=controller.signal.aborted?'查询超时，可稍后重试。':error.name==='TypeError'?'网络连接失败，请稍后重试。':error.message||'暂时无法查询。';}
      finally {clearTimeout(timer);if(current===view&&view.controller===controller){view.controller=null;view.loading=false;draw();}}
    }
    view.draw=draw;view.fetch=fetchIfNeeded;
    draw();if(active.size)fetchIfNeeded();
  }
  global.addEventListener?.('offline',()=>{if(current){const controller=current.controller;current.controller=null;controller?.abort();current.loading=false;current.error='';current.draw();}});
  global.addEventListener?.('online',()=>{if(current){current.draw();current.fetch();}});
  global.OrdrumWordExtras={mount,unmount:stop,parse,lemma,currentForm,lookupUrl,load,getCredits:()=>Array.from(credits.values(),record=>({...record}))};
})(window);
