'use strict';

let dictationDraft = '';

function activeStudyTask() {
  return StudyCore.getTask(state);
}
function captureStudySession() {
  if (!data) return;
  const session = {
    chapterIds:state.selectedChapters || [], mode:state.mode, deck:[...currentDeck],
    flashIndex, flipped, dictationIndex, dictationResult,
    dictationAnswers:{...dictationAnswers}, mistakes:[...mistakes],
    retryMode, draft:dictationDraft, page, search,
    reviewSessionId, bookId:state.selectedBook || data.book.id,
    notebookChapterIds:state.selectedNotebookChapters || ['all'],
    ...(planKind === 'today' ? {planKind:'today'} : {}),
  };
  if (isPlanPractice()) { capturePlanCheckpoint(session); return; }
  const task = activeStudyTask();
  const previous = retryMode ? state.reviewSession?.session : task ? task.session : state.studySession;
  const comparison = previous ? {...previous} : null;
  if (comparison) delete comparison.updatedAt;
  const unchanged = comparison && (window.OrdrumCloud?.equal ? window.OrdrumCloud.equal(comparison,session) : JSON.stringify(comparison) === JSON.stringify(session));
  session.updatedAt = unchanged ? previous.updatedAt || '1970-01-01T00:00:00.000Z' : new Date().toISOString();
  if (retryMode) {
    state.reviewSession = {taskId:task?.id || null,chapterIds:session.chapterIds,session};
  } else if (task) {
    task.session = session;
    if (!unchanged) task.updatedAt = session.updatedAt;
  } else {
    state.studySession = session;
  }
}
function restoreStudySession(saved) {
  const validIds = new Set(data.words.map(word => word.id));
  const session = StudyCore.sanitiseSession(saved,validIds);
  if (!session || !session.deck.length) return false;
  const task = activeStudyTask();
  if (!task && session.bookId) {
    state.selectedBook = session.bookId === '__notebook__' ? '__notebook__' : data.book.id;
    if (state.selectedBook === '__notebook__' && session.notebookChapterIds) state.selectedNotebookChapters = StudyCore.notebookChapterSelection({...state,selectedNotebookChapters:session.notebookChapterIds});
  }
  const chapters = new Set(data.chapters.map(chapter => Number(chapter.id)));
  if (!task && state.selectedBook !== '__notebook__' && session.chapterIds?.length) {
    state.selectedChapters = session.chapterIds.filter(id => chapters.has(Number(id)));
  }
  const allowed = new Set(task ? task.wordIds : state.selectedBook === '__notebook__' ? StudyCore.notebookSelectedIds(state) : data.words.filter(word => state.selectedChapters.includes(Number(word.chapter))).map(word => word.id));
  // A notebook round can include words outside the current task's main scope.
  const deck = session.deck.filter(id => session.retryMode || allowed.has(id));
  if (!deck.length) return false;
  currentDeck = deck;
  flashIndex = Math.max(0,Math.min(session.flashIndex,deck.length-1));
  dictationIndex = Math.max(0,Math.min(session.dictationIndex,deck.length-1));
  flipped = session.flipped;
  dictationResult = session.dictationResult;
  dictationAnswers = session.dictationAnswers;
  mistakes = new Set(session.mistakes);
  retryMode = session.retryMode;
  dictationDraft = session.draft;
  state.mode = session.mode;
  page = session.page;
  search = session.search;
  reviewSessionId = session.reviewSessionId || newReviewSessionId();
  planKind = session.planKind || '';
  return true;
}
function recordStudyResult(wordId,outcome,answer = '') {
  StudyCore.recordResult(isPlanPractice() ? {...state,activeTaskId:null} : state,wordId,outcome,answer);
  save();
  renderSummary();
}
function refreshStudyView({autoplay = true} = {}) {
  save(); renderChapters(); renderSummary(); renderMode({autoplay});
}
function activateStudyTask(id) {
  const task = StudyCore.getTask(state,id);
  if (!task) return;
  save();
  state.activeTaskId = task.id;
  state.reviewSession = null;
  selectTaskBook(task);
  task.status = 'active';
  if (!restoreStudySession(task.session)) {
    resetDeck(); state.mode = 'flashcard';
  }
  closeDialog(); stopAudio(); refreshStudyView();
}
function leaveStudyTask() {
  save();
  state.activeTaskId = null;
  state.reviewSession = null;
  if (!restoreStudySession(state.studySession)) resetDeck();
  closeDialog(); stopAudio(); refreshStudyView();
}
function resetStudyTask(id) {
  const task = StudyCore.getTask(state,id);
  if (!task) return;
  task.marks = {}; task.errors = {}; task.session = null;
  task.updatedAt = new Date().toISOString(); task.status = 'active';
  if (state.reviewSession?.taskId === id) state.reviewSession = null;
  if (state.activeTaskId === id) {
    selectTaskBook(task);
    resetDeck(); state.mode = 'flashcard';
    closeDialog(); stopAudio(); refreshStudyView();
  } else {
    save(); window.OrdrumStudyUI.showTasks();
  }
  notify('任务进度已重置，错题本中的历史记录仍保留。');
}
function deleteStudyTask(id) {
  if (state.activeTaskId === id) leaveStudyTask();
  state.tasks = state.tasks.filter(task => task.id !== id);
  Object.values(state.notebook).forEach(record => { record.taskIds = record.taskIds.filter(taskId => taskId !== id); });
  if (state.reviewSession?.taskId === id) state.reviewSession = null;
  save(); window.OrdrumStudyUI.renderContext(); window.OrdrumStudyUI.showTasks();
  notify('任务已删除，错题本中的单词记录仍保留。');
}
function startNotebookReview(ids,taskId = null,options = {}) {
  const validIds = new Set(data.words.map(word => word.id));
  const deck = [...new Set(ids)].filter(id => validIds.has(id));
  if (!deck.length) { notify('先选择需要练习的单词。'); return; }
  save();
  if (taskId && StudyCore.getTask(state,taskId)) {
    state.activeTaskId = taskId;
    selectTaskBook(activeStudyTask());
  } else if (!activeStudyTask()) {
    state.selectedChapters = [...new Set(data.words.filter(word => deck.includes(word.id)).map(word => Number(word.chapter)))];
  }
  currentDeck = deck; flashIndex = 0; flipped = false;
  dictationIndex = 0; dictationResult = null; dictationDraft = '';
  dictationAnswers = {}; mistakes = new Set(); retryMode = true;
  reviewSessionId = newReviewSessionId(); planKind = options.kind === 'today' ? 'today' : '';
  state.mode = options.mode === 'flashcard' ? 'flashcard' : 'dictation'; page = 1; search = '';
  closeDialog(); stopAudio(); refreshStudyView();
}
function returnToStudy() {
  const task = activeStudyTask();
  state.reviewSession = null;
  const session = task?.session || state.studySession;
  if (!restoreStudySession(session)) resetDeck();
  retryMode = false;
  planKind = '';
  closeDialog(); stopAudio(); refreshStudyView();
}
function restoreSavedStudy() {
  StudyCore.normalise(state,data);
  window.OrdrumReview?.normalise(state,data);
  window.OrdrumPlanCore?.normalise(state,data);
  const task = activeStudyTask();
  if (task) selectTaskBook(task);
  const review = state.reviewSession;
  const saved = review && review.taskId === (task?.id || null)
    ? review.session : task?.session || state.studySession;
  if (!restoreStudySession(saved)) resetDeck();
}

function selectTaskBook(task) {
  if (task.bookId === '__notebook__') {
    state.selectedBook = '__notebook__';
    state.selectedNotebookChapters = StudyCore.notebookChapterSelection({...state,selectedNotebookChapters:task.chapterIds});
  } else {
    state.selectedBook = data.book.id;
    state.selectedChapters = [...task.chapterIds];
  }
}
function recordReviewAssessment(wordId,outcome,firstAttempt = true) {
  if (isPlanPractice()) {
    const prior = activePlan().results[currentPlanStage().id]?.[wordId];
    const original = state.mode === 'dictation' && !firstAttempt ? dictationAnswers[wordId] : outcome;
    if (['known','again','correct','wrong','revealed'].includes(original)) recordPlanOutcome(wordId,original);
    if (prior) return {ok:true,reason:'already-assessed'};
    if (currentPlanStage()?.assisted) firstAttempt = false;
  }
  const result = window.OrdrumReview?.record(state,{wordId,sessionId:reviewSessionId,mode:state.mode,outcome,firstAttempt});
  if (result?.ok === false && result.message) notify(result.message);
  return result;
}
function startTodayPlan({mode,wordIds}) {
  startNotebookReview(wordIds,state.activeTaskId,{mode,kind:'today'});
}
function skipTodayWord() {
  const word = currentWord(state.mode === 'dictation' ? dictationIndex : flashIndex);
  if (!word || !['today','plan'].includes(planKind)) return;
  const result = window.OrdrumReview?.skip(state,word.id,{sessionId:reviewSessionId});
  if (result?.ok === false) { notify(result.message || '暂时无法保存跳过记录。'); return; }
  if (isPlanPractice()) recordPlanOutcome(word.id,'skip');
  save(); renderSummary();
  if (state.mode === 'dictation') dictNext(); else if(flashIndex>=currentDeck.length-1) { if (isPlanPractice()) finishPlanStage(); else returnToStudy(); } else flashMove(1);
}
