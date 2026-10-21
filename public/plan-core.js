(function (global) {
  'use strict';
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const own = (value, key) => object(value) && Object.prototype.hasOwnProperty.call(value, key);
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  const modeOutcomes = {preview: ['seen', 'skip'], flashcard: ['known', 'again', 'skip'], dictation: ['correct', 'wrong', 'revealed', 'skip']};
  const stamp = value => { if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
  const count = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isFinite(Number(value)) ? Math.min(maximum, Math.max(0, Math.floor(Number(value)))) : 0;
  const ids = (value, valid, maximum = 400) => [...new Set((Array.isArray(value) ? value : []).filter(id => safeId(id) && (!valid || valid.has(id))))].slice(0, maximum);
  function day(value, fallback) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value) return value;
    return (stamp(fallback) || '1970-01-01T00:00:00.000Z').slice(0, 10);
  }
  function fallbackScope(value, valid) {
    const scope = object(value) ? value : {};
    const result = global.OrdrumReview?.cleanScope ? global.OrdrumReview.cleanScope(scope) : {
      kind: ['selected', 'book', 'chapters', 'notebook'].includes(scope.kind) ? scope.kind : 'selected',
      chapterIds: [...new Set((Array.isArray(scope.chapterIds) ? scope.chapterIds : []).filter(id => Number.isInteger(id) && id >= 1 && id <= 1000))].sort((a, b) => a - b).slice(0, 200),
      notebookChapterIds: ids(scope.notebookChapterIds, null, 1000)
    };
    if (Array.isArray(scope.wordIds)) result.wordIds = ids(scope.wordIds, valid);
    if (scope.bookId === '__notebook__' || safeId(scope.bookId)) result.bookId = scope.bookId;
    if (typeof scope.label === 'string') result.label = scope.label.slice(0, 200);
    return result;
  }
  function cleanRecord(key, input, valid) {
    if (!safeId(key) || !object(input) || input.id !== key) return null;
    const wordIds = ids(input.wordIds, valid);
    if (!wordIds.length || !Array.isArray(input.stages)) return null;
    const wordSet = new Set(wordIds), stages = [], stageIds = new Set();
    input.stages.forEach(value => {
      if (!object(value) || !safeId(value.id) || stageIds.has(value.id) || !['preview', 'flashcard', 'dictation'].includes(value.mode)) return;
      stageIds.add(value.id);
      stages.push({id: value.id, phase: ['preview', 'main', 'retry', 'reinforce', 'test'].includes(value.phase) ? value.phase : value.mode === 'preview' ? 'preview' : 'main',
        label: typeof value.label === 'string' ? value.label.slice(0, 200) : '学习分组', mode: value.mode, wordIds: ids(value.wordIds, wordSet),
        selector: ['all', 'difficult', 'errors', 'sample'].includes(value.selector) ? value.selector : 'all', maxWords: Math.min(25, Math.max(1, count(value.maxWords || value.wordIds?.length || input.chunkSize || 20, 25))),
        chunkOffset: count(value.chunkOffset, 400), assisted: value.assisted === true || value.phase === 'retry'});
    });
    if (!stages.length) return null;
    const createdAt = stamp(input.createdAt) || stamp(input.updatedAt) || '1970-01-01T00:00:00.000Z';
    const row = {id: key, day: day(input.day, createdAt), method: ['recall', 'dictation', 'quick'].includes(input.method) ? input.method : 'recall', status: 'active', stageIndex: 0,
      elapsedMs: count(input.elapsedMs), createdAt, updatedAt: stamp(input.updatedAt) || createdAt,
      wordIds, newIds: ids(input.newIds, wordSet), dueIds: ids(input.dueIds, wordSet), targetMinutes: Math.max(10, Math.min(180, count(input.targetMinutes || 60))), chunkSize: Math.max(10, Math.min(25, count(input.chunkSize || 20))),
      scope: fallbackScope(input.scope, wordSet), stages, results: {}, resolvedStages: {}, stageSessions: {}, completedStages: {}, estimatedMinutes: count(input.estimatedMinutes, 10000), maximumContacts: count(input.maximumContacts, 100000)};
    if (global.OrdrumReview?.cleanPreferences) row.preferences = global.OrdrumReview.cleanPreferences(input.preferences);
    else {
      const prefs = object(input.preferences) ? input.preferences : {}, intervals = prefs.intervals;
      row.preferences = {method: row.method, targetMinutes: row.targetMinutes, chunkSize: row.chunkSize, reviewLimit: count(prefs.reviewLimit, 200), newLimit: count(prefs.newLimit, 200),
        intervals: Array.isArray(intervals) && intervals.length === 5 && intervals.every((value, index) => Number.isInteger(value) && value >= 1 && value <= 365 && (!index || value > intervals[index - 1])) ? intervals.slice() : [1, 3, 7, 14, 30],
        scope: fallbackScope(prefs.scope, wordSet), paused: prefs.paused === true, updatedAt: stamp(prefs.updatedAt) || '1970-01-01T00:00:00.000Z'};
    }
    stages.forEach(stage => {
      const candidateSet = new Set(stage.wordIds);
      // A single device selects at most maxWords. A legitimate concurrent
      // merge can contain both frozen selections; retain every candidate and
      // its first answer rather than silently truncating the second device.
      if (own(input.resolvedStages, stage.id) && Array.isArray(input.resolvedStages[stage.id])) row.resolvedStages[stage.id] = ids(input.resolvedStages[stage.id], candidateSet);
      const actual = new Set(own(row.resolvedStages, stage.id) ? row.resolvedStages[stage.id] : stage.wordIds);
      if (object(input.results?.[stage.id])) {
        const answers = {};
        Object.keys(input.results[stage.id]).sort().forEach(wordId => {
          const answer = input.results[stage.id][wordId];
          if (!safeId(wordId) || !actual.has(wordId) || !object(answer) || !modeOutcomes[stage.mode].includes(answer.outcome)) return;
          const at = stamp(answer.at);
          if (at) answers[wordId] = {outcome: answer.outcome, at};
        });
        row.results[stage.id] = answers;
      }
      if (input.completedStages?.[stage.id] === true) row.completedStages[stage.id] = true;
      if (object(input.stageSessions?.[stage.id]) && typeof global.OrdrumStudy?.sanitiseSession === 'function') {
        const checkpoint = global.OrdrumStudy.sanitiseSession(input.stageSessions[stage.id], actual);
        if (checkpoint) row.stageSessions[stage.id] = checkpoint;
      }
    });
    while (row.stageIndex < stages.length && row.completedStages[stages[row.stageIndex].id] === true) row.stageIndex++;
    row.status = row.stageIndex === stages.length ? 'completed' : input.status === 'ended' ? 'ended' : input.status === 'paused' ? 'paused' : 'active';
    ['endedAt', 'completedAt', 'pausedAt'].forEach(key => { const value = stamp(input[key]); if (value) row[key] = value; });
    return row;
  }
  function normalise(state, data) {
    if (!object(state)) return state;
    const valid = Array.isArray(data?.words) ? new Set(data.words.map(word => word?.id).filter(safeId)) : null, sessions = {};
    if (object(state.planSessions)) Object.keys(state.planSessions).sort().forEach(id => { const row = cleanRecord(id, state.planSessions[id], valid); if (row) sessions[id] = row; });
    // There is no age/count eviction. A valid completed or offline plan remains
    // recoverable; the shared snapshot capacity controls future writes.
    state.planSessions = sessions;
    state.activePlanId = safeId(state.activePlanId) && own(sessions, state.activePlanId) ? state.activePlanId : null;
    return state;
  }
  function decorate(record) {
    if (!object(record)) return null;
    const row = copy(record), stages = Array.isArray(row.stages) ? row.stages : [];
    let index = 0;
    while (index < stages.length && row.completedStages?.[stages[index].id] === true) index++;
    row.stageIndex = index;
    if (stages.length && index === stages.length) row.status = 'completed';
    else if (row.status === 'completed') row.status = 'active';
    const stage = stages[index];
    const contacted = new Set(), answered = new Set(), known = new Set(), skipped = new Set(), revealed = new Set(), first = new Map();
    stages.forEach((item, stageIndex) => {
      const valid = new Set(own(row.resolvedStages, item.id) ? row.resolvedStages[item.id] : item.wordIds || []);
      Object.entries(object(row.results?.[item.id]) ? row.results[item.id] : {}).forEach(([wordId, result]) => {
        if (!valid.has(wordId) || !modeOutcomes[item.mode]?.includes(result?.outcome)) return;
        const outcome = result.outcome;
        if (outcome === 'skip') skipped.add(wordId);
        else contacted.add(wordId);
        if (!['seen', 'skip'].includes(outcome)) answered.add(wordId);
        if (item.mode === 'flashcard' && outcome === 'known') known.add(wordId);
        if (outcome === 'revealed') revealed.add(wordId);
        if (item.mode !== 'dictation' || item.assisted || item.phase === 'retry' || !['correct', 'wrong', 'revealed'].includes(outcome)) return;
        const at = stamp(result.at) || '9999-12-31T23:59:59.999Z', previous = first.get(wordId), candidate = {outcome, at, stageIndex};
        if (!previous || at < previous.at || at === previous.at && stageIndex < previous.stageIndex) first.set(wordId, candidate);
      });
    });
    row.currentWordIds = stage ? (own(row.resolvedStages, stage.id) ? row.resolvedStages[stage.id].slice() : stage.selector === 'all' || !stage.selector ? (stage.wordIds || []).slice() : []) : [];
    const currentResults = object(row.results?.[stage?.id]) ? row.results[stage.id] : {}, stageDone = row.currentWordIds.filter(id => modeOutcomes[stage.mode]?.includes(currentResults[id]?.outcome)).length;
    row.progress = {total: new Set(row.wordIds || []).size, contacted: contacted.size, answered: answered.size, known: known.size,
      correct: [...first.values()].filter(value => value.outcome === 'correct').length, wrong: [...first.values()].filter(value => value.outcome === 'wrong').length, revealed: revealed.size, skipped: skipped.size,
      stageDone, stageTotal: row.currentWordIds.length, stagesDone: stages.filter(value => row.completedStages?.[value.id] === true).length, stagesTotal: stages.length, elapsedMs: count(row.elapsedMs)};
    row.canAdvance = !!stage && (stage.mode === 'preview' || (stage.selector === 'all' || !stage.selector || own(row.resolvedStages, stage.id)) && row.currentWordIds.every(id => modeOutcomes[stage.mode]?.includes(currentResults[id]?.outcome)));
    return row;
  }
  global.OrdrumPlanCore = {normalise, decorate, cleanRecord};
})(typeof window === 'undefined' ? globalThis : window);
