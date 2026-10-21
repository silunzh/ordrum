(function (global) {
  'use strict';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
  const unique = values => Array.from(new Set(values));
  const now = () => new Date().toISOString();
  const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const time = value => Date.parse(value || '') || 0;
  const short = (value, length = 1000) => typeof value === 'string' ? value.slice(0, length) : '';
  const markStatus = value => typeof value === 'string' ? value : value?.status;
  function cleanMarks(marks, validIds) {
    const result = {};
    if (!object(marks)) return result;
    Object.entries(marks).forEach(([id, mark]) => {
      if (safeId(id) && validIds.has(id) && ['known', 'review'].includes(markStatus(mark))) {
        result[id] = {status: markStatus(mark), updated: stamp(mark?.updated) || stamp(mark?.updatedAt) || '1970-01-01T00:00:00.000Z'};
      }
    });
    return result;
  }
  function cleanErrors(errors, validIds, taskIds) {
    const result = {};
    if (!object(errors)) return result;
    Object.entries(errors).forEach(([id, value]) => {
      if (!safeId(id) || !validIds.has(id) || !object(value)) return;
      const count = Math.min(1000000000, Math.max(0, Math.floor(Number(value.count) || 0)));
      const row = {wordId: id, count, lastWrongAt: stamp(value.lastWrongAt), lastAnswer: short(value.lastAnswer), status: value.status === 'mastered' ? 'mastered' : 'pending', taskIds: unique((Array.isArray(value.taskIds) ? value.taskIds : []).filter(id => safeId(id) && (!taskIds || taskIds.has(id))))};
      const updated = stamp(value.updatedAt);
      if (updated) row.updatedAt = updated;
      result[id] = row;
    });
    return result;
  }
  function notebookCollectionIds(state, collection = 'all', reference = new Date()) {
    const records = object(state.notebook) ? state.notebook : {};
    if (!['all', 'today', 'week'].includes(collection)) {
      const members = own(state.notebookUnits || {}, collection) ? state.notebookUnits[collection]?.wordIds : [];
      return unique((Array.isArray(members) ? members : []).filter(id => safeId(id) && own(records, id)));
    }
    const current = new Date(reference);
    const until = current.getTime();
    const start = new Date(current); start.setHours(0, 0, 0, 0);
    if (collection === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    return Object.keys(records).filter(id => {
      if (!safeId(id) || !object(records[id])) return false;
      if (collection === 'all') return true;
      const wrongAt = Date.parse(records[id].lastWrongAt || '');
      return Number.isFinite(wrongAt) && wrongAt >= start.getTime() && wrongAt <= until;
    }).sort((a, b) => time(records[a].lastWrongAt) - time(records[b].lastWrongAt) || a.localeCompare(b));
  }
  function cleanNotebookUnits(units, notebook) {
    const result = {}, assigned = new Set(), usedNumbers = new Set();
    if (!object(units)) return result;
    const numberOf = unit => Math.min(1000000000, Math.max(1, Math.floor(Number(unit.number) || 1)));
    const entries = Object.entries(units).filter(([id, unit]) => safeId(id) && object(unit));
    const reservedNumbers = new Set(entries.map(([, unit]) => numberOf(unit)));
    let nextNumber = Math.max(0, ...reservedNumbers) + 1;
    entries.sort(([idA, a], [idB, b]) =>
      (Number(a.number) || 0) - (Number(b.number) || 0) || time(a.createdAt) - time(b.createdAt) || idA.localeCompare(idB)).forEach(([id, unit]) => {
      const wordIds = unique((Array.isArray(unit.wordIds) ? unit.wordIds : []).filter(wordId => safeId(wordId) && own(notebook, wordId) && !assigned.has(wordId))).slice(0, 30);
      if (!wordIds.length) return;
      wordIds.forEach(wordId => assigned.add(wordId));
      const originalNumber = numberOf(unit);
      let number = originalNumber;
      if (usedNumbers.has(number)) {
        if (nextNumber > 1000000000) nextNumber = 1;
        while (usedNumbers.has(nextNumber) || reservedNumbers.has(nextNumber)) nextNumber++;
        number = nextNumber++;
      }
      usedNumbers.add(number);
      const originalName = short(unit.name, 80).trim() || `错词单元 ${originalNumber}`;
      const name = originalName === `错词单元 ${originalNumber}` ? `错词单元 ${number}` : originalName;
      result[id] = {id, number, name, wordIds,
        source: ['today', 'week'].includes(unit.source) ? unit.source : 'all',
        createdAt: stamp(unit.createdAt) || '1970-01-01T00:00:00.000Z',
        updatedAt: stamp(unit.updatedAt) || stamp(unit.createdAt) || '1970-01-01T00:00:00.000Z'};
    });
    return result;
  }
  function notebookUnitId(wordId) {
    let first = 2166136261, second = 5381;
    for (const letter of wordId) { first = Math.imul(first ^ letter.charCodeAt(0), 16777619); second = Math.imul(second, 33) ^ letter.charCodeAt(0); }
    return `notebook-unit-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
  }
  function organiseNotebook(state, collection = 'all', reference = new Date()) {
    if (!object(state.notebook)) state.notebook = {};
    state.notebookUnits = cleanNotebookUnits(state.notebookUnits, state.notebook);
    const units = Object.values(state.notebookUnits);
    const assigned = new Set(units.flatMap(unit => unit.wordIds));
    const ids = notebookCollectionIds(state, collection, reference).filter(id => !assigned.has(id));
    const updatedAt = new Date(reference).toISOString();
    let created = 0;
    ids.forEach(wordId => {
      let unit = units.find(value => value.wordIds.length < 30);
      if (!unit) {
        const number = Math.max(0, ...units.map(value => value.number)) + 1;
        const anchor = notebookUnitId(wordId);
        let id = anchor, suffix = 1;
        while (own(state.notebookUnits, id)) id = `${anchor}-${suffix++}`;
        unit = {id, number, name: `错词单元 ${number}`, wordIds: [], source: ['today', 'week'].includes(collection) ? collection : 'all', createdAt: updatedAt, updatedAt};
        state.notebookUnits[id] = unit; units.push(unit); created++;
      }
      unit.wordIds.push(wordId); unit.updatedAt = updatedAt;
    });
    return {added: ids.length, created, total: units.length};
  }
  function mergeNotebookUnits(current, incoming, notebook) {
    const result = {...current};
    Object.entries(incoming).forEach(([id, unit]) => {
      const old = own(result, id) ? result[id] : null;
      result[id] = old ? {...(time(unit.updatedAt) > time(old.updatedAt) ? unit : old), wordIds: unique([...old.wordIds, ...unit.wordIds])} : unit;
    });
    return cleanNotebookUnits(result, notebook);
  }
  function sanitiseSession(session, validIds) {
    if (!object(session) || !Array.isArray(session.deck)) return null;
    const valid = validIds instanceof Set ? validIds : new Set(Array.isArray(validIds) ? validIds : []);
    const deck = unique(session.deck.filter(id => safeId(id) && valid.has(id)));
    if (!deck.length) return null;
    const deckIds = new Set(deck);
    const index = value => Math.min(deck.length - 1, Math.max(0, Math.floor(Number(value) || 0)));
    const answers = {};
    if (object(session.dictationAnswers)) Object.entries(session.dictationAnswers).forEach(([id, value]) => {
      if (safeId(id) && deckIds.has(id) && ['correct', 'wrong', 'revealed'].includes(value)) answers[id] = value;
    });
    const result = object(session.dictationResult) && ['correct', 'wrong', 'revealed'].includes(session.dictationResult.status)
      ? {status: session.dictationResult.status, input: short(session.dictationResult.input)} : null;
    return {
      deck, flashIndex: index(session.flashIndex), flipped: !!session.flipped,
      dictationIndex: index(session.dictationIndex), dictationResult: result, dictationAnswers: answers,
      mistakes: unique((Array.isArray(session.mistakes) ? session.mistakes : []).filter(id => safeId(id) && deckIds.has(id))),
      retryMode: !!session.retryMode, draft: short(session.draft),
      mode: ['preview', 'flashcard', 'dictation'].includes(session.mode) ? session.mode : 'preview',
      page: Math.min(10000, Math.max(1, Math.floor(Number(session.page) || 1))), search: short(session.search, 200),
      chapterIds: unique((Array.isArray(session.chapterIds) ? session.chapterIds : []).map(Number).filter(id => Number.isInteger(id) && id > 0)),
      updatedAt: stamp(session.updatedAt) || '1970-01-01T00:00:00.000Z',
    };
  }
  function cleanTaskSession(session, validIds) {
    if (object(session) && own(session, 'main')) {
      return sanitiseSession(session.main, validIds);
    }
    return sanitiseSession(session, validIds);
  }
  function cleanReview(review, validIds, taskIds, chapterIds) {
    if (!object(review)) return null;
    if (own(review, 'session')) {
      const session = sanitiseSession(review.session, validIds);
      if (!session) return null;
      return {taskId: safeId(review.taskId) && taskIds.has(review.taskId) ? review.taskId : null,
        chapterIds: unique((Array.isArray(review.chapterIds) ? review.chapterIds : []).map(Number).filter(id => chapterIds.has(id))), session};
    }
    return sanitiseSession(review, validIds);
  }
  function createTask(book, chapterIds, words, name) {
    const chapters = unique((Array.isArray(chapterIds) ? chapterIds : []).map(Number).filter(Number.isInteger));
    const chosen = new Set(chapters);
    const wordIds = unique((Array.isArray(words) ? words : []).filter(word => word && safeId(word.id) && chosen.has(Number(word.chapter))).map(word => word.id));
    const createdAt = now();
    const random = global.crypto?.randomUUID ? global.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    return {id: `task-${random}`, name: short(name, 100).trim() || `学习任务 ${new Date().toLocaleDateString('zh-CN')}`, bookId: short(book?.id, 160), chapterIds: chapters, wordIds, createdAt, updatedAt: createdAt, status: 'active', marks: {}, errors: {}, session: null};
  }
  function getTask(state, id = state.activeTaskId) {
    return (Array.isArray(state.tasks) ? state.tasks : []).find(task => task.id === id) || null;
  }
  function taskProgress(task) {
    const ids = unique(Array.isArray(task?.wordIds) ? task.wordIds : []);
    const total = ids.length;
    const studied = ids.filter(id => ['known', 'review'].includes(markStatus(task.marks?.[id]))).length;
    const known = ids.filter(id => markStatus(task.marks?.[id]) === 'known').length;
    const mistakes = ids.filter(id => task.errors?.[id]?.status === 'pending').length;
    return {studied, known, total, mistakes, percent: total ? Math.round(known / total * 100) : 0};
  }
  function normalise(state, data) {
    const validIds = new Set((data?.words || []).map(word => word.id).filter(safeId));
    const chapters = new Set((data?.chapters || []).map(chapter => Number(chapter.id)));
    const oldNotebook = object(state.notebook);
    state.marks = cleanMarks(state.marks, validIds);
    const byId = new Map();
    (Array.isArray(state.tasks) ? state.tasks : []).forEach(task => {
      if (!object(task) || !safeId(task.id) || (task.bookId && task.bookId !== data?.book?.id)) return;
      const ids = unique((Array.isArray(task.wordIds) ? task.wordIds : []).filter(id => safeId(id) && validIds.has(id)));
      const taskIds = new Set(ids);
      const clean = {id: task.id, name: short(task.name, 100).trim() || '未命名任务', bookId: data?.book?.id || short(task.bookId, 160),
        chapterIds: unique((Array.isArray(task.chapterIds) ? task.chapterIds : []).map(Number).filter(id => chapters.has(id))),
        wordIds: ids, createdAt: stamp(task.createdAt) || '1970-01-01T00:00:00.000Z', updatedAt: stamp(task.updatedAt) || stamp(task.createdAt) || '1970-01-01T00:00:00.000Z',
        status: task.status === 'archived' ? 'archived' : 'active', marks: cleanMarks(task.marks, taskIds), errors: cleanErrors(task.errors, taskIds), session: cleanTaskSession(task.session, taskIds)};
      if (!byId.has(clean.id) || time(clean.updatedAt) >= time(byId.get(clean.id).updatedAt)) byId.set(clean.id, clean);
    });
    state.tasks = Array.from(byId.values());
    const taskIds = new Set(state.tasks.map(task => task.id));
    state.notebook = cleanErrors(state.notebook, validIds, taskIds);
    if (!oldNotebook) Object.entries(state.marks).forEach(([id, mark]) => {
      if (mark.status === 'review') state.notebook[id] = {wordId: id, count: 0, lastWrongAt: null, lastAnswer: '', status: 'pending', taskIds: []};
    });
    state.notebookUnits = cleanNotebookUnits(state.notebookUnits, state.notebook);
    state.tasks.forEach(task => Object.values(task.errors).forEach(row => { row.taskIds = [task.id]; }));
    const active = getTask(state, state.activeTaskId);
    state.activeTaskId = active && active.status !== 'archived' ? active.id : null;
    state.studySession = sanitiseSession(state.studySession, validIds);
    state.reviewSession = cleanReview(state.reviewSession, validIds, taskIds, chapters);
    return state;
  }
  function recordResult(state, wordId, outcome, answer = '') {
    if (!safeId(wordId) || !['known', 'correct', 'review', 'revealed', 'wrong', 'unmarked'].includes(outcome)) return;
    if (!object(state.marks)) state.marks = {};
    if (!object(state.notebook)) state.notebook = {};
    const task = getTask(state);
    const active = task && task.wordIds.includes(wordId) ? task : null;
    const updatedAt = now();
    const known = ['known', 'correct'].includes(outcome);
    const status = known ? 'known' : 'review';
    if (outcome === 'unmarked') {
      delete state.marks[wordId];
      if (active) { delete active.marks[wordId]; active.updatedAt = updatedAt; }
      return;
    }
    state.marks[wordId] = {status, updated: updatedAt};
    if (active) { active.marks[wordId] = {status, updated: updatedAt}; active.updatedAt = updatedAt; }
    const updateError = (errors, taskId) => {
      if (known && !own(errors, wordId)) return;
      const previous = object(errors[wordId]) ? errors[wordId] : {wordId, count: 0, lastWrongAt: null, lastAnswer: '', taskIds: []};
      const row = {...previous, wordId, count: Math.max(0, Math.floor(Number(previous.count) || 0)), status: known ? 'mastered' : 'pending', updatedAt,
        taskIds: unique([...(Array.isArray(previous.taskIds) ? previous.taskIds : []).filter(safeId), ...(taskId ? [taskId] : [])])};
      if (outcome === 'wrong') { row.count++; row.lastWrongAt = updatedAt; row.lastAnswer = short(answer); }
      else if (!known && answer) row.lastAnswer = short(answer);
      errors[wordId] = row;
    };
    updateError(state.notebook, active?.id);
    if (active) updateError(active.errors, active.id);
  }
  function mergeErrorRecords(current, incoming) {
    const result = {...current};
    Object.entries(incoming).forEach(([id, row]) => {
      const old = own(result, id) ? result[id] : null;
      if (!old) { result[id] = row; return; }
      const later = time(row.updatedAt || row.lastWrongAt) >= time(old.updatedAt || old.lastWrongAt) ? row : old;
      const lastWrong = time(row.lastWrongAt) >= time(old.lastWrongAt) ? row : old;
      result[id] = {...later, count: Math.max(old.count, row.count), lastWrongAt: lastWrong.lastWrongAt, lastAnswer: lastWrong.lastAnswer, taskIds: unique([...old.taskIds, ...row.taskIds])};
    });
    return result;
  }
  function mergeMarks(current, incoming) {
    const result = {...current};
    Object.entries(incoming).forEach(([id, mark]) => {
      if (!own(result, id) || time(mark.updated) > time(result[id].updated)) result[id] = mark;
    });
    return result;
  }
  function merge(state, incoming, data) {
    normalise(state, data);
    const imported = normalise({...incoming}, data);
    const tasks = new Map(state.tasks.map(task => [task.id, task]));
    imported.tasks.forEach(task => {
      const old = tasks.get(task.id);
      if (!old) { tasks.set(task.id, task); return; }
      const latest = time(task.updatedAt) > time(old.updatedAt) ? task : old;
      const validTaskWords = new Set(latest.wordIds);
      tasks.set(task.id, {...latest,
        marks: cleanMarks(mergeMarks(old.marks, task.marks), validTaskWords),
        errors: cleanErrors(mergeErrorRecords(old.errors, task.errors), validTaskWords),
      });
    });
    state.tasks = Array.from(tasks.values());
    state.notebook = mergeErrorRecords(state.notebook, imported.notebook);
    state.notebookUnits = mergeNotebookUnits(state.notebookUnits, imported.notebookUnits, state.notebook);
    // Restore a saved location only when no current location exists; importing never discards an in-progress session.
    if (!state.studySession && imported.studySession) state.studySession = imported.studySession;
    if (!state.reviewSession && imported.reviewSession) state.reviewSession = imported.reviewSession;
    if (!state.activeTaskId && imported.activeTaskId) state.activeTaskId = imported.activeTaskId;
    return normalise(state, data);
  }
  const core = {normalise, createTask, getTask, taskProgress, recordResult, sanitiseSession, merge, notebookCollectionIds, organiseNotebook};
  global.OrdrumStudy = core;

  let taskFilter = 'active';
  const notebookFilter = {task: 'all', chapter: 'all', status: 'pending', search: '', collection: 'all'};
  let notebookPage = 1;
  const notebookSelection = new Set();
  let dialogView = null;
  const PAGE = 30;
  const query = selector => document.querySelector(selector);
  const action = (name, label, id = '', cls = 'study-small-button', accessibleName = '') => `<button type="button" class="${cls}" data-action="study-${name}"${id ? ` data-id="${esc(id)}"` : ''}${accessibleName ? ` aria-label="${esc(accessibleName)}"` : ''}>${label}</button>`;
  const pct = task => taskProgress(task);
  const dateLabel = value => stamp(value) ? new Date(value).toLocaleDateString('zh-CN') : '历史记录';
  function dialogChanged() { dialogView = null; }
  function captureDialogState() {
    const dialog = query('#app-dialog');
    if (!dialog?.open) return null;
    const active = document.activeElement;
    const focused = active && dialog.contains(active) ? {
      id: active.id, tag: active.tagName,
      data: Object.fromEntries(['action', 'id', 'value', 'studyWord'].map(key => [key, active.dataset?.[key]])),
      start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection,
    } : null;
    return {view: dialogView, focused, scrollTop: dialog.scrollTop, scrollLeft: dialog.scrollLeft};
  }
  function refreshOpenDialog(saved) {
    const dialog = query('#app-dialog');
    if (!saved || !dialog?.open || saved.view !== dialogView) return;
    if (dialogView === 'tasks') showTasks();
    else if (dialogView === 'notebook') {
      if (!['all', 'free'].includes(notebookFilter.task) && !getTask(state, notebookFilter.task)) notebookFilter.task = 'all';
      const select = query('#study-notebook-task');
      const options = [['all', '全部任务'], ['free', '自由学习'], ...(state.tasks || []).map(task => [task.id, task.name])];
      // Leave the other filter and search controls in place while results update.
      // Only rebuild task options when a task was added, renamed or removed.
      if (select && (!select.options || select.options.length !== options.length
        || options.some(([value, text], index) => select.options[index].value !== value || select.options[index].textContent !== text))) {
        select.innerHTML = options.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join('');
      }
      if (select) select.value = notebookFilter.task;
      const searchInput = query('#study-notebook-search');
      if (searchInput) notebookFilter.search = searchInput.value;
      renderNotebookResults();
    }
    const focus = saved.focused;
    let target = focus?.id ? query(`#${focus.id}`) : null;
    if (focus && !target) target = Array.from(dialog.querySelectorAll('button, input, select, textarea, a')).find(node =>
      node.tagName === focus.tag && Object.entries(focus.data).every(([key, value]) => node.dataset?.[key] === value));
    if (target && dialog.contains(target)) {
      target.focus({preventScroll: true});
      if (typeof focus.start === 'number' && typeof target.setSelectionRange === 'function') {
        try { target.setSelectionRange(focus.start, focus.end, focus.direction); } catch (_) { /* Some input types have no text selection. */ }
      }
    }
    dialog.scrollTop = saved.scrollTop;
    dialog.scrollLeft = saved.scrollLeft;
  }
  function taskBadge(task) { const p = pct(task); return task.status === 'archived' ? '已归档' : p.total && p.known === p.total ? '已完成' : '学习中'; }
  function contextRefresh() { save(); renderContext(); }
  function renderContext() {
    const holder = query('#task-context');
    if (!holder || !data) return;
    if (state.reviewSession) {
      holder.innerHTML = `<div class="study-context study-context-review"><div><span class="study-context-eyebrow">错题复习</span><strong>把不熟悉的词，再记牢一点</strong><span>复习结束后，可以返回原来的学习位置。</span></div>${action('return-study', '返回原学习进度', '', 'secondary-button')}</div>`;
      return;
    }
    const task = getTask(state);
    if (!task) { holder.innerHTML = ''; return; }
    const p = pct(task);
    holder.innerHTML = `<div class="study-context"><div class="study-context-main"><span class="study-context-eyebrow">${esc(taskBadge(task))} · 独立学习任务</span><strong>${esc(task.name)}</strong><span>已学 ${p.studied} / ${p.total} · 已掌握 ${p.known} · 待复习 ${p.mistakes}</span><div class="study-progress-track" role="progressbar" aria-label="任务掌握进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.percent}"><span style="width:${p.percent}%"></span></div></div><div class="study-context-actions">${action('tasks', '管理任务')}${action('leave-task', '返回自由学习')}</div></div>`;
  }
  function showTasks() {
    if (!data) return;
    const tasks = (state.tasks || []).filter(task => taskFilter === 'all' || task.status === taskFilter).slice().sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
    const rows = tasks.map(task => {
      const p = pct(task);
      return `<article class="study-task-card"><div class="study-task-heading"><div><span class="study-badge ${task.status === 'archived' ? 'is-muted' : ''}">${esc(taskBadge(task))}${task.id === state.activeTaskId ? ' · 当前' : ''}</span><h3>${esc(task.name)}</h3></div><span class="study-card-date">${esc(dateLabel(task.updatedAt))}</span></div><p>${task.chapterIds.length === data.chapters.length ? '全书' : `第 ${task.chapterIds.join('、')} 章`} · ${p.total} 张卡片</p><div class="study-task-stats"><span>已学 <b>${p.studied}</b></span><span>已掌握 <b>${p.known}</b></span><span>待复习 <b>${p.mistakes}</b></span><span>${p.percent}%</span></div><div class="study-progress-track"><span style="width:${p.percent}%"></span></div><div class="study-task-actions">${task.status !== 'archived' ? action('activate-task', task.session ? '继续学习' : '开始学习', task.id, 'primary-button') : action('restore-task', '恢复任务', task.id, 'secondary-button')}${action('rename-task', '重命名', task.id)}${task.status !== 'archived' ? action('archive-task', '归档', task.id) : ''}${action('reset-task', '重置进度', task.id)}${action('delete-task', '删除', task.id, 'study-small-button study-danger')}</div></article>`;
    }).join('');
    openDialog('我的学习任务', `<div class="study-dialog"><div class="study-dialog-intro"><p>每个任务单独记录学习位置和掌握进度，随时继续。</p>${action('create-task', '＋ 新建任务', '', 'primary-button')}</div><div class="study-filter-tabs" aria-label="任务筛选">${[['active', '进行中'], ['archived', '已归档'], ['all', '全部']].map(([id, text]) => `<button class="${taskFilter === id ? 'active' : ''}" data-action="study-task-filter" data-value="${id}">${text}</button>`).join('')}</div><div class="study-task-list">${rows || '<div class="study-empty">这里还没有学习任务。可以从已选章节或全书新建一个。</div>'}</div></div>`);
    dialogView = 'tasks';
  }
  function showCreateTask() {
    if (!data) return;
    const chapters = state.selectedChapters || [];
    const selected = new Set(chapters);
    const count = data.words.filter(word => selected.has(Number(word.chapter))).length;
    openDialog('新建学习任务', `<form id="study-create-form" class="study-dialog"><p>选择本次要学的内容。之后可在任务列表继续，并保留自己的进度。</p><label for="study-task-name">任务名称</label><input id="study-task-name" maxlength="100" placeholder="例如：第一周 · 第 1–3 章" required value="${esc(count ? `第 ${chapters.join('、')} 章` : '全书学习')}"><fieldset class="study-scope-options"><legend>学习范围</legend><label class="study-scope-option ${count ? '' : 'is-disabled'}"><input type="radio" name="study-scope" value="selected" ${count ? 'checked' : 'disabled'}><span><b>当前已选章节</b><small>${count ? `第 ${chapters.join('、')} 章 · ${count} 张卡片` : '请先在左侧选择章节'}</small></span></label><label class="study-scope-option"><input type="radio" name="study-scope" value="all" ${count ? '' : 'checked'}><span><b>整本书</b><small>${data.chapters.length} 章 · ${data.words.length} 张卡片</small></span></label></fieldset><div class="dialog-actions">${action('tasks', '返回任务列表', '', 'secondary-button')}<button class="primary-button" type="submit">创建并开始</button></div></form>`);
    query('#study-task-name')?.focus();
  }
  function renameTask(id) {
    const task = getTask(state, id); if (!task) return;
    openDialog('重命名任务', `<form id="study-rename-form" data-id="${esc(id)}"><label for="study-task-name">任务名称</label><input id="study-task-name" maxlength="100" required value="${esc(task.name)}"><div class="dialog-actions">${action('tasks', '取消', '', 'secondary-button')}<button class="primary-button" type="submit">保存名称</button></div></form>`);
    query('#study-task-name')?.focus();
  }
  function confirmTask(kind, id) {
    const task = getTask(state, id); if (!task) return;
    const reset = kind === 'reset';
    openDialog(reset ? '重置任务进度' : '删除学习任务', `<p>确定${reset ? '重置' : '删除'}「${esc(task.name)}」？${reset ? '此任务的掌握标记、错词记录和学习位置会清空。' : '此任务及它的学习位置会移除。'}全局错题本和其他任务会保留。</p><div class="dialog-actions">${action('tasks', '取消', '', 'secondary-button')}${action(`confirm-${kind}`, reset ? '确认重置' : '确认删除', id, 'primary-button study-danger-solid')}</div>`);
  }
  function notebookUnits() {
    return Object.values(state.notebookUnits || {}).sort((a, b) => a.number - b.number || time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
  }
  function notebookCollectionLabel(collection) {
    return {all: '全部错词', today: '今天错词', week: '本周错词'}[collection] || state.notebookUnits?.[collection]?.name || '全部错词';
  }
  function notebookCollectionOptions() {
    return [['all', '全部错词'], ['today', '今天错词'], ['week', '本周错词'], ...notebookUnits().map(unit => [unit.id, unit.name])];
  }
  function refreshNotebookCollections() {
    if (!['all', 'today', 'week'].includes(notebookFilter.collection) && !own(state.notebookUnits || {}, notebookFilter.collection)) notebookFilter.collection = 'all';
    const select = query('#study-notebook-collection');
    const options = notebookCollectionOptions();
    if (select && (!select.options || select.options.length !== options.length
      || options.some(([value, text], index) => select.options[index].value !== value || select.options[index].textContent !== text))) {
      select.innerHTML = options.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join('');
    }
    if (select) select.value = notebookFilter.collection;
  }
  function renderNotebookShelf() {
    const holder = query('#notebook-shelf'); if (!holder || !data) return;
    const all = notebookCollectionIds(state), today = notebookCollectionIds(state, 'today'), week = notebookCollectionIds(state, 'week');
    const pending = all.filter(id => state.notebook[id].status === 'pending').length;
    const units = notebookUnits();
    holder.innerHTML = `<div class="notebook-shelf-summary"><span>${all.length} 个错词 · ${pending} 个待复习</span></div><div class="notebook-shelf-collections">${[['all', '全部错词', all], ['today', '今天错词', today], ['week', '本周错词', week]].map(([id, label, ids]) => `<button type="button" class="notebook-shelf-item" data-action="study-notebook-open" data-id="${id}"><span>${label}</span><span class="notebook-shelf-count">${ids.length}</span></button>`).join('')}</div>${units.length ? `<div class="notebook-shelf-units">${units.map(unit => `<button type="button" class="notebook-shelf-item notebook-shelf-unit" data-action="study-notebook-open" data-id="${esc(unit.id)}"><span>${esc(unit.name)}</span><span class="notebook-shelf-count">${unit.wordIds.length} / 30</span></button>`).join('')}</div>` : '<p class="notebook-shelf-hint">打开错题本，按每 30 词整理成单元。</p>'}`;
  }
  function notebookRows() {
    const words = new Map(data.words.map(word => [word.id, word]));
    const collection = new Set(notebookCollectionIds(state, notebookFilter.collection));
    const needle = notebookFilter.search.normalize('NFC').toLocaleLowerCase('sv').trim();
    return Object.values(state.notebook || {}).filter(row => {
      const word = words.get(row.wordId); if (!word) return false;
      if (!collection.has(row.wordId)) return false;
      if (notebookFilter.status !== 'all' && row.status !== notebookFilter.status) return false;
      if (notebookFilter.task === 'free' && row.taskIds.length) return false;
      if (!['all', 'free'].includes(notebookFilter.task) && !row.taskIds.includes(notebookFilter.task)) return false;
      if (notebookFilter.chapter !== 'all' && Number(word.chapter) !== Number(notebookFilter.chapter)) return false;
      const override = state.overrides?.[word.id];
      const enriched = override ? {...word, ...override, id: word.id, swedish: word.swedish, chapter: word.chapter} : word;
      if (needle && !`${word.swedish} ${enriched.english || ''} ${row.lastAnswer || ''}`.normalize('NFC').toLocaleLowerCase('sv').includes(needle)) return false;
      return {row, word: enriched};
    }).map(row => {
      const word = words.get(row.wordId), override = state.overrides?.[row.wordId];
      return {row, word: override ? {...word, ...override, id: word.id, swedish: word.swedish, chapter: word.chapter} : word};
    }).sort((a, b) => (a.row.status === b.row.status ? 0 : a.row.status === 'pending' ? -1 : 1) || time(b.row.lastWrongAt) - time(a.row.lastWrongAt) || b.row.count - a.row.count);
  }
  function showNotebook(options) {
    if (!data) return;
    if (options && typeof options === 'object') {
      notebookFilter.collection = options.unitId || options.collection || 'all';
      notebookFilter.status = 'all'; notebookFilter.task = 'all'; notebookFilter.chapter = 'all'; notebookFilter.search = '';
    }
    if (!['all', 'today', 'week'].includes(notebookFilter.collection) && !own(state.notebookUnits || {}, notebookFilter.collection)) notebookFilter.collection = 'all';
    if (!['all', 'free'].includes(notebookFilter.task) && !getTask(state, notebookFilter.task)) notebookFilter.task = 'all';
    if (notebookFilter.chapter !== 'all' && !data.chapters.some(chapter => Number(chapter.id) === Number(notebookFilter.chapter))) notebookFilter.chapter = 'all';
    notebookSelection.clear(); notebookPage = 1;
    openDialog('错题本', `<div class="study-dialog">
      <p id="study-notebook-summary"></p>
      <div class="study-notebook-organize"><div><strong>整理错词单元</strong><p>每单元最多 30 词；已分组的词保留原单元。</p></div><div class="study-organize-actions">${action('notebook-organize', '整理今天错词', 'today')}${action('notebook-organize', '整理本周错词', 'week')}${action('notebook-organize', '整理全部错词', 'all')}</div></div>
      <div class="study-notebook-collection-bar"><label>分类<select id="study-notebook-collection">${notebookCollectionOptions().map(([id, label]) => `<option value="${esc(id)}" ${notebookFilter.collection === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>${action('notebook-retry-list', '重练当前列表', '', 'secondary-button')}</div>
      <p class="study-notebook-date-hint">按本机日期和最近答错时间分类，周一开始。无日期记录见“全部错词”；已掌握的错词仍可查看。</p>
      <div class="study-notebook-filters"><label>任务<select id="study-notebook-task"><option value="all">全部任务</option><option value="free">自由学习</option>${(state.tasks || []).map(task => `<option value="${esc(task.id)}" ${notebookFilter.task === task.id ? 'selected' : ''}>${esc(task.name)}</option>`).join('')}</select></label><label>章节<select id="study-notebook-chapter"><option value="all">全部章节</option>${data.chapters.map(chapter => `<option value="${Number(chapter.id)}" ${Number(notebookFilter.chapter) === Number(chapter.id) ? 'selected' : ''}>第 ${Number(chapter.id)} 章</option>`).join('')}</select></label><label>状态<select id="study-notebook-status">${[['pending', '待复习'], ['mastered', '已掌握'], ['all', '全部状态']].map(([id, text]) => `<option value="${id}" ${notebookFilter.status === id ? 'selected' : ''}>${text}</option>`).join('')}</select></label></div>
      <label class="sr-only" for="study-notebook-search">搜索错题本</label><input id="study-notebook-search" type="search" placeholder="搜索瑞典语、英文或上次答案…" value="${esc(notebookFilter.search)}"><div id="study-notebook-results"></div></div>`);
    query('#study-notebook-task').value = notebookFilter.task;
    query('#study-notebook-chapter').value = notebookFilter.chapter;
    renderNotebookResults();
    dialogView = 'notebook';
  }
  function renderNotebookResults() {
    const holder = query('#study-notebook-results'); if (!holder) return;
    refreshNotebookCollections();
    const summary = query('#study-notebook-summary');
    const records = Object.values(state.notebook || {});
    if (summary) summary.textContent = `共 ${records.length} 个词条，${records.filter(row => row.status === 'pending').length} 个待复习。当前：${notebookCollectionLabel(notebookFilter.collection)}。`;
    const rows = notebookRows();
    const retry = query('[data-action="study-notebook-retry-list"]'); if (retry) retry.disabled = !rows.length;
    const visibleIds = new Set(rows.map(({row}) => row.wordId));
    Array.from(notebookSelection).forEach(id => { if (!visibleIds.has(id)) notebookSelection.delete(id); });
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    notebookPage = Math.min(pages, notebookPage);
    const visible = rows.slice((notebookPage - 1) * PAGE, notebookPage * PAGE);
    holder.innerHTML = `<div class="study-batch-bar"><label class="study-checkbox"><input type="checkbox" id="study-notebook-select-all" ${rows.length && rows.every(({row}) => notebookSelection.has(row.wordId)) ? 'checked' : ''} ${rows.length ? '' : 'disabled'}>全选筛选结果 <span>(${rows.length})</span></label><span>已选 ${notebookSelection.size}</span><div>${action('notebook-retry', '重练所选')}${action('notebook-mastered', '标为掌握')}${action('notebook-delete', '删除', '', 'study-small-button study-danger')}</div></div><div class="study-notebook-list">${visible.map(({row, word}) => `<article class="study-notebook-row"><label class="study-checkbox study-word-check"><input type="checkbox" data-study-word="${esc(row.wordId)}" ${notebookSelection.has(row.wordId) ? 'checked' : ''}><span class="sr-only">选择 ${esc(word.swedish)}</span></label><div class="study-notebook-word"><div class="study-notebook-word-heading"><strong lang="sv">${esc(word.swedish)}</strong>${action('speak-word', icon('sound'), word.id, 'sound-button', `听读 ${word.swedish}`)}</div><p lang="en">${esc(word.english || '释义待补充')}</p><div class="study-notebook-meta"><span>第 ${word.chapter} 章</span><span>答错 ${row.count} 次</span><span class="study-badge ${row.status === 'mastered' ? 'is-muted' : ''}">${row.status === 'mastered' ? '已掌握' : '待复习'}</span></div>${row.lastAnswer ? `<p class="study-last-answer">上次输入：<span lang="sv">${esc(row.lastAnswer)}</span></p>` : ''}</div></article>`).join('') || '<div class="study-empty">没有符合筛选条件的词条。继续学习时，答错和标记待复习的词会保存在这里。</div>'}</div><div class="study-notebook-bottom"><span>${rows.length ? `第 ${(notebookPage - 1) * PAGE + 1}–${Math.min(notebookPage * PAGE, rows.length)} 项，共 ${rows.length} 项` : '暂无词条'}</span><div>${action('notebook-prev', '上一页')}${notebookPage} / ${pages}${action('notebook-next', '下一页')}</div></div>`;
    const prev = holder.querySelector('[data-action="study-notebook-prev"]'), next = holder.querySelector('[data-action="study-notebook-next"]');
    if (prev) prev.disabled = notebookPage <= 1;
    if (next) next.disabled = notebookPage >= pages;
    holder.querySelectorAll('[data-action="study-notebook-retry"],[data-action="study-notebook-mastered"],[data-action="study-notebook-delete"]').forEach(button => { button.disabled = !notebookSelection.size; });
  }
  function selectedNotebookIds() { return Array.from(notebookSelection).filter(id => own(state.notebook || {}, id)); }
  function organiseNotebookCollection(collection) {
    const result = organiseNotebook(state, collection);
    if (result.added) { save(); renderNotebookShelf(); }
    renderNotebookResults();
    notify(result.added ? `已整理 ${result.added} 个错词，新增 ${result.created} 个单元。` : `${notebookCollectionLabel(collection)}没有尚未分组的词。`);
  }
  function notebookBatch(kind) {
    const ids = selectedNotebookIds(); if (!ids.length) { notify('先选择要操作的词条。'); return; }
    if (kind === 'retry') {
      closeDialog();
      startNotebookReview(ids, ['all', 'free'].includes(notebookFilter.task) ? null : notebookFilter.task);
      return;
    }
    if (kind === 'delete') {
      openDialog('删除错题记录', `<p>确定从错题本删除这 ${ids.length} 个词条？相关任务的错词记录会同时移除，掌握标记和学习位置会保留。</p><div class="dialog-actions">${action('notebook', '取消', '', 'secondary-button')}${action('notebook-confirm-delete', '确认删除', '', 'primary-button study-danger-solid')}</div>`);
      return;
    }
    updateNotebook(ids, 'mastered');
    renderNotebookResults();
  }
  function updateNotebook(ids, kind) {
    const updatedAt = now();
    ids.forEach(id => {
      if (kind === 'delete') delete state.notebook[id];
      else if (state.notebook[id]) {
        state.notebook[id].status = 'mastered'; state.notebook[id].updatedAt = updatedAt;
        if (!object(state.marks)) state.marks = {};
        state.marks[id] = {status: 'known', updated: updatedAt};
      }
      (state.tasks || []).forEach(task => {
        if (!task.errors?.[id]) return;
        if (kind === 'delete') delete task.errors[id];
        else {
          task.errors[id].status = 'mastered'; task.errors[id].updatedAt = updatedAt;
          if (!object(task.marks)) task.marks = {};
          task.marks[id] = {status: 'known', updated: updatedAt};
        }
        task.updatedAt = updatedAt;
      });
    });
    state.notebookUnits = cleanNotebookUnits(state.notebookUnits, state.notebook);
    notebookSelection.clear(); contextRefresh();
    if (typeof renderSummary === 'function') renderSummary();
    if (typeof renderMode === 'function') renderMode({autoplay: false});
    notify(kind === 'delete' ? '所选词条已从错题本移除。' : '所选错题已标为掌握。');
  }
  global.OrdrumStudyUI = {showTasks, showCreateTask, showNotebook, renderContext, renderNotebookShelf, dialogChanged, captureDialogState, refreshOpenDialog};
  if (typeof document === 'undefined' || !document.addEventListener) return;
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-action]');
    if (!button || button.disabled || !button.dataset.action?.startsWith('study-') || !data) return;
    const id = button.dataset.id;
    const task = id ? getTask(state, id) : null;
    switch (button.dataset.action.slice(6)) {
      case 'tasks': showTasks(); break;
      case 'create-task': showCreateTask(); break;
      case 'notebook': showNotebook(); break;
      case 'notebook-open': showNotebook({collection: id}); break;
      case 'notebook-organize': organiseNotebookCollection(['today', 'week'].includes(id) ? id : 'all'); break;
      case 'notebook-retry-list': {
        const ids = notebookRows().map(({row}) => row.wordId);
        if (ids.length) { closeDialog(); startNotebookReview(ids, ['all', 'free'].includes(notebookFilter.task) ? null : notebookFilter.task); }
        break;
      }
      case 'task-filter': taskFilter = button.dataset.value; showTasks(); break;
      case 'activate-task': if (task) { closeDialog(); activateStudyTask(id); } break;
      case 'leave-task': leaveStudyTask(); break;
      case 'return-study': returnToStudy(); break;
      case 'rename-task': renameTask(id); break;
      case 'archive-task': if (task) { if (state.activeTaskId === id) leaveStudyTask(); task.status = 'archived'; task.updatedAt = now(); contextRefresh(); showTasks(); } break;
      case 'restore-task': if (task) { task.status = 'active'; task.updatedAt = now(); contextRefresh(); showTasks(); } break;
      case 'reset-task': confirmTask('reset', id); break;
      case 'delete-task': confirmTask('delete', id); break;
      case 'confirm-reset': resetStudyTask(id); showTasks(); break;
      case 'confirm-delete': deleteStudyTask(id); showTasks(); break;
      case 'notebook-retry': notebookBatch('retry'); break;
      case 'notebook-mastered': notebookBatch('mastered'); break;
      case 'notebook-delete': notebookBatch('delete'); break;
      case 'notebook-confirm-delete': updateNotebook(selectedNotebookIds(), 'delete'); showNotebook(); break;
      case 'notebook-prev': notebookPage--; renderNotebookResults(); break;
      case 'notebook-next': notebookPage++; renderNotebookResults(); break;
      case 'speak-word': { const word = data.words.find(word => word.id === id); if (word && typeof speak === 'function') speak(word.swedish); break; }
    }
  });
  document.addEventListener('submit', event => {
    if (!['study-create-form', 'study-rename-form'].includes(event.target.id) || !data) return;
    event.preventDefault();
    const name = query('#study-task-name').value.trim();
    if (!name) { query('#study-task-name').focus(); return; }
    if (event.target.id === 'study-create-form') {
      const scope = query('input[name="study-scope"]:checked')?.value;
      const chapters = scope === 'all' ? data.chapters.map(chapter => Number(chapter.id)) : state.selectedChapters || [];
      const task = createTask(data.book, chapters, data.words, name);
      if (!task.wordIds.length) { notify('请先选择至少一个章节。'); return; }
      if (!Array.isArray(state.tasks)) state.tasks = [];
      state.tasks.push(task); save(); closeDialog(); activateStudyTask(task.id);
    } else {
      const task = getTask(state, event.target.dataset.id); if (!task) return;
      task.name = name.slice(0, 100); task.updatedAt = now(); contextRefresh(); showTasks();
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id !== 'study-notebook-search' || !data) return;
    notebookFilter.search = event.target.value; notebookPage = 1; renderNotebookResults();
  });
  document.addEventListener('change', event => {
    if (!data) return;
    const target = event.target;
    const filters = {'study-notebook-task': 'task', 'study-notebook-chapter': 'chapter', 'study-notebook-status': 'status', 'study-notebook-collection': 'collection'};
    if (filters[target.id]) { notebookFilter[filters[target.id]] = target.value; notebookPage = 1; renderNotebookResults(); }
    if (target.id === 'study-notebook-select-all') {
      notebookRows().forEach(({row}) => { if (target.checked) notebookSelection.add(row.wordId); else notebookSelection.delete(row.wordId); });
      renderNotebookResults();
    } else if (target.dataset.studyWord) {
      if (target.checked) notebookSelection.add(target.dataset.studyWord); else notebookSelection.delete(target.dataset.studyWord);
      renderNotebookResults();
    }
  });
})(typeof window === 'undefined' ? globalThis : window);
