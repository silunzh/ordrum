const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sandbox = {window: {}, console, TextEncoder, document: {addEventListener() {}}, setTimeout() {}, clearTimeout() {}};
vm.createContext(sandbox);
for (const file of ['study.js', 'review.js', 'plan-core.js']) vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../public', file), 'utf8'), sandbox, {filename: file});
const core = sandbox.window.OrdrumPlanCore, review = sandbox.window.OrdrumReview;
const plain = value => JSON.parse(JSON.stringify(value));
const data = {words: ['a', 'b', 'c'].map(id => ({id}))};
const at = hour => `2026-10-21T${String(hour).padStart(2, '0')}:00:00.000Z`;
const result = (outcome, hour = 8) => ({outcome, at: at(hour)});
let passed = 0;
function test(name, run) {try {run();passed++;console.log('PASS ' + name);} catch (error) {console.error('FAIL ' + name);throw error;}}
function record(extra = {}) {
  return {id: 'plan-one', day: '2026-10-21', method: 'recall', status: 'active', stageIndex: 0, createdAt: at(7), updatedAt: at(8), elapsedMs: 10000,
    wordIds: ['a', 'b', 'c'], newIds: ['a'], dueIds: ['b', 'c'], targetMinutes: 60, chunkSize: 20, preferences: {reviewLimit: 90, newLimit: 30},
    scope: {kind: 'chapters', chapterIds: [1], wordIds: ['a', 'b', 'c']}, stages: [
      {id: 'preview-1', phase: 'preview', label: '新词预览', mode: 'preview', selector: 'all', wordIds: ['a'], maxWords: 1},
      {id: 'main-1', phase: 'main', label: '主动回忆', mode: 'flashcard', selector: 'all', wordIds: ['a', 'b', 'c'], maxWords: 3},
      {id: 'test-1', phase: 'test', label: '听写抽查', mode: 'dictation', selector: 'sample', wordIds: ['a', 'b', 'c'], maxWords: 3}
    ], results: {}, completedStages: {}, resolvedStages: {}, stageSessions: {}, ...extra};
}
function state(row, extra = {}) {return core.normalise({planSessions: {[row.id]: row}, activePlanId: row.id, ...extra}, data);}

test('legacy state gets empty plans and no invented active session or events', () => {
  const current = {marks: {a: {status: 'known'}}};core.normalise(current, data);
  assert.deepEqual(plain(current.planSessions), {});assert.equal(current.activePlanId, null);assert.equal(current.reviewEvents, undefined);
});
test('restored session preserves fixed metadata scope preferences and timestamps', () => {
  const input = record(), output = state(input).planSessions[input.id];
  assert.deepEqual(plain(output.wordIds), ['a', 'b', 'c']);assert.deepEqual(plain(output.scope), {kind: 'chapters', chapterIds: [1], notebookChapterIds: [], wordIds: ['a', 'b', 'c']});
  assert.equal(output.method, 'recall');assert.equal(output.createdAt, at(7));assert.equal(output.updatedAt, at(8));assert.equal(output.targetMinutes, 60);assert.equal(output.preferences.newLimit, 30);assert.equal(output.stageIndex, 0);
});
test('invalid identities unknown cards invalid modes and credential-shaped metadata are discarded', () => {
  const input = record({credential: 'never-keep', wordIds: ['a', 'missing', 'a', '__proto__'], scope: {kind: 'unsafe', chapterIds: [-2, '3'], token: 'never-keep'},
    results: {'main-1': {a: result('correct'), missing: result('known')}}, stages: [{id: 'invalid-mode', mode: 'unsafe', wordIds: ['a']}, {id: 'main-1', mode: 'flashcard', wordIds: ['a', 'missing']} ]});
  const current = state(input), output = current.planSessions[input.id];
  assert.deepEqual(plain(output.wordIds), ['a']);assert.equal(output.stages.length, 1);assert.equal(output.results['main-1'].a, undefined);assert.equal(JSON.stringify(output).includes('never-keep'), false);
  core.normalise({planSessions: {wrong: record()}, activePlanId: 'wrong'}, data);
  assert.equal(core.normalise({planSessions: {wrong: record()}, activePlanId: 'wrong'}, data).activePlanId, null);
});
test('invalid active pointer is cleared without deleting valid saved plans', () => {
  const current = state(record(), {activePlanId: 'unknown'});assert.equal(current.activePlanId, null);assert.equal(Object.keys(current.planSessions).length, 1);
});
test('completion derives from a consecutive completed prefix rather than a forged stage index', () => {
  let current = state(record({status: 'completed', stageIndex: 999, completedStages: {'main-1': true}}));
  assert.equal(current.planSessions['plan-one'].stageIndex, 0);assert.equal(current.planSessions['plan-one'].status, 'active');
  current = state(record({stageIndex: 0, completedStages: {'preview-1': true, 'main-1': true, 'test-1': true}}));
  assert.equal(current.planSessions['plan-one'].stageIndex, 3);assert.equal(current.planSessions['plan-one'].status, 'completed');
});
test('decoration also derives the next group after in-memory completion without mutating the stored pointer', () => {
  const input = record({stageIndex: 0, completedStages: {'preview-1': true}}), output = core.decorate(input);
  assert.equal(output.stageIndex, 1);assert.deepEqual(plain(output.currentWordIds), ['a', 'b', 'c']);assert.equal(input.stageIndex, 0);
});
test('paused and explicitly ended partial sessions stay partial and retain their progress', () => {
  for (const status of ['paused', 'ended']) {
    const current = state(record({status, completedStages: {'preview-1': true}})).planSessions['plan-one'];assert.equal(current.status, status);assert.equal(current.stageIndex, 1);
  }
});
test('valid plans are not evicted by count or age', () => {
  const plans = Object.fromEntries(Array.from({length: 1001}, (_, index) => {const id = `plan-${index}`;return [id, record({id, createdAt: '2000-01-01T00:00:00Z'})];}));
  const current = core.normalise({planSessions: plans, activePlanId: 'plan-0'}, data);assert.equal(Object.keys(current.planSessions).length, 1001);assert.equal(current.activePlanId, 'plan-0');
});
test('up to four hundred frozen candidates survive while invalid resolved members cannot enter a stage', () => {
  const largeData = {words: Array.from({length: 400}, (_, index) => ({id: `word-${index}`}))}, all = largeData.words.map(word => word.id);
  const input = record({wordIds: all, newIds: all, dueIds: [], stages: [{id: 'dynamic-1', mode: 'dictation', selector: 'difficult', wordIds: all, maxWords: 20}], resolvedStages: {'dynamic-1': ['word-399', 'missing']}});
  const current = core.normalise({planSessions: {[input.id]: input}}, largeData).planSessions[input.id];assert.equal(current.wordIds.length, 400);assert.equal(current.stages[0].wordIds.length, 400);assert.deepEqual(plain(current.resolvedStages['dynamic-1']), ['word-399']);
});
test('concurrent frozen selections above the single-device group size retain every member and first answer', () => {
  const largeData = {words: Array.from({length: 40}, (_, index) => ({id: `word-${index}`}))}, all = largeData.words.map(word => word.id), frozen = all.slice(0, 30);
  const input = record({wordIds: all, stages: [{id: 'merged-1', mode: 'dictation', selector: 'difficult', wordIds: all, maxWords: 20}],
    resolvedStages: {'merged-1': frozen}, results: {'merged-1': Object.fromEntries(frozen.map(id => [id, result('wrong')]))},
    stageSessions: {'merged-1': {deck: frozen, mode: 'dictation', dictationAnswers: Object.fromEntries(frozen.map(id => [id, 'wrong']))}}});
  const output = core.normalise({planSessions: {[input.id]: input}}, largeData).planSessions[input.id];
  assert.equal(output.resolvedStages['merged-1'].length, 30);assert.equal(Object.keys(output.results['merged-1']).length, 30);assert.equal(output.stageSessions['merged-1'].deck.length, 30);assert.equal(core.decorate(output).progress.stageDone, 30);
});
test('study checkpoints reuse the existing sanitizer and only contain the actual stage cards', () => {
  const input = record({resolvedStages: {'test-1': ['b']}, stageSessions: {'test-1': {deck: ['b', 'a', 'missing'], mode: 'dictation', draft: 'åäö', dictationIndex: 99,
    dictationAnswers: {b: 'wrong', a: 'correct'}, reviewSessionId: 'first-round', token: 'never-keep'}}});
  const checkpoint = state(input).planSessions[input.id].stageSessions['test-1'];assert.deepEqual(plain(checkpoint.deck), ['b']);assert.equal(checkpoint.dictationIndex, 0);assert.equal(checkpoint.draft, 'åäö');assert.equal(checkpoint.reviewSessionId, 'first-round');assert.deepEqual(plain(checkpoint.dictationAnswers), {b: 'wrong'});assert.equal(checkpoint.token, undefined);
});
test('preview seen counts contacted without becoming self known or an objective answer', () => {
  const input = state(record({results: {'preview-1': {a: result('seen')}}})).planSessions['plan-one'], output = core.decorate(input);
  assert.equal(output.progress.contacted, 1);assert.equal(output.progress.answered, 0);assert.equal(output.progress.known, 0);assert.equal(output.progress.correct, 0);assert.equal(output.canAdvance, true);assert.equal(input.progress, undefined);
});
test('a stage advances only after all actual cards have results and skip is recorded separately', () => {
  const input = state(record({completedStages: {'preview-1': true}, results: {'main-1': {a: result('known'), b: result('again')}}})).planSessions['plan-one'];
  let output = core.decorate(input);assert.equal(output.progress.stageDone, 2);assert.equal(output.progress.stageTotal, 3);assert.equal(output.canAdvance, false);assert.equal(output.progress.contacted, 2);assert.equal(output.progress.known, 1);
  input.results['main-1'].c = result('skip');output = core.decorate(input);assert.equal(output.canAdvance, true);assert.equal(output.progress.skipped, 1);assert.equal(output.progress.contacted, 2);assert.equal(output.progress.answered, 2);
});
test('unresolved dynamic stages cannot advance while an explicitly resolved empty group can', () => {
  const input = state(record({completedStages: {'preview-1': true, 'main-1': true}})).planSessions['plan-one'];
  assert.equal(core.decorate(input).canAdvance, false);assert.deepEqual(plain(core.decorate(input).currentWordIds), []);
  input.resolvedStages['test-1'] = [];assert.equal(core.decorate(input).canAdvance, true);
});
test('first objective wrong stays wrong after a later correct attempt and assisted retry never raises correctness', () => {
  const input = record({stages: [
    {id: 'first-1', mode: 'dictation', selector: 'all', wordIds: ['a', 'b', 'c']},
    {id: 'retry-1', phase: 'retry', mode: 'dictation', selector: 'all', wordIds: ['a', 'b', 'c'], assisted: true},
    {id: 'later-1', phase: 'test', mode: 'dictation', selector: 'all', wordIds: ['a', 'b', 'c']}
  ], results: {'first-1': {a: result('wrong', 8), c: result('revealed', 8)}, 'retry-1': {a: result('correct', 9), b: result('correct', 9)}, 'later-1': {a: result('correct', 10), c: result('correct', 10)}}});
  const output = core.decorate(state(input).planSessions[input.id]);assert.equal(output.progress.wrong, 1);assert.equal(output.progress.correct, 0);assert.equal(output.progress.revealed, 1);assert.equal(output.progress.answered, 3);
});
test('objective first outcome follows actual time rather than stage array order', () => {
  const input = record({stages: [{id: 'ordered-1', mode: 'dictation', wordIds: ['a']}, {id: 'ordered-2', mode: 'dictation', wordIds: ['a']}],
    results: {'ordered-1': {a: result('correct', 10)}, 'ordered-2': {a: result('wrong', 8)}}});
  const output = core.decorate(state(input).planSessions[input.id]);assert.equal(output.progress.wrong, 1);assert.equal(output.progress.correct, 0);
});
test('decoration preserves elapsed time stage totals and source without mutation', () => {
  const input = state(record({elapsedMs: 123456, completedStages: {'preview-1': true}, results: {'main-1': {a: result('known')}}})).planSessions['plan-one'], before = plain(input), output = core.decorate(input);
  assert.equal(output.progress.elapsedMs, 123456);assert.equal(output.progress.stagesDone, 1);assert.equal(output.progress.stagesTotal, 3);assert.equal(output.progress.total, 3);assert.deepEqual(plain(input), before);
});
test('normalization round trips an engine-generated session without changing frozen stages', () => {
  const preferences = review.cleanPreferences({method: 'quick', reviewLimit: 2, newLimit: 1}), session = review.buildSession({day: '2026-10-21', wordIds: ['a', 'b', 'c'], newIds: ['a'], dueIds: ['b', 'c'], preferences}, {id: 'built-session', now: at(8)});
  const output = state(session).planSessions[session.id];assert.deepEqual(plain(output.stages), plain(session.stages));assert.deepEqual(plain(output.preferences), plain(session.preferences));assert.equal(output.method, 'quick');
});
console.log(`${passed} plan core tests passed.`);
