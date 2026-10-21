(function (global) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count = value => Math.max(0, Math.floor(Number(value) || 0));
  const unique = values => Array.from(new Set(values));
  const fallbackMethods = [
    {id:'recall',name:'主动回忆',tagline:'稳妥积累',description:'先认识新词，再遮住释义回忆，最后听写难词。',newLimit:30,reviewLimit:90,targetMinutes:60,chunkSize:20,intervals:[1,3,7,14,30],steps:['认识新词','主动回忆','难词听写']},
    {id:'dictation',name:'听写强化',tagline:'听音与拼写',description:'新词预习后听音拼写，再集中练习首次答错的词。',newLimit:20,reviewLimit:80,targetMinutes:60,chunkSize:10,intervals:[1,2,5,12,30],steps:['认识新词','听写检验','错词重练']},
    {id:'quick',name:'快速复习',tagline:'熟词维护',description:'用翻卡快速回忆，难词再看一轮，并抽样听写。',newLimit:40,reviewLimit:160,targetMinutes:60,chunkSize:25,intervals:[1,3,7,14,30],steps:['快速回忆','难词回看','抽样听写']}
  ];
  function getMethods() {
    const source = global.OrdrumReview?.getMethods?.();
    return Array.isArray(source) && source.length ? source : fallbackMethods;
  }
  function methodsById(id) { return getMethods().find(method => method.id === id) || getMethods()[0]; }
  function makeScope(data, state, kind, chapters, selectedIds) {
    const words = Array.isArray(data?.words) ? data.words : [];
    const valid = new Set(words.map(word => word.id));
    let ids;
    if (kind === 'book') ids = words.map(word => word.id);
    else if (kind === 'chapters') {
      const wanted = new Set((chapters || []).map(String));
      ids = words.filter(word => wanted.has(String(word.chapter))).map(word => word.id);
    } else if (kind === 'notebook') {
      ids = global.OrdrumStudy?.notebookSelectedIds?.(state, chapters?.length ? chapters : ['all']) || [];
    } else ids = Array.isArray(selectedIds) ? selectedIds : words.filter(word => (state.selectedChapters || []).map(String).includes(String(word.chapter))).map(word => word.id);
    return {kind:['selected','book','chapters','notebook'].includes(kind) ? kind : 'selected',chapterIds:kind === 'chapters' && Array.isArray(chapters) ? chapters.map(Number).filter(Number.isInteger) : [],notebookChapterIds:kind === 'notebook' && Array.isArray(chapters) ? chapters.map(String) : [],wordIds:unique(ids.filter(id => valid.has(id)))};
  }
  function sessionView(session) {
    if (!session || typeof session !== 'object') return null;
    const stages = Array.isArray(session.stages) ? session.stages : [];
    const stageIndex = Math.min(stages.length, count(session.stageIndex));
    const stage = stages[stageIndex];
    const ended = session.status === 'ended';
    const complete = session.status === 'completed' || ended || stageIndex >= stages.length && stages.length > 0;
    const answers = session.results && typeof session.results === 'object' ? session.results : {};
    const completed = count(session.progress?.contacted ?? (Array.isArray(session.completedWordIds) ? unique(session.completedWordIds).length : Object.keys(answers).length));
    return {session,stages,stageIndex,stage,complete,ended,paused:session.status === 'paused',completed,total:count(session.progress?.total ?? session.wordIds?.length),minutes:Math.floor(count(session.progress?.elapsedMs ?? session.elapsedMs) / 60000)};
  }
  function mount(root, options = {}) {
    if (!root || typeof options.getState !== 'function' || typeof options.getData !== 'function') return {render(){},show(){},hide(){},getPracticeSlot(){return null;},destroy(){}};
    const doc = root.ownerDocument || global.document;
    let visible = !root.hidden, draft = null, dirty = false, formOpen = false, feedback = '', endConfirm = false, dashboardOpen = false, practiceSession = null, destroyed = false;
    const now = () => typeof options.now === 'function' ? options.now() : new Date();
    const state = () => options.getState() || {};
    const data = () => options.getData() || {};
    const current = () => sessionView(typeof options.getSession === 'function' ? options.getSession() : practiceSession || state().planSession || null);
    root.classList.add('plan-page');
    root.innerHTML = `<div class="plan-page-heading"><div><p class="plan-kicker" id="plan-date"></p><h1 id="plan-page-title">计划学习</h1><p>到期词优先，分组完成。</p></div><button type="button" class="plan-text-button" data-plan-action="home">返回书架 <span aria-hidden="true">↗</span></button></div><div class="plan-dashboard" id="plan-dashboard"><div class="plan-overview" id="plan-overview"></div><aside class="plan-configuration" aria-labelledby="plan-config-title"><div class="plan-config-heading"><div><p class="plan-kicker">学习安排</p><h2 id="plan-config-title">适合今天的节奏</h2></div><button type="button" class="plan-text-button" data-plan-action="toggle-options" aria-expanded="false" aria-controls="plan-config-form">调整</button></div><div id="plan-config-summary"></div><form id="plan-config-form" hidden></form></aside></div><section id="plan-session-bar" class="plan-session-bar" hidden aria-label="本轮学习进度"></section><section id="plan-practice-slot" class="plan-practice-slot" hidden aria-label="计划练习"></section><p id="plan-feedback" class="plan-feedback" role="status" aria-live="polite"></p>`;
    const node = id => root.querySelector('#'+id);
    const practiceSlot = node('plan-practice-slot');
    function markup(target,html) {
      if (target.innerHTML === html) return;
      const active = doc?.activeElement, action = target.contains(active) ? active?.dataset?.planAction : '';
      target.innerHTML = html;
      if (action) target.querySelector(`[data-plan-action="${action}"]`)?.focus();
    }
    function loadDraft() {
      const prefs = global.OrdrumReview?.cleanPreferences?.(state().reviewPreferences) || {...fallbackMethods[0],...state().reviewPreferences};
      draft = {method:prefs.method || 'recall',reviewLimit:prefs.reviewLimit,newLimit:prefs.newLimit,targetMinutes:prefs.targetMinutes || 60,chunkSize:prefs.chunkSize || 15,intervals:(prefs.intervals || [1,3,7,14,30]).slice(),scope:prefs.scope?.kind || 'selected',chapterIds:(prefs.scope?.kind === 'notebook' ? prefs.scope.notebookChapterIds : prefs.scope?.chapterIds || []).map(String)};
      dirty = false;
    }
    function scope() { return makeScope(data(),state(),draft.scope,draft.chapterIds,options.getWordIds?.()); }
    function plan() {
      const temporary = {...state(),reviewPreferences:{...state().reviewPreferences,...draft,scope:scopePreference()}};
      return global.OrdrumReview?.getPlan?.(temporary,data(),{now:now(),wordIds:scope().wordIds}) || {wordIds:[],newIds:[],dueIds:[],availableNew:0,availableDue:0,completedToday:0,scopeCount:scope().wordIds.length,preferences:temporary.reviewPreferences};
    }
    function estimate(value) {
      if (Number.isFinite(value.estimatedMinutes)) return Math.ceil(value.estimatedMinutes);
      const method = methodsById(draft.method);
      const baseline = Number(method.newLimit) + Number(method.reviewLimit) || 120;
      return value.wordIds.length ? Math.max(1,Math.ceil(value.wordIds.length / baseline * Number(method.targetMinutes || method.minutes || 60))) : 0;
    }
    function scopePreference() {return {kind:draft.scope,chapterIds:draft.scope === 'chapters' ? draft.chapterIds.map(Number) : [],notebookChapterIds:draft.scope === 'notebook' ? draft.chapterIds.slice() : []};}
    function scopeLabel() {
      if (draft.scope === 'book') return data().book?.title || '全书';
      if (draft.scope === 'chapters') return `${draft.chapterIds.length} 个章节`;
      if (draft.scope === 'notebook') return draft.chapterIds.length ? `错题本 · ${draft.chapterIds.length} 个章节` : '错题本 · 全部错词';
      return '首页所选章节';
    }
    function readForm() {
      const form = node('plan-config-form');
      for (const key of ['reviewLimit','newLimit','targetMinutes','chunkSize']) {
        const input = form.querySelector(`[name="${key}"]`);if (input) draft[key] = input.value;
      }
      const select = form.querySelector('[name="scope"]');if (select) draft.scope = select.value;
      draft.chapterIds = Array.from(form.querySelectorAll('[name="planChapter"]')).filter(input => input.checked).map(input => input.value);
      const intervals = form.querySelector('[name="intervals"]');
      if (intervals) draft.intervals = intervals.value.split(/[,，\s]+/).filter(Boolean).map(Number);
    }
    function configMarkup() {
      const methods = getMethods();
      const notebook = draft.scope === 'notebook';
      const chapters = notebook ? global.OrdrumStudy?.notebookChapters?.(state(),now()) || [] : data().chapters || [];
      return `<fieldset class="plan-methods"><legend>记忆法</legend>${methods.map(method => `<button type="button" class="plan-method" data-plan-method="${escape(method.id)}" aria-pressed="${method.id === draft.method}"><span class="plan-method-mark" aria-hidden="true"></span><span><strong>${escape(method.name)}</strong><small>${escape(method.tagline || method.description || '')}</small></span><span class="plan-method-count">${count(method.newLimit)+count(method.reviewLimit)}<small>词／天</small></span></button>`).join('')}</fieldset><p class="plan-method-explanation">${escape(methodsById(draft.method).description)}</p><label class="plan-field">学习范围<select name="scope" id="plan-scope"><option value="selected" ${draft.scope === 'selected' ? 'selected' : ''}>首页所选章节</option><option value="book" ${draft.scope === 'book' ? 'selected' : ''}>${escape(data().book?.title || '全书')}</option><option value="chapters" ${draft.scope === 'chapters' ? 'selected' : ''}>自选章节</option><option value="notebook" ${draft.scope === 'notebook' ? 'selected' : ''}>错题本</option></select></label><fieldset class="plan-chapters" ${!['chapters','notebook'].includes(draft.scope) ? 'hidden' : ''}><legend>${notebook ? '错词章节（不选则使用全部）' : '选择章节'}</legend>${chapters.map(chapter => `<label><input type="checkbox" name="planChapter" value="${escape(chapter.id)}" ${draft.chapterIds.includes(String(chapter.id)) ? 'checked' : ''}><span>${escape(chapter.title || 'Kapitel '+chapter.id)}</span></label>`).join('')}</fieldset><div class="plan-fields"><label class="plan-field">每日复习上限<input name="reviewLimit" type="number" min="0" max="200" step="1" value="${escape(draft.reviewLimit)}" required><small>已学习且到期的词</small></label><label class="plan-field">每日新词上限<input name="newLimit" type="number" min="0" max="200" step="1" value="${escape(draft.newLimit)}" required><small>尚无回忆记录的词</small></label><label class="plan-field">每日预算<span class="plan-input-unit"><input name="targetMinutes" type="number" min="10" max="180" step="5" value="${escape(draft.targetMinutes)}" required><span>分钟</span></span></label><label class="plan-field">每组单词数<input name="chunkSize" type="number" min="10" max="25" step="1" value="${escape(draft.chunkSize)}" required></label></div><details class="plan-advanced"><summary>复习间隔</summary><label class="plan-field">成功后的间隔（天）<input name="intervals" type="text" value="${escape(draft.intervals.join(', '))}" required></label><p>未记住的词约 10 分钟后再次出现；同日重复不会连续升级。</p></details><p class="plan-budget-note">100–200 词指新词与复习词合计。用时为估计，可随时暂停；数量不足时按实际可用词安排。</p><div class="plan-form-actions"><button type="submit" class="primary-button">保存设置</button><button type="button" class="plan-text-button" data-plan-action="preset">恢复此方法默认值</button></div>`;
    }
    function renderConfig(force = false) {
      const summary = node('plan-config-summary'), method = methodsById(draft.method);
      summary.innerHTML = `<p class="plan-summary-method">${escape(method.name)}<span>${count(draft.targetMinutes)} 分钟／天</span></p><p class="plan-summary-scope">${escape(scopeLabel())}</p><div class="plan-summary-limits"><span><strong>${count(draft.reviewLimit)}</strong> 复习</span><span><strong>${count(draft.newLimit)}</strong> 新词</span><span><strong>${count(draft.chunkSize)}</strong> 每组</span></div><ol class="plan-mini-flow">${(method.steps || []).map(step => `<li>${escape(typeof step === 'string' ? step : step.label)}</li>`).join('')}</ol><p class="plan-config-note">新词＋复习词，共 ${count(draft.newLimit)+count(draft.reviewLimit)} 词／天。先完成回忆，再决定是否加量。</p>`;
      summary.hidden = formOpen;
      const form = node('plan-config-form');form.hidden = !formOpen;
      const toggle = root.querySelector('[data-plan-action="toggle-options"]');toggle?.setAttribute('aria-expanded',String(formOpen));if (toggle) toggle.textContent = formOpen ? '收起' : '调整';
      if (force || !form.querySelector('[name="reviewLimit"]')) form.innerHTML = configMarkup();
    }
    function stepHint(phase,method,index) {
      if (phase === 'preview' || !phase && method !== 'quick' && index === 0) return '听读新词，建立读音与词义联系';
      if (phase === 'retry') return '保留首次错误，集中再练';
      if (phase === 'test' || !phase && method === 'quick' && index === 2) return '抽样检验听音与拼写';
      if (phase === 'reinforce' || index === 2) return '集中处理本轮需要加强的词';
      if (method === 'dictation') return '先独立拼写，再核对答案';
      return '遮住释义，先回忆再翻开';
    }
    function renderOverview() {
      const value = plan(), view = current(), active = view && !view.complete;
      const method = methodsById(active ? view.session.method : draft.method), total = value.wordIds.length, minutes = estimate(value);
      const date = now();
      node('plan-date').textContent = Number.isFinite(new Date(date).getTime()) ? new Date(date).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'}) : '';
      let status = '';
      if (!active && !value.scopeCount) status = '当前范围没有单词。先选择书籍或章节。';
      else if (!active && value.paused) status = '每日计划已暂停，恢复后继续安排。';
      else if (!total && !active) status = value.nextDueAt ? `当前没有到期词。下次复习 ${new Date(value.nextDueAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}。` : '今天暂无可安排的词，可调整范围或每日上限。';
      const availableNew = count(value.availableNew), availableDue = count(value.availableDue);
      const limited = (availableNew < count(draft.newLimit) || availableDue < count(draft.reviewLimit)) && total;
      const completed = count(value.daily?.contactedToday ?? value.completedToday), target = count(draft.newLimit) + count(draft.reviewLimit), percent = target ? Math.min(100,Math.round(completed / target * 100)) : 0;
      const sessionCopy = active ? `<span class="plan-resume-status">${view.paused ? '已暂停' : '进行中'} · 第 ${view.stageIndex + 1} / ${view.stages.length} 组</span><h2>${escape(view.stage?.label || method.name)}</h2><p>本轮 ${view.total} 词 · 已用 ${view.minutes} 分钟 · ${escape(method.name)}</p>` : view?.complete ? `<span class="plan-resume-status">${view.ended ? '本轮已结束' : '本轮已完成'}</span><h2>练习了 ${view.completed} 个词</h2><p>本轮安排 ${view.total} 词 · 用时 ${view.minutes} 分钟。记录已保留。</p>${sessionSummary(view)}` : `<span class="plan-resume-status">今日待安排</span><h2>${total}<span> 词</span></h2><p>${count(value.dueIds?.length)} 复习 · ${count(value.newIds?.length)} 新词${minutes ? ` · 预计约 ${minutes} 分钟` : ''}</p>`;
      const phases = active ? unique(view.stages.map(stage => stage.phase || stage.label.split(' · ')[0])) : [];
      const activePhase = active ? phases.indexOf(view.stage?.phase || view.stage?.label.split(' · ')[0]) : -1;
      const steps = active ? phases.map(phase => view.stages.find(stage => (stage.phase || stage.label.split(' · ')[0]) === phase).label.split(' · ')[0]) : (method.steps || []).map(step => typeof step === 'string' ? step : step.label);
      markup(node('plan-overview'), `<section class="plan-today" aria-labelledby="plan-today-heading"><div class="plan-today-top"><div><p class="plan-kicker" id="plan-today-heading">${active ? '继续这一轮' : '今日学习'}</p>${sessionCopy}</div><div class="plan-daily-progress" style="--plan-progress:${percent}%" role="img" aria-label="今日已回忆 ${completed} 词，每日上限 ${target} 词"><div><strong>${completed}</strong><span>今日回忆</span></div></div></div>${status ? `<p class="plan-status-note" role="status">${escape(status)}</p>` : ''}${limited && !active ? `<p class="plan-available-note">当前范围可安排 ${availableDue} 个到期词、${availableNew} 个新词；本轮使用实际可用数量。</p>` : ''}<div class="plan-main-actions"><button type="button" class="primary-button plan-start" data-plan-action="${active ? 'resume' : 'start'}" ${!active && (!total || value.paused) ? 'disabled' : ''}>${active ? '继续学习' : view?.complete ? '安排下一轮' : '开始今日学习'}<span aria-hidden="true">→</span></button>${active ? `${!view.paused ? '<button type="button" class="plan-text-button" data-plan-action="pause">暂停</button>' : ''}<button type="button" class="plan-text-button" data-plan-action="end">结束本轮</button>` : `<button type="button" class="plan-text-button" data-plan-action="pause-plan">${value.paused ? '恢复每日计划' : '暂停每日计划'}</button>`}</div>${endConfirm && active && (view.paused || !practiceSlot.children.length || dashboardOpen) ? endConfirmation() : ''}${minutes > count(draft.targetMinutes) && !active ? '<p class="plan-available-note">预计用时超过每日预算，可减少每日上限或分段完成。</p>' : ''}${value.historyFull ? '<p class="plan-status-note" role="status">复习历史容量已满，请先在设置 → 档案导出备份。</p>' : ''}</section><section class="plan-flow" aria-labelledby="plan-flow-title"><div class="plan-section-heading"><h2 id="plan-flow-title">${active ? '本轮流程' : '这轮怎么学'}</h2><span>每组 ${count(active ? view.session.chunkSize : draft.chunkSize)} 词</span></div><ol>${steps.map((label,index) => `<li class="${active && index < activePhase ? 'done' : active && index === activePhase ? 'current' : ''}"><span class="plan-step-number" aria-hidden="true">${active && index < activePhase ? '✓' : index + 1}</span><div><strong>${escape(label)}</strong><small>${escape(stepHint(active ? phases[index] : '',method.id,index))}</small></div></li>`).join('')}</ol><p>翻卡记录自评；听写只按首次作答判断。重复练习不会抹去首次错误。</p></section>`);
      if (view) renderSession(view);
      else {node('plan-session-bar').hidden = true;node('plan-dashboard').hidden = false;if (!practiceSlot.children.length) practiceSlot.hidden = true;}
    }
    function renderSession(view) {
      const bar = node('plan-session-bar'), hasPractice = practiceSlot.children.length > 0;
      bar.hidden = !hasPractice;
      practiceSlot.hidden = !hasPractice || view.complete || view.paused;
      node('plan-dashboard').hidden = hasPractice && !view.complete && !view.paused && !dashboardOpen;
      if (!hasPractice) return;
      const stage = view.stage;
      markup(bar, `<div class="plan-session-position"><span class="plan-kicker">${escape(methodsById(view.session.method).name)}</span><h2>${escape(view.complete ? view.ended ? '本轮已结束' : '本轮完成' : stage?.label || '计划练习')}</h2><p>第 ${Math.min(view.stageIndex + 1,view.stages.length)} / ${view.stages.length} 组 · ${view.total} 词 · 已用 ${view.minutes} 分钟${view.paused ? ' · 已暂停' : ''}</p><p class="plan-stage-progress">本组 ${count(view.session.progress?.stageDone)} / ${count(view.session.progress?.stageTotal ?? view.session.currentWordIds?.length ?? stage?.wordIds?.length)} · 本轮已接触 ${view.completed} / ${view.total} 词</p></div><div class="plan-session-actions"><button type="button" class="plan-text-button" data-plan-action="dashboard">查看安排</button>${!view.complete ? `<button type="button" class="secondary-button" data-plan-action="pause">${view.paused ? '继续' : '暂停'}</button><button type="button" class="secondary-button" data-plan-action="next-stage" ${view.session.canAdvance ? '' : 'disabled'}>${stage?.mode === 'preview' ? '已预览，继续' : '完成本组'}</button><button type="button" class="plan-text-button" data-plan-action="end">结束本轮</button>` : ''}</div>${endConfirm && !view.paused && !dashboardOpen ? endConfirmation() : ''}`);
    }
    function endConfirmation() {return '<div class="plan-end-confirm" role="alert"><p>结束后保留已完成的记录；未练完的词仍参与以后的安排。</p><button type="button" class="secondary-button" data-plan-action="confirm-end">结束并保留记录</button><button type="button" class="plan-text-button" data-plan-action="cancel-end">继续本轮</button></div>';}
    function sessionSummary(view) {
      const progress = view.session.progress || {};
      return `<div class="plan-finish-metrics"><span>自评记住 <strong>${count(progress.known)}</strong></span><span>首次听写正确 <strong>${count(progress.correct)}</strong></span><span>首次听写错误 <strong>${count(progress.wrong)}</strong></span><span>跳过 <strong>${count(progress.skipped)}</strong></span></div>`;
    }
    function render(renderOptions = {}) {
      if (destroyed) return;
      const force = renderOptions === true || renderOptions.force === true;
      if (!draft || !dirty && !formOpen) loadDraft();
      renderOverview();renderConfig(force && !dirty);node('plan-feedback').textContent = feedback;
    }
    function validateDraft() {
      const validInt = (key,min,max) => /^\d+$/.test(String(draft[key])) && Number(draft[key]) >= min && Number(draft[key]) <= max;
      if (!validInt('reviewLimit',0,200) || !validInt('newLimit',0,200) || count(draft.reviewLimit)+count(draft.newLimit)>200 || !validInt('targetMinutes',10,180) || !validInt('chunkSize',10,25) || draft.intervals.length !== 5 || draft.intervals.some((day,index) => !Number.isInteger(day) || day < 1 || day > 365 || index && day <= draft.intervals[index-1])) return '每日新词与复习词合计应为 1–200；预算 10–180 分钟，每组 10–25 词。复习间隔需为五个递增天数。';
      if (count(draft.reviewLimit)+count(draft.newLimit) < 1) return '至少安排 1 个新词或复习词。';
      return '';
    }
    function saveDraft() {
      readForm();const invalid = validateDraft();
      if (invalid) {feedback = invalid;node('plan-feedback').textContent = feedback;return false;}
      const patch = {method:draft.method,reviewLimit:Number(draft.reviewLimit),newLimit:Number(draft.newLimit),targetMinutes:Number(draft.targetMinutes),chunkSize:Number(draft.chunkSize),intervals:draft.intervals.slice(),scope:scopePreference()};
      if (typeof options.onPreferences === 'function') options.onPreferences(patch);
      else {global.OrdrumReview?.setPreferences?.(state(),patch,now());options.onChange?.({type:'preferences',preferences:patch,scope:scope()});}
      dirty = false;feedback = current() && !current().complete ? '已保存。当前这一轮保持原安排，新设置用于下一轮。' : '学习设置已保存。';
      return true;
    }
    function usePreset(id) {
      const method = methodsById(id);
      draft = {...draft,method:method.id,newLimit:method.newLimit,reviewLimit:method.reviewLimit,targetMinutes:method.targetMinutes || method.minutes || 60,chunkSize:method.chunkSize || 15,intervals:(method.intervals || [1,3,7,14,30]).slice()};
      dirty = true;feedback = '已载入默认设置，保存或开始学习时生效。';renderConfig(true);renderOverview();node('plan-feedback').textContent = feedback;
    }
    function click(event) {
      const method = event.target.closest?.('[data-plan-method]');
      if (method && root.contains(method)) {readForm();usePreset(method.dataset.planMethod);root.querySelector(`[data-plan-method="${method.dataset.planMethod}"]`)?.focus();return;}
      const button = event.target.closest?.('[data-plan-action]');if (!button || !root.contains(button)) return;
      const action = button.dataset.planAction, view = current();
      if (action === 'home') options.onReturnHome?.();
      else if (action === 'toggle-options') {if (formOpen) readForm();formOpen = !formOpen;renderConfig(true);root.querySelector('[data-plan-action="toggle-options"]')?.focus();}
      else if (action === 'preset') {readForm();usePreset(draft.method);}
      else if (action === 'start') {
        if (formOpen && !saveDraft()) return;
        if (dirty && !formOpen && !saveDraft()) return;
        const value = plan();if (!value.wordIds.length || value.paused) return;
        dashboardOpen = false;options.onStart?.({plan:value,preferences:{...draft,scope:scopePreference()},scope:scope(),method:draft.method,wordIds:value.wordIds.slice(),dueIds:value.dueIds.slice(),newIds:value.newIds.slice()});
      }
      else if (action === 'resume') {dashboardOpen = false;options.onResume?.(view?.session.id);}
      else if (action === 'pause') {if (view?.paused) options.onResume?.(view.session.id);else options.onPause?.(view?.session.id);}
      else if (action === 'pause-plan') {const prefs = state().reviewPreferences || {};global.OrdrumReview?.setPreferences?.(state(),{paused:!prefs.paused},now());options.onChange?.({type:'preferences'});render();}
      else if (action === 'dashboard') {dashboardOpen = true;node('plan-dashboard').hidden = false;node('plan-page-title')?.focus?.();}
      else if (action === 'end') {endConfirm = true;renderOverview();root.querySelector('[data-plan-action="confirm-end"]')?.focus();}
      else if (action === 'cancel-end') {endConfirm = false;renderOverview();}
      else if (action === 'confirm-end') {endConfirm = false;options.onEnd?.(view?.session.id);}
      else if (action === 'next-stage') options.onNextStage?.(view?.session.id);
    }
    function input(event) {
      if (!node('plan-config-form').contains(event.target)) return;
      const changedScope = event.target.name === 'scope';readForm();dirty = true;
      if (changedScope) {draft.chapterIds = [];renderConfig(true);root.querySelector('#plan-scope')?.focus();}
      renderOverview();
    }
    function submit(event) {if (event.target.id !== 'plan-config-form') return;event.preventDefault();if (saveDraft()) {formOpen = false;render();root.querySelector('[data-plan-action="toggle-options"]')?.focus();}}
    root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',input);root.addEventListener('submit',submit);render();
    return {render,show(){visible = true;root.hidden = false;render();},hide(){visible = false;root.hidden = true;},isVisible(){return visible;},getPracticeSlot(){return practiceSlot;},setPracticeSession(value){practiceSession = value;render();},getDraft(){return {...draft,chapterIds:draft.chapterIds.slice(),intervals:draft.intervals.slice(),scope:scopePreference()};},destroy(){destroyed = true;root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('change',input);root.removeEventListener('submit',submit);}};
  }
  global.OrdrumPlan = {mount,makeScope,sessionView,getMethods};
})(typeof window === 'undefined' ? globalThis : window);
