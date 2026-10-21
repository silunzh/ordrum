(function (global) {
  'use strict';
  const API = 'https://en.wiktionary.org/w/api.php';
  const COMMONS = 'https://commons.wikimedia.org/w/api.php';
  const TTL = 24 * 60 * 60 * 1000;
  const MAX_BYTES = 700000;
  const cache = new Map(), enabled = new Map();
  const TYPES = {examples:'例句',antonyms:'反义词',synonyms:'同义词',pronunciations:'读音版本'};
  let current = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clean = value => String(value || '').normalize('NFC').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>|<ref\b[^>]*\/>/gi,'').replace(/<[^>]*>/g,'').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2').replace(/\[\[([^\]]+)\]\]/g,'$1').replace(/'{2,5}/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
  function lemma(word) {
    return String(word?.lemma || word?.swedish || '').normalize('NFC').replace(/^\(?\b(?:en|ett|att)\)?\s+/i,'').replace(/\s*\([^)]*\)\s*$/,'').trim().slice(0,100);
  }
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
  const relatedTerm=value=>{const term=plain(value);return /^(?:#|https?:|[A-Za-z -]+:)/i.test(term)?'':term;};
  function parse(text, word, meta={}) {
    const markup=String(text||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<(nowiki|pre|syntaxhighlight)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
    const swedish=markup.match(/^==[ \t]*Swedish[ \t]*==[ \t]*\r?$([\s\S]*?)(?=^==[^=]|$(?![\s\S]))/m)?.[1]||'';
    const revision=Number.isSafeInteger(meta.revision)&&meta.revision>0?meta.revision:null;
    const result={lemma:meta.title||lemma(word),revision,source:'Wiktionary',url:'https://en.wiktionary.org/wiki/'+encodeURIComponent(meta.title||lemma(word))+(revision?'?oldid='+revision:'')+'#Swedish',examples:[],antonyms:[],synonyms:[],pronunciations:[],files:[]};
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
          if(t.name==='ipa')t.args.slice(1).forEach((value,index)=>{if(/^[/\[]/.test(value||''))push('pronunciations',{text:plain(value),label:plain(t.named['a'+(index+1)]||t.named['q'+(index+1)]||t.named.a||t.named.q||'IPA'),kind:'ipa'});});
          if(t.name==='audio'&&t.args[1]&&/^.{1,150}\.(ogg|oga|mp3|wav)$/i.test(t.args[1])&&!/[\u0000-\u001f<>|#]/.test(t.args[1]))push('files',{file:t.args[1],label:plain(t.named.a||t.named.q||t.args[2]||'词典录音')});
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
    result.examples=result.examples.slice(0,3);result.synonyms=result.synonyms.slice(0,6);result.antonyms=result.antonyms.slice(0,6);result.files=result.files.slice(0,4);
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
    const title=lemma(word);if(!title)throw new Error('这个词没有可查询的原形。');
    const response=await request(API,{action:'query',prop:'revisions',rvprop:'content|ids',rvslots:'main',titles:title,redirects:'1'},signal);
    const page=response.query?.pages?.[0];
    const revision=page?.revisions?.[0];
    if(!revision||page.ns!==0||!revision.slots?.main?.content)throw new Error('参考源没有找到该词的瑞典语条目。');
    const value=parse(revision.slots.main.content,word,{title:page.title,revision:revision.revid});
    if(!/^==[ \t]*Swedish[ \t]*==[ \t]*\r?$/m.test(revision.slots.main.content))throw new Error('参考源没有找到该词的瑞典语条目。');
    return value;
  }
  async function audioInfo(value,signal) {
    if(!value.files.length)return [];
    const result=await request(COMMONS,{action:'query',prop:'imageinfo',iiprop:'url|extmetadata|mime',titles:value.files.map(x=>'File:'+x.file).join('|')},signal);
    return (result.query?.pages||[]).flatMap(page=>{
      const info=page.imageinfo?.[0],name=String(page.title||'').replace(/^File:/,'');
      let url;try{url=new URL(info?.url);}catch(_){return [];}
      const file=value.files.find(x=>x.file===name);
      if(!file||url.protocol!=='https:'||url.hostname!=='upload.wikimedia.org'||url.port||url.username||url.password||!/^\/wikipedia\/commons\//.test(url.pathname)||!/\.(ogg|oga|mp3|wav)$/i.test(url.pathname)||!['audio/ogg','application/ogg','audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/vnd.wave'].includes(info.mime))return [];
      url.search='';url.hash='';
      const metadata=info.extmetadata||{};
      const license=clean(metadata.LicenseShortName?.value||'');
      // Audio files have their own licenses; never infer them from the dictionary text license.
      const cc=license.match(/^CC[ -]BY(-SA)? ([1-4]\.\d)(?: ([a-z]{2}(?:-[a-z]{2})?))?$/i);
      const publicLicense=/^(?:CC0(?: 1\.0)?|Public domain)$/i.test(license);
      if((!cc&&!publicLicense)||clean(metadata.Restrictions?.value||''))return [];
      // Ported CC licenses add a jurisdiction to both the name and canonical license URL.
      if(cc?.[3]){
        let licenseUrl;try{licenseUrl=new URL(metadata.LicenseUrl?.value);}catch(_){return [];}
        const expected='/licenses/by'+(cc[1]?'-sa':'')+'/'+cc[2]+'/'+cc[3].toLowerCase()+'/';
        const licensePath=licenseUrl.pathname.replace(/\/deed\.[a-z]+(?:-[a-z]+)*\/?$/i,'/');
        if(!['https:','http:'].includes(licenseUrl.protocol)||licenseUrl.hostname!=='creativecommons.org'||licenseUrl.port||licenseUrl.username||licenseUrl.password||licenseUrl.search||licenseUrl.hash||(licensePath.endsWith('/')?licensePath:licensePath+'/')!==expected)return [];
      }
      return [{kind:'audio',url:url.href,label:file.label||'词典录音',license,author:clean(metadata.Artist?.value).slice(0,160),source:'https://commons.wikimedia.org/wiki/'+encodeURIComponent(page.title)}];
    }).slice(0,4);
  }
  function key(word){return lemma(word)+'|'+(word?.pos||'');}
  function cached(word){const id=key(word),entry=cache.get(id);if(entry&&Date.now()-entry.at<TTL)return entry;cache.delete(id);return null;}
  function remember(word,value){cache.set(key(word),{at:Date.now(),value});while(cache.size>40)cache.delete(cache.keys().next().value);}
  function releaseAudio(audio){audio.pause();audio.removeAttribute('src');audio.load?.();}
  function stop(){if(!current)return;const old=current;current=null;old.controller?.abort();old.audioElements?.forEach(releaseAudio);}
  function mount(host,word,options={}) {
    if(current&&current.host===host&&key(current.word)===key(word)){current.options=options;current.draw();return;}
    stop();if(!host||!word)return;
    const id=key(word), active=enabled.get(id)||new Set();enabled.set(id,active);while(enabled.size>80)enabled.delete(enabled.keys().next().value);
    const view={host,word,active,options,controller:null,loading:false,error:'',audioElements:new Map(),markup:null,draw:null,fetch:null};current=view;
    function draw(){
      if(current!==view||!host.isConnected)return;
      const entry=cached(word),value=entry?.value;
      const offline=global.navigator?.onLine===false;
      const pendingAudio=value&&active.has('pronunciations')&&!value.audioFetched;
      const loadingNotice=view.loading&&(!pendingAudio||!value)?`<p class="extras-notice">${value?'正在更新参考信息…':'正在查询参考源…'}</p>`:'';
      const errorNotice=view.error?`<p class="extras-notice">${esc(view.error)} <button type="button" data-extra-retry>重试</button></p>`:'';
      const content=active.size?loadingNotice+errorNotice+(value?Array.from(active).map(type=>section(type,value)).join(''):''):'';
      const markup=`<div class="extras-buttons" role="group" aria-label="临时扩展词义">${Object.entries(TYPES).map(([type,label])=>`<button type="button" data-extra="${type}" aria-pressed="${active.has(type)}" ${offline&&!value&&!active.has(type)?'disabled':''}>${esc(label)}</button>`).join('')}</div><div class="extras-content" aria-live="polite">${content}</div>${active.size&&value?`<p class="extras-source">词典原形 <span lang="sv">${esc(value.lemma)}</span> · <a href="${esc(value.url)}" target="_blank" rel="noopener noreferrer">Wiktionary 瑞典语条目</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a><br>社区词典，按义项参考。仅临时显示，未修改释义。${offline?' 当前为本次会话缓存。':''}</p>`:offline&&!value?'<p class="extras-notice">联网后可查询；已获取内容可在本次会话中继续查看。</p>':''}`;
      if(markup===view.markup)return;
      view.markup=markup;host.innerHTML=markup;
      host.querySelectorAll('[data-extra]').forEach(button=>button.addEventListener('click',event=>{
        event.stopPropagation();const type=button.dataset.extra;
        if(active.has(type))active.delete(type);else active.add(type);
        if(!active.size||(type==='pronunciations'&&!active.has(type)&&cached(word))){const controller=view.controller;view.controller=null;controller?.abort();view.loading=false;view.error='';}
        draw();if(active.size)fetchIfNeeded();
        host.querySelector(`[data-extra="${type}"]`)?.focus({preventScroll:true});
      }));
      host.querySelector('[data-extra-retry]')?.addEventListener('click',event=>{event.stopPropagation();view.error='';fetchIfNeeded(true);});
      host.querySelector('[data-extra-audio-retry]')?.addEventListener('click',event=>{event.stopPropagation();view.error='';fetchIfNeeded();});
      const retained=new Map();
      host.querySelectorAll('audio').forEach(audio=>{
        const url=audio.getAttribute('src'),old=view.audioElements.get(url);
        if(old){audio.replaceWith(old);retained.set(url,old);}
        else {retained.set(url,audio);audio.addEventListener('play',()=>{view.options.onStop?.();view.audioElements.forEach(other=>{if(other!==audio)other.pause();});});}
      });
      view.audioElements.forEach((audio,url)=>{if(!retained.has(url))releaseAudio(audio);});view.audioElements=retained;
    }
    function section(type,value){
      const values=value[type]||[];
      const pending=type==='pronunciations'&&view.loading&&!value.audioFetched;
      const warning=type==='pronunciations'&&value.audioWarning&&!pending;
      const noVerifiedAudio=type==='pronunciations'&&value.audioFetched&&value.files.length&&!values.some(item=>item.kind==='audio');
      const notice=pending?'<p class="extras-notice">正在查询录音来源…</p>':warning?'<p class="extras-notice">录音来源暂不可用；已获取的内容仍可查看。 <button type="button" data-extra-audio-retry>重试录音</button></p>':noVerifiedAudio?'<p class="extras-notice">此来源暂无可核对的录音版本。</p>':'';
      if(!values.length)return `<section class="extra-section"><h4>${TYPES[type]}</h4>${notice||`<p class="extras-notice">此来源未提供${TYPES[type]}，不自动补造。</p>`}</section>`;
      return `<section class="extra-section"><h4>${TYPES[type]}</h4>${type==='examples'?values.map(x=>`<div class="extra-example">${x.sense?`<small lang="en">${esc(x.sense)}</small>`:''}<p lang="sv">${esc(x.sv)}</p><p lang="en">${esc(x.en)}</p></div>`).join(''):type==='pronunciations'?values.map(x=>x.kind==='audio'?`<div class="extra-audio"><span>${esc(x.label)}</span><audio controls preload="none" src="${esc(x.url)}"></audio><small><a href="${esc(x.source)}" target="_blank" rel="noopener noreferrer">录音来源与许可</a> · ${esc(x.license)}${x.author?' · '+esc(x.author):''}</small></div>`:`<p class="extra-ipa"><span>${esc(x.label)}</span> <span lang="sv">${esc(x.text)}</span></p>`).join(''):values.map(x=>`<div class="extra-term"><strong lang="sv">${esc(x.term)}</strong>${x.note?` <span>${esc(x.note)}</span>`:''}${x.sense?`<small lang="en">${esc(x.sense)}</small>`:''}</div>`).join('')}${notice}</section>`;
    }
    async function fetchIfNeeded(force=false){
      if(current!==view||!active.size||view.loading)return;
      let entry=cached(word);
      if(entry&&!force&&(!active.has('pronunciations')||entry.value.audioFetched)){view.error='';draw();return;}
      if(global.navigator?.onLine===false){view.error=entry?'':'当前离线，未找到可用缓存。';draw();return;}
      const controller=new AbortController();view.controller=controller;view.loading=true;view.error='';draw();
      const timer=setTimeout(()=>controller.abort(),12000);
      try {
        const original=entry&&!force?entry.value:await load(word,controller.signal);
        const value={...original,pronunciations:original.pronunciations.slice()};
        if(controller.signal.aborted||current!==view||view.controller!==controller)return;
        // Show verified dictionary text while the independent recording request is pending.
        remember(word,value);draw();
        if(active.has('pronunciations')&&!value.audioFetched){try{const audio=await audioInfo(value,controller.signal);if(controller.signal.aborted) return;value.pronunciations.push(...audio);value.audioFetched=true;value.audioWarning=false;}catch(error){if(controller.signal.aborted)throw error;value.audioWarning=true;}}
        if(controller.signal.aborted||current!==view||view.controller!==controller)return;
        remember(word,value);
      }catch(error){if(current===view&&view.controller===controller&&active.size)view.error=controller.signal.aborted?'查询超时，可稍后重试。':error.name==='TypeError'?'网络连接失败，请稍后重试。':error.message||'参考源暂时不可用。';}
      finally {clearTimeout(timer);if(current===view&&view.controller===controller){view.controller=null;view.loading=false;draw();}}
    }
    view.draw=draw;
    view.fetch=fetchIfNeeded;
    draw();if(active.size)fetchIfNeeded();
  }
  global.addEventListener?.('offline',()=>{if(current){const controller=current.controller;current.controller=null;controller?.abort();current.loading=false;current.error='';current.draw();}});
  global.addEventListener?.('online',()=>{if(current){current.draw();current.fetch();}});
  global.OrdrumWordExtras={mount,unmount:stop,parse,lemma,load,audioInfo};
})(window);
