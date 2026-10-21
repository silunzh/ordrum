const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const elements = new Map();
const stored = new Map();
const blobs = [];
const downloadEvents = [];
const documentListeners = new Map();
const timers = [];
const windowListeners = new Map();
function decodeHTML(value) {
  return value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
}
function element(key = '') {
  let markup = '';
  const listeners = new Map();
  const node = {
    key,id:key.startsWith('#') ? key.slice(1) : '',tagName:key === '#dictation-answer' ? 'INPUT' : 'DIV',textContent:'',value:'',open:false,disabled:false,readOnly:false,dataset:{},scrollTop:0,scrollLeft:0,
    get innerHTML(){return markup;},
    set innerHTML(value){
      markup = value;
      if (key === '#dialog-content') {
        for (const [selector,item] of elements) if (item.dialogOwned) elements.delete(selector);
        for (const [index,match] of Array.from(value.matchAll(/<(input|select|textarea|button|a)\b([^>]*)>/g)).entries()) {
          const [,tag,attributes]=match;
          const id=attributes.match(/(?:^|\s)id="([^"]+)"/)?.[1];
          const selector=id?`#${id}`:`@dialog-${index}`;
          const control=element(selector);control.tagName=tag.toUpperCase();control.dialogOwned=true;
          control.value=decodeHTML(attributes.match(/(?:^|\s)value="([^"]*)"/)?.[1]||'');
          for(const data of attributes.matchAll(/\bdata-([a-z-]+)="([^"]*)"/g))control.dataset[data[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=decodeHTML(data[2]);
          if(tag==='select') {
            const options=value.slice(match.index+match[0].length).split('</select>')[0];
            control.options=Array.from(options.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g),option=>({value:decodeHTML(option[1].match(/\bvalue="([^"]*)"/)?.[1]||''),textContent:decodeHTML(option[2]),selected:/\bselected\b/.test(option[1])}));
            control.value=(control.options.find(option=>option.selected)||control.options[0])?.value||'';
          }
          elements.set(selector,control);
        }
      }
      // These are the recreated elements used by the actual app's dictation render.
      if (key !== '#mode-content') return;
      const inputMarkup = value.match(/<input\b(?=[^>]*\bid="dictation-answer")[^>]*>/)?.[0];
      if (inputMarkup) {
        const input = element('#dictation-answer');
        input.value = decodeHTML(inputMarkup.match(/\bvalue="([^"]*)"/)?.[1] || '');
        input.readOnly = /\breadonly\b/.test(inputMarkup);
        elements.set('#dictation-answer',input);
        elements.set('#dictation-form',element('#dictation-form'));
      }
    },
    classList:{add(){},remove(){},toggle(){}},
    addEventListener(type,fn){if (!listeners.has(type)) listeners.set(type,[]);listeners.get(type).push(fn);},
    dispatch(type,event){for (const fn of listeners.get(type)||[]) fn(event);},
    setAttribute(){},removeAttribute(){},appendChild(child){child.parentNode=this;},focus(){document.activeElement=this;},scrollIntoView(){},
    setSelectionRange(start,end,direction='none'){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},
    contains(other){return other===this||key==='#app-dialog'&&!!other?.dialogOwned&&Array.from(elements.values()).includes(other);},
    querySelectorAll(){return key==='#app-dialog'?Array.from(elements.values()).filter(item=>item.dialogOwned):[];},querySelector(selector){return lookup(selector);},
    showModal(){this.open=true;},close(){this.open=false;},
    click(){downloadEvents.push({type:'click',attached:!!this.attached,download:this.download});},
    remove(){downloadEvents.push({type:'remove',attached:!!this.attached});this.attached=false;},
  };
  return node;
}
function lookup(selector) {
  if (selector === 'dialog[open]') return [...elements.values()].find(node => node.open && (node.key === '#app-dialog' || node.key === '#pwa-install-dialog')) || null;
  if (!elements.has(selector)) elements.set(selector,element(selector));
  return elements.get(selector);
}
const document = {
  querySelector:lookup,querySelectorAll(){return [];},
  addEventListener(type,fn){if (!documentListeners.has(type)) documentListeners.set(type,[]);documentListeners.get(type).push(fn);},
  createElement:tag => element(tag),activeElement:{tagName:'BODY'},
  body:{appendChild(node){node.attached=true;downloadEvents.push({type:'append'});}},
};
const sandbox = {
  document,window:{addEventListener(type,fn){if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(fn);}},Blob,console,
  localStorage:{setItem(key,value){stored.set(key,value);},getItem(key){return stored.get(key)||null;}},
  setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},
  URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test';},revokeObjectURL(){}},
};
sandbox.window.localStorage = sandbox.localStorage;
vm.createContext(sandbox);
for (const name of ['study.js','review.js','plan-core.js','session.js','plan-session.js','cloud.js','sync-health.js']) {
  const modulePath=path.resolve(__dirname,'../public',name);
  vm.runInContext(fs.readFileSync(modulePath,'utf8'),sandbox,{filename:modulePath});
}
const sourcePath = path.resolve(__dirname,'../public/app.js');
const source = fs.readFileSync(sourcePath,'utf8').replace(/\ninit\(\);\s*$/,'\n');
vm.runInContext(source,sandbox,{filename:sourcePath});
const run = expression => vm.runInContext(expression,sandbox);
const json = expression => JSON.parse(run(`JSON.stringify(${expression})`));
let passed = 0;
function test(name,fn) { fn(); passed++; console.log(`PASS ${name}`); }

const fixture = {
  book:{id:'rivstart-a1-a2',title:'Rivstart A1/A2 Ordkort'},
  chapters:[{id:1,title:'Kapitel 1'},{id:2,title:'Kapitel 2'}],
  words:[
    {id:'bomull',chapter:1,swedish:'(en) bomull',english:'cotton',pos:'noun',forms:[]},
    {id:'kaffe',chapter:1,swedish:'(ett) kaffe',english:'coffee',pos:'noun',forms:[]},
    {id:'yr',chapter:1,swedish:'yr (adj.)',english:'dizzy',pos:'adjective',forms:[]},
    {id:'skal',chapter:1,swedish:'Skål!',english:'Cheers!',pos:'phrase',forms:[]},
    {id:'as-ridge',chapter:2,swedish:'en ås',english:'ridge',pos:'noun',forms:[]},
    {id:'here',chapter:2,swedish:'här',english:'here',pos:'adverb',forms:[]},
    {id:'beer',chapter:2,swedish:'en öl',english:'beer',pos:'noun',forms:[]},
    {id:'1800',chapter:2,swedish:'1800-talet',english:'the nineteenth century',pos:'phrase',forms:[]},
  ],
};
run(`data=${JSON.stringify(fixture)};state.selectedChapters=[1,2]`);
function answer(id,text) {
  run(`currentDeck=[${JSON.stringify(id)}];dictationIndex=0;dictationResult=null;dictationAnswers={};mistakes=new Set();dictationDraft='';`);
  lookup('#dictation-answer').value = text;
  run('checkAnswer()');
  return run('dictationResult.status');
}
test('adjective annotation removed',() => assert.equal(run('studyText("yr (adj.)")'),'yr'));
test('parenthesized en normalized',() => assert.equal(run('studyText("(en) bomull")'),'en bomull'));
test('parenthesized ett normalized',() => assert.equal(run('studyText("(ett) kaffe")'),'ett kaffe'));
test('meaningful hyphen retained',() => assert.equal(run('studyText("1800-talet")'),'1800-talet'));
test('case and terminal punctuation ignored',() => assert.equal(run('normalizeAnswer(" SKÅL! ")'),'skål'));
test('multiple spaces normalized',() => assert.equal(run('normalizeAnswer("  god   morgon  ")'),'god morgon'));
test('decomposed å uses NFC',() => assert.equal(run('normalizeAnswer("a\\u030a")'),'å'));
test('å not folded to a',() => assert.notEqual(run('normalizeAnswer("å")'),run('normalizeAnswer("a")')));
test('ä not folded to a',() => assert.notEqual(run('normalizeAnswer("ä")'),run('normalizeAnswer("a")')));
test('ö not folded to o',() => assert.notEqual(run('normalizeAnswer("ö")'),run('normalizeAnswer("o")')));
test('noun answer without en accepted',() => assert.equal(answer('bomull','bomull'),'correct'));
test('noun answer with en accepted',() => assert.equal(answer('bomull','en bomull'),'correct'));
test('noun answer without ett accepted',() => assert.equal(answer('kaffe','kaffe'),'correct'));
test('noun answer with ett accepted',() => assert.equal(answer('kaffe','ett kaffe'),'correct'));
test('adjective answer excludes annotation',() => assert.equal(answer('yr','yr'),'correct'));
test('uppercase and punctuation accepted in checker',() => assert.equal(answer('skal','  SKÅL.  '),'correct'));
test('decomposed å accepted in checker',() => assert.equal(answer('as-ridge','a\u030as'),'correct'));
test('missing å rejected in checker',() => assert.equal(answer('as-ridge','as'),'wrong'));
test('missing ä rejected in checker',() => assert.equal(answer('here','har'),'wrong'));
test('missing ö rejected in checker',() => assert.equal(answer('beer','ol'),'wrong'));
test('hyphenated number answer accepted',() => assert.equal(answer('1800','1800-talet'),'correct'));

sandbox.speechCalls = [];
run('speak = text => speechCalls.push(text)');
function startDictation({deck=['bomull','kaffe'],autoPlay=false,index=0}={}) {
  timers.length = 0;
  sandbox.speechCalls.length = 0;
  lookup('#app-dialog').close();
  document.activeElement = {tagName:'BODY'};
  run(`state.mode='dictation';state.autoPlay=${autoPlay};state.selectedChapters=[1,2];currentDeck=${JSON.stringify(deck)};dictationIndex=${index};dictationResult=null;dictationAnswers={};mistakes=new Set();retryMode=false;dictationDraft='';renderMode();`);
}
function submitForm() {
  const event = {defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
  lookup('#dictation-form').dispatch('submit',event);
  return event;
}
function pressEnter(options={}) {
  const originalForm = lookup('#dictation-form');
  const event = {
    key:'Enter',code:'Enter',keyCode:13,repeat:false,isComposing:false,
    altKey:false,ctrlKey:false,metaKey:false,defaultPrevented:false,preventCalls:0,
    target:document.activeElement,
    preventDefault(){this.defaultPrevented=true;this.preventCalls++;},
    stopPropagation(){},...options,
  };
  for (const fn of documentListeners.get('keydown')||[]) fn(event);
  // Model the browser's implicit form submission, which must be suppressed by
  // the handled keydown so a single Enter cannot check and then advance.
  if (!event.defaultPrevented && event.target?.id === 'dictation-answer' && !event.isComposing && event.keyCode !== 229 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.implicitSubmitted = true;
    originalForm.dispatch('submit',{preventDefault(){}});
  }
  return event;
}
function typeAnswer(value) { lookup('#dictation-answer').value = value; }
function clickAction(action,extra={}) {
  const button = {dataset:{action,...extra},disabled:false};
  const event = {target:{closest:()=>button}};
  for (const fn of documentListeners.get('click')||[]) fn(event);
}
function flushTimers() {
  const queued = timers.splice(0);
  for (const callback of queued) callback();
}
test('dictation starts with immediate audio despite flashcard autoplay off',() => {
  startDictation();
  assert.deepEqual(sandbox.speechCalls,['(en) bomull']);
  assert.equal(document.activeElement,lookup('#dictation-answer'));
  assert.equal(lookup('#dictation-answer').readOnly,false);
});
test('dictation does not duplicate audio when flashcard autoplay is on',() => {
  startDictation({autoPlay:true});flushTimers();
  assert.deepEqual(sandbox.speechCalls,['(en) bomull']);
});
test('prompt Enter checks exactly once and focuses readonly feedback',() => {
  startDictation();typeAnswer('bomull');
  const event = pressEnter();
  assert.equal(event.defaultPrevented,true);
  assert.equal(event.preventCalls,1);
  assert.equal(event.implicitSubmitted,undefined);
  assert.equal(run('dictationResult.status'),'correct');
  assert.equal(run('dictationIndex'),0);
  assert.equal(document.activeElement,lookup('#dictation-answer'));
  assert.equal(lookup('#dictation-answer').readOnly,true);
  assert.deepEqual(sandbox.speechCalls,['(en) bomull']);
});
test('correct feedback Enter advances one word, clears input and autoplays',() => {
  startDictation();typeAnswer('bomull');pressEnter();
  const event = pressEnter();
  assert.equal(event.defaultPrevented,true);
  assert.equal(run('dictationIndex'),1);
  assert.equal(run('dictationResult'),null);
  assert.equal(lookup('#dictation-answer').value,'');
  assert.equal(lookup('#dictation-answer').readOnly,false);
  assert.equal(document.activeElement,lookup('#dictation-answer'));
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','(ett) kaffe']);
});
test('next-word autoplay occurs once with flashcard autoplay on',() => {
  startDictation({autoPlay:true});typeAnswer('bomull');pressEnter();pressEnter();flushTimers();
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','(ett) kaffe']);
});
test('wrong feedback Enter retries the same word and autoplays once',() => {
  startDictation();typeAnswer('wrong');pressEnter();
  assert.equal(run('dictationResult.status'),'wrong');
  assert.equal(sandbox.speechCalls.length,1);
  const event = pressEnter();
  assert.equal(event.defaultPrevented,true);
  assert.equal(run('dictationIndex'),0);
  assert.equal(run('dictationResult'),null);
  assert.equal(lookup('#dictation-answer').value,'');
  assert.equal(lookup('#dictation-answer').readOnly,false);
  assert.equal(document.activeElement,lookup('#dictation-answer'));
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','(en) bomull']);
});
test('corrected retry keeps first-attempt history and then advances',() => {
  startDictation();typeAnswer('wrong');pressEnter();pressEnter();
  typeAnswer('bomull');pressEnter();
  assert.equal(run('dictationResult.status'),'correct');
  assert.equal(run('dictationAnswers.bomull'),'wrong');
  assert.equal(run('mistakes.has("bomull")'),true);
  pressEnter();
  assert.equal(run('dictationIndex'),1);
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','(en) bomull','(ett) kaffe']);
});
test('revealed answer Enter clears and retries instead of skipping',() => {
  startDictation();typeAnswer('partial');clickAction('reveal-answer');
  assert.equal(run('dictationResult.status'),'revealed');
  assert.equal(document.activeElement,lookup('#dictation-answer'));
  assert.equal(sandbox.speechCalls.length,1);
  pressEnter();
  assert.equal(run('dictationIndex'),0);
  assert.equal(run('dictationResult'),null);
  assert.equal(lookup('#dictation-answer').value,'');
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','(en) bomull']);
});
test('empty Enter neither judges nor advances or replays',() => {
  startDictation();typeAnswer('  ');const event=pressEnter();
  assert.equal(event.defaultPrevented,true);
  assert.equal(run('dictationResult'),null);
  assert.equal(run('dictationIndex'),0);
  assert.equal(document.activeElement,lookup('#dictation-answer'));
  assert.equal(sandbox.speechCalls.length,1);
});
test('held Enter is prevented without judging the prompt',() => {
  startDictation();typeAnswer('bomull');const event=pressEnter({repeat:true});
  assert.equal(event.defaultPrevented,true);
  assert.equal(event.implicitSubmitted,undefined);
  assert.equal(run('dictationResult'),null);
  assert.equal(sandbox.speechCalls.length,1);
});
test('held Enter cannot skip correct feedback',() => {
  startDictation();typeAnswer('bomull');pressEnter();
  const event=pressEnter({repeat:true});
  assert.equal(event.defaultPrevented,true);
  assert.equal(run('dictationIndex'),0);
  assert.equal(run('dictationResult.status'),'correct');
  assert.equal(sandbox.speechCalls.length,1);
});
test('IME composition Enter is left to the input method',() => {
  startDictation();typeAnswer('bomull');const event=pressEnter({isComposing:true});
  assert.equal(event.defaultPrevented,false);
  assert.equal(run('dictationResult'),null);
  assert.equal(sandbox.speechCalls.length,1);
});
test('IME keyCode 229 cannot check or advance',() => {
  startDictation();typeAnswer('bomull');const event=pressEnter({keyCode:229});
  assert.equal(event.defaultPrevented,false);
  assert.equal(run('dictationResult'),null);
  assert.equal(sandbox.speechCalls.length,1);
});
test('already prevented Enter is not processed twice',() => {
  startDictation();typeAnswer('bomull');const event=pressEnter({defaultPrevented:true});
  assert.equal(event.preventCalls,0);
  assert.equal(run('dictationResult'),null);
  assert.equal(sandbox.speechCalls.length,1);
});
test('focused button keeps native Enter behavior',() => {
  startDictation();typeAnswer('bomull');pressEnter();
  document.activeElement={tagName:'BUTTON',id:'another-control'};
  const event=pressEnter();
  assert.equal(event.defaultPrevented,false);
  assert.equal(run('dictationIndex'),0);
  assert.equal(sandbox.speechCalls.length,1);
});
test('unrelated editable field keeps its Enter behavior',() => {
  startDictation();document.activeElement={tagName:'TEXTAREA',id:'other-field'};
  const event=pressEnter();
  assert.equal(event.defaultPrevented,false);
  assert.equal(run('dictationResult'),null);
});
test('modal dialog prevents dictation shortcuts',() => {
  startDictation();typeAnswer('bomull');lookup('#app-dialog').showModal();
  pressEnter({target:{tagName:'BUTTON'}});
  assert.equal(run('dictationResult'),null);
  assert.equal(sandbox.speechCalls.length,1);
  lookup('#app-dialog').close();
});
test('final correct Enter completes the round without replay or overflow',() => {
  startDictation({deck:['bomull']});typeAnswer('bomull');pressEnter();pressEnter();
  assert.equal(lookup('#app-dialog').open,true);
  assert.equal(run('dictationIndex'),0);
  assert.equal(run('currentDeck.length'),1);
  assert.deepEqual(sandbox.speechCalls,['(en) bomull']);
});
test('final wrong Enter stays in the round and replays current word',() => {
  startDictation({deck:['bomull']});typeAnswer('wrong');pressEnter();pressEnter();
  assert.equal(lookup('#app-dialog').open,false);
  assert.equal(run('dictationIndex'),0);
  assert.equal(run('dictationResult'),null);
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','(en) bomull']);
});
test('form submit checks, then advances correct feedback',() => {
  startDictation();typeAnswer('bomull');
  assert.equal(submitForm().defaultPrevented,true);
  assert.equal(run('dictationResult.status'),'correct');
  submitForm();
  assert.equal(run('dictationIndex'),1);
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','(ett) kaffe']);
});
test('form submit retries wrong feedback instead of advancing',() => {
  startDictation();typeAnswer('wrong');submitForm();submitForm();
  assert.equal(run('dictationIndex'),0);
  assert.equal(run('dictationResult'),null);
  assert.equal(lookup('#dictation-answer').value,'');
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','(en) bomull']);
});
test('retry button shares keyboard clear-focus-and-replay flow',() => {
  startDictation();typeAnswer('wrong');pressEnter();clickAction('dict-retry');
  assert.equal(run('dictationIndex'),0);
  assert.equal(run('dictationResult'),null);
  assert.equal(lookup('#dictation-answer').value,'');
  assert.equal(document.activeElement,lookup('#dictation-answer'));
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','(en) bomull']);
});
test('voices refresh preserves partial input and does not replay',() => {
  startDictation();typeAnswer('bom');const input=lookup('#dictation-answer');
  sandbox.speechSynthesis = sandbox.window.speechSynthesis = {
    getVoices:()=>[{lang:'sv-SE',voiceURI:'Alva Swedish',name:'Alva'}],cancel(){},
  };
  run('refreshVoices()');flushTimers();
  assert.equal(run('voices.length'),1);
  assert.equal(lookup('#dictation-answer'),input);
  assert.equal(input.value,'bom');
  assert.equal(document.activeElement,input);
  assert.deepEqual(sandbox.speechCalls,['(en) bomull']);
});
test('voices refresh preserves feedback without advancing or replaying',() => {
  startDictation();typeAnswer('bomull');pressEnter();const input=lookup('#dictation-answer');
  run('refreshVoices()');flushTimers();
  assert.equal(lookup('#dictation-answer'),input);
  assert.equal(run('dictationResult.status'),'correct');
  assert.equal(run('dictationIndex'),0);
  assert.deepEqual(sandbox.speechCalls,['(en) bomull']);
});
test('passive render can suppress dictation autoplay',() => {
  startDictation();run('renderMode({autoplay:false})');flushTimers();
  assert.equal(sandbox.speechCalls.length,1);
});
test('chapter change autoplays the newly selected first prompt',() => {
  startDictation();run('changeChapters([2])');
  assert.equal(run('currentWord(dictationIndex).id'),'as-ridge');
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','en ås']);
});
test('mistakes round autoplays its first prompt',() => {
  startDictation();typeAnswer('wrong');pressEnter();run('retryMistakes()');
  assert.equal(run('retryMode'),true);
  assert.equal(run('dictationResult'),null);
  assert.equal(document.activeElement,lookup('#dictation-answer'));
  assert.deepEqual(sandbox.speechCalls,['(en) bomull','(en) bomull']);
});
test('flashcards stay silent when their autoplay preference is off',() => {
  startDictation();sandbox.speechCalls.length=0;
  run("state.mode='flashcard';state.autoPlay=false;flashIndex=0;renderMode();flashMove(1)");flushTimers();
  assert.deepEqual(sandbox.speechCalls,[]);
});
test('flashcard autoplay still reads the current card once',() => {
  startDictation();sandbox.speechCalls.length=0;
  run("state.mode='flashcard';state.autoPlay=true;flashIndex=0;renderMode();flashMove(1)");flushTimers();
  assert.deepEqual(sandbox.speechCalls,['(ett) kaffe']);
});


function startFlash({autoPlay=false}={}) {
  timers.length=0;sandbox.speechCalls.length=0;
  lookup('#app-dialog').close();document.activeElement={tagName:'BODY'};
  run(`state.mode='flashcard';state.autoPlay=${autoPlay};state.selectedChapters=[1,2];currentDeck=['bomull','kaffe'];flashIndex=0;flipped=false;renderMode();`);
}
test('flashcard back retains its Swedish heading above the revealed meaning',()=>{
  startFlash();clickAction('flip');
  const html=lookup('#mode-content').innerHTML;
  assert.match(html,/<h3 class="flash-word"[^>]*>\(en\) bomull<\/h3>/);
  assert.ok(html.indexOf('(en) bomull')<html.indexOf('class="flash-english"'));
  assert.match(html,/class="flash-english"[^>]*>cotton/);
});
test('flashcard content is an article with a separate flip control',()=>{
  startFlash();
  const html=lookup('#mode-content').innerHTML;
  assert.match(html,/<article[^>]*class="flash-card/);
  assert.doesNotMatch(html,/<button[^>]*class="flash-card/);
  assert.match(html,/<button[^>]*class="flip-toggle"[^>]*data-action="flip"/);
  assert.match(fs.readFileSync(path.resolve(__dirname,'../public/style.css'),'utf8'),/user-select:\s*text/);
});
test('opening the flashcard meaning does not play either language',()=>{
  startFlash({autoPlay:true});flushTimers();sandbox.speechCalls.length=0;
  clickAction('flip');flushTimers();
  assert.equal(run('flipped'),true);
  assert.deepEqual(sandbox.speechCalls,[]);
});
test('returning to the flashcard front autoplays Swedish exactly once',()=>{
  startFlash({autoPlay:true});flushTimers();clickAction('flip');sandbox.speechCalls.length=0;
  clickAction('flip');flushTimers();
  assert.equal(run('flipped'),false);
  assert.deepEqual(sandbox.speechCalls,['(en) bomull']);
});
test('returning to the front stays silent when autoplay is disabled',()=>{
  startFlash();clickAction('flip');clickAction('flip');flushTimers();
  assert.deepEqual(sandbox.speechCalls,[]);
});
test('rapid front-back-front flipping invalidates the initial pending narration',()=>{
  startFlash({autoPlay:true});clickAction('flip');clickAction('flip');flushTimers();
  assert.deepEqual(sandbox.speechCalls,['(en) bomull']);
});
test('a pending front narration cannot play after opening the back',()=>{
  startFlash({autoPlay:true});clickAction('flip');flushTimers();
  assert.deepEqual(sandbox.speechCalls,[]);
});
test('enabling autoplay while on the back stays silent until returning front',()=>{
  startFlash();clickAction('flip');
  lookup('#auto-play').dispatch('change',{target:{checked:true}});flushTimers();
  assert.deepEqual(sandbox.speechCalls,[]);
  clickAction('flip');flushTimers();
  assert.deepEqual(sandbox.speechCalls,['(en) bomull']);
});
test('verb forms appear command-infinitive-present-past-supine without mutating data',()=>{
  sandbox.formFixture={pos:'verb',forms:[{label:'过去时',value:'gick'},{label:'完成式用形 (supinum)',value:'gått'},{label:'不定式',value:'gå'},{label:'现在时',value:'går'},{label:'命令式',value:'gå'}]};
  const before=JSON.stringify(sandbox.formFixture);
  assert.deepEqual(json('visibleForms(formFixture).map(form=>form.label)'),['命令式','不定式','现在时','过去时','完成式用形 (supinum)']);
  assert.equal(JSON.stringify(sandbox.formFixture),before);
});
test('known form aliases sort consistently and custom rows retain their relative order',()=>{
  sandbox.formFixture={pos:'vb',forms:[{label:'我的例句',value:'one'},{label:'supinum',value:'gått'},{label:'past',value:'gick'},{label:'另一个例句',value:'two'},{label:'present',value:'går'},{label:'infinitive',value:'gå'},{label:'imperative',value:'gå'}]};
  assert.deepEqual(json('visibleForms(formFixture).map(form=>form.label)'),['imperative','infinitive','present','past','supinum','我的例句','另一个例句']);
});
test('rare modal forms keep their grammatical category in the verb ordering',()=>{
  sandbox.formFixture={pos:'verb',forms:[{label:'不定式（少见）',value:'skola'},{label:'现在时',value:'ska'},{label:'过去时',value:'skulle'},{label:'完成式用形 (supinum)（少见）',value:'skolat'}]};
  assert.deepEqual(json('visibleForms(formFixture).map(form=>form.label)'),['不定式（少见）','现在时','过去时','完成式用形 (supinum)（少见）']);
});
test('noun form order remains exactly as the dictionary or user supplied it',()=>{
  sandbox.formFixture={pos:'noun',forms:[{label:'复数定',value:'barnen'},{label:'单数定',value:'barnet'},{label:'单数不定',value:'ett barn'}]};
  assert.deepEqual(json('visibleForms(formFixture)'),sandbox.formFixture.forms);
});

(async () => {
  run(`state={selectedChapters:[1,2],mode:'preview',layout:'list',marks:{bomull:{status:'known',updated:'2026-10-20T10:00:00Z'}},overrides:{kaffe:{english:'coffee; a cup of coffee',pos:'noun',forms:[{label:'单数定',value:'kaffet'}],definitionStatus:'manual'}},rate:1,autoPlay:true,voiceURI:'Alva Swedish'};exportProgress();`);
  const backupText = await blobs.at(-1).text();
  const backup = JSON.parse(backupText);
  test('export attaches anchor before click',() => assert.equal(downloadEvents.find(event => event.type === 'click').attached,true));
  test('export removes attached anchor',() => assert.equal(downloadEvents.at(-1).type,'remove'));
  test('export identifies app and book',() => assert.deepEqual([backup.app,backup.version,backup.book],['ordrum',1,'rivstart-a1-a2']));
  test('export carries forms and voice preference',() => assert.deepEqual([backup.state.overrides.kaffe.forms[0].value,backup.state.voiceURI],['kaffet','Alva Swedish']));
  run(`state={selectedChapters:[1],mode:'preview',layout:'grid',marks:{yr:{status:'review'}},overrides:{},rate:0.7,autoPlay:false,voiceURI:''};currentDeck=[];flashIndex=0;dictationIndex=0;dictationResult=null;dictationAnswers={};mistakes=new Set();retryMode=false;dictationDraft='';`);
  sandbox.backupFile = {size:Buffer.byteLength(backupText),text:async () => backupText};
  await run('importProgress(backupFile)');
  if (run('pendingRestore !== null')) run('commitRestore()');
  test('import restores selected chapters',() => assert.deepEqual(json('state.selectedChapters'),[1,2]));
  test('import restores known mark',() => assert.equal(run('markStatus("bomull")'),'known'));
  test('import merges existing marks',() => assert.equal(run('markStatus("yr")'),'review'));
  test('import restores edit and forms',() => assert.deepEqual(json('state.overrides.kaffe'),backup.state.overrides.kaffe));
  test('import restores rate and autoplay',() => assert.deepEqual(json('[state.rate,state.autoPlay]'),[1,true]));
  test('import restores voice selection',() => assert.equal(run('state.voiceURI'),'Alva Swedish'));
  test('import persists merged record',() => assert.equal(JSON.parse(stored.get('ordrum.rivstart.v1')).voiceURI,'Alva Swedish'));
  const before = json('state');
  sandbox.backupFile = {size:50,text:async () => JSON.stringify({app:'other',version:1,state:{selectedChapters:[]}})};
  await run('importProgress(backupFile)');
  if (run('pendingRestore !== null')) run('commitRestore()');
  test('invalid backup leaves progress intact',() => assert.deepEqual(json('state'),before));
function resetStudyFixture() {
  run(`state={selectedChapters:[1,2],mode:'dictation',layout:'grid',marks:{},overrides:{},rate:0.85,autoPlay:false,voiceURI:''};StudyCore.normalise(state,data);resetDeck();dictationDraft='';`);
  lookup('#app-dialog').close();
  sandbox.speechCalls.length=0;timers.length=0;
}
function browserReload() {
  const reloaded={...sandbox,document:{...document,addEventListener(){}},window:{addEventListener(){}},speechCalls:[]};
  reloaded.window.localStorage = reloaded.localStorage;
  vm.createContext(reloaded);
  for(const name of ['study.js','review.js','plan-core.js','session.js','plan-session.js','cloud.js','sync-health.js','app.js']) {
    const modulePath=path.resolve(__dirname,'../public',name);
    const code=fs.readFileSync(modulePath,'utf8').replace(/\ninit\(\);\s*$/,'\n');
    vm.runInContext(code,reloaded,{filename:modulePath});
  }
  const execute=expression=>vm.runInContext(expression,reloaded);
  execute(`data=${JSON.stringify(fixture)};speak=text=>speechCalls.push(text);restore();restoreSavedStudy();renderMode({autoplay:false});`);
  return {run:execute,json:expression=>JSON.parse(execute(`JSON.stringify(${expression})`))};
}

function documentEvent(type,event) {for(const fn of documentListeners.get(type)||[])fn(event);}
function selectNotebookWord(id) {documentEvent('change',{target:{id:'',dataset:{studyWord:id},checked:true}});}
test('task controls create and rename a task using the selected chapters',()=>{
  resetStudyFixture();run('state.selectedChapters=[1]');
  lookup('#study-task-name').value='第一周';lookup('input[name="study-scope"]:checked').value='selected';
  documentEvent('submit',{target:{id:'study-create-form'},preventDefault(){}});
  assert.equal(run('activeStudyTask().name'),'第一周');
  assert.deepEqual(json('activeStudyTask().chapterIds'),[1]);
  assert.equal(run('activeStudyTask().wordIds.length'),4);
  const id=run('state.activeTaskId');lookup('#study-task-name').value='新的任务名称';
  documentEvent('submit',{target:{id:'study-rename-form',dataset:{id}},preventDefault(){}});
  assert.equal(run('activeStudyTask().name'),'新的任务名称');
});

test('a whole-book task can be created when no chapters are selected',()=>{
  resetStudyFixture();run('state.selectedChapters=[]');
  lookup('#study-task-name').value='全书计划';lookup('input[name="study-scope"]:checked').value='all';
  documentEvent('submit',{target:{id:'study-create-form'},preventDefault(){}});
  assert.deepEqual(json('activeStudyTask().chapterIds'),[1,2]);
  assert.equal(run('activeStudyTask().wordIds.length'),8);
});

test('archiving and restoring a task preserve its independent progress',()=>{
  resetStudyFixture();run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'归档任务'));activateStudyTask(state.tasks[0].id);setMark('bomull','known');`);
  const id=run('state.activeTaskId');clickAction('study-archive-task',{id});
  assert.equal(run('state.tasks[0].status'),'archived');
  assert.equal(run('state.activeTaskId'),null);
  clickAction('study-restore-task',{id});
  assert.equal(run('state.tasks[0].status'),'active');
  assert.equal(run('state.tasks[0].marks.bomull.status'),'known');
});
test('notebook controls preserve counts while marking a pending word mastered',()=>{
  resetStudyFixture();run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'错题任务'));activateStudyTask(state.tasks[0].id);recordStudyResult('bomull','wrong','bom');state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'无关联任务'));state.tasks[1].marks.bomull={status:'review'};window.OrdrumStudyUI.showNotebook();`);
  assert.match(lookup('#study-notebook-summary').textContent,/1.*1/);
  assert.match(lookup('#study-notebook-results').innerHTML,/aria-label="听读 \(en\) bomull"/);
  selectNotebookWord('bomull');clickAction('study-notebook-mastered');
  assert.match(lookup('#study-notebook-summary').textContent,/1.*0/);
  assert.equal(run('state.notebook.bomull.status'),'mastered');
  assert.equal(run('state.notebook.bomull.count'),1);
  assert.equal(run('activeStudyTask().errors.bomull.status'),'mastered');
  assert.equal(run('state.marks.bomull.status'),'known');
  assert.equal(run('activeStudyTask().marks.bomull.status'),'known');
  assert.equal(run('state.tasks[1].marks.bomull.status'),'review');
});

test('notebook mastery refresh preserves the dictation draft and stays silent',()=>{
  resetStudyFixture();startDictation();
  lookup('#dictation-answer').value='bom';lookup('#dictation-answer').dispatch('input',{target:lookup('#dictation-answer')});
  run("recordStudyResult('kaffe','wrong','ka');window.OrdrumStudyUI.showNotebook()");
  const calls=sandbox.speechCalls.length;selectNotebookWord('kaffe');clickAction('study-notebook-mastered');
  assert.equal(run('dictationDraft'),'bom');
  assert.equal(lookup('#dictation-answer').value,'bom');
  assert.deepEqual(json('[currentDeck,dictationIndex,dictationResult]'),[['bomull','kaffe'],0,null]);
  assert.equal(sandbox.speechCalls.length,calls);
});

test('deleting a selected notebook record preserves marks and prevents reload migration',()=>{
  resetStudyFixture();run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'错题任务'));activateStudyTask(state.tasks[0].id);recordStudyResult('bomull','wrong','bom');window.OrdrumStudyUI.showNotebook();`);
  selectNotebookWord('bomull');clickAction('study-notebook-delete');clickAction('study-notebook-confirm-delete');
  assert.equal(run('state.notebook.bomull'),undefined);
  assert.equal(run('activeStudyTask().errors.bomull'),undefined);
  assert.equal(run('markStatus("bomull")'),'review');
  const restored=browserReload();assert.equal(restored.run('state.notebook.bomull'),undefined);
});

test('browser reload resumes the exact flashcard deck, position and revealed side',()=>{
  resetStudyFixture();
  run(`state.mode='flashcard';currentDeck=['yr','kaffe','bomull'];flashIndex=1;flipped=true;save();`);
  const restored=browserReload();
  assert.deepEqual(restored.json('[state.mode,currentDeck,flashIndex,flipped]'),['flashcard',['yr','kaffe','bomull'],1,true]);
});
test('typing a partial dictation answer survives a real script reload',()=>{
  resetStudyFixture();startDictation();
  lookup('#dictation-answer').value='bom';lookup('#dictation-answer').dispatch('input',{target:lookup('#dictation-answer')});
  const restored=browserReload();
  assert.equal(restored.run('dictationDraft'),'bom');
  assert.equal(lookup('#dictation-answer').value,'bom');
  assert.equal(restored.run('dictationResult'),null);
});
test('checked dictation feedback, first-attempt statistics and mistakes survive reload',()=>{
  resetStudyFixture();startDictation();typeAnswer('wrong');run('checkAnswer()');
  const restored=browserReload();
  assert.deepEqual(restored.json('dictationResult'),{status:'wrong',input:'wrong'});
  assert.deepEqual(restored.json('dictationAnswers'),{bomull:'wrong'});
  assert.deepEqual(restored.json('[...mistakes]'),['bomull']);
  assert.equal(restored.run('dictationIndex'),0);
  assert.equal(lookup('#dictation-answer').readOnly,true);
});
test('task switching restores each task checkpoint and isolates its visible progress',()=>{
  resetStudyFixture();
  run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'任务 A'),StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'任务 B'));activateStudyTask(state.tasks[0].id);currentDeck=['yr','bomull','kaffe','skal'];flashIndex=2;flipped=true;setMark('bomull','known');`);
  run('activateStudyTask(state.tasks[1].id)');
  assert.notEqual(run('markStatus("bomull")'),'known');
  run("currentDeck=['skal','yr','bomull','kaffe'];flashIndex=1;save();activateStudyTask(state.tasks[0].id)");
  assert.deepEqual(json('[currentDeck,flashIndex,flipped]'),[['yr','bomull','kaffe','skal'],2,true]);
  assert.equal(run('markStatus("bomull")'),'known');
  run('activateStudyTask(state.tasks[1].id)');
  assert.deepEqual(json('[currentDeck,flashIndex]'),[['skal','yr','bomull','kaffe'],1]);
});
test('an active task and its progress resume after browser reload',()=>{
  resetStudyFixture();
  run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'今天的任务'));activateStudyTask(state.tasks[0].id);setMark('bomull','known');flashIndex=2;flipped=true;save();`);
  const restored=browserReload();
  assert.equal(restored.run('activeStudyTask().name'),'今天的任务');
  assert.equal(restored.run('StudyCore.taskProgress(activeStudyTask()).known'),1);
  assert.deepEqual(restored.json('[flashIndex,flipped]'),[2,true]);
});
test('clearing chapter selection does not erase permanent wrong-answer history',()=>{
  resetStudyFixture();startDictation();typeAnswer('wrong');run('checkAnswer();changeChapters([])');
  const restored=browserReload();
  assert.equal(restored.run('state.notebook.bomull.count'),1);
  assert.equal(restored.run('state.notebook.bomull.status'),'pending');
});
test('notebook practice keeps the original task checkpoint for returning later',()=>{
  resetStudyFixture();
  run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'任务 A'));activateStudyTask(state.tasks[0].id);currentDeck=['yr','kaffe','bomull','skal'];flashIndex=2;flipped=true;save();startNotebookReview(['bomull'],state.activeTaskId);`);
  assert.equal(run('retryMode'),true);
  assert.match(lookup('#task-context').innerHTML,/data-action="study-return-study"/);
  assert.deepEqual(json('activeStudyTask().session.deck'),['yr','kaffe','bomull','skal']);
  run('save()');const restored=browserReload();
  assert.deepEqual(restored.json('[retryMode,currentDeck]'),[true,['bomull']]);
  restored.run('returnToStudy()');
  assert.deepEqual(restored.json('[retryMode,state.mode,currentDeck,flashIndex,flipped]'),[false,'flashcard',['yr','kaffe','bomull','skal'],2,true]);
});

test('preview during notebook practice shows only review words and reset restores the task scope',()=>{
  resetStudyFixture();
  run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'完整任务'));activateStudyTask(state.tasks[0].id);startNotebookReview(['bomull'],state.activeTaskId);state.mode='preview';renderMode({autoplay:false});`);
  assert.equal(lookup('#result-count').textContent,'1 张卡片');
  assert.match(lookup('#preview-results').innerHTML,/>\(en\) bomull<\/h3>/);
  assert.doesNotMatch(lookup('#preview-results').innerHTML,/>\(ett\) kaffe<\/h3>/);
  run('resetDeck();renderMode({autoplay:false})');
  assert.equal(run('retryMode'),false);
  assert.equal(run('currentDeck.length'),4);
  assert.equal(lookup('#result-count').textContent,'4 张卡片');
});

test('notebook practice can return to a free-study checkpoint outside its chapters',()=>{
  resetStudyFixture();
  run(`state.selectedChapters=[1];state.mode='flashcard';currentDeck=['yr','bomull','kaffe','skal'];flashIndex=1;flipped=true;save();startNotebookReview(['here']);save();`);
  const restored=browserReload();
  assert.deepEqual(restored.json('[retryMode,currentDeck]'),[true,['here']]);
  restored.run('returnToStudy()');
  assert.deepEqual(restored.json('[state.selectedChapters,currentDeck,flashIndex,flipped,retryMode]'),[[1],['yr','bomull','kaffe','skal'],1,true,false]);
});
test('resetting a task clears only its progress and keeps permanent notebook history',()=>{
  resetStudyFixture();
  run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'重置任务'));activateStudyTask(state.tasks[0].id);recordStudyResult('bomull','wrong','bom');resetStudyTask(state.activeTaskId);`);
  assert.deepEqual(json('activeStudyTask().marks'),{});
  assert.deepEqual(json('activeStudyTask().errors'),{});
  assert.equal(run('state.notebook.bomull.count'),1);
  assert.equal(run('state.notebook.bomull.status'),'pending');
});
test('deleting a task retains its wrong words and removes its notebook association',()=>{
  resetStudyFixture();
  run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'删除任务'));activateStudyTask(state.tasks[0].id);recordStudyResult('bomull','wrong','bom');deleteStudyTask(state.activeTaskId);`);
  assert.equal(run('state.tasks.length'),0);
  assert.equal(run('state.activeTaskId'),null);
  assert.equal(run('state.notebook.bomull.count'),1);
  assert.deepEqual(json('state.notebook.bomull.taskIds'),[]);
});


  resetStudyFixture();
  run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'备份任务'));activateStudyTask(state.tasks[0].id);currentDeck=['yr','bomull','kaffe','skal'];flashIndex=2;flipped=true;recordStudyResult('bomull','wrong','bom');exportProgress();`);
  const taskBackupText=await blobs.at(-1).text();
  const taskBackup=JSON.parse(taskBackupText);
  test('v1 backup includes task checkpoints and permanent notebook history',()=>{
    assert.equal(taskBackup.version,1);
    assert.equal(taskBackup.state.tasks[0].session.flashIndex,2);
    assert.equal(taskBackup.state.tasks[0].session.flipped,true);
    assert.equal(taskBackup.state.notebook.bomull.count,1);
  });
  resetStudyFixture();
  run(`state.tasks.push(StudyCore.createTask(data.book,[2],data.words.filter(w=>w.chapter===2),'本机任务'));activateStudyTask(state.tasks[0].id);flashIndex=1;flipped=true;save();`);
  const localTaskId=run('state.activeTaskId');
  sandbox.backupFile={size:Buffer.byteLength(taskBackupText),text:async()=>taskBackupText};
  await run('importProgress(backupFile)');
  if (run('pendingRestore !== null')) run('commitRestore()');
  test('v1 backup import merges tasks and notebook while preserving the current task checkpoint',()=>{
    assert.equal(run('state.tasks.length'),2);
    assert.equal(run('state.activeTaskId'),localTaskId);
    assert.equal(run('activeStudyTask().name'),'本机任务');
    assert.deepEqual(json('[flashIndex,flipped]'),[1,true]);
    assert.equal(run('state.notebook.bomull.count'),1);
    assert.equal(run('state.tasks.find(task=>task.name==="备份任务").session.flashIndex'),2);
  });

  resetStudyFixture();run('captureStudySession()');
  const freeCheckpointBefore=json('state.studySession');
  await new Promise(resolve=>setTimeout(resolve,5));
  run('restoreSavedStudy();captureStudySession();save()');
  const freeCheckpointAfter=json('state.studySession');
  resetStudyFixture();
  run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words.filter(w=>w.chapter===1),'稳定同步任务'));activateStudyTask(state.tasks[0].id)`);
  const taskCheckpointBefore=json('[activeStudyTask().updatedAt,activeStudyTask().session]');
  await new Promise(resolve=>setTimeout(resolve,5));
  run('captureStudySession();save();captureStudySession()');
  test('unchanged free and task checkpoint reads keep stable timestamps and cannot trigger a sync loop',()=>{
    assert.deepEqual(freeCheckpointAfter,freeCheckpointBefore);
    assert.deepEqual(json('[activeStudyTask().updatedAt,activeStudyTask().session]'),taskCheckpointBefore);
  });

  test('cloud progress refreshes an already open task list without losing its focused action or scroll',()=>{
    resetStudyFixture();
    run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words,'原任务'));window.OrdrumStudyUI.showTasks()`);
    const id=run('state.tasks[0].id');
    const button=lookup('#app-dialog').querySelectorAll().find(item=>item.dataset.action==='study-rename-task'&&item.dataset.id===id);
    button.focus();lookup('#app-dialog').scrollTop=170;
    const incoming=json('state');incoming.tasks[0].name='云端更新的任务';incoming.tasks[0].marks.bomull={status:'known',updated:'2026-10-21T10:00:00Z'};
    const added=json(`StudyCore.createTask(data.book,[2],data.words,'另一台设备的新任务')`);incoming.tasks.push(added);
    run(`applyCloudState(${JSON.stringify(incoming)})`);
    const markup=lookup('#dialog-content').innerHTML;
    assert.equal(lookup('#app-dialog').open,true);
    assert.match(markup,/云端更新的任务/);assert.match(markup,/另一台设备的新任务/);assert.match(markup,/已掌握 <b>1<\/b>/);
    assert.equal(document.activeElement.dataset.action,'study-rename-task');assert.equal(document.activeElement.dataset.id,id);
    assert.notEqual(document.activeElement,button,'focus must refer to the newly rendered action');
    assert.equal(lookup('#app-dialog').scrollTop,170);
  });
  test('cloud task list refresh preserves the selected archived filter',()=>{
    resetStudyFixture();run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words,'进行中的任务'));window.OrdrumStudyUI.showTasks()`);
    clickAction('study-task-filter',{value:'archived'});
    const incoming=json('state');const archived=json(`StudyCore.createTask(data.book,[2],data.words,'刚归档的云端任务')`);archived.status='archived';incoming.tasks.push(archived);
    run(`applyCloudState(${JSON.stringify(incoming)})`);
    assert.match(lookup('#dialog-content').innerHTML,/刚归档的云端任务/);
    assert.doesNotMatch(lookup('#dialog-content').innerHTML,/进行中的任务/);
    assert.match(lookup('#dialog-content').innerHTML,/class="active" data-action="study-task-filter" data-value="archived"/);
  });
  test('cloud notebook refresh preserves search, filters, selected words, text selection and scroll',()=>{
    resetStudyFixture();run(`recordStudyResult('bomull','wrong','bom');recordStudyResult('kaffe','wrong','ka');window.OrdrumStudyUI.showNotebook()`);
    lookup('#study-notebook-chapter').value='1';documentEvent('change',{target:lookup('#study-notebook-chapter')});
    const searchInput=lookup('#study-notebook-search');searchInput.value='cot';documentEvent('input',{target:searchInput});
    selectNotebookWord('bomull');searchInput.focus();searchInput.setSelectionRange(1,2,'backward');lookup('#app-dialog').scrollTop=220;
    const incoming=json('state');incoming.notebook.bomull.count=4;
    incoming.notebook.yr={wordId:'yr',count:2,lastWrongAt:'2026-10-21T10:00:00Z',lastAnswer:'y',status:'pending',taskIds:[]};
    incoming.overrides.yr={english:'cot-related dizzy'};incoming.tasks.push(json(`StudyCore.createTask(data.book,[1],data.words,'同步加入的任务')`));
    run(`applyCloudState(${JSON.stringify(incoming)})`);
    assert.equal(lookup('#study-notebook-search'),searchInput,'the search field must stay in the document');
    assert.equal(searchInput.value,'cot');assert.equal(document.activeElement,searchInput);
    assert.deepEqual([searchInput.selectionStart,searchInput.selectionEnd,searchInput.selectionDirection],[1,2,'backward']);
    assert.equal(lookup('#study-notebook-chapter').value,'1');assert.equal(lookup('#study-notebook-status').value,'pending');
    assert.equal(lookup('#app-dialog').scrollTop,220);
    assert.match(lookup('#study-notebook-results').innerHTML,/答错 4 次/);assert.match(lookup('#study-notebook-results').innerHTML,/cot-related dizzy/);
    assert.match(lookup('#study-notebook-results').innerHTML,/已选 1/);assert.match(lookup('#study-notebook-task').innerHTML,/同步加入的任务/);
    clickAction('study-notebook-retry');assert.deepEqual(json('currentDeck'),['bomull']);
  });
  test('cloud notebook refresh keeps its current result page and removes selections deleted remotely',()=>{
    resetStudyFixture();
    const many={...fixture,words:Array.from({length:36},(_,index)=>({id:`extra-${index}`,chapter:1,swedish:`ord ${index}`,english:'word',forms:[]}))};
    run(`data=${JSON.stringify(many)};state.selectedChapters=[1];resetDeck();state.notebook=Object.fromEntries(data.words.slice(0,35).map(word=>[word.id,{wordId:word.id,count:1,lastWrongAt:'2026-10-21T10:00:00Z',lastAnswer:'x',status:'pending',taskIds:[]}]));window.OrdrumStudyUI.showNotebook()`);
    const searchInput=lookup('#study-notebook-search');searchInput.value='';documentEvent('input',{target:searchInput});
    clickAction('study-notebook-next');selectNotebookWord('extra-31');
    const incoming=json('state');delete incoming.notebook['extra-31'];incoming.notebook['extra-35']={wordId:'extra-35',count:1,lastWrongAt:'2026-10-21T10:00:00Z',lastAnswer:'x',status:'pending',taskIds:[]};
    run(`applyCloudState(${JSON.stringify(incoming)})`);
    assert.match(lookup('#study-notebook-results').innerHTML,/2 \/ 2/);assert.match(lookup('#study-notebook-results').innerHTML,/ord 35/);
    assert.doesNotMatch(lookup('#study-notebook-results').innerHTML,/ord 31/);assert.match(lookup('#study-notebook-results').innerHTML,/已选 0/);
    run(`data=${JSON.stringify(fixture)}`);
  });
  test('cloud updates leave open create, rename, edit and confirmation dialogs intact',()=>{
    for(const kind of ['create','rename','edit','confirm']) {
      resetStudyFixture();run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words,'表单任务'));window.OrdrumStudyUI.showTasks()`);
      const id=run('state.tasks[0].id');
      if(kind==='create')run('window.OrdrumStudyUI.showCreateTask()');
      if(kind==='rename')clickAction('study-rename-task',{id});
      if(kind==='edit')run('showEdit("bomull")');
      if(kind==='confirm')clickAction('study-delete-task',{id});
      const field=kind==='edit'?lookup('#edit-english'):kind==='confirm'?null:lookup('#study-task-name');
      if(field){field.value='还没保存的输入';field.focus();field.setSelectionRange(2,4);}
      const before=lookup('#dialog-content').innerHTML;lookup('#app-dialog').scrollTop=75;
      const incoming=json('state');incoming.tasks[0].name='另一台设备改了名字';
      run(`applyCloudState(${JSON.stringify(incoming)})`);
      assert.equal(lookup('#dialog-content').innerHTML,before,`${kind} dialog must not be rebuilt`);
      assert.equal(lookup('#app-dialog').scrollTop,75);
      if(field){assert.equal(field.value,'还没保存的输入');assert.equal(document.activeElement,field);assert.deepEqual([field.selectionStart,field.selectionEnd],[2,4]);}
    }
  });
  test('bookshelf date categories include mastered wrong words and keep undated records in all words',()=>{
    resetStudyFixture();
    run(`recordStudyResult('bomull','wrong','bom');recordStudyResult('bomull','correct','bomull');recordStudyResult('kaffe','wrong','ka');recordStudyResult('yr','wrong','y');recordStudyResult('skal','revealed');state.notebook.yr.lastWrongAt='2000-01-01T00:00:00.000Z';renderSummary()`);
    const chapters=json('StudyCore.notebookChapters(state)');
    assert.equal(chapters.find(ch=>ch.id==='all').count,4);
    assert.equal(chapters.find(ch=>ch.id==='today').count,2);
    assert.equal(chapters.find(ch=>ch.id==='week').count,2);
    clickAction('study-notebook-open',{id:'today'});
    assert.equal(lookup('#study-notebook-status').value,'all');
    assert.equal(lookup('#study-notebook-collection').value,'today');
    assert.match(lookup('#study-notebook-results').innerHTML,/听读 \(en\) bomull/);
    assert.match(lookup('#study-notebook-results').innerHTML,/听读 \(ett\) kaffe/);
    assert.doesNotMatch(lookup('#study-notebook-results').innerHTML,/听读 yr|听读 en skål/);
    lookup('#study-notebook-status').value='pending';documentEvent('change',{target:lookup('#study-notebook-status')});
    assert.doesNotMatch(lookup('#study-notebook-results').innerHTML,/听读 \(en\) bomull/);
    clickAction('study-notebook-open',{id:'all'});
    assert.match(lookup('#study-notebook-results').innerHTML,/听读 yr/);
    assert.equal(run('Object.keys(state.notebook).length'),4);
  });
  test('notebook grouping controls save bookshelf units and restore them after a browser reload',()=>{
    resetStudyFixture();run(`recordStudyResult('bomull','wrong','bom');recordStudyResult('kaffe','wrong','ka');recordStudyResult('here','wrong','har');window.OrdrumStudyUI.showNotebook({collection:'all'})`);
    clickAction('study-notebook-organize',{id:'all'});
    const units=json('state.notebookUnits'), unitId=Object.keys(units)[0];
    assert.equal(Object.keys(units).length,1);
    assert.equal(units[unitId].wordIds.length,3);
    const unit=json('StudyCore.notebookChapters(state)').find(ch=>ch.id===unitId);
    assert.equal(unit.title,'错词单元 1');assert.equal(unit.count,3);
    assert.deepEqual(JSON.parse(stored.get('ordrum.rivstart.v1')).notebookUnits,units);
    const restored=browserReload();assert.deepEqual(restored.json('state.notebookUnits'),units);
    assert.equal(restored.run('Object.keys(state.notebook).length'),3);
    clickAction('study-notebook-organize',{id:'all'});
    assert.deepEqual(json('state.notebookUnits'),units,'a repeated organise action must not regroup words');
  });
  test('practising a bookshelf unit preserves the active task checkpoint and revealed side',()=>{
    resetStudyFixture();
    run(`state.tasks.push(StudyCore.createTask(data.book,[1],data.words,'按单元复习'));activateStudyTask(state.tasks[0].id);recordStudyResult('bomull','wrong','bom');recordStudyResult('kaffe','wrong','ka');currentDeck=['yr','kaffe','bomull','skal'];flashIndex=2;flipped=true;save();StudyCore.organiseNotebook(state,'all');renderSummary()`);
    const unitId=run('Object.keys(state.notebookUnits)[0]');
    clickAction('study-notebook-open',{id:unitId});
    assert.equal(lookup('#study-notebook-collection').value,unitId);
    clickAction('study-notebook-retry-list');
    assert.equal(run('retryMode'),true);
    assert.deepEqual(new Set(json('currentDeck')),new Set(['bomull','kaffe']));
    assert.deepEqual(json('activeStudyTask().session.deck'),['yr','kaffe','bomull','skal']);
    run('returnToStudy()');
    assert.deepEqual(json('[retryMode,state.mode,currentDeck,flashIndex,flipped]'),[false,'flashcard',['yr','kaffe','bomull','skal'],2,true]);
  });
  test('cloud refresh keeps an open notebook unit filter, selection and focus while adding new unit choices',()=>{
    resetStudyFixture();run(`recordStudyResult('bomull','wrong','bom');StudyCore.organiseNotebook(state,'all');renderSummary()`);
    const unitId=run('Object.keys(state.notebookUnits)[0]');
    clickAction('study-notebook-open',{id:unitId});
    selectNotebookWord('bomull');
    const collection=lookup('#study-notebook-collection');collection.focus();lookup('#app-dialog').scrollTop=95;
    const incoming=json('state');
    incoming.notebook.kaffe={wordId:'kaffe',count:1,lastWrongAt:new Date().toISOString(),status:'pending',taskIds:[]};
    incoming.notebook.here={wordId:'here',count:1,lastWrongAt:new Date().toISOString(),status:'pending',taskIds:[]};
    incoming.notebookUnits[unitId].wordIds.push('kaffe');
    incoming.notebookUnits['remote-unit']={id:'remote-unit',number:2,name:'另一设备整理的单元',wordIds:['here'],source:'all',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    run(`applyCloudState(${JSON.stringify(incoming)})`);
    assert.equal(lookup('#study-notebook-collection'),collection);
    assert.equal(collection.value,unitId);assert.equal(document.activeElement,collection);
    assert.equal(lookup('#app-dialog').scrollTop,95);
    assert.match(collection.innerHTML,/另一设备整理的单元/);
    assert.match(lookup('#study-notebook-results').innerHTML,/已选 1/);
    assert.match(lookup('#study-notebook-results').innerHTML,/听读 \(ett\) kaffe/);
    assert.doesNotMatch(lookup('#study-notebook-results').innerHTML,/听读 here/);
    assert.ok(json('StudyCore.notebookChapters(state)').some(chapter=>chapter.title==='另一设备整理的单元'));
  });
  test('notebook book chapters drive the same study modes and preserve the original book selection',()=>{
    resetStudyFixture();
    run(`recordStudyResult('bomull','wrong','bom');recordStudyResult('here','wrong','har');StudyCore.organiseNotebook(state,'all');state.selectedBook='__notebook__';state.selectedNotebookChapters=['all'];changeChapters(['all']);state.mode='flashcard';renderMode();`);
    assert.deepEqual(json('currentDeck'),['bomull','here']);
    assert.deepEqual(json('state.selectedChapters'),[1,2]);
    assert.match(lookup('#chapter-list').innerHTML,/今天错词|本周错词/);
    assert.equal(lookup('#notebook-button').hidden,false);
    clickAction('flip');assert.match(lookup('#mode-content').innerHTML,/id="word-extras"/);
    const restored=browserReload();assert.equal(restored.run('state.selectedBook'),'__notebook__');
    assert.deepEqual(restored.json('currentDeck'),['bomull','here']);
  });
  test('notebook tasks retain a frozen scope and resume after their source group is deleted',()=>{
    resetStudyFixture();
    run(`recordStudyResult('bomull','wrong','bom');recordStudyResult('here','wrong','har');StudyCore.organiseNotebook(state,'all');state.selectedBook='__notebook__';state.selectedNotebookChapters=[Object.keys(state.notebookUnits)[0]];const unit=state.selectedNotebookChapters[0];state.tasks.push(StudyCore.createTask({id:'__notebook__'},[unit],selectedWords(),'错词任务'));activateStudyTask(state.tasks[0].id);StudyCore.deleteNotebookUnit(state,unit);save();`);
    assert.deepEqual(json('currentDeck'),['bomull','here']);
    const restored=browserReload();assert.equal(restored.run('activeStudyTask().bookId'),'__notebook__');
    assert.deepEqual(restored.json('currentDeck'),['bomull','here']);
  });
  test('review history records only the first dictation response across retries and reload',()=>{
    resetStudyFixture();startDictation();typeAnswer('wrong');pressEnter();pressEnter();typeAnswer('bomull');pressEnter();
    assert.equal(run('Object.values(state.reviewEvents).filter(e=>e.wordId==="bomull").length'),1);
    assert.equal(run('Object.values(state.reviewEvents).find(e=>e.wordId==="bomull").outcome'),'wrong');
    const sessionId=run('reviewSessionId');const restored=browserReload();
    assert.equal(restored.run('reviewSessionId'),sessionId);
    assert.equal(restored.run('window.OrdrumReview.schedules(state).bomull.objectiveCorrect'),0);
  });
  test('revealing a dictation answer cannot become an objective first success after retry',()=>{
    resetStudyFixture();startDictation();clickAction('reveal-answer');pressEnter();typeAnswer('bomull');pressEnter();
    const schedule=json('window.OrdrumReview.schedules(state).bomull');
    assert.equal(schedule.revealed,1);assert.equal(schedule.objectiveAttempts,0);
  });
  test('flashcard self assessment is distinct from objective dictation accuracy',()=>{
    resetStudyFixture();startFlash();clickAction('flash-known');
    const schedule=json('window.OrdrumReview.schedules(state).bomull');
    assert.equal(schedule.selfKnown,1);assert.equal(schedule.objectiveAttempts,0);
    assert.equal(schedule.stage,1);
  });
  test('today plan and its original study checkpoint survive reload and return',()=>{
    resetStudyFixture();run(`state.mode='flashcard';currentDeck=['yr','kaffe','bomull','skal'];flashIndex=2;flipped=true;save();startTodayPlan({mode:'flashcard',wordIds:['here','beer']});`);
    assert.equal(run('planKind'),'today');assert.equal(run('state.mode'),'flashcard');
    assert.equal(lookup('#today-plan').hidden,true);
    const restored=browserReload();assert.equal(restored.run('planKind'),'today');
    assert.deepEqual(restored.json('currentDeck'),['here','beer']);
    restored.run('returnToStudy()');
    assert.deepEqual(restored.json('[currentDeck,flashIndex,flipped,planKind]'),[['yr','kaffe','bomull','skal'],2,true,'']);
  });
  test('skip in today plan persists until tomorrow without creating a wrong-answer record',()=>{
    resetStudyFixture();run(`startTodayPlan({mode:'flashcard',wordIds:['bomull','kaffe']});skipTodayWord();`);
    assert.equal(run('currentWord(flashIndex).id'),'kaffe');
    assert.equal(run('Object.keys(state.notebook).length'),0);
    assert.equal(run('window.OrdrumReview.getPlan(state,data).wordIds.includes("bomull")'),false);
    assert.equal(run('Object.values(state.reviewEvents)[0].outcome'),'skip');
  });
  test('import presents changes without applying them, then saves a scoped recovery point before commit',()=>{
    resetStudyFixture();run(`recordStudyResult('kaffe','wrong','ka');captureStudySession();`);
    const old=json('state');
    run(`previewRestore({app:'ordrum',version:1,book:data.book.id,state:{marks:{bomull:{status:'known'}}}})`);
    assert.deepEqual(json('state'),old);assert.equal(lookup('#app-dialog').open,true);
    assert.match(lookup('#dialog-content').innerHTML,/变化|备份当前记录并恢复/);
    run('commitRestore()');
    assert.equal(run('state.marks.bomull.status'),'known');
    assert.equal(run('window.OrdrumSyncHealth.getRecovery(recoveryScope()).backup.state.notebook.kaffe.count'),1);
    assert.equal(run('window.OrdrumSyncHealth.getRecovery(recoveryScope()).backup.state.marks.bomull'),undefined);
  });
  test('recovery quota failure leaves current state and persisted learning data intact',()=>{
    resetStudyFixture();run(`save();previewRestore({app:'ordrum',version:1,state:{marks:{bomull:{status:'known'}}}})`);
    const old=json('state'),saved=stored.get('ordrum.rivstart.v1'), setter=sandbox.localStorage.setItem;
    sandbox.localStorage.setItem=(key,value)=>{if(key==='ordrum.rivstart.v1')throw new Error('quota');setter(key,value);};
    try{run('commitRestore()');}finally{sandbox.localStorage.setItem=setter;}
    assert.deepEqual(json('state'),old);assert.equal(stored.get('ordrum.rivstart.v1'),saved);
    assert.match(lookup('#toast').textContent,/尚未更改当前进度/);
  });
  test('recovery rechecks a changed preview and prevents cross-account confirmation',()=>{
    resetStudyFixture();run(`previewRestore({app:'ordrum',version:1,state:{marks:{bomull:{status:'known'}}}});state.marks.kaffe={status:'review'};commitRestore();`);
    assert.equal(run('state.marks.bomull'),undefined);
    assert.match(lookup('#toast').textContent,/已更新恢复预览/);
    const getHealth=sandbox.window.OrdrumCloud.getHealth;
    sandbox.window.OrdrumCloud.getHealth=()=>({accountId:'a'.repeat(64)});
    try{run('commitRestore()');}finally{sandbox.window.OrdrumCloud.getHealth=getHealth;}
    assert.equal(run('state.marks.bomull'),undefined);assert.equal(run('pendingRestore'),null);
  });
  console.log(`\n${passed} focused checks passed.`);
})().catch(error => {console.error(error);process.exitCode=1;});
