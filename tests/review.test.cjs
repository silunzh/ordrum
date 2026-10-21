const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../public/review.js'), 'utf8');
const sandbox = {window: {}, console, TextEncoder};
vm.runInNewContext(source, sandbox, {filename: 'review.js'});
const core = sandbox.window.OrdrumReview;
const plain = value => JSON.parse(JSON.stringify(value));
const data = {words: Array.from({length: 50}, (_, i) => ({id: `word-${i + 1}`, chapter: i < 25 ? 1 : 2}))};
// Most original cases exercise a saved pre-methods profile. Empty new profiles
// are covered separately and now get the explicitly documented recall preset.
const fresh = extra => core.normalise({marks: {}, reviewPreferences: {reviewLimit: 20, newLimit: 5}, ...extra}, data);
const at = (day, hour = 12, minute = 0) => new Date(2026, 9, day, hour, minute);
let sequence = 0, passed = 0;
const answer = (state, wordId, outcome, when, sessionId = `session-${++sequence}`, mode = ['known', 'again'].includes(outcome) ? 'flashcard' : 'dictation') => core.record(state, {wordId, outcome, at: when, mode, sessionId, id: `event-${++sequence}`});
function test(name, fn) { try {fn();passed++;console.log('PASS ' + name);} catch (error) {console.error('FAIL ' + name);throw error;} }
function row(state, day = 31) { return core.schedules(state, at(day))['word-1']; }

test('legacy marks never fabricate review history or objective answers', () => {
  const state = fresh({marks: {'word-1': {status: 'known'}, 'word-2': {status: 'review'}}});
  assert.deepEqual(plain(state.reviewEvents), {});
  assert.deepEqual(plain(core.schedules(state, at(21))), {});
  const plan = core.getPlan(state, data, {now: at(21)});
  assert.equal(plan.newIds.length, 5);assert.equal(plan.completedToday, 0);
});
test('first successful recall is due next calendar day', () => {
  const state = fresh();assert.equal(answer(state, 'word-1', 'correct', at(21)).ok, true);
  const schedule = row(state);assert.equal(schedule.stage, 1);assert.equal(schedule.dueDay, '2026-10-22');
  assert.equal(schedule.objectiveCorrect, 1);assert.equal(schedule.objectiveAttempts, 1);
});
test('successful later days advance through transparent 1 3 7 14 30 intervals', () => {
  const state = fresh();
  answer(state, 'word-1', 'correct', at(1));answer(state, 'word-1', 'correct', at(2));
  answer(state, 'word-1', 'correct', at(5));answer(state, 'word-1', 'correct', at(12));answer(state, 'word-1', 'correct', at(26));
  assert.equal(row(state).stage, 5);assert.equal(row(state).dueDay, '2026-11-25');
});
test('same-day repeated successful sessions cannot jump through intervals', () => {
  const state = fresh();answer(state, 'word-1', 'correct', at(21, 8));answer(state, 'word-1', 'correct', at(21, 9));
  assert.equal(row(state).stage, 1);assert.equal(row(state).dueDay, '2026-10-22');
  assert.equal(row(state).objectiveCorrect, 2);
});
test('incorrect recall resets schedule and becomes eligible after ten minutes', () => {
  const state = fresh();answer(state, 'word-1', 'correct', at(20));answer(state, 'word-1', 'wrong', at(21, 12));
  assert.equal(row(state).stage, 0);assert.equal(row(state).dueDay, null);
  assert.equal(core.getPlan(state, data, {now: at(21, 12, 9)}).dueIds.includes('word-1'), false);
  assert.equal(core.getPlan(state, data, {now: at(21, 12, 10)}).dueIds.includes('word-1'), true);
});
test('correct retry in the same dictation round preserves the original failure', () => {
  const state = fresh();answer(state, 'word-1', 'wrong', at(21, 8), 'round-1');answer(state, 'word-1', 'correct', at(21, 9), 'round-1');
  const schedule = row(state);assert.equal(schedule.stage, 0);assert.equal(schedule.lastOutcome, 'wrong');
  assert.equal(schedule.objectiveAttempts, 1);assert.equal(schedule.objectiveCorrect, 0);
});
test('revealed then correct in one round never becomes first-try correctness', () => {
  const state = fresh();answer(state, 'word-1', 'revealed', at(21, 8), 'round-1');answer(state, 'word-1', 'correct', at(21, 9), 'round-1');
  const schedule = row(state);assert.equal(schedule.stage, 0);assert.equal(schedule.revealed, 1);
  assert.equal(schedule.objectiveAttempts, 0);assert.equal(schedule.objectiveCorrect, 0);
  assert.equal(core.getPlan(state, data, {now: at(21)}).completedToday, 0);
});
test('flashcard self assessment stays separate from objective accuracy', () => {
  const state = fresh();answer(state, 'word-1', 'known', at(20));answer(state, 'word-1', 'again', at(21));
  const schedule = row(state);assert.equal(schedule.selfKnown, 1);assert.equal(schedule.selfAgain, 1);
  assert.equal(schedule.objectiveAttempts, 0);assert.equal(schedule.objectiveCorrect, 0);assert.equal(schedule.stage, 0);
});
test('same round flashcard again followed by known cannot erase the again response', () => {
  const state = fresh();answer(state, 'word-1', 'again', at(21, 8), 'round-1');answer(state, 'word-1', 'known', at(21, 9), 'round-1');
  const schedule = row(state);assert.equal(schedule.stage, 0);assert.equal(schedule.selfKnown, 0);assert.equal(schedule.selfAgain, 1);
});
test('new independent round after a failure can restore a one-day interval', () => {
  const state = fresh();answer(state, 'word-1', 'wrong', at(21, 8));answer(state, 'word-1', 'correct', at(21, 9));
  assert.equal(row(state).stage, 1);assert.equal(row(state).dueDay, '2026-10-22');
});
test('plan places due words before a bounded number of new arrangements', () => {
  const state = fresh();answer(state, 'word-2', 'known', at(20));answer(state, 'word-1', 'known', at(19));
  core.setPreferences(state, {reviewLimit: 1, newLimit: 2}, at(21));
  const plan = core.getPlan(state, data, {now: at(21)});
  assert.deepEqual(plain(plan.dueIds), ['word-1']);assert.deepEqual(plain(plan.newIds), ['word-3', 'word-4']);
  assert.deepEqual(plain(plan.wordIds), ['word-1', 'word-3', 'word-4']);assert.equal(plan.availableDue, 2);
});
test('today limit counts distinct new words across sessions and reloads', () => {
  let state = fresh();core.setPreferences(state, {newLimit: 2}, at(21));
  answer(state, 'word-1', 'correct', at(21, 8));answer(state, 'word-1', 'known', at(21, 9));
  state = fresh(plain(state));const plan = core.getPlan(state, data, {now: at(21)});
  assert.equal(plan.newToday, 1);assert.equal(plan.remainingNew, 1);assert.equal(plan.newIds.length, 1);assert.equal(plan.completedToday, 1);
});
test('failed repeat keeps its allocation and can return at a zero remaining review budget', () => {
  const state = fresh();core.setPreferences(state, {reviewLimit: 1, newLimit: 0}, at(21));
  answer(state, 'word-1', 'correct', at(20));answer(state, 'word-2', 'correct', at(20));answer(state, 'word-1', 'wrong', at(21, 8));
  const plan = core.getPlan(state, data, {now: at(21)});
  assert.equal(plan.remainingReview, 0);assert.deepEqual(plain(plan.dueIds), ['word-1']);
});
test('zero limits allow normal studying without introducing a forced plan', () => {
  const state = fresh();core.setPreferences(state, {reviewLimit: 0, newLimit: 0}, at(21));
  assert.equal(core.getPlan(state, data, {now: at(21)}).wordIds.length, 0);
  assert.equal(answer(state, 'word-1', 'correct', at(21)).ok, true);
});
test('paused plan retains all history and exposes no selected words', () => {
  const state = fresh();answer(state, 'word-1', 'known', at(20));core.setPreferences(state, {paused: true}, at(21));
  const plan = core.getPlan(state, data, {now: at(21)});assert.equal(plan.paused, true);assert.equal(plan.wordIds.length, 0);assert.equal(plan.availableDue, 1);
  core.setPreferences(state, {paused: false}, at(21));assert.equal(core.getPlan(state, data, {now: at(21)}).dueIds[0], 'word-1');
});
test('skip removes a word only for the current local calendar day', () => {
  const state = fresh();answer(state, 'word-1', 'known', at(20));assert.equal(core.skip(state, 'word-1', {at: at(21), id: 'skip-1'}).ok, true);
  assert.equal(core.getPlan(state, data, {now: at(21, 13)}).dueIds.includes('word-1'), false);
  assert.equal(core.getPlan(state, data, {now: at(21, 13)}).skippedToday, 1);
  assert.equal(core.getPlan(state, data, {now: at(22)}).dueIds.includes('word-1'), true);assert.equal(row(state).objectiveAttempts, 0);
});
test('selection scope excludes unrelated cards while preserving a global daily allocation', () => {
  const state = fresh();answer(state, 'word-1', 'known', at(20));answer(state, 'word-2', 'known', at(21));
  const plan = core.getPlan(state, data, {now: at(21), wordIds: new Set(['word-26', 'word-27'])});
  assert.deepEqual(plain(plan.wordIds), ['word-26', 'word-27']);assert.equal(plan.scopeCount, 2);assert.equal(plan.newToday, 1);assert.equal(plan.scopeNewToday, 0);
});
test('empty selection is safe and schedules nothing', () => {
  const plan = core.getPlan(fresh(), data, {now: at(21), wordIds: []});assert.equal(plan.scopeCount, 0);assert.equal(plan.wordIds.length, 0);
});
test('events deduplicate by immutable identity and merge concurrent additions', () => {
  const first = fresh(), second = fresh();answer(first, 'word-1', 'correct', at(20));answer(second, 'word-2', 'known', at(21));
  const merged = core.mergeEvents(first.reviewEvents, second.reviewEvents, data);
  assert.equal(Object.keys(merged).length, 2);assert.deepEqual(plain(core.mergeEvents(merged, merged, data)), plain(merged));
  assert.deepEqual(plain(core.mergeEvents(first.reviewEvents, second.reviewEvents, data)), plain(core.mergeEvents(second.reviewEvents, first.reviewEvents, data)));
});
test('conflicting duplicate IDs have deterministic resolution independent of merge direction', () => {
  const state = fresh();const event = answer(state, 'word-1', 'correct', at(21)).event;
  const altered = {...event, outcome: 'wrong'};
  assert.deepEqual(plain(core.mergeEvents({[event.id]: event}, {[event.id]: altered})), plain(core.mergeEvents({[event.id]: altered}, {[event.id]: event})));
});
test('reordered imported events replay deterministically by time and stable ID', () => {
  const state = fresh();answer(state, 'word-1', 'correct', at(20));answer(state, 'word-1', 'wrong', at(21));
  const reversed = {...state, reviewEvents: Object.fromEntries(Object.entries(state.reviewEvents).reverse())};
  assert.deepEqual(plain(core.schedules(state, at(22))), plain(core.schedules(reversed, at(22))));
});
test('invalid modes unsafe identities malformed days and unknown words are excluded', () => {
  const state = fresh();const event = answer(state, 'word-1', 'correct', at(21)).event;
  const events = {...state.reviewEvents, bad1: {...event, id: 'bad1', day: '2026-02-31'}, bad2: {...event, id: 'bad2', mode: 'flashcard'}, bad3: {...event, id: 'bad3', wordId: 'missing'}, bad4: {...event, id: 'bad4', day: '2025-10-21'}};
  assert.equal(Object.keys(core.sanitiseEvents(events, new Set(['word-1']))).length, 1);
  assert.equal(core.record(state, {...event, id: '__proto__'}).ok, false);
  assert.equal(core.record(state, {...event, id: 'invalid-time', at: 'invalid'}).ok, false);
});
test('future clock events do not prematurely alter a current plan', () => {
  const state = fresh();answer(state, 'word-1', 'known', at(22));
  assert.equal(core.getPlan(state, data, {now: at(21)}).newIds.includes('word-1'), true);
});
test('preferences accept explicit modest values and reject invalid intervals', () => {
  const state = fresh();core.setPreferences(state, {reviewLimit: 999, newLimit: -4, intervals: [1, 2, 4, 8, 16]}, at(21));
  assert.equal(state.reviewPreferences.reviewLimit, 200);assert.equal(state.reviewPreferences.newLimit, 0);assert.deepEqual(plain(state.reviewPreferences.intervals), [1, 2, 4, 8, 16]);
  core.setPreferences(state, {intervals: [1, 2, 2, 5, 8]}, at(21));assert.deepEqual(plain(state.reviewPreferences.intervals), [1, 3, 7, 14, 30]);
});
test('local midnight, rather than elapsed 24 hours, makes a one-day card due', () => {
  const state = fresh();answer(state, 'word-1', 'known', at(21, 23, 59));
  assert.equal(core.getPlan(state, data, {now: at(22, 0, 0)}).dueIds.includes('word-1'), true);
  assert.equal(core.getPlan(state, data, {now: at(21, 23, 59)}).dueIds.includes('word-1'), false);
});
test('calendar arithmetic spans month leap year and DST boundaries', () => {
  assert.equal(core.addDays('2026-10-24', 1), '2026-10-25');assert.equal(core.addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(core.addDays('2028-02-28', 1), '2028-02-29');assert.equal(core.addDays('2026-12-31', 1), '2027-01-01');
});
test('stored local day preserves the original learning day after device timezone changes', () => {
  const state = fresh();const atUTC = '2026-10-20T22:30:00.000Z';
  const result = core.record(state, {id: 'east-event', wordId: 'word-1', sessionId: 'east-session', mode: 'dictation', outcome: 'correct', at: atUTC, day: '2026-10-21'});
  assert.equal(result.ok, true);assert.equal(core.schedules(state, at(22))['word-1'].dueDay, '2026-10-22');
});
test('history budget refuses new events without deleting existing or unsynced history', () => {
  const state = fresh();answer(state, 'word-1', 'correct', at(21));const original = plain(state.reviewEvents);
  state.overrides = {large: 'x'.repeat(core.constants.MAX_STATE_BYTES)};
  const result = answer(state, 'word-2', 'wrong', at(21));assert.equal(result.ok, false);assert.equal(result.reason, 'capacity');
  assert.deepEqual(plain(state.reviewEvents), original);assert.equal(core.capacity(state).full, true);
});
test('normalising an over-budget imported history preserves every valid event', () => {
  const state = fresh();const base = answer(state, 'word-1', 'correct', at(21)).event;
  state.reviewEvents = Object.fromEntries(Array.from({length: core.constants.MAX_EVENTS + 1}, (_, i) => [`large-${i}`, {...base, id: `large-${i}`, sessionId: `large-round-${i}`} ]));
  const result = core.normalise(state, data);assert.equal(Object.keys(result.reviewEvents).length, core.constants.MAX_EVENTS + 1);
  assert.equal(answer(state, 'word-2', 'known', at(21)).reason, 'capacity');
});
test('recording an existing event is idempotent after a persisted round trip', () => {
  const state = fresh();const event = answer(state, 'word-1', 'wrong', at(21)).event;
  const restored = fresh(plain(state));const result = core.record(restored, event);assert.equal(result.ok, true);assert.equal(result.reason, 'duplicate');assert.equal(Object.keys(restored.reviewEvents).length, 1);
});

// Real TZ changes exercise Date's local calendar boundary around both DST shifts.
test('Europe Stockholm spring and autumn DST day boundaries stay calendar based', () => {
  const previous = process.env.TZ;process.env.TZ = 'Europe/Stockholm';
  try {
    for (const [when, next] of [[new Date(2026, 2, 28, 23, 45), new Date(2026, 2, 29, 0, 1)], [new Date(2026, 9, 24, 23, 45), new Date(2026, 9, 25, 0, 1)]]) {
      const state = fresh();answer(state, 'word-1', 'known', when);assert.equal(core.getPlan(state, data, {now: next}).dueIds.includes('word-1'), true);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});


test('assisted legacy retries are ignored even without an earlier new review event', () => {
  const state = fresh();
  const result = core.record(state, {wordId: 'word-1', mode: 'dictation', outcome: 'correct', sessionId: 'legacy-round', firstAttempt: false, at: at(21)});
  assert.equal(result.ok, true);assert.equal(result.reason, 'assisted');assert.equal(Object.keys(state.reviewEvents).length, 0);
});
test('early independent recall does not postpone or advance an interval before it is due', () => {
  const state = fresh();answer(state, 'word-1', 'known', at(1));answer(state, 'word-1', 'known', at(2));
  assert.equal(row(state).stage, 2);assert.equal(row(state).dueDay, '2026-10-05');
  answer(state, 'word-1', 'known', at(3));answer(state, 'word-1', 'known', at(4));
  assert.equal(row(state).stage, 2);assert.equal(row(state).dueDay, '2026-10-05');
});
test('same-day failure and independent recovery cannot add a second success stage', () => {
  const state = fresh();answer(state, 'word-1', 'correct', at(20));answer(state, 'word-1', 'correct', at(21, 8));
  assert.equal(row(state).stage, 2);answer(state, 'word-1', 'wrong', at(21, 9));answer(state, 'word-1', 'correct', at(21, 10));answer(state, 'word-1', 'correct', at(21, 11));
  assert.equal(row(state).stage, 1);assert.equal(row(state).dueDay, '2026-10-22');
});
function uiHarness(state = fresh()) {
  const listeners = new Map(), changes = [], starts = [];let html = '', writes = 0;
  const target = {get innerHTML() {return html;}, set innerHTML(value) {html = value;writes++;},
    addEventListener(type, listener) {listeners.set(type, listener);}, removeEventListener(type, listener) {if (listeners.get(type) === listener) listeners.delete(type);},
    querySelector(selector) {return selector === '#review-plan-options' && html.includes('id="review-plan-options"') ? {tagName: 'FORM'} : {focus() {}};}, contains() {return true;}
  };
  let selected = ['word-1', 'word-2'];
  const ui = core.mount(target, {getState: () => state, getData: () => data, getWordIds: () => selected, now: () => at(21), onChange: event => changes.push(event), onStart: event => starts.push(event)});
  return {target, ui, state, changes, starts, get writes() {return writes;}, set selected(value) {selected = value;},
    click(action) {const button = {dataset: {reviewAction: action}};listeners.get('click')({target: {closest() {return button;}}});},
    submit(values) {let prevented = false;const form = {id: 'review-plan-options', querySelector(selector) {return {value: values[selector.match(/name="([^"]+)"/)[1]]};}};listeners.get('submit')({target: form, preventDefault() {prevented = true;}});return prevented;}, listeners};
}
test('mounted plan launches a frozen current selection in the requested mode', () => {
  const app = uiHarness();app.click('dictation');assert.equal(app.starts.length, 1);assert.equal(app.starts[0].mode, 'dictation');assert.deepEqual(plain(app.starts[0].wordIds), ['word-1', 'word-2']);
  app.selected = ['word-3'];assert.deepEqual(plain(app.starts[0].wordIds), ['word-1', 'word-2']);app.click('flashcard');assert.deepEqual(plain(app.starts[1].wordIds), ['word-3']);
});
test('background plan redraw preserves an open preferences form and its draft', () => {
  const app = uiHarness();app.click('options');const writes = app.writes;app.state.reviewPreferences.newLimit = 1;app.ui.render();assert.equal(app.writes, writes);
  app.click('options');assert.ok(app.writes > writes);
});
test('plan controls pause and resume without discarding existing history', () => {
  const state = fresh();answer(state, 'word-1', 'correct', at(20));const app = uiHarness(state);const saved = plain(state.reviewEvents);
  app.click('pause');assert.equal(state.reviewPreferences.paused, true);app.click('dictation');assert.equal(app.starts.length, 0);
  app.click('pause');assert.equal(state.reviewPreferences.paused, false);assert.equal(app.changes.length, 2);assert.deepEqual(plain(state.reviewEvents), saved);
});
test('invalid plan form cannot overwrite valid preferences, and valid save notifies persistence', () => {
  const app = uiHarness();app.click('options');assert.equal(app.submit({reviewLimit: '101', newLimit: '3', intervals: '1, 3, 3, 14, 30'}), true);
  assert.equal(app.state.reviewPreferences.reviewLimit, 20);assert.equal(app.changes.length, 0);
  app.submit({reviewLimit: '12', newLimit: '3', intervals: '1, 2, 4, 8, 16'});assert.equal(app.state.reviewPreferences.reviewLimit, 12);assert.equal(app.state.reviewPreferences.newLimit, 3);assert.equal(app.changes.length, 1);
});
test('destroying the plan removes delegated listeners', () => {
  const app = uiHarness();app.ui.destroy();assert.equal(app.target.innerHTML, '');assert.equal(app.listeners.size, 0);
});


test('failed recall empty card explains the actual future ready time', () => {
  const state = fresh();answer(state, 'word-1', 'wrong', at(21, 11, 55));core.setPreferences(state, {newLimit: 0}, at(21));
  const app = uiHarness(state);assert.ok(app.target.innerHTML.includes('下一次复习：'));assert.ok(app.target.innerHTML.includes('12:05'));
  assert.equal(core.getPlan(state, data, {now: at(21)}).wordIds.length, 0);
});
test('skipping a currently due word reports tomorrow midnight before later scheduled words', () => {
  const state = fresh();answer(state, 'word-1', 'known', at(19));answer(state, 'word-2', 'known', at(21, 8));
  core.skip(state, 'word-1', {at: at(21), id: 'skip-ready'});
  const next = core.getPlan(state, data, {now: at(21)}).nextDueAt;
  assert.equal(new Date(next).getTime(), new Date(2026, 9, 22).getTime());
});
test('skipping an as-yet unscheduled word keeps tomorrow eligibility without inventing recall', () => {
  const state = fresh();core.skip(state, 'word-1', {at: at(21), id: 'skip-new'});
  const plan = core.getPlan(state, data, {now: at(21), wordIds: ['word-1']});
  assert.equal(plan.wordIds.length, 0);assert.equal(new Date(plan.nextDueAt).getTime(), new Date(2026, 9, 22).getTime());assert.equal(Object.keys(core.schedules(state, at(21))).length, 0);
});

test('a genuinely empty new profile defaults to the recall workload while saved legacy limits stay intact', () => {
  const current = core.cleanPreferences({});assert.equal(current.method, 'recall');assert.equal(current.newLimit, 30);assert.equal(current.reviewLimit, 90);assert.equal(current.targetMinutes, 60);
  const legacy = core.cleanPreferences({newLimit: 3, reviewLimit: 12, intervals: [1, 2, 4, 8, 20], paused: true});
  assert.equal(legacy.newLimit, 3);assert.equal(legacy.reviewLimit, 12);assert.equal(legacy.paused, true);assert.deepEqual(plain(legacy.intervals), [1, 2, 4, 8, 20]);
});
test('explicit method presets change workload and intervals without resuming a paused plan or changing its scope', () => {
  const state = fresh();core.setPreferences(state, {paused: true, scope: {kind: 'chapters', chapterIds: [2]}}, at(21));
  const result = core.applyPreset(state, 'dictation', at(22));assert.equal(result.ok, true);assert.equal(state.reviewPreferences.method, 'dictation');assert.equal(state.reviewPreferences.reviewLimit, 80);assert.equal(state.reviewPreferences.newLimit, 20);assert.equal(state.reviewPreferences.chunkSize, 10);
  assert.equal(state.reviewPreferences.paused, true);assert.deepEqual(plain(state.reviewPreferences.scope.chapterIds), [2]);assert.deepEqual(plain(state.reviewPreferences.intervals), [1, 2, 5, 12, 30]);
  const before = plain(state);assert.equal(core.applyPreset(state, 'made-up', at(23)).ok, false);assert.deepEqual(plain(state), before);
});
test('preferences enforce bounded editable limits time chunk sizes and allowlisted scope', () => {
  const prefs = core.cleanPreferences({method: 'unsafe', targetMinutes: 999, chunkSize: 2, reviewLimit: 400, newLimit: 170,
    scope: {kind: 'chapters', chapterIds: [2, 1, 2, -1, '3', 1001], notebookChapterIds: ['all', 'today', '__proto__', 'all', 'unit-1'], credential: 'never-keep'}});
  assert.equal(prefs.method, 'recall');assert.equal(prefs.targetMinutes, 180);assert.equal(prefs.chunkSize, 10);assert.equal(prefs.reviewLimit, 200);assert.equal(prefs.newLimit, 170);
  assert.deepEqual(plain(prefs.scope), {kind: 'chapters', chapterIds: [1, 2], notebookChapterIds: ['all', 'today', 'unit-1']});assert.equal(JSON.stringify(prefs).includes('never-keep'), false);
});
test('preset descriptors are defensive copies and expose distinct practical workloads', () => {
  const methods = core.getMethods();assert.deepEqual(plain(methods.map(row => [row.id, row.newLimit + row.reviewLimit])), [['recall', 120], ['dictation', 100], ['quick', 200]]);
  methods[0].intervals[0] = 99;methods[0].steps[0] = 'changed';assert.equal(core.getMethods()[0].intervals[0], 1);assert.equal(core.getMethods()[0].steps[0], '新词预览');
});
test('changing selected chapters cannot bypass either global daily budget', () => {
  const state = fresh();core.setPreferences(state, {newLimit: 1, reviewLimit: 1}, at(21));
  answer(state, 'word-1', 'known', at(20));answer(state, 'word-2', 'known', at(20));answer(state, 'word-1', 'known', at(21, 8));answer(state, 'word-3', 'known', at(21, 8));
  const plan = core.buildDailyPlan(state, data, {now: at(21), wordIds: ['word-2', 'word-26']});
  assert.equal(plan.newToday, 1);assert.equal(plan.reviewedToday, 1);assert.equal(plan.remainingNew, 0);assert.equal(plan.remainingReview, 0);assert.deepEqual(plain(plan.wordIds), []);assert.equal(plan.scopeNewToday, 0);assert.equal(plan.scopeReviewedToday, 0);
});
test('daily summary separates distinct contacted words first answers and self ratings', () => {
  const state = fresh();answer(state, 'word-1', 'wrong', at(21, 8), 'bad-round');answer(state, 'word-1', 'correct', at(21, 9), 'bad-round');
  answer(state, 'word-2', 'known', at(21, 8));answer(state, 'word-3', 'revealed', at(21, 8));answer(state, 'word-4', 'correct', at(21, 8));core.skip(state, 'word-5', {at: at(21)});
  const metrics = core.dailyMetrics(state, at(21));assert.equal(metrics.contactedToday, 4);assert.equal(metrics.answeredContacts, 4);assert.equal(metrics.objectiveAttempts, 2);assert.equal(metrics.objectiveCorrect, 1);assert.equal(metrics.objectivePercent, 50);assert.equal(metrics.selfKnown, 1);assert.equal(metrics.revealed, 1);
  assert.equal(core.dailyMetrics(state, at(22)).objectivePercent, null);
});
const sessionPlan = method => {
  const preferences = core.cleanPreferences({...core.getMethods().find(row => row.id === method), method});
  const dueIds = Array.from({length: preferences.reviewLimit}, (_, i) => `due-${i + 1}`), newIds = Array.from({length: preferences.newLimit}, (_, i) => `new-${i + 1}`);
  return {day: '2026-10-21', wordIds: [...dueIds, ...newIds], dueIds, newIds, preferences, paused: false};
};
test('recall session previews new words uses bounded chunks and ends in dynamic difficult dictation', () => {
  const plan = sessionPlan('recall'), before = plain(plan), session = core.buildSession(plan, {id: 'recall-session', now: at(21)});
  assert.equal(session.method, 'recall');assert.equal(session.wordIds.length, 120);assert.equal(session.stages[0].mode, 'preview');assert.equal(session.stages[0].wordIds.length, 20);
  assert.equal(session.stages.filter(stage => stage.phase === 'main').length, 6);assert.ok(session.stages.filter(stage => stage.selector === 'all').every(stage => stage.wordIds.length <= 20));
  const final = session.stages.at(-1);assert.equal(final.mode, 'dictation');assert.equal(final.selector, 'difficult');assert.equal(final.maxWords, 20);assert.equal(session.maximumContacts, 170);assert.equal(session.estimatedMinutes, 54);
  assert.deepEqual(plain(plan), before);plan.preferences.intervals[0] = 99;assert.equal(session.preferences.intervals[0], 1);
});
test('dictation session retries are assisted practice and each actual group is at most ten cards', () => {
  const session = core.buildSession(sessionPlan('dictation'), {id: 'dictation-session', now: at(21)});
  assert.equal(session.stages.filter(stage => stage.phase === 'main').length, 10);assert.ok(session.stages.filter(stage => stage.phase === 'main').every(stage => stage.mode === 'dictation' && stage.wordIds.length === 10));
  const retries = session.stages.filter(stage => stage.phase === 'retry');assert.equal(retries.length, 2);assert.equal(retries[0].assisted, true);assert.equal(retries[1].chunkOffset, 10);assert.equal(retries[1].selector, 'errors');assert.equal(session.estimatedMinutes, 60);
});
test('quick session interleaves old and new cards then reinforces and samples separately', () => {
  const session = core.buildSession(sessionPlan('quick'), {id: 'quick-session', now: at(21)});
  assert.equal(session.stages.some(stage => stage.phase === 'preview'), false);assert.deepEqual(plain(session.stages[0].wordIds.slice(0, 5)), ['due-1', 'due-2', 'due-3', 'due-4', 'new-1']);
  assert.equal(session.stages.at(-2).selector, 'difficult');assert.equal(session.stages.at(-2).maxWords, 25);assert.equal(session.stages.at(-1).selector, 'sample');assert.equal(session.stages.at(-1).mode, 'dictation');assert.equal(session.estimatedMinutes, 57);
});
test('dynamic difficult selection retains any first difficulty even when later self ratings are known', () => {
  const stage = {id: 'stage-hard', wordIds: ['word-1', 'word-2', 'word-3'], selector: 'difficult', maxWords: 20};
  const results = [{'word-1': 'again', 'word-2': 'known', 'word-3': 'wrong'}, {'word-1': 'known', 'word-3': {outcome: 'correct'}}];
  assert.deepEqual(plain(core.selectStageWords(stage, {results})), ['word-1', 'word-3']);assert.deepEqual(plain(core.selectStageWords({...stage, selector: 'errors'}, {results})), ['word-3']);
});
test('dynamic retry chunks partition a frozen failure pool without duplicates', () => {
  const session = core.buildSession(sessionPlan('dictation'), {id: 'partition-session', now: at(21)});
  const failures = Object.fromEntries(session.wordIds.slice(0, 30).map(id => [id, 'wrong']));
  const retries = session.stages.filter(stage => stage.phase === 'retry').flatMap(stage => plain(core.selectStageWords(stage, {results: failures})));
  assert.equal(retries.length, 20);assert.equal(new Set(retries).size, 20);assert.deepEqual(plain(retries), plain(session.wordIds.slice(0, 20)));
});
test('sample chunks share a stable ordering prioritize difficulty and never repeat a sampled card', () => {
  const plan = sessionPlan('quick');plan.preferences.chunkSize = 10;
  const session = core.buildSession(plan, {id: 'sample-session', now: at(21)}), results = {'due-199': 'wrong', 'new-40': 'again'};
  const samples = session.stages.filter(stage => stage.phase === 'test').flatMap(stage => plain(core.selectStageWords(stage, {results})));
  assert.equal(samples.length, 20);assert.equal(new Set(samples).size, 20);assert.equal(samples[0], 'new-40');
  assert.deepEqual(plain(samples), plain(session.stages.filter(stage => stage.phase === 'test').flatMap(stage => plain(core.selectStageWords(stage, {results})))));
  assert.notDeepEqual(plain(samples), plain(session.wordIds.slice(0, 20)));
});
test('sessions freeze selected words and produce stable safe stage IDs without collecting pretend events', () => {
  const state = fresh(), plan = core.getPlan(state, data, {now: at(21)}), session = core.buildSession(plan, {id: 'stable-session', now: at(21)});
  const before = plain(session);plan.wordIds.reverse();assert.deepEqual(plain(session), before);assert.equal(Object.keys(state.reviewEvents).length, 0);
  assert.equal(new Set(session.stages.map(stage => stage.id)).size, session.stages.length);assert.ok(session.stages.every(stage => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(stage.id)));
  assert.equal(core.buildSession({...plan, paused: true}), null);assert.equal(core.buildSession({...plan, wordIds: []}), null);
});
test('empty and sparse plans receive honest workload estimates rather than a guaranteed hour', () => {
  assert.equal(core.estimateMinutes({newIds: [], dueIds: [], preferences: core.cleanPreferences({})}), 0);
  assert.ok(core.estimateMinutes({newIds: ['word-1'], dueIds: [], preferences: core.cleanPreferences({})}) < 60);
});
test('capacity reports remaining space without modifying or silently pruning history', () => {
  const state = fresh();answer(state, 'word-1', 'known', at(21));const before = plain(state), info = core.capacity(state);
  assert.equal(info.maximum, 10000);assert.equal(info.maximumEventBytes, 1600000);assert.equal(info.remainingEvents, 9999);assert.ok(info.remainingEventBytes > 0);assert.ok(info.remainingStateBytes > 0);assert.equal(info.nearLimit, false);assert.deepEqual(plain(state), before);
});

console.log(`${passed} review tests passed.`);
