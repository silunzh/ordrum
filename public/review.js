(function (global) {
  'use strict';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
  const DEFAULT_INTERVALS = [1, 3, 7, 14, 30];
  const MAX_EVENTS = 10000, MAX_EVENT_BYTES = 1600000, MAX_STATE_BYTES = 2700000;
  const AGAIN_MINUTES = 10;
  // These are editable workload suggestions, not a claim about how many new
  // words a learner can retain in an hour. Existing limits remain unchanged
  // until the learner explicitly applies a preset.
  const METHODS = [
    {id: 'recall', name: '分组主动回忆', tagline: '翻卡回忆，再练难词', description: '先浏览新词，再遮住释义主动回忆，最后听写需要巩固的词。', newLimit: 30, reviewLimit: 90, targetMinutes: 60, chunkSize: 20, intervals: [1, 3, 7, 14, 30], steps: ['新词预览', '主动翻卡', '难词听写']},
    {id: 'dictation', name: '听写巩固', tagline: '先听后写，集中纠错', description: '先浏览新词，再听写首次答案，最后重练本轮答错或看过答案的词。', newLimit: 20, reviewLimit: 80, targetMinutes: 60, chunkSize: 10, intervals: [1, 2, 5, 12, 30], steps: ['新词预览', '首次听写', '错词重练']},
    {id: 'quick', name: '快速交错复习', tagline: '熟词快过，难词再来', description: '新旧词交错翻卡，再练难词，最后进行少量听写抽查。', newLimit: 40, reviewLimit: 160, targetMinutes: 60, chunkSize: 25, intervals: [1, 3, 7, 14, 30], steps: ['交错翻卡', '难词回看', '听写抽查']}
  ];
  const getMethods = () => METHODS.map(method => ({...method, minutes: method.targetMinutes, intervals: method.intervals.slice(), steps: method.steps.slice()}));
  const methodFor = id => METHODS.find(method => method.id === id) || METHODS[0];
  const modes = {dictation: ['correct', 'wrong', 'revealed', 'skip'], flashcard: ['known', 'again', 'skip']};
  const iso = value => { if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
  const dateValue = value => Number.isFinite(new Date(value).getTime()) ? new Date(value) : new Date();
  const localDay = value => { const d = dateValue(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function dayNumber(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const valueAt = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(valueAt) && new Date(valueAt).toISOString().slice(0, 10) === value ? valueAt / 86400000 : null;
  }
  function addDays(day, amount) { return new Date((dayNumber(day) + amount) * 86400000).toISOString().slice(0, 10); }
  function localStart(day) { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
  function bytes(value) { const json = JSON.stringify(value); return typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : unescape(encodeURIComponent(json)).length; }
  function validSet(value) {
    if (Object.prototype.toString.call(value) === '[object Set]') return value;
    if (Array.isArray(value)) return new Set(value.map(row => typeof row === 'string' ? row : row?.id).filter(safeId));
    if (Array.isArray(value?.words)) return validSet(value.words);
    return null;
  }
  function cleanEvent(key, event, validIds) {
    if (!safeId(key) || !object(event) || event.id !== key || !safeId(event.wordId) || validIds && !validIds.has(event.wordId) || !safeId(event.sessionId) || !own(modes, event.mode) || !modes[event.mode].includes(event.outcome)) return null;
    const at = iso(event.at), day = event.day;
    if (!at || dayNumber(day) === null || Math.abs(dayNumber(day) - dayNumber(at.slice(0, 10))) > 1) return null;
    return {id: key, wordId: event.wordId, sessionId: event.sessionId, mode: event.mode, outcome: event.outcome, at, day};
  }
  // Never trim a valid imported history: silently pruning it could erase pending
  // offline events. New collection stops explicitly when the budget is reached.
  function sanitiseEvents(events, validIds) {
    const result = {}, valid = validSet(validIds);
    if (object(events)) Object.keys(events).sort().forEach(id => { const row = cleanEvent(id, events[id], valid); if (row) result[id] = row; });
    return result;
  }
  function mergeEvents(local, incoming, validIds) {
    const result = sanitiseEvents(local, validIds), remote = sanitiseEvents(incoming, validIds);
    Object.keys(remote).forEach(id => {
      // Genuine event IDs are immutable. A deterministic tie also keeps corrupt
      // conflicting copies from producing device-dependent schedules.
      if (!own(result, id) || JSON.stringify(remote[id]) < JSON.stringify(result[id])) result[id] = remote[id];
    });
    return result;
  }
  const limit = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(0, Math.floor(Number(value)))) : fallback;
  function cleanScope(value) {
    const scope = object(value) ? value : {};
    return {kind: ['selected', 'book', 'chapters', 'notebook'].includes(scope.kind) ? scope.kind : 'selected',
      chapterIds: Array.isArray(scope.chapterIds) ? [...new Set(scope.chapterIds.filter(id => Number.isInteger(id) && id >= 1 && id <= 1000))].sort((a, b) => a - b).slice(0, 200) : [],
      notebookChapterIds: Array.isArray(scope.notebookChapterIds) ? [...new Set(scope.notebookChapterIds.filter(safeId))].slice(0, 1000) : []};
  }
  function cleanPreferences(value) {
    const prefs = object(value) ? value : {}, proposed = prefs.intervals;
    const fresh = !Object.keys(prefs).length, defaults = fresh ? METHODS[0] : {reviewLimit: 20, newLimit: 5};
    const intervals = Array.isArray(proposed) && proposed.length === 5 && proposed.every((day, index) => Number.isInteger(day) && day >= 1 && day <= 365 && (!index || day > proposed[index - 1])) ? proposed.slice() : DEFAULT_INTERVALS.slice();
    return {method: methodFor(prefs.method).id, targetMinutes: Math.max(10, limit(prefs.targetMinutes, 60, 180)), chunkSize: Math.max(10, limit(prefs.chunkSize, 20, 25)), reviewLimit: limit(prefs.reviewLimit, defaults.reviewLimit, 200), newLimit: limit(prefs.newLimit, defaults.newLimit, 200), intervals, scope: cleanScope(prefs.scope), paused: prefs.paused === true, updatedAt: iso(prefs.updatedAt) || '1970-01-01T00:00:00.000Z'};
  }
  function normalise(state, data) {
    state.reviewEvents = sanitiseEvents(state.reviewEvents, data);
    state.reviewPreferences = cleanPreferences(state.reviewPreferences);
    return state;
  }
  function setPreferences(state, patch, at = new Date()) {
    state.reviewPreferences = cleanPreferences({...cleanPreferences(state.reviewPreferences), ...(object(patch) ? patch : {}), updatedAt: dateValue(at).toISOString()});
    return state.reviewPreferences;
  }
  function applyPreset(state, methodId, at = new Date()) {
    const method = METHODS.find(row => row.id === methodId);
    if (!method) return {ok: false, reason: 'method'};
    const {id, newLimit, reviewLimit, targetMinutes, chunkSize, intervals} = method;
    return {ok: true, preferences: setPreferences(state, {method: id, newLimit, reviewLimit, targetMinutes, chunkSize, intervals: intervals.slice()}, at)};
  }
  function capacity(state) {
    const events = object(state.reviewEvents) ? state.reviewEvents : {};
    const count = Object.keys(events).length, eventBytes = bytes(events), stateBytes = bytes(state);
    return {full: count >= MAX_EVENTS || eventBytes >= MAX_EVENT_BYTES || stateBytes >= MAX_STATE_BYTES, count, maximum: MAX_EVENTS,
      eventBytes, maximumEventBytes: MAX_EVENT_BYTES, stateBytes, maximumStateBytes: MAX_STATE_BYTES,
      remainingEvents: Math.max(0, MAX_EVENTS - count), remainingEventBytes: Math.max(0, MAX_EVENT_BYTES - eventBytes), remainingStateBytes: Math.max(0, MAX_STATE_BYTES - stateBytes),
      nearLimit: count >= MAX_EVENTS * 0.9 || eventBytes >= MAX_EVENT_BYTES * 0.9 || stateBytes >= MAX_STATE_BYTES * 0.9};
  }
  function record(state, input) {
    if (!object(input)) return {ok: false, reason: 'invalid'};
    if (input.firstAttempt === false) return {ok: true, reason: 'assisted'};
    const at = iso(input.at === undefined ? new Date() : input.at);
    const random = global.crypto?.randomUUID ? global.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    const id = input.id === undefined ? `review-${random}` : input.id;
    const event = cleanEvent(id, {...input, id, at, day: input.day || (at ? localDay(at) : '')}, null);
    if (!event) return {ok: false, reason: 'invalid'};
    if (!object(state.reviewEvents)) state.reviewEvents = {};
    if (own(state.reviewEvents, id)) return {ok: JSON.stringify(state.reviewEvents[id]) === JSON.stringify(event), reason: 'duplicate', event: state.reviewEvents[id]};
    const events = {...state.reviewEvents, [id]: event};
    if (Object.keys(events).length > MAX_EVENTS || bytes(events) > MAX_EVENT_BYTES || bytes({...state, reviewEvents: events}) > MAX_STATE_BYTES) return {ok: false, reason: 'capacity', message: '复习历史已接近同步容量。本次学习仍可继续；新的复习记录暂不收集。请先导出档案保留历史。'};
    state.reviewEvents[id] = event;
    return {ok: true, event};
  }
  function skip(state, wordId, options = {}) { return record(state, {...options, wordId, mode: 'flashcard', outcome: 'skip', sessionId: options.sessionId || `skip-${dateValue(options.at === undefined ? new Date() : options.at).getTime()}`}); }
  function replay(state, reference) {
    const current = dateValue(reference), until = current.getTime(), today = localDay(current), prefs = cleanPreferences(state.reviewPreferences);
    const events = Object.values(sanitiseEvents(state.reviewEvents)).filter(row => Date.parse(row.at) <= until).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
    const schedules = {}, sessions = new Set(), skipped = new Set(), touchedToday = new Set(), successfulToday = new Set();
    for (const event of events) {
      if (event.outcome === 'skip') { if (event.day === today) skipped.add(event.wordId); continue; }
      const sessionKey = `${event.sessionId}\n${event.wordId}\n${event.mode}`;
      if (sessions.has(sessionKey)) continue;
      sessions.add(sessionKey);
      const row = schedules[event.wordId] || {wordId: event.wordId, stage: 0, dueDay: null, dueAt: null, lastAt: null, lastOutcome: null, firstDay: event.day, lastSuccessDay: null, objectiveAttempts: 0, objectiveCorrect: 0, revealed: 0, selfKnown: 0, selfAgain: 0};
      const success = event.outcome === 'correct' || event.outcome === 'known';
      if (event.mode === 'dictation' && ['correct', 'wrong'].includes(event.outcome)) { row.objectiveAttempts++; if (success) row.objectiveCorrect++; }
      if (event.outcome === 'revealed') row.revealed++;
      if (event.outcome === 'known') row.selfKnown++;
      if (event.outcome === 'again') row.selfAgain++;
      if (event.day === today) { touchedToday.add(event.wordId); if (success) successfulToday.add(event.wordId); }
      if (success) {
        // Repeated practice remains possible, but one calendar day's clicks do
        // not jump through several intervals or push an existing due date out.
        if (row.lastSuccessDay !== event.day) {
          if (!row.stage || row.dueAt !== null || !row.dueDay || dayNumber(event.day) >= dayNumber(row.dueDay)) {
            row.stage = Math.min(prefs.intervals.length, row.stage + 1);
            row.dueDay = addDays(event.day, prefs.intervals[row.stage - 1]);
            row.dueAt = null;
          }
          row.lastSuccessDay = event.day;
        } else if (row.dueAt !== null) {
          row.stage = Math.max(1, row.stage);
          row.dueDay = addDays(event.day, prefs.intervals[row.stage - 1]);
          row.dueAt = null;
        }
      } else {
        row.stage = 0; row.dueAt = Date.parse(event.at) + AGAIN_MINUTES * 60000; row.dueDay = null;
      }
      row.lastAt = event.at; row.lastOutcome = event.outcome; row.mode = event.mode;
      schedules[event.wordId] = row;
    }
    return {schedules, skipped, touchedToday, successfulToday, today, now: until, preferences: prefs};
  }
  function schedules(state, reference = new Date()) { return replay(state, reference).schedules; }
  function dailyMetrics(state, reference = new Date()) {
    const now = dateValue(reference), today = localDay(now), seen = new Set(), words = new Set();
    const result = {day: today, contactedToday: 0, answeredContacts: 0, objectiveAttempts: 0, objectiveCorrect: 0, revealed: 0, selfKnown: 0, selfAgain: 0, objectivePercent: null};
    const events = Object.values(sanitiseEvents(state.reviewEvents)).filter(event => Date.parse(event.at) <= now.getTime()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
    for (const event of events) {
      if (event.outcome === 'skip') continue;
      const key = `${event.sessionId}\n${event.wordId}\n${event.mode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (event.day !== today) continue;
      words.add(event.wordId); result.answeredContacts++;
      if (event.mode === 'dictation' && ['correct', 'wrong'].includes(event.outcome)) { result.objectiveAttempts++; if (event.outcome === 'correct') result.objectiveCorrect++; }
      if (event.outcome === 'revealed') result.revealed++;
      if (event.outcome === 'known') result.selfKnown++;
      if (event.outcome === 'again') result.selfAgain++;
    }
    result.contactedToday = words.size;
    if (result.objectiveAttempts) result.objectivePercent = Math.round(100 * result.objectiveCorrect / result.objectiveAttempts);
    return result;
  }
  function estimateMinutes(plan, preferences) {
    const prefs = cleanPreferences(preferences || plan?.preferences), method = prefs.method;
    const newCount = Array.isArray(plan?.newIds) ? plan.newIds.length : 0, dueCount = Array.isArray(plan?.dueIds) ? plan.dueIds.length : 0, count = newCount + dueCount;
    if (!count) return 0;
    const hardCount = Math.min(method === 'quick' ? 25 : 20, count);
    const seconds = method === 'dictation' ? newCount * 20 + count * 23 + hardCount * 20 + 8 * 60
      : method === 'quick' ? newCount * 25 + dueCount * 8 + hardCount * 10 + Math.min(20, count) * 18 + 8 * 60
      : newCount * 20 + count * 12 + hardCount * 30 + 10 * 60;
    return Math.ceil(seconds / 60);
  }
  function getPlan(state, data, options = {}) {
    const history = replay(state, options.now === undefined ? new Date() : options.now), {today, now, preferences: prefs} = history;
    const words = (Array.isArray(data?.words) ? data.words : []).filter(word => safeId(word?.id));
    const scope = options.wordIds === undefined ? null : validSet(options.wordIds) || new Set();
    const scopedIds = Array.from(new Set(words.filter(word => !scope || scope.has(word.id)).map(word => word.id)));
    const scopeSet = new Set(scopedIds), day = dayNumber(today);
    const scopedRows = Object.values(history.schedules).filter(row => scopeSet.has(row.wordId));
    // Daily allocation is global, even when the page changes books/chapters.
    // Otherwise selecting another scope would silently multiply the budget.
    const allRows = Object.values(history.schedules);
    const newToday = allRows.filter(row => row.firstDay === today).length;
    const reviewedToday = allRows.filter(row => row.firstDay !== today && history.touchedToday.has(row.wordId)).length;
    const remainingReview = Math.max(0, prefs.reviewLimit - reviewedToday), remainingNew = Math.max(0, prefs.newLimit - newToday);
    const dueTime = row => row.dueAt === null ? localStart(row.dueDay) : row.dueAt;
    const due = scopedRows.filter(row => !history.skipped.has(row.wordId) && (row.dueAt !== null ? row.dueAt <= now : dayNumber(row.dueDay) <= day)).sort((a, b) => dueTime(a) - dueTime(b) || a.wordId.localeCompare(b.wordId));
    // A word already allocated today may return after a failed recall without
    // taking another slot from the day's distinct-word allocation.
    const repeats = due.filter(row => history.touchedToday.has(row.wordId));
    const freshDue = due.filter(row => !history.touchedToday.has(row.wordId)).slice(0, remainingReview);
    const dueIds = [...repeats, ...freshDue].sort((a, b) => dueTime(a) - dueTime(b) || a.wordId.localeCompare(b.wordId)).map(row => row.wordId);
    const fresh = scopedIds.filter(id => !own(history.schedules, id) && !history.skipped.has(id));
    const newIds = fresh.slice(0, remainingNew);
    const tomorrow = localStart(addDays(today, 1));
    const nextTimes = scopedRows.map(row => history.skipped.has(row.wordId) ? Math.max(dueTime(row), tomorrow) : dueTime(row)).filter(at => at > now);
    if (scopedIds.some(id => history.skipped.has(id) && !own(history.schedules, id))) nextTimes.push(tomorrow);
    nextTimes.sort((a, b) => a - b);
    const plan = {day: today, wordIds: prefs.paused ? [] : [...dueIds, ...newIds], dueIds: prefs.paused ? [] : dueIds, newIds: prefs.paused ? [] : newIds,
      availableDue: due.length, availableNew: fresh.length, reviewedToday, newToday, completedToday: [...history.successfulToday].filter(id => scopeSet.has(id)).length,
      scopeNewToday: scopedRows.filter(row => row.firstDay === today).length, scopeReviewedToday: scopedRows.filter(row => row.firstDay !== today && history.touchedToday.has(row.wordId)).length,
      skippedToday: [...history.skipped].filter(id => scopeSet.has(id)).length, remainingReview, remainingNew, paused: prefs.paused, scopeCount: scopedIds.length,
      nextDueAt: nextTimes.length ? new Date(nextTimes[0]).toISOString() : null, historyFull: capacity(state).full, preferences: prefs, method: prefs.method,
      daily: dailyMetrics(state, new Date(now))};
    plan.estimatedMinutes = estimateMinutes(plan, prefs);
    return plan;
  }
  function stableHash(value) { let hash = 2166136261; for (const character of String(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
  function selectStageWords(stage, options = {}) {
    if (!object(stage)) return [];
    const candidates = [...new Set((Array.isArray(stage.wordIds) ? stage.wordIds : []).filter(safeId))];
    const outcomes = {};
    function collect(results) {
      if (Array.isArray(results)) { results.forEach(collect); return; }
      if (!object(results)) return;
      Object.keys(results).forEach(wordId => {
        if (!safeId(wordId)) return;
        const rows = Array.isArray(results[wordId]) ? results[wordId] : [results[wordId]];
        rows.forEach(row => { const outcome = typeof row === 'string' ? row : row?.outcome; if (typeof outcome === 'string') (outcomes[wordId] ||= []).push(outcome); });
      });
    }
    collect(options.results);
    const hard = id => (outcomes[id] || []).some(outcome => ['again', 'wrong', 'revealed'].includes(outcome));
    let selected = candidates;
    if (stage.selector === 'difficult') selected = selected.filter(hard);
    else if (stage.selector === 'errors') selected = selected.filter(id => (outcomes[id] || []).some(outcome => ['wrong', 'revealed'].includes(outcome)));
    else if (stage.selector === 'sample') { const seed = String(stage.id || '').replace(/-\d+$/, ''); selected = selected.slice().sort((a, b) => Number(hard(b)) - Number(hard(a)) || stableHash(`${seed}:${a}`) - stableHash(`${seed}:${b}`) || a.localeCompare(b)); }
    const offset = limit(stage.chunkOffset, 0, 10000), max = limit(stage.maxWords, candidates.length, 200);
    return selected.slice(offset, offset + max);
  }
  function buildSession(plan, options = {}) {
    if (!object(plan)) return null;
    const prefs = cleanPreferences(plan.preferences), method = methodFor(prefs.method), now = dateValue(options.now);
    const id = safeId(options.id) ? options.id : `plan-${localDay(now)}-${global.crypto?.randomUUID ? global.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
    const wordIds = [...new Set((Array.isArray(plan.wordIds) ? plan.wordIds : []).filter(safeId))];
    if (!wordIds.length || plan.paused) return null;
    const set = new Set(wordIds), newIds = [...new Set((Array.isArray(plan.newIds) ? plan.newIds : []).filter(id => set.has(id)))], newSet = new Set(newIds), dueIds = wordIds.filter(id => !newSet.has(id));
    const session = {id, day: dayNumber(plan.day) === null ? localDay(now) : plan.day, method: method.id, status: 'active', stageIndex: 0, elapsedMs: 0,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), wordIds, newIds, dueIds, targetMinutes: prefs.targetMinutes, chunkSize: prefs.chunkSize,
      preferences: {...prefs, intervals: prefs.intervals.slice(), scope: cleanScope(prefs.scope)}, stages: []};
    const prefix = id.slice(0, 100);
    function stages(phase, label, mode, ids, selector = 'all', maximum = ids.length) {
      if (!ids.length || !maximum) return;
      for (let offset = 0, group = 1; offset < maximum; offset += prefs.chunkSize, group++) {
        const size = Math.min(prefs.chunkSize, maximum - offset), dynamic = selector !== 'all';
        session.stages.push({id: `${prefix}-${phase}-${group}`, phase, label: `${label}${maximum > prefs.chunkSize ? ` · 第 ${group} 组` : ''}`, mode,
          wordIds: dynamic ? ids.slice() : ids.slice(offset, offset + size), selector, maxWords: size, chunkOffset: dynamic ? offset : 0, assisted: phase === 'retry'});
      }
    }
    if (method.id !== 'quick') stages('preview', '新词预览', 'preview', newIds);
    let main = wordIds.slice();
    if (method.id === 'quick') {
      main = []; let freshIndex = 0, dueIndex = 0;
      while (dueIndex < dueIds.length || freshIndex < newIds.length) {
        for (let count = 0; count < 4 && dueIndex < dueIds.length; count++) main.push(dueIds[dueIndex++]);
        if (freshIndex < newIds.length) main.push(newIds[freshIndex++]);
      }
    }
    stages('main', method.id === 'dictation' ? '首次听写' : method.id === 'quick' ? '交错翻卡' : '主动翻卡', method.id === 'dictation' ? 'dictation' : 'flashcard', main);
    if (method.id === 'dictation') stages('retry', '错词重练', 'dictation', wordIds, 'errors', Math.min(20, wordIds.length));
    else if (method.id === 'quick') { stages('reinforce', '难词回看', 'flashcard', wordIds, 'difficult', Math.min(25, wordIds.length)); stages('test', '听写抽查', 'dictation', wordIds, 'sample', Math.min(20, wordIds.length)); }
    else stages('reinforce', '难词听写', 'dictation', wordIds, 'difficult', Math.min(20, wordIds.length));
    session.estimatedMinutes = estimateMinutes(plan, prefs);
    session.maximumContacts = session.stages.reduce((sum, stage) => sum + stage.maxWords, 0);
    return session;
  }
  const esc = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
  function mount(target, options) {
    if (!target || typeof options?.getState !== 'function' || typeof options?.getData !== 'function') return {render() {}, destroy() {}};
    let showOptions = false, feedback = '';
    const time = () => typeof options.now === 'function' ? options.now() : new Date();
    function get() { return getPlan(options.getState(), options.getData(), {now: time(), ...(typeof options.getWordIds === 'function' ? {wordIds: options.getWordIds()} : {})}); }
    function render(force = false) {
      // Background snapshots may refresh counters elsewhere, but must not erase
      // a half-edited plan form or move its keyboard focus. User actions redraw.
      if (!force && showOptions && target.querySelector('#review-plan-options')) return;
      const plan = get(), prefs = plan.preferences;
      const nextDueLabel = plan.nextDueAt ? new Date(plan.nextDueAt).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '';
      const emptyLabel = !plan.scopeCount ? '选择章节后即可安排今日学习。' : nextDueLabel ? `下一次复习：${nextDueLabel}。现在可继续原任务。` : '当前没有待安排的词，可继续原任务或调整计划上限。';
      target.innerHTML = `<section class="review-plan" aria-labelledby="today-plan-title"><div class="review-plan-heading"><div><h2 id="today-plan-title">今日计划</h2><p>本次所选范围 · 到期词优先</p></div><button type="button" class="review-plan-options" data-review-action="options" aria-expanded="${showOptions}" aria-controls="review-plan-options">计划设置</button></div><div class="review-plan-counts"><span><strong>${plan.dueIds.length}</strong> 待复习</span><span><strong>${plan.newIds.length}</strong> 新安排</span><span class="review-plan-done">今日完成 ${plan.completedToday} 词</span></div>${plan.paused ? '<p class="review-plan-note" role="status">计划已暂停。仍可照常选择章节和学习任务。</p>' : !plan.wordIds.length ? `<p class="review-plan-note" role="status">${esc(emptyLabel)}</p>` : ''}<div class="review-plan-actions"><button type="button" class="primary-button" data-review-action="flashcard" ${!plan.wordIds.length ? 'disabled' : ''}>翻卡复习</button><button type="button" class="secondary-button" data-review-action="dictation" ${!plan.wordIds.length ? 'disabled' : ''}>听写复习</button><button type="button" class="review-plan-options" data-review-action="pause">${plan.paused ? '恢复计划' : '暂停计划'}</button></div>${plan.skippedToday ? `<p class="review-plan-note">今天已跳过 ${plan.skippedToday} 词，明天重新参与安排。</p>` : ''}${plan.historyFull ? '<p class="review-plan-warning" role="status">复习历史已接近同步容量。学习可继续；新记录暂停收集，请先在设置 → 档案导出历史。</p>' : ''}<form id="review-plan-options" class="review-plan-settings" ${showOptions ? '' : 'hidden'}><label>每日复习上限<input name="reviewLimit" type="number" min="0" max="200" step="1" value="${prefs.reviewLimit}" required></label><label>每日新安排上限<input name="newLimit" type="number" min="0" max="200" step="1" value="${prefs.newLimit}" required></label><label class="review-intervals">成功后的间隔（天）<input name="intervals" type="text" value="${esc(prefs.intervals.join(', '))}" required><small>五个递增天数；未记住时约 10 分钟后再复习。同一天重复练习不会连续升级。</small></label><p class="review-plan-note review-intervals">从启用此功能后的实际回忆开始安排；翻卡自评与听写首次作答分别记录。上限和间隔会随学习进度同步。</p><div class="review-intervals"><button type="submit" class="secondary-button">保存计划</button></div></form><p class="review-plan-feedback" role="status">${esc(feedback)}</p></section>`;
    }
    function click(event) {
      const button = event.target.closest?.('[data-review-action]');
      if (!button || !target.contains(button)) return;
      const action = button.dataset.reviewAction;
      if (action === 'options') { showOptions = !showOptions; render(true); target.querySelector('[data-review-action="options"]')?.focus(); }
      else if (action === 'pause') { const state = options.getState(); setPreferences(state, {paused: !cleanPreferences(state.reviewPreferences).paused}, time()); options.onChange?.({type: 'preferences'}); render(true); target.querySelector('[data-review-action="pause"]')?.focus(); }
      else if (['flashcard', 'dictation'].includes(action)) { const plan = get(); if (plan.wordIds.length) options.onStart?.({mode: action, wordIds: plan.wordIds.slice(), kind: 'today'}); }
    }
    function submit(event) {
      if (event.target.id !== 'review-plan-options') return;
      event.preventDefault();
      const form = event.target, values = Object.fromEntries(['reviewLimit', 'newLimit', 'intervals'].map(name => [name, form.querySelector(`[name="${name}"]`)?.value]));
      const intervals = (values.intervals || '').split(/[,，\s]+/).filter(Boolean).map(Number);
      if (!/^\d+$/.test(values.reviewLimit || '') || !/^\d+$/.test(values.newLimit || '') || Number(values.reviewLimit) > 200 || Number(values.newLimit) > 200 || intervals.length !== 5 || intervals.some((day, index) => !Number.isInteger(day) || day < 1 || day > 365 || index && day <= intervals[index - 1])) { feedback = '请输入范围内的每日上限，以及五个 1–365 之间递增的间隔天数。'; render(true); return; }
      setPreferences(options.getState(), {reviewLimit: Number(values.reviewLimit), newLimit: Number(values.newLimit), intervals}, time());
      feedback = '计划已保存。'; options.onChange?.({type: 'preferences'}); render(true); target.querySelector('[data-review-action="options"]')?.focus();
    }
    target.addEventListener('click', click); target.addEventListener('submit', submit); render();
    return {render, destroy() { target.removeEventListener('click', click); target.removeEventListener('submit', submit); target.innerHTML = ''; }};
  }
  global.OrdrumReview = {normalise, sanitiseEvents, mergeEvents, cleanScope, cleanPreferences, setPreferences, applyPreset, getMethods, capacity, record, skip, schedules, dailyMetrics, getPlan, buildDailyPlan: getPlan, estimateMinutes, buildSession, selectStageWords, mount, localDay, addDays,
    constants: {MAX_EVENTS, MAX_EVENT_BYTES, MAX_STATE_BYTES, AGAIN_MINUTES, DEFAULT_INTERVALS: DEFAULT_INTERVALS.slice()}};
})(typeof window === 'undefined' ? globalThis : window);
