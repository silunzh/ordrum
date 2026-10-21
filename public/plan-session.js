'use strict';

// The planned round uses its own checkpoint; the bookshelf/task checkpoint stays intact.
let planPageView = null, appPage = 'study', planPracticeMounted = false, planClockStarted = 0;
function activePlan() { return state.planSessions?.[state.activePlanId] || null; }
function currentPlanStage() { const record = activePlan(); return record?.stages?.[record.stageIndex] || null; }
function isPlanPractice() { return planPracticeMounted && !!activePlan() && !!currentPlanStage(); }
function planTimestamp() { return new Date().toISOString(); }
function flushPlanClock() {
  if (!planClockStarted) return;
  const record = activePlan(), now = Date.now();
  if (now-planClockStarted < 1000 && document.visibilityState !== 'hidden') return;
  if (record) { record.elapsedMs = (record.elapsedMs || 0)+Math.max(0,Math.min(60000,now-planClockStarted)); record.updatedAt = planTimestamp(); }
  planClockStarted = document.visibilityState === 'hidden' ? 0 : now;
}
function capturePlanCheckpoint(session) {
  const record = activePlan(), stage = currentPlanStage();
  if (!record || !stage) return;
  const previous = record.stageSessions[stage.id];
  const copy = {...session}; delete copy.updatedAt;
  const old = previous ? {...previous} : null; if (old) delete old.updatedAt;
  const unchanged = window.OrdrumCloud?.equal ? window.OrdrumCloud.equal(copy,old) : JSON.stringify(copy) === JSON.stringify(old);
  if (!unchanged) {
    record.stageSessions[stage.id] = {...copy,updatedAt:planTimestamp()}; record.updatedAt = planTimestamp();
  }
}
function recordPlanOutcome(wordId,outcome) {
  const record = activePlan(), stage = currentPlanStage();
  if (!isPlanPractice() || !currentDeck.includes(wordId)) return;
  flushPlanClock();
  const results = record.results[stage.id] ||= {};
  if (!results[wordId]) { results[wordId] = {outcome,at:planTimestamp()}; record.updatedAt = planTimestamp(); }
}
function planForPage() {
  const record = activePlan();
  if (!record) return null;
  const decorated = window.OrdrumPlanCore.decorate(record);
  // Another device may be studying this plan. An unopened local round is only
  // paused in this view; reading it must not overwrite that device's status.
  if (!planPracticeMounted && decorated.status === 'active') decorated.status = 'paused';
  if (planClockStarted) decorated.progress.elapsedMs += Math.max(0,Math.min(60000,Date.now()-planClockStarted));
  return decorated;
}
function homePlanWordIds() {
  const task = activeStudyTask();
  if (task) return [...task.wordIds];
  if (state.selectedBook === '__notebook__') return StudyCore.notebookSelectedIds(state);
  const chapters = new Set(state.selectedChapters || []);
  return data.words.filter(word=>chapters.has(Number(word.chapter))).map(word=>word.id);
}
function moveStudySurface(planned) {
  const slot = planned ? planPageView?.getPracticeSlot() : $('#home-practice-slot');
  const surface = $('#study-surface');
  if (slot && surface && surface.parentNode !== slot) slot.appendChild(surface);
  planPracticeMounted = !!planned;
  surface?.classList.toggle('planned-practice',!!planned);
}
function showAppPage(next,{route = true} = {}) {
  next = next === 'plan' ? 'plan' : 'study';
  if (next === 'study' && isPlanPractice()) pausePlannedSession(null,{render:false});
  appPage = next;
  if ($('#home-page')) $('#home-page').hidden = next !== 'study';
  if ($('#plan-page')) $('#plan-page').hidden = next !== 'plan';
  for (const [id,value] of [['study-page-button','study'],['plan-page-button','plan']]) {
    const button = $('#'+id); button?.classList.toggle('active',next === value);
    if (button) { if (next === value) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); }
  }
  if (next === 'plan') planPageView?.show(); else planPageView?.hide();
  if (route && window.location?.hash !== '#'+next) window.history?.replaceState(null,'','#'+next);
}
function restoreHomePractice() {
  planClockStarted = 0; moveStudySurface(false); restoreSavedStudy();
  renderChapters(); renderSummary(); renderMode({autoplay:false});
}
function pausePlannedSession(id,{render = true} = {}) {
  const record = activePlan();
  if (!record || id && id !== record.id) return;
  if (isPlanPractice()) { flushPlanClock(); captureStudySession(); stopAudio(); }
  planClockStarted = 0;
  if (record.status === 'active') { record.status = 'paused'; record.updatedAt = planTimestamp(); }
  if (planPracticeMounted) restoreHomePractice();
  save(); if (render) planPageView?.render();
}
function enterPlanStage({autoplay = true} = {}) {
  const record = activePlan();
  if (!record || ['completed','ended'].includes(record.status)) return;
  let stage;
  while ((stage = record.stages[record.stageIndex])) {
    if (!record.resolvedStages[stage.id]) {
      const prior = record.stages.slice(0,record.stageIndex).map(item=>record.results[item.id] || {});
      record.resolvedStages[stage.id] = window.OrdrumReview.selectStageWords(stage,{results:prior});
    }
    if (record.resolvedStages[stage.id].length) break;
    record.completedStages[stage.id] = true; record.stageIndex++;
  }
  if (!stage) { finishPlannedSession(); return; }
  currentDeck = [...record.resolvedStages[stage.id]];
  flashIndex = 0; flipped = false; dictationIndex = 0; dictationResult = null; dictationDraft = '';
  dictationAnswers = {}; mistakes = new Set(); page = 1; search = ''; retryMode = true;
  state.mode = stage.mode; reviewSessionId = newReviewSessionId(); planKind = 'plan';
  const saved = record.stageSessions[stage.id];
  if (saved && saved.mode === stage.mode) restoreStudySession(saved);
  // The latest checkpoint supplies position; every merged stage member stays reachable.
  const actual = new Set(record.resolvedStages[stage.id]);
  currentDeck = [...new Set([...currentDeck.filter(id=>actual.has(id)),...actual])];
  if (stage.mode === 'dictation') {
    const answers = record.results[stage.id] ||= {};
    for (const [id,outcome] of Object.entries(dictationAnswers)) {
      if (actual.has(id) && !answers[id] && ['correct','wrong','revealed'].includes(outcome)) {
        answers[id] = {outcome,at:saved?.updatedAt || record.updatedAt};
      }
    }
    for (const [id,result] of Object.entries(record.results[stage.id] || {})) {
      if (actual.has(id) && ['correct','wrong','revealed'].includes(result.outcome)) dictationAnswers[id] = result.outcome;
    }
  }
  retryMode = true; planKind = 'plan';
  if (record.status !== 'active') { record.status = 'active'; record.updatedAt = planTimestamp(); }
  moveStudySurface(true); if (!planClockStarted) planClockStarted = document.visibilityState === 'hidden' ? 0 : Date.now();
  planPageView?.setPracticeSession(planForPage());
  showAppPage('plan'); renderMode({autoplay}); planPageView?.render();
}
function startPlannedSession(payload) {
  const existing = activePlan();
  if (existing && !['completed','ended'].includes(existing.status)) {
    showAppPage('plan'); notify('请先继续或结束当前计划，再开始新的安排。'); return;
  }
  if (!payload?.plan?.wordIds?.length) { notify('此范围今天没有待学词，可以调整章节或每日上限。'); return; }
  const capacity = window.OrdrumReview.capacity(state);
  if (capacity.full) { notify('学习档案容量已满，请先在设置中导出档案。'); return; }
  captureStudySession(); stopAudio();
  window.OrdrumReview.setPreferences(state,payload.preferences);
  const record = window.OrdrumReview.buildSession(payload.plan);
  Object.assign(record,{createdAt:planTimestamp(),scope:payload.scope,results:{},resolvedStages:{},stageSessions:{},completedStages:{}});
  if (window.OrdrumReview.capacity({...state,planSessions:{...state.planSessions,[record.id]:record}}).full) {
    notify('学习档案已没有足够空间保存新计划，请先导出档案。'); return;
  }
  state.planSessions ||= {}; state.planSessions[record.id] = record; state.activePlanId = record.id;
  window.OrdrumPlanCore.normalise(state,data);
  enterPlanStage();
}
function resumePlannedSession(id) {
  if (id && state.planSessions?.[id]) state.activePlanId = id;
  if (!isPlanPractice()) { captureStudySession(); stopAudio(); }
  enterPlanStage();
}
function finishPlannedSession(ended = false) {
  const record = activePlan(); if (!record) return;
  if (isPlanPractice()) { flushPlanClock(); captureStudySession(); }
  planClockStarted = 0; stopAudio();
  record.status = ended ? 'ended' : 'completed'; record.updatedAt = planTimestamp();
  if (!ended) record.completedAt = record.updatedAt; else record.endedAt = record.updatedAt;
  if (planPracticeMounted) restoreHomePractice();
  save(); planPageView?.render();
}
function finishPlanStage() {
  const record = activePlan(), stage = currentPlanStage(); if (!isPlanPractice() || !stage) return;
  if (stage.mode === 'preview') currentDeck.forEach(id=>recordPlanOutcome(id,'seen'));
  if (!planForPage().canAdvance) { notify('本组还有未作答词卡；可返回补答，或逐词跳过。'); return; }
  flushPlanClock(); captureStudySession(); stopAudio(); planClockStarted = 0;
  record.completedStages[stage.id] = true; record.stageIndex++; record.updatedAt = planTimestamp();
  // Empty dynamic phases are skipped deterministically, without producing successes.
  while (record.stages[record.stageIndex]) {
    const next = record.stages[record.stageIndex];
    const prior = record.stages.slice(0,record.stageIndex).map(item=>record.results[item.id] || {});
    record.resolvedStages[next.id] ||= window.OrdrumReview.selectStageWords(next,{results:prior});
    if (record.resolvedStages[next.id].length) break;
    record.completedStages[next.id] = true; record.stageIndex++;
  }
  if (record.stageIndex >= record.stages.length) { finishPlannedSession(); return; }
  record.status = 'paused'; restoreHomePractice(); save(); planPageView?.render();
  notify('本组完成。休息30–60秒后，点击继续学习。');
}
function mountPlanPage() {
  window.OrdrumPlanCore?.normalise(state,data);
  planPageView = window.OrdrumPlan?.mount($('#plan-page'),{
    getState:()=>state,getData:()=>data,getWordIds:homePlanWordIds,getSession:planForPage,
    onChange:()=>{save();renderSummary();},onStart:startPlannedSession,onResume:resumePlannedSession,
    onPause:pausePlannedSession,onEnd:()=>finishPlannedSession(true),onNextStage:finishPlanStage,onReturnHome:()=>showAppPage('study'),
  });
  $('#study-page-button')?.addEventListener('click',()=>showAppPage('study'));
  $('#plan-page-button')?.addEventListener('click',()=>{if (!isPlanPractice()) save(); showAppPage('plan');});
  window.addEventListener('hashchange',()=>showAppPage(window.location.hash === '#plan' ? 'plan' : 'study',{route:false}));
  document.addEventListener('visibilitychange',()=>{
    if (!isPlanPractice()) return;
    if (document.visibilityState === 'hidden') { flushPlanClock(); captureStudySession(); planClockStarted = 0; save(); stopAudio(); }
    else { planClockStarted = Date.now(); planPageView?.render(); }
  });
  window.setInterval?.(()=>{if (isPlanPractice()) {flushPlanClock();save();planPageView?.render();}},15000);
  showAppPage(window.location?.hash === '#plan' ? 'plan' : 'study',{route:false});
}
