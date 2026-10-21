const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname,'../public/plan.js'),'utf8');
const reviewSource = fs.readFileSync(path.resolve(__dirname,'../public/review.js'),'utf8');
const studySource = fs.readFileSync(path.resolve(__dirname,'../public/study.js'),'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const today = new Date(2026,9,21,12);
const data = {book:{id:'test-book',title:'Rivstart'},chapters:[{id:1,title:'Kapitel 1'},{id:2,title:'Kapitel 2'}],words:Array.from({length:80},(_,index) => ({id:'word-'+index,chapter:index<40?1:2}))};

function harness(extra = {}) {
  let document;
  function matches(node,selector) {
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    const part = selector.match(/^([a-z][a-z0-9-]*)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/i);
    return !!part && (!part[1] || node.tagName.toLowerCase() === part[1]) && (!part[2] || node.attributes.has(part[2]) && (part[3] === undefined || node.attributes.get(part[2]) === part[3]));
  }
  class Element {
    constructor(tag) {this.tagName=tag.toUpperCase();this.attributes=new Map();this.children=[];this.dataset={};this.listeners=new Map();this.parentNode=null;this.hidden=false;this.value='';this.checked=false;this._markup='';this.textContent='';this.classList={add(){}};}
    get ownerDocument(){return document;}
    get id(){return this.attributes.get('id') || '';}
    set id(value){this.setAttribute('id',value);}
    get name(){return this.attributes.get('name') || '';}
    setAttribute(name,value){this.attributes.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);if(name==='value')this.value=String(value);if(name==='checked')this.checked=true;if(name==='hidden')this.hidden=true;}
    getAttribute(name){return this.attributes.get(name) ?? null;}
    appendChild(node){if(node.parentNode){node.parentNode.children=node.parentNode.children.filter(child=>child!==node);}this.children.push(node);node.parentNode=this;return node;}
    get innerHTML(){return this._markup;}
    set innerHTML(value){this.children.forEach(node=>node.parentNode=null);this.children=[];this._markup=value;const stack=[this];for(const token of value.matchAll(/<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi)){const [text,tag,attrs]=token;if(text.startsWith('</')){if(stack.length>1)stack.pop();continue;}const node=new Element(tag);for(const attr of attrs.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g))node.setAttribute(attr[1],attr[2] || '');stack.at(-1).appendChild(node);if(!['input','br','hr','img','meta','link'].includes(tag))stack.push(node);}for(const select of this.querySelectorAll('select')){select.value=(select.querySelectorAll('option').find(option=>option.attributes.has('selected')) || select.querySelector('option'))?.value || '';}}
    querySelectorAll(selector){const result=[];function walk(node){for(const child of node.children){if(matches(child,selector))result.push(child);walk(child);}}walk(this);return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
    closest(selector){let node=this;while(node){if(matches(node,selector))return node;node=node.parentNode;}return null;}
    contains(other){let node=other;while(node){if(node===this)return true;node=node.parentNode;}return false;}
    focus(){document.activeElement=this;}
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
    removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(listener=>listener!==fn));}
    dispatch(type,event={}){const value={target:this,preventDefault(){this.defaultPrevented=true;},...event};for(const fn of this.listeners.get(type)||[])fn(value);return value;}
  }
  const root=new Element('div');document={activeElement:null,createElement:tag=>new Element(tag)};
  const window={document};
  vm.runInNewContext(reviewSource,{window,TextEncoder,console});
  vm.runInNewContext(studySource,{window,TextEncoder,console});
  vm.runInNewContext(source,{window,console});
  const state=window.OrdrumReview.normalise({selectedChapters:[1],notebook:{},notebookUnits:{},...extra},data),calls=[];
  let session=null;
  const options={getState:()=>state,getData:()=>data,getWordIds:()=>data.words.filter(word=>state.selectedChapters.includes(word.chapter)).map(word=>word.id),getSession:()=>session,now:()=>today,onPreferences(patch){calls.push({type:'preferences',patch});window.OrdrumReview.setPreferences(state,patch,today);},onChange:value=>calls.push(value),onStart:value=>calls.push({type:'start',value}),onResume:id=>calls.push({type:'resume',id}),onPause:id=>calls.push({type:'pause',id}),onEnd:id=>calls.push({type:'end',id}),onNextStage:id=>calls.push({type:'next',id}),onReturnHome:()=>calls.push({type:'home'})};
  const api=window.OrdrumPlan.mount(root,options);
  return {api,root,state,window,calls,document,Element,setSession(value){session=value;api.render();},getSession:()=>session,
    click(selector){const node=root.querySelector(selector);assert.ok(node,selector);root.dispatch('click',{target:node});return node;},
    input(name,value,type='input'){const node=root.querySelector(`[name="${name}"]`);assert.ok(node,name);node.value=String(value);root.dispatch(type,{target:node});return node;},
    save(){return root.dispatch('submit',{target:root.querySelector('#plan-config-form')});}
  };
}
let passed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name);throw error;}}

test('planning has a separate dashboard and one stable practice slot',()=>{
  const app=harness();assert.ok(app.root.querySelector('#plan-dashboard'));assert.ok(app.root.querySelector('#plan-page-title'));assert.equal(app.root.querySelectorAll('#plan-practice-slot').length,1);
  const slot=app.api.getPracticeSlot(),input=slot.appendChild(new app.Element('input'));input.value='pågående';input.focus();app.api.render();app.api.render(true);
  assert.equal(app.api.getPracticeSlot(),slot);assert.equal(slot.children[0],input);assert.equal(input.value,'pågående');assert.equal(app.document.activeElement,input);
});
test('the three methods use different realistic default budgets without mutating an active session',()=>{
  const app=harness(),profiles=app.window.OrdrumPlan.getMethods();assert.deepEqual(plain(profiles.map(row=>row.newLimit+row.reviewLimit)),[120,100,200]);
  app.click('[data-plan-action="toggle-options"]');app.click('[data-plan-method="dictation"]');
  assert.equal(app.api.getDraft().newLimit,20);assert.equal(app.api.getDraft().reviewLimit,80);assert.equal(app.calls.length,0);
  app.save();assert.equal(app.state.reviewPreferences.method,'dictation');assert.equal(app.state.reviewPreferences.targetMinutes,60);
});
test('background refreshes retain partially edited values and keyboard focus',()=>{
  const app=harness();app.click('[data-plan-action="toggle-options"]');const input=app.input('newLimit',17);input.focus();
  app.state.reviewPreferences.newLimit=29;app.api.render();app.api.render(true);
  assert.equal(app.root.querySelector('[name="newLimit"]'),input);assert.equal(input.value,'17');assert.equal(app.document.activeElement,input);
  app.save();assert.equal(app.state.reviewPreferences.newLimit,17);
});
test('saving a method persists its scope and a session starts with actual available words',()=>{
  const app=harness();app.click('[data-plan-action="toggle-options"]');app.input('scope','chapters','change');
  const chapter=app.root.querySelector('[name="planChapter"]');chapter.checked=true;app.root.dispatch('change',{target:chapter});
  app.save();assert.deepEqual(plain(app.state.reviewPreferences.scope),{kind:'chapters',chapterIds:[1],notebookChapterIds:[]});
  app.click('[data-plan-action="start"]');const start=app.calls.find(row=>row.type==='start').value;
  assert.equal(start.scope.kind,'chapters');assert.deepEqual(plain(start.scope.chapterIds),[1]);assert.equal(start.plan.newIds.length,30);assert.equal(start.plan.dueIds.length,0);assert.equal(start.plan.wordIds.length,30);assert.ok(start.plan.estimatedMinutes>0);
});
test('notebook scope validates IDs and never includes words absent from the vocabulary',()=>{
  const app=harness({notebook:{'word-2':{wordId:'word-2',count:1,status:'pending'},missing:{wordId:'missing',count:1}}});
  const scope=app.window.OrdrumPlan.makeScope(data,app.state,'notebook',['all']);
  assert.deepEqual(plain(scope.wordIds),['word-2']);assert.deepEqual(plain(scope.notebookChapterIds),['all']);assert.deepEqual(plain(scope.chapterIds),[]);
});
test('unknown or empty chapter choices do not silently expand to the whole book',()=>{
  const app=harness();assert.deepEqual(plain(app.window.OrdrumPlan.makeScope(data,app.state,'chapters',[]).wordIds),[]);assert.deepEqual(plain(app.window.OrdrumPlan.makeScope(data,app.state,'chapters',['999']).wordIds),[]);
});
test('invalid limits are rejected before settings or sessions are changed',()=>{
  const app=harness();app.click('[data-plan-action="toggle-options"]');app.input('newLimit',150);app.input('reviewLimit',100);app.save();
  assert.equal(app.calls.length,0);assert.match(app.root.querySelector('#plan-feedback').textContent,/1–200/);
  app.input('newLimit',20);app.input('chunkSize',7);app.save();assert.equal(app.calls.length,0);assert.match(app.root.querySelector('#plan-feedback').textContent,/10–25/);
});
test('starting from edited settings saves before dispatching a session',()=>{
  const app=harness();app.click('[data-plan-action="toggle-options"]');app.click('[data-plan-method="quick"]');app.input('newLimit',39);app.click('[data-plan-action="start"]');
  assert.equal(app.calls[0].type,'preferences');assert.equal(app.calls[1].type,'start');assert.equal(app.calls[1].value.preferences.newLimit,'39');assert.equal(app.calls[1].value.plan.newIds.length,39);
});
test('a paused session preserves its form, practice input and data while showing the dashboard',()=>{
  const app=harness(),slot=app.api.getPracticeSlot(),input=slot.appendChild(new app.Element('input'));input.value='svenska';
  const session={id:'plan-1',method:'recall',status:'paused',stageIndex:1,wordIds:['word-1','word-2'],chunkSize:20,stages:[{id:'s1',phase:'preview',label:'新词预览',mode:'preview',wordIds:['word-1']},{id:'s2',phase:'main',label:'主动翻卡',mode:'flashcard',wordIds:['word-1','word-2']}],progress:{contacted:1,total:2,stageDone:0,stageTotal:2,elapsedMs:120000}};
  app.setSession(session);assert.equal(slot.hidden,true);assert.equal(app.root.querySelector('#plan-dashboard').hidden,false);assert.equal(slot.children[0],input);
  app.click('[data-plan-action="resume"]');assert.deepEqual(app.calls.at(-1),{type:'resume',id:'plan-1'});assert.equal(input.value,'svenska');assert.equal(session.stageIndex,1);
});
test('ending a round needs an explicit confirmation and preserves existing records',()=>{
  const app=harness();app.api.getPracticeSlot().appendChild(new app.Element('div'));const session={id:'plan-1',status:'active',method:'recall',wordIds:['word-1'],stageIndex:0,stages:[{id:'s1',label:'新词预览',mode:'preview',wordIds:['word-1']}],results:{s1:{'word-1':{outcome:'seen'}}},progress:{contacted:1,total:1}};
  app.setSession(session);app.click('[data-plan-action="end"]');assert.equal(app.calls.length,0);assert.ok(app.root.querySelector('[data-plan-action="confirm-end"]'));
  app.click('[data-plan-action="cancel-end"]');assert.equal(app.calls.length,0);app.click('[data-plan-action="end"]');app.click('[data-plan-action="confirm-end"]');assert.deepEqual(app.calls.at(-1),{type:'end',id:'plan-1'});assert.equal(session.results.s1['word-1'].outcome,'seen');
});
test('a paused plan can be ended from its dashboard after the practice surface returned home',()=>{
  const app=harness();app.setSession({id:'paused-plan',method:'recall',status:'paused',stageIndex:0,wordIds:['word-1'],stages:[{id:'s1',label:'主动翻卡',mode:'flashcard',wordIds:['word-1']}],progress:{contacted:0,total:1}});
  assert.equal(app.api.getPracticeSlot().children.length,0);assert.equal(app.root.querySelector('#plan-session-bar').hidden,true);
  app.click('[data-plan-action="end"]');const overview=app.root.querySelector('#plan-overview');assert.ok(overview.querySelector('[data-plan-action="confirm-end"]'));assert.equal(app.calls.length,0);
  app.api.render();assert.ok(overview.querySelector('[data-plan-action="confirm-end"]'));app.click('[data-plan-action="cancel-end"]');assert.equal(overview.querySelector('[data-plan-action="confirm-end"]'),null);
  app.click('[data-plan-action="end"]');app.click('[data-plan-action="confirm-end"]');assert.deepEqual(app.calls.at(-1),{type:'end',id:'paused-plan'});
});
test('ended summaries distinguish contacted words from mastery and objective accuracy',()=>{
  const app=harness();app.setSession({id:'p',status:'ended',stageIndex:0,wordIds:['word-1','word-2'],stages:[{id:'s',label:'回忆',mode:'flashcard',wordIds:['word-1','word-2']}],progress:{contacted:1,total:2,known:1,correct:0,wrong:0,elapsedMs:60000}});
  const html=app.root.querySelector('#plan-overview').innerHTML;assert.match(html,/本轮已结束/);assert.match(html,/练习了 1 个词/);assert.match(html,/首次听写正确/);assert.doesNotMatch(html,/掌握率|100%/);
});
test('completed and ended plans show the newly selected method for the next round',()=>{
  for(const status of ['completed','ended']){
    const app=harness();app.setSession({id:'old-recall',method:'recall',status,stageIndex:0,wordIds:['word-1'],stages:[{id:'old-stage',phase:'main',label:'主动翻卡',mode:'flashcard',wordIds:['word-1']}],progress:{contacted:1,total:1}});
    app.click('[data-plan-action="toggle-options"]');app.click('[data-plan-method="quick"]');
    const method=app.window.OrdrumReview.getMethods().find(row=>row.id==='quick'),html=app.root.querySelector('#plan-overview').innerHTML;
    for(const label of method.steps)assert.ok(html.includes(label),status+': '+label);
    assert.equal(app.api.getDraft().newLimit,method.newLimit);assert.equal(app.api.getDraft().reviewLimit,method.reviewLimit);assert.equal(app.api.getDraft().chunkSize,method.chunkSize);
    assert.ok(!html.includes('难词听写'));assert.ok(html.includes('每组 '+method.chunkSize+' 词'));
  }
});
test('an unfinished round keeps its frozen method flow when another method is drafted',()=>{
  const app=harness();app.setSession({id:'active-recall',method:'recall',status:'paused',stageIndex:0,chunkSize:20,wordIds:['word-1'],stages:[{id:'s1',phase:'main',label:'主动翻卡',mode:'flashcard',wordIds:['word-1']},{id:'s2',phase:'reinforce',label:'难词听写',mode:'dictation',wordIds:['word-1']}],progress:{contacted:0,total:1}});
  app.click('[data-plan-action="toggle-options"]');app.click('[data-plan-method="quick"]');
  const html=app.root.querySelector('#plan-overview').innerHTML;assert.ok(html.includes('难词听写'));assert.ok(!html.includes('听写抽查'));assert.ok(html.includes('每组 20 词'));assert.equal(app.api.getDraft().method,'quick');
});
test('unrelated background counters do not recreate a focused stage action',()=>{
  const app=harness();app.api.getPracticeSlot().appendChild(new app.Element('div'));app.setSession({id:'p',status:'active',method:'recall',wordIds:['word-1'],stageIndex:0,stages:[{id:'s',label:'回忆',mode:'flashcard',wordIds:['word-1']}],canAdvance:false,progress:{stageDone:0,stageTotal:1}});
  const button=app.root.querySelector('[data-plan-action="end"]');button.focus();app.api.render();assert.equal(app.root.querySelector('[data-plan-action="end"]'),button);assert.equal(app.document.activeElement,button);
});
test('plan visibility and teardown never delete the mounted practice surface',()=>{
  const app=harness(),slot=app.api.getPracticeSlot(),input=slot.appendChild(new app.Element('input'));app.api.hide();assert.equal(app.root.hidden,true);app.api.show();assert.equal(app.root.hidden,false);assert.equal(slot.children[0],input);app.api.destroy();assert.equal(slot.children[0],input);app.root.dispatch('click',{target:app.root.querySelector('[data-plan-action="home"]')});assert.equal(app.calls.length,0);
});
console.log(`\n${passed} plan page tests passed.`);
