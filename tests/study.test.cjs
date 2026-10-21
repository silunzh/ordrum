const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const sourcePath = path.resolve(__dirname, '../public/study.js');
const sandbox = {window:{},console,document:{addEventListener(){}},setTimeout(){},clearTimeout(){}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(sourcePath,'utf8'),sandbox,{filename:sourcePath});
const core = sandbox.window.OrdrumStudy;
assert.ok(core, 'study core is exposed before the app loads');
const plain = value => JSON.parse(JSON.stringify(value));
const clone = plain;
const book = {id:'rivstart-a1-a2',title:'Rivstart A1/A2 Ordkort'};
const data = {
  book,
  chapters:[{id:1,title:'Kapitel 1'},{id:2,title:'Kapitel 2'}],
  words:[
    {id:'arbetar',chapter:1,swedish:'arbetar'},
    {id:'barn',chapter:1,swedish:'ett barn'},
    {id:'here',chapter:2,swedish:'here'},
    {id:'beer',chapter:2,swedish:'en öl'},
  ],
};
const ids = new Set(data.words.map(word => word.id));
function fresh(extra={}) { return core.normalise({marks:{},overrides:{},selectedChapters:[1],...extra},data); }
function task(state, chapters=[1], name='第一课') {
  const value = core.createTask(book,chapters,data.words.filter(word=>chapters.includes(word.chapter)),name);
  state.tasks.push(value);state.activeTaskId=value.id;return value;
}
let passed=0, failed=0;
function test(name,fn) {
  try {fn();passed++;console.log(`PASS ${name}`);}
  catch(error) {failed++;console.error(`FAIL ${name}\n${error.stack}`);}
}

test('legacy progress migrates review marks without inventing failures',()=>{
  const state=fresh({marks:{arbetar:{status:'known'},barn:{status:'review'},missing:{status:'review'}}});
  assert.equal(state.marks.arbetar.status,'known');
  assert.equal(state.notebook.barn.status,'pending');
  assert.equal(state.notebook.barn.count,0);
  assert.equal(state.notebook.missing,undefined);
});
test('an intentionally deleted notebook entry stays deleted after reload',()=>{
  const state=fresh({marks:{barn:{status:'review'}},notebook:{}});
  assert.equal(state.notebook.barn,undefined);
  assert.equal(core.normalise(clone(state),data).notebook.barn,undefined);
});
test('legacy migration does not erase user edits or known progress',()=>{
  const edit={english:'my translation',forms:[{label:'过去式',value:'arbetade'}]};
  const state=fresh({marks:{arbetar:'known'},overrides:{arbetar:edit}});
  assert.equal(state.marks.arbetar.status,'known');
  assert.deepEqual(plain(state.overrides.arbetar),edit);
});
test('new tasks preserve their chapter scope and independent identity',()=>{
  const state=fresh();const first=task(state,[1],'第一课');const second=task(state,[1],'再学第一课');
  assert.notEqual(first.id,second.id);
  assert.equal(first.bookId,book.id);
  assert.deepEqual(plain(first.chapterIds),[1]);
  assert.deepEqual(plain(first.wordIds),['arbetar','barn']);
  assert.equal(first.name,'第一课');
  assert.equal(core.getTask(state,first.id),first);
});
test('new task progress starts at zero even when global marks are known',()=>{
  const state=fresh({marks:{arbetar:{status:'known'}}});const first=task(state);
  assert.deepEqual(plain(core.taskProgress(first)),{studied:0,known:0,total:2,mistakes:0,percent:0});
});
test('wrong answers accumulate attempts in one notebook record',()=>{
  const state=fresh();const first=task(state);
  core.recordResult(state,'arbetar','wrong','arbet');core.recordResult(state,'arbetar','wrong','arbeta');
  assert.equal(first.marks.arbetar.status,'review');
  assert.equal(state.notebook.arbetar.count,2);
  assert.equal(state.notebook.arbetar.lastAnswer,'arbeta');
  assert.equal(state.notebook.arbetar.status,'pending');
  assert.deepEqual(plain(state.notebook.arbetar.taskIds),[first.id]);
  assert.equal(Object.keys(state.notebook).length,1);
  assert.equal(core.taskProgress(first).mistakes,1);
});
test('revealing an answer records review without inventing a wrong attempt',()=>{
  const state=fresh();const first=task(state);
  core.recordResult(state,'barn','revealed','b');
  assert.equal(state.notebook.barn.count,0);
  assert.equal(state.notebook.barn.status,'pending');
  assert.equal(first.marks.barn.status,'review');
});
test('correcting a word masters it while preserving its error history',()=>{
  const state=fresh();const first=task(state);
  core.recordResult(state,'arbetar','wrong','arbet');
  const lastWrong=state.notebook.arbetar.lastWrongAt;
  core.recordResult(state,'arbetar','correct','arbetar');
  assert.equal(state.notebook.arbetar.status,'mastered');
  assert.equal(state.notebook.arbetar.count,1);
  assert.equal(state.notebook.arbetar.lastWrongAt,lastWrong);
  assert.equal(first.marks.arbetar.status,'known');
  assert.deepEqual(plain(core.taskProgress(first)),{studied:1,known:1,total:2,mistakes:0,percent:50});
});
test('unmarking progress preserves the permanent error notebook',()=>{
  const state=fresh();const first=task(state);
  core.recordResult(state,'barn','wrong','ban');core.recordResult(state,'barn','unmarked');
  assert.equal(first.marks.barn,undefined);
  assert.equal(state.notebook.barn.count,1);
  assert.equal(state.notebook.barn.status,'pending');
});
test('tasks A and B keep independent progress for the same word',()=>{
  const state=fresh();const first=task(state,[1],'任务 A');
  core.recordResult(state,'arbetar','known');
  const second=task(state,[1],'任务 B');
  assert.equal(core.taskProgress(second).known,0);
  core.recordResult(state,'arbetar','wrong','arbet');
  assert.equal(first.marks.arbetar.status,'known');
  assert.equal(second.marks.arbetar.status,'review');
  state.activeTaskId=first.id;
  assert.equal(core.taskProgress(core.getTask(state)).known,1);
});
test('notebook links one word to every task where it was missed',()=>{
  const state=fresh();const first=task(state,[1],'任务 A');core.recordResult(state,'barn','wrong','bar');
  const second=task(state,[1],'任务 B');core.recordResult(state,'barn','wrong','ban');
  assert.equal(state.notebook.barn.count,2);
  assert.deepEqual(new Set(state.notebook.barn.taskIds),new Set([first.id,second.id]));
});
test('free study errors enter the notebook without changing an unrelated task',()=>{
  const state=fresh();const first=task(state);state.activeTaskId=null;
  core.recordResult(state,'here','wrong','har');
  assert.equal(state.notebook['here'].count,1);
  assert.equal(Object.keys(first.marks).length,0);
});
test('error history and pending status survive a browser storage round trip',()=>{
  const state=fresh();task(state);core.recordResult(state,'barn','wrong','ban');
  state.selectedChapters=[2];
  const restored=core.normalise(clone(state),data);
  assert.equal(restored.notebook.barn.count,1);
  assert.equal(restored.notebook.barn.lastAnswer,'ban');
  assert.equal(restored.notebook.barn.status,'pending');
  assert.equal(core.getTask(restored).errors.barn.count,1);
});
test('mastered notebook status survives reload',()=>{
  const state=fresh();task(state);core.recordResult(state,'barn','wrong','ban');core.recordResult(state,'barn','known');
  assert.equal(core.normalise(clone(state),data).notebook.barn.status,'mastered');
});
test('sanitised sessions preserve a resumable deck, position and draft',()=>{
  const session={mode:'dictation',chapterIds:[1,2],deck:['barn','arbetar','here'],flashIndex:1,dictationIndex:2,flipped:true,dictationResult:{status:'wrong',input:'har'},dictationAnswers:{barn:'correct','here':'wrong'},mistakes:['here'],retryMode:false,draft:'har',page:2,search:'word'};
  const restored=core.sanitiseSession(session,[...ids]);
  for (const key of ['mode','deck','flashIndex','dictationIndex','flipped','dictationResult','dictationAnswers','mistakes','retryMode','draft','page','search']) assert.deepEqual(plain(restored[key]),session[key],key);
});
test('invalid saved card IDs and out-of-range positions cannot break resume',()=>{
  const session={mode:'dictation',deck:['missing','barn','barn','arbetar'],flashIndex:999,dictationIndex:-4,dictationAnswers:{missing:'wrong',barn:'correct'},mistakes:['missing','barn']};
  const safe=core.sanitiseSession(session,[...ids]);
  assert.deepEqual(plain(safe.deck),['barn','arbetar']);
  assert.ok(safe.flashIndex>=0&&safe.flashIndex<safe.deck.length);
  assert.ok(safe.dictationIndex>=0&&safe.dictationIndex<safe.deck.length);
  assert.equal(safe.dictationAnswers.missing,undefined);
  assert.deepEqual(plain(safe.mistakes),['barn']);
});
test('task and notebook normalisation drops deleted book card IDs',()=>{
  const state=fresh();const first=task(state);first.wordIds.push('missing');first.marks.missing={status:'known'};
  state.notebook.missing={wordId:'missing',count:4,status:'pending',taskIds:[first.id]};
  const safe=core.normalise(clone(state),data);
  assert.deepEqual(plain(safe.tasks[0].wordIds),['arbetar','barn']);
  assert.equal(safe.tasks[0].marks.missing,undefined);
  assert.equal(safe.notebook.missing,undefined);
});
test('merging backup state retains local tasks and adds imported tasks',()=>{
  const local=fresh();const a=task(local,[1],'本机任务');
  const incoming=fresh();const b=task(incoming,[2],'备份任务');
  const merged=core.merge(local,incoming,data);
  assert.ok(core.getTask(merged,a.id));assert.ok(core.getTask(merged,b.id));
  assert.equal(merged.tasks.length,2);
});
test('merging an existing task adopts its newer progress and checkpoint',()=>{
  const local=fresh();const first=task(local);first.updatedAt='2026-10-20T09:00:00Z';
  const incoming=clone(local);incoming.tasks[0].updatedAt='2026-10-20T11:00:00Z';incoming.tasks[0].marks.barn={status:'known'};
  incoming.tasks[0].session={mode:'flashcard',deck:['barn','arbetar'],flashIndex:1,dictationIndex:0,flipped:true};
  const merged=core.merge(local,incoming,data);
  assert.equal(core.getTask(merged).marks.barn.status,'known');
  assert.equal(core.getTask(merged).session.flipped,true);
});
test('older backups cannot erase more recent local task progress',()=>{
  const local=fresh();const first=task(local);first.updatedAt='2026-10-20T11:00:00Z';first.marks.barn={status:'known'};
  const incoming=clone(local);incoming.tasks[0].updatedAt='2026-10-20T09:00:00Z';incoming.tasks[0].marks={};
  assert.equal(core.getTask(core.merge(local,incoming,data)).marks.barn.status,'known');
});
test('notebook merge retains maximum attempts and the newest mastery transition',()=>{
  const local=fresh({tasks:[{id:'a',wordIds:[],chapterIds:[1]}],notebook:{barn:{wordId:'barn',count:5,status:'pending',lastAnswer:'ban',lastWrongAt:'2026-10-20T09:00:00Z',updatedAt:'2026-10-20T09:00:00Z',taskIds:['a']}}});
  const incoming=fresh({tasks:[{id:'b',wordIds:[],chapterIds:[1]}],notebook:{barn:{wordId:'barn',count:2,status:'mastered',lastAnswer:'bar',lastWrongAt:'2026-10-19T09:00:00Z',updatedAt:'2026-10-20T11:00:00Z',taskIds:['b']}}});
  const record=core.merge(local,incoming,data).notebook.barn;
  assert.equal(record.count,5);assert.equal(record.status,'mastered');
  assert.equal(Date.parse(record.lastWrongAt),Date.parse('2026-10-20T09:00:00Z'));
  assert.deepEqual(new Set(record.taskIds),new Set(['a','b']));
});
test('v1 legacy backups can still merge into task-aware progress',()=>{
  const local=fresh();const first=task(local);
  const merged=core.merge(local,{marks:{barn:{status:'review'}},overrides:{arbetar:{english:'custom'}},selectedChapters:[2]},data);
  assert.ok(core.getTask(merged,first.id));
  assert.equal(merged.notebook.barn.status,'pending');
  assert.equal(merged.notebook.barn.count,0);
});
test('malformed imported tasks, notebook entries and sessions are safely filtered',()=>{
  const state=core.normalise({tasks:[null,3,{id:'broken',wordIds:['missing']}],notebook:{missing:{count:9},barn:null},activeTaskId:'missing',studySession:{deck:['missing']}},data);
  assert.equal(state.activeTaskId,null);
  assert.equal(state.notebook.missing,undefined);
  assert.equal(state.notebook.barn,undefined);
});


test('concurrent copies of one task merge word progress without discarding either browser',()=>{
  const local=fresh();const first=task(local);first.updatedAt='2026-10-20T10:00:00Z';
  first.marks.barn={status:'known',updated:'2026-10-20T10:00:00Z'};
  const incoming=clone(local);incoming.tasks[0].updatedAt='2026-10-20T11:00:00Z';
  incoming.tasks[0].marks={arbetar:{status:'known',updated:'2026-10-20T11:00:00Z'},barn:{status:'review',updated:'2026-10-20T09:00:00Z'}};
  const merged=core.getTask(core.merge(local,incoming,data));
  assert.equal(merged.marks.barn.status,'known');
  assert.equal(merged.marks.arbetar.status,'known');
  assert.equal(core.taskProgress(merged).known,2);
});

const manyData = {...data, words:Array.from({length:65},(_,index)=>({id:`word-${String(index + 1).padStart(2,'0')}`,chapter:1,swedish:`ord ${index + 1}`}))};
function mistakeState(count=61) {
  return core.normalise({marks:{},notebook:Object.fromEntries(manyData.words.slice(0,count).map((word,index)=>[word.id,{wordId:word.id,count:1,status:index%2?'mastered':'pending',lastWrongAt:'2026-10-21T09:00:00.000Z',taskIds:[]}]))},manyData);
}
test('today uses local midnight and excludes future and undated errors without deleting them',()=>{
  const current=new Date(2026,9,25,12,0,0);
  const midnight=new Date(2026,9,25,0,0,0);
  const state=fresh({notebook:{
    arbetar:{count:1,status:'mastered',lastWrongAt:midnight.toISOString()},
    barn:{count:1,lastWrongAt:new Date(midnight.getTime()-1).toISOString()},
    here:{count:1,lastWrongAt:new Date(current.getTime()+1).toISOString()},
    beer:{count:0,lastWrongAt:'invalid'},
  }});
  assert.deepEqual(plain(core.notebookCollectionIds(state,'today',current)),['arbetar']);
  assert.equal(core.notebookCollectionIds(state,'all',current).length,4);
  assert.equal(state.notebook.arbetar.status,'mastered');
  assert.equal(state.notebook.beer.lastWrongAt,null);
});
test('the local week starts on Monday including a daylight-saving transition',()=>{
  const sunday=new Date(2026,9,25,12,0,0), monday=new Date(2026,9,19,0,0,0);
  const state=fresh({notebook:{
    arbetar:{count:1,lastWrongAt:monday.toISOString()},
    barn:{count:1,lastWrongAt:new Date(monday.getTime()-1).toISOString()},
    here:{count:1,lastWrongAt:sunday.toISOString()},
    beer:{count:0,lastWrongAt:null},
  }});
  assert.deepEqual(plain(core.notebookCollectionIds(state,'week',sunday)),['arbetar','here']);
  assert.deepEqual(plain(core.notebookCollectionIds(state,'week',new Date(2026,9,26,0,0,0))),[]);
  assert.equal(Object.keys(state.notebook).length,4);
});
test('61 errors become stable 30, 30 and 1 word units without changing history or mastery',()=>{
  const state=mistakeState(), before=clone(state.notebook);
  const result=core.organiseNotebook(state,'all',new Date('2026-10-21T12:00:00Z'));
  assert.deepEqual(plain(result),{added:61,created:3,total:3});
  const units=Object.values(state.notebookUnits).sort((a,b)=>a.number-b.number);
  assert.deepEqual(units.map(unit=>unit.wordIds.length),[30,30,1]);
  assert.deepEqual(units.map(unit=>unit.name),['错词单元 1','错词单元 2','错词单元 3']);
  assert.equal(new Set(units.flatMap(unit=>unit.wordIds)).size,61);
  assert.deepEqual(plain(state.notebook),before);
});
test('organising an already grouped notebook is idempotent across reload',()=>{
  const state=mistakeState();core.organiseNotebook(state,'all');
  const before=clone(state.notebookUnits), restored=core.normalise(clone(state),manyData);
  assert.deepEqual(plain(core.organiseNotebook(restored,'all')),{added:0,created:0,total:3});
  assert.deepEqual(plain(restored.notebookUnits),before);
});
test('new errors append to the partial unit while existing membership and names stay fixed',()=>{
  const state=mistakeState();core.organiseNotebook(state,'all');
  const before=clone(state.notebookUnits), last=Object.values(state.notebookUnits).find(unit=>unit.number===3);
  core.recordResult(state,'word-62','wrong','new answer');
  assert.equal(core.organiseNotebook(state,'all').added,1);
  for(const [id,unit] of Object.entries(before)) {
    assert.equal(state.notebookUnits[id].name,unit.name);
    assert.deepEqual(plain(state.notebookUnits[id].wordIds.slice(0,unit.wordIds.length)),unit.wordIds);
  }
  assert.deepEqual(plain(last.wordIds),['word-61']);
  assert.deepEqual(plain(state.notebookUnits[last.id].wordIds),['word-61','word-62']);
  assert.equal(Object.keys(state.notebook).length,62);
});
test('two devices organising the same errors derive the same stable unit identities',()=>{
  const first=mistakeState(), second=mistakeState();
  core.organiseNotebook(first,'all',new Date('2026-10-21T11:00:00Z'));
  core.organiseNotebook(second,'all',new Date('2026-10-21T12:00:00Z'));
  assert.deepEqual(Object.keys(first.notebookUnits),Object.keys(second.notebookUnits));
  const merged=core.merge(first,second,manyData);
  assert.equal(Object.keys(merged.notebookUnits).length,3);
  assert.equal(new Set(Object.values(merged.notebookUnits).flatMap(unit=>unit.wordIds)).size,61);
});
test('organising dated subsets leaves older and undated errors available for later grouping',()=>{
  const current=new Date(2026,9,21,12,0,0), today=new Date(2026,9,21,9,0,0), monday=new Date(2026,9,19,9,0,0);
  const state=fresh({notebook:{
    arbetar:{count:1,status:'mastered',lastWrongAt:today.toISOString()},
    barn:{count:1,lastWrongAt:monday.toISOString()},
    here:{count:1,lastWrongAt:new Date(2026,9,18,9,0,0).toISOString()},
    beer:{count:0,lastWrongAt:null},
  }});
  assert.equal(core.organiseNotebook(state,'today',current).added,1);
  assert.equal(core.organiseNotebook(state,'week',current).added,1);
  assert.equal(core.organiseNotebook(state,'all',current).added,2);
  assert.equal(Object.keys(state.notebook).length,4);
  assert.equal(Object.values(state.notebookUnits).flatMap(unit=>unit.wordIds).length,4);
});
test('imported units are bounded, deduplicated and keep overflow errors unassigned rather than deleting them',()=>{
  const state=mistakeState();
  state.notebookUnits={
    later:{number:2,createdAt:'2026-10-21T10:00:00Z',wordIds:['word-01','word-31','missing']},
    earlier:{number:1,createdAt:'2026-10-21T10:00:00Z',wordIds:[...manyData.words.map(word=>word.id),'word-01']},
    invalid:null, empty:{number:3,wordIds:['missing']},
  };
  core.normalise(state,manyData);
  assert.deepEqual(plain(state.notebookUnits.earlier.wordIds),manyData.words.slice(0,30).map(word=>word.id));
  assert.deepEqual(plain(state.notebookUnits.later.wordIds),['word-31']);
  assert.equal(state.notebookUnits.empty,undefined);
  assert.equal(Object.keys(state.notebook).length,61);
  assert.equal(core.organiseNotebook(state,'all').added,30);
  assert.equal(new Set(Object.values(state.notebookUnits).flatMap(unit=>unit.wordIds)).size,61);
});
test('backup merge preserves both device unit memberships and all original wrong records',()=>{
  const local=mistakeState(2);core.organiseNotebook(local,'all');
  const incoming=clone(local), unitId=Object.keys(local.notebookUnits)[0];
  core.recordResult(local,'word-03','wrong','third');core.organiseNotebook(local,'all');
  core.recordResult(incoming,'word-04','wrong','fourth');core.organiseNotebook(incoming,'all');
  const merged=core.merge(local,incoming,manyData);
  assert.deepEqual(new Set(merged.notebookUnits[unitId].wordIds),new Set(['word-01','word-02','word-03','word-04']));
  assert.equal(Object.keys(merged.notebook).length,4);
});
test('deleting a notebook record removes only that word from its unit on reload',()=>{
  const state=mistakeState(2);core.organiseNotebook(state,'all');
  const unitId=Object.keys(state.notebookUnits)[0];delete state.notebook['word-01'];
  const restored=core.normalise(clone(state),manyData);
  assert.deepEqual(plain(restored.notebookUnits[unitId].wordIds),['word-02']);
  assert.equal(restored.notebook['word-01'],undefined);
  assert.equal(core.notebookCollectionIds(restored,unitId).length,1);
});
test('concurrent unit number collisions get stable new numbers without renumbering other units or custom names',()=>{
  const state=mistakeState(5);
  state.notebookUnits={
    original:{id:'original',number:1,name:'错词单元 1',wordIds:['word-01'],createdAt:'2026-10-21T09:00:00Z'},
    concurrent:{id:'concurrent',number:1,name:'错词单元 1',wordIds:['word-02'],createdAt:'2026-10-21T10:00:00Z'},
    custom:{id:'custom',number:1,name:'我的听写难词',wordIds:['word-03'],createdAt:'2026-10-21T11:00:00Z'},
    unaffected:{id:'unaffected',number:2,name:'错词单元 2',wordIds:['word-04','word-05'],createdAt:'2026-10-21T12:00:00Z'},
  };
  const members=Object.fromEntries(Object.entries(state.notebookUnits).map(([id,unit])=>[id,unit.wordIds]));
  core.normalise(state,manyData);
  assert.equal(state.notebookUnits.original.number,1);
  assert.equal(state.notebookUnits.unaffected.number,2);
  assert.equal(state.notebookUnits.unaffected.name,'错词单元 2');
  assert.equal(state.notebookUnits.concurrent.number,3);
  assert.equal(state.notebookUnits.concurrent.name,'错词单元 3');
  assert.equal(state.notebookUnits.custom.number,4);
  assert.equal(state.notebookUnits.custom.name,'我的听写难词');
  assert.deepEqual(plain(Object.fromEntries(Object.entries(state.notebookUnits).map(([id,unit])=>[id,unit.wordIds]))),members);
  const stable=clone(state.notebookUnits);
  const reloaded=core.normalise(clone(state),manyData);
  assert.deepEqual(plain(reloaded.notebookUnits),stable);
  assert.equal(Object.keys(reloaded.notebook).length,5);
});

console.log(`\n${passed} study checks passed${failed?`, ${failed} failed`:''}.`);
if(failed)process.exitCode=1;
