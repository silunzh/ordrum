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
const fresh = extra => core.normalise({marks: {}, ...extra}, data);
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
test('selection scope excludes unrelated words and progress counts', () => {
  const state = fresh();answer(state, 'word-1', 'known', at(20));answer(state, 'word-2', 'known', at(21));
  const plan = core.getPlan(state, data, {now: at(21), wordIds: new Set(['word-26', 'word-27'])});
  assert.deepEqual(plain(plan.wordIds), ['word-26', 'word-27']);assert.equal(plan.scopeCount, 2);assert.equal(plan.newToday, 0);
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
  assert.equal(state.reviewPreferences.reviewLimit, 100);assert.equal(state.reviewPreferences.newLimit, 0);assert.deepEqual(plain(state.reviewPreferences.intervals), [1, 2, 4, 8, 16]);
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

console.log(`${passed} review tests passed.`);
