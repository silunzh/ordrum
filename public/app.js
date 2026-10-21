'use strict';

const ICONS = {
  sound:'<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  archive:'<path d="M5 8v12h14V8M3 4h18v4H3zM9 12h6"/>',
  book:'<path d="M12 6C8 3 3 4 3 4v15s5-1 9 2c4-3 9-2 9-2V4s-5-1-9 2Zm0 0v15"/>',
  leaf:'<path d="M19 3S7 3 5 9c-2 7 7 11 11 5 3-4 3-11 3-11ZM4 21 15 8"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
  cards:'<rect x="7" y="3" width="13" height="17" rx="2"/><path d="m4 7-2 1 4 13a2 2 0 0 0 2 1l5-1"/>',
  headphones:'<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',
  shuffle:'<path d="M3 6h3c4 0 8 12 12 12h3m-4-4 4 4-4 4M3 18h3c1.5 0 3-2 4.5-4M14 8c1.5-1.3 2.5-2 4-2h3m-4-4 4 4-4 4"/>',
  flip:'<path d="M4 8a8 8 0 0 1 14-3l2 3M20 3v5h-5M20 16a8 8 0 0 1-14 3l-2-3m0 5v-5h5"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  reset:'<path d="M4 8a8 8 0 1 1-1 7M4 3v5h5"/>',
  edit:'<path d="m15 4 5 5M3 21l5-1L21 7l-5-5L3 15v6Z"/>',
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
const STORAGE_KEY = 'ordrum.rivstart.v1';
const PAGE_SIZE = 24;
const StudyCore = window.OrdrumStudy;
let data = null, audioMap = {}, voices = [], activeAudio = null, toastTimer;
let currentDeck = [], flashIndex = 0, flipped = false, dictationIndex = 0, dictationResult = null;
let dictationAnswers = {}, mistakes = new Set(), retryMode = false, search = '', page = 1, renderToken = 0;
let state = {selectedChapters:null, selectedBook:null, selectedNotebookChapters:['all'], mode:'preview', layout:'grid', marks:{}, overrides:{}, rate:0.85, autoPlay:false, voiceURI:'', tasks:[], notebook:null, notebookUnits:{}, reviewEvents:{}, reviewPreferences:{}, planSessions:{}, activePlanId:null, activeTaskId:null, studySession:null, reviewSession:null};
let storageAvailable = true;
let cloudCommitId = null;
let reviewSessionId = newReviewSessionId(), planKind = '', pendingRestore = null, renderedDay = '';
function newReviewSessionId() { return `round-${window.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}`; }

function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach(el => { el.innerHTML = icon(el.dataset.icon); });
}
function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
}
function save() {
  captureStudySession();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({...state,__cloudCommitId:cloudCommitId})); }
  catch (_) {
    if (storageAvailable) notify('此浏览器无法保存进度。可以用设置中的档案功能导出记录。');
    storageAvailable = false;
    const status = $('#cloud-status');
    if (status) status.textContent = '当前进度仅在本次打开期间保留，请导出备份';
    updateSettingsStatus('error');
  }
  window.OrdrumCloud?.schedule();
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (typeof saved.__cloudCommitId === 'string') cloudCommitId = saved.__cloudCommitId;
      if (Array.isArray(saved.selectedChapters)) state.selectedChapters = saved.selectedChapters.map(Number);
      if (typeof saved.selectedBook === 'string') state.selectedBook = saved.selectedBook;
      if (Array.isArray(saved.selectedNotebookChapters)) state.selectedNotebookChapters = saved.selectedNotebookChapters;
      if (saved.reviewEvents && typeof saved.reviewEvents === 'object') state.reviewEvents = saved.reviewEvents;
      if (saved.reviewPreferences && typeof saved.reviewPreferences === 'object') state.reviewPreferences = saved.reviewPreferences;
      if (saved.planSessions && typeof saved.planSessions === 'object') state.planSessions = saved.planSessions;
      if (typeof saved.activePlanId === 'string') state.activePlanId = saved.activePlanId;
      if (['preview','flashcard','dictation'].includes(saved.mode)) state.mode = saved.mode;
      if (['grid','list'].includes(saved.layout)) state.layout = saved.layout;
      if (saved.marks && typeof saved.marks === 'object' && !Array.isArray(saved.marks)) state.marks = saved.marks;
      if (saved.overrides && typeof saved.overrides === 'object' && !Array.isArray(saved.overrides)) state.overrides = saved.overrides;
      if ([0.7,0.85,1].includes(Number(saved.rate))) state.rate = Number(saved.rate);
      state.autoPlay = !!saved.autoPlay;
      if (typeof saved.voiceURI === 'string') state.voiceURI = saved.voiceURI;
      if (Array.isArray(saved.tasks)) state.tasks = saved.tasks;
      if (saved.notebook && typeof saved.notebook === 'object' && !Array.isArray(saved.notebook)) state.notebook = saved.notebook;
      if (saved.notebookUnits && typeof saved.notebookUnits === 'object' && !Array.isArray(saved.notebookUnits)) state.notebookUnits = saved.notebookUnits;
      if (typeof saved.activeTaskId === 'string') state.activeTaskId = saved.activeTaskId;
      if (saved.studySession && typeof saved.studySession === 'object') state.studySession = saved.studySession;
      if (saved.reviewSession && typeof saved.reviewSession === 'object') state.reviewSession = saved.reviewSession;
    }
  } catch (_) { /* A malformed older backup must never stop the study room. */ }
}
function wordFor(base) {
  const override = state.overrides[base.id];
  return override && typeof override === 'object' ? {...base,...override,id:base.id,chapter:base.chapter,swedish:base.swedish} : base;
}
function selectedWords() {
  const chosen = new Set(state.selectedChapters || []);
  const task = activeStudyTask();
  const taskIds = retryMode ? new Set(currentDeck) : task ? new Set(task.wordIds) : state.selectedBook === '__notebook__' ? new Set(StudyCore.notebookSelectedIds(state)) : null;
  return data.words.filter(word => taskIds ? taskIds.has(word.id) : chosen.has(Number(word.chapter))).map(wordFor);
}
function markStatus(id) {
  const task = isPlanPractice() ? null : activeStudyTask();
  const mark = task ? task.marks[id] : state.marks[id];
  return typeof mark === 'string' ? mark : mark?.status;
}
function setMark(id, status) {
  recordStudyResult(id,status || 'unmarked');
}
function posLabel(pos) {
  const p = String(pos || '').toLowerCase();
  const labels = {noun:'名词',nn:'名词',substantiv:'名词',verb:'动词',vb:'动词',adjective:'形容词',jj:'形容词',adjektiv:'形容词',adverb:'副词',ab:'副词',pronoun:'代词',pn:'代词',pronomen:'代词',preposition:'介词',pp:'介词',conjunction:'连词',kn:'连词',interjection:'感叹词',in:'感叹词',numeral:'数词',rg:'数词',phrase:'短语',expression:'短语',fras:'短语',other:'其他'};
  return labels[p] || pos || '词条';
}
function visibleForms(word) {
  const forms = Array.isArray(word.forms) ? word.forms.filter(form => form && form.value).map(form => ({label:String(form.label || '词形'),value:String(form.value)})) : [];
  if (posLabel(word.pos) !== '动词') return forms;
  const order = new Map([
    ['命令',0],['命令式',0],['imperative',0],['imperativ',0],
    ['不定',1],['不定式',1],['infinitive',1],['infinitiv',1],
    ['现在',2],['现在时',2],['现在式',2],['present',2],['presens',2],
    ['过去',3],['过去时',3],['过去式',3],['past',3],['preterite',3],['preteritum',3],
    ['完成',4],['完成时',4],['完成式',4],['完成式用形 (supinum)',4],['supine',4],['supinum',4],
  ]);
  const rank = form => {
    let label = form.label.trim().toLowerCase();
    while (!order.has(label)) {
      const withoutAnnotation = label.replace(/\s*[（(][^（）()]*[）)]\s*$/u,'').trim();
      if (withoutAnnotation === label) break;
      label = withoutAnnotation;
    }
    return order.get(label) ?? 5;
  };
  return forms.map((form,index) => ({form,index,rank:rank(form)}))
    .sort((a,b) => a.rank-b.rank || a.index-b.index).map(item => item.form);
}
function formsMarkup(word, interactive = true) {
  const forms = visibleForms(word);
  return forms.length ? `<dl class="word-forms">${forms.map(form => `<div class="form-row"><dt>${esc(form.label)}</dt><dd>${interactive ? `<button class="form-value-button" data-action="speak-text" data-text="${esc(form.value)}" title="听读：${esc(form.value)}" aria-label="听读 ${esc(form.value)}">${esc(form.value)}</button>` : esc(form.value)}</dd></div>`).join('')}</dl>` : '';
}
function definitionMarkup(word, className = 'word-english') {
  return word.english ? `<p class="${className}" lang="en">${esc(word.english)}</p>` : `<p class="${className} pending">释义待核对 · 可手动补充</p>`;
}
function hasBuiltInAudio(text) { return !!audioMap[text]; }
function availableSpeech() { return !!(window.speechSynthesis && voices.length); }
function stopAudio() {
  if (activeAudio) { activeAudio.pause(); activeAudio.currentTime = 0; activeAudio = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
async function speak(text) {
  if (!text) return;
  stopAudio();
  const path = audioMap[text];
  if (path) {
    const clip = new Audio(path);
    activeAudio = clip;
    clip.playbackRate = state.rate;
    try { await clip.play(); window.OrdrumPWA?.clearAudioStart(); return; }
    catch (error) {
      if (activeAudio !== clip) return;
      activeAudio = null;
      if (error.name === 'NotAllowedError') {
        window.OrdrumPWA?.offerAudioStart(text,() => speak(text));
        return;
      }
    }
  }
  speakWithBrowser(text);
}
function speakWithBrowser(text) {
  if (!availableSpeech()) {
    notify('这段文字没有内置音频，浏览器也没有可用的瑞典语语音。请在发音设置中查看。');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(studyText(text));
  utterance.lang = 'sv-SE';
  utterance.voice = voices.find(voice => voice.voiceURI === state.voiceURI) || voices[0];
  utterance.rate = state.rate;
  utterance.onerror = event => { if (!['canceled','interrupted'].includes(event.error)) notify('发音暂时无法播放，请稍后再试。'); };
  window.speechSynthesis.speak(utterance);
}
function refreshVoices() {
  voices = 'speechSynthesis' in window ? speechSynthesis.getVoices().filter(voice => /^sv([-_]|$)/i.test(voice.lang)) : [];
  if (availableSpeech()) $('.audio-notice')?.remove();
}
function audioNotice(word) {
  if (hasBuiltInAudio(word?.swedish) || availableSpeech()) return '';
  return `<div class="audio-notice">${icon('info')}<span>当前没有可播放的瑞典语音频。可以先预览或翻卡片，或在<button data-action="audio-settings">发音设置</button>中查看。</span></div>`;
}
function renderChapters() {
  const notebook = state.selectedBook === '__notebook__';
  const chapters = notebook ? StudyCore.notebookChapters(state) : data.chapters;
  const selection = notebook ? state.selectedNotebookChapters : state.selectedChapters;
  const select = $('#book-select');
  if (select) select.value = state.selectedBook || data.book.id;
  const caption = $('.book-caption');
  if (caption) caption.textContent = notebook ? '错词记录 · 30 词单元' : 'ORDKORT';
  if ($('#notebook-button')) $('#notebook-button').hidden = !notebook;
  const count = $('#chapter-picker-count');
  if (count) count.textContent = `已选 ${selection.length} 章`;
  const counts = {};
  data.words.forEach(word => { counts[word.chapter] = (counts[word.chapter] || 0) + 1; });
  $('#chapter-list').innerHTML = chapters.map((chapter,index) => {
    const id = notebook ? chapter.id : Number(chapter.id);
    const selected = selection.includes(id);
    return `<label class="chapter-option ${selected ? 'selected' : ''}"><span><input type="checkbox" value="${esc(id)}" ${selected ? 'checked' : ''}><span class="chapter-number">${notebook ? String(index+1).padStart(2,'0') : String(chapter.id).padStart(2,'0')}</span>${esc(chapter.title || `Kapitel ${chapter.id}`)}</span><span class="chapter-count">${notebook ? chapter.count : counts[chapter.id] || 0}</span></label>`;
  }).join('');
}
function renderSummary() {
  const selected = selectedWords();
  const chapters = state.selectedChapters.slice().sort((a,b) => a-b);
  let title;
  if (!chapters.length) title = '选择章节';
  else if (chapters.length === data.chapters.length) title = '全书';
  else if (chapters.length === 1) title = `Kapitel ${chapters[0]}`;
  else if (chapters.length <= 3) title = `Kapitel ${chapters.join(' + ')}`;
  else title = `已选择 ${chapters.length} 个章节`;
  if (state.selectedBook === '__notebook__') {
    const chosen = StudyCore.notebookChapters(state).filter(chapter => state.selectedNotebookChapters.includes(chapter.id));
    title = chosen.length === 1 ? chosen[0].title : chosen.length ? `错题本 · ${chosen.length} 个章节` : '错题本 · 选择章节';
  }
  $('#selection-title').textContent = title;
  const uniqueCount = new Set(selected.map(word => word.swedish)).size;
  $('#selection-description').textContent = chapters.length ? `${chapters.length} 个章节 · ${selected.length} 张单词卡${uniqueCount < selected.length ? ` · ${uniqueCount} 个不同词条` : ''}` : '在书架选择章节，或打开错题本。';
  if (state.selectedBook === '__notebook__') $('#selection-description').textContent = `${selected.length} 张错词卡 · 今天与本周自动更新，30 词单元保留分组`;
  $('#known-count').textContent = selected.filter(word => markStatus(word.id) === 'known').length;
  if (retryMode) {
    $('#selection-title').textContent = planKind === 'today' ? '今日计划' : '错词重练';
    $('#selection-description').textContent = `${currentDeck.length} 张卡片 · 练习后可返回原学习进度`;
  }
  window.OrdrumStudyUI.renderContext();
  if ($('#today-plan')) $('#today-plan').hidden = retryMode;
  planPageView?.render();
}
function refreshCalendarViews() {
  if (!data || document.visibilityState === 'hidden') return;
  const day = window.OrdrumReview?.localDay(new Date()) || new Date().toDateString();
  const changed = renderedDay && renderedDay !== day;
  renderedDay = day;
  if (changed && state.selectedBook === '__notebook__' && !activeStudyTask() && !retryMode) {
    const oldFlash = currentDeck[flashIndex], oldDictation = currentDeck[dictationIndex];
    const nextDeck = selectedWords().map(word => word.id);
    if (JSON.stringify(currentDeck) !== JSON.stringify(nextDeck)) {
      currentDeck = nextDeck;
      flashIndex = Math.max(0,nextDeck.indexOf(oldFlash));
      dictationIndex = Math.max(0,nextDeck.indexOf(oldDictation));
      if (!nextDeck.includes(oldFlash)) flipped = false;
      if (!nextDeck.includes(oldDictation)) { dictationResult = null; dictationDraft = ''; }
      renderMode({autoplay:false}); save();
    }
  }
  renderChapters(); renderSummary();
}
function resetDeck() {
  reviewSessionId = newReviewSessionId(); planKind = '';
  retryMode = false;
  currentDeck = selectedWords().map(word => word.id);
  flashIndex = 0; flipped = false; dictationIndex = 0; dictationResult = null;
  dictationAnswers = {}; mistakes = new Set(); retryMode = false; page = 1;
  dictationDraft = '';
}
function currentWord(index) {
  const id = currentDeck[index];
  const base = data.words.find(word => word.id === id);
  return base ? wordFor(base) : null;
}
function renderMode({autoplay = true} = {}) {
  if (state.mode !== 'flashcard') window.OrdrumWordExtras?.unmount();
  renderToken++;
  const token = renderToken;
  $$('.mode-tab').forEach(tab => {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle('active',active);
    tab.setAttribute('aria-selected',String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  $('#mode-content').setAttribute('aria-labelledby',`tab-${state.mode}`);
  if (!selectedWords().length) {
    $('#mode-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('book')}</div><h3>给今天选几张单词卡</h3><p>勾选想学的章节，就可以预览、翻卡片和听写了。</p><button class="primary-button" data-action="start-first">从第一章开始 ${icon('right')}</button></div>`;
    return;
  }
  if (!currentDeck.length) resetDeck();
  if (state.mode === 'preview') renderPreview();
  else if (state.mode === 'flashcard') renderFlashcard();
  else renderDictation();
  if (state.mode === 'dictation' && !dictationResult) {
    $('#dictation-answer')?.focus({preventScroll:true});
    if (autoplay) speak(currentWord(dictationIndex).swedish);
  }
  if (autoplay && state.autoPlay && state.mode === 'flashcard' && !flipped) {
    const word = currentWord(flashIndex);
    setTimeout(() => { if (token === renderToken && word && state.autoPlay && state.mode === 'flashcard' && !flipped) speak(word.swedish); }, 120);
  }
  save();
}
function renderPreview() {
  $('#mode-content').innerHTML = `<div class="preview-toolbar"><label class="search-wrap">${icon('search')}<span class="sr-only">搜索瑞典语或英文释义</span><input type="search" id="word-search" placeholder="搜索瑞典语、英文释义…" value="${esc(search)}" autocomplete="off"></label><div class="preview-tools"><span class="result-count" id="result-count"></span><div class="view-toggle" aria-label="预览布局"><button class="${state.layout === 'grid' ? 'active' : ''}" data-action="layout" data-layout="grid" title="卡片视图" aria-label="卡片视图" aria-pressed="${state.layout === 'grid'}">${icon('grid')}</button><button class="${state.layout === 'list' ? 'active' : ''}" data-action="layout" data-layout="list" title="列表视图" aria-label="列表视图" aria-pressed="${state.layout === 'list'}">${icon('list')}</button></div></div></div><div id="preview-results"></div>`;
  renderPreviewResults();
  $('#word-search').addEventListener('input',event => { search = event.target.value; page = 1; renderPreviewResults(); save(); });
}
function renderPreviewResults() {
  const query = search.trim().toLocaleLowerCase('sv');
  const words = selectedWords().filter(word => !query || `${word.swedish} ${word.english || ''} ${visibleForms(word).map(form => form.value).join(' ')}`.toLocaleLowerCase('sv').includes(query));
  const pages = Math.max(1,Math.ceil(words.length / PAGE_SIZE));
  page = Math.min(page,pages);
  $('#result-count').textContent = `${words.length} 张卡片`;
  if (!words.length) {
    $('#preview-results').innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('search')}</div><h3>这一组里还没有找到</h3><p>试试其他拼写，或多选几个章节。</p><button class="secondary-button" data-action="clear-search">清空搜索</button></div>`;
    return;
  }
  const start = (page-1)*PAGE_SIZE;
  $('#preview-results').innerHTML = `<div class="word-grid ${state.layout === 'list' ? 'list-view' : ''}">${words.slice(start,start+PAGE_SIZE).map(word => `<article class="word-card ${markStatus(word.id) === 'known' ? 'is-known' : ''}"><div class="word-card-top"><span class="word-tag">KAPITEL ${word.chapter}</span><span class="word-tag pos">${esc(posLabel(word.pos))}</span></div><div class="word-title-row"><h3 class="swedish-word" lang="sv">${esc(word.swedish)}</h3><button class="sound-button" data-action="speak" data-id="${esc(word.id)}" title="听读 ${esc(word.swedish)}" aria-label="听读 ${esc(word.swedish)}">${icon('sound')}</button></div>${definitionMarkup(word)}${formsMarkup(word)}<div class="word-card-footer"><button class="known-toggle ${markStatus(word.id) === 'known' ? 'marked' : ''}" data-action="toggle-known" data-id="${esc(word.id)}" aria-pressed="${markStatus(word.id) === 'known'}">${icon('check')}${markStatus(word.id) === 'known' ? '已掌握' : '标为掌握'}</button><button class="edit-button" data-action="edit" data-id="${esc(word.id)}">编辑</button></div></article>`).join('')}</div><div class="preview-footer"><span>点按词形听读</span><div class="pagination"><button class="small-square" data-action="page-prev" ${page === 1 ? 'disabled' : ''} aria-label="上一页">${icon('left')}</button><span>${page} / ${pages}</span><button class="small-square" data-action="page-next" ${page === pages ? 'disabled' : ''} aria-label="下一页">${icon('right')}</button></div></div>`;
}
function studyTopline(index, type) {
  return `<div class="study-topline"><div class="study-counter"><strong>${Math.min(index+1,currentDeck.length)}</strong> / ${currentDeck.length} <span>${planKind === 'today' ? ' · 今日计划' : retryMode && type === 'dictation' ? ' · 错词重练' : ''}</span></div><div class="study-controls">${planKind === 'plan' ? '<button class="control-button" data-action="skip-today">跳过此词</button>' : planKind === 'today' ? '<button class="control-button" data-action="skip-today">今天跳过</button><button class="control-button" data-action="return-to-study">返回原进度</button>' : ''}${type === 'flashcard' ? `<label class="auto-play"><input type="checkbox" id="auto-play" ${state.autoPlay ? 'checked' : ''}>自动读音</label>` : isPlanPractice() ? '' : `<button class="control-button" data-action="retry-mistakes" ${!mistakes.size ? 'disabled' : ''}>${icon('reset')}重练错词 (${mistakes.size})</button>`}<button class="control-button" data-action="shuffle">${icon('shuffle')}打乱顺序</button></div></div><div class="study-progress" role="progressbar" aria-label="本轮卡片位置" aria-valuemin="0" aria-valuemax="${currentDeck.length}" aria-valuenow="${index+1}"><span style="width:${((index+1)/currentDeck.length)*100}%"></span></div>`;
}
function renderFlashcard() {
  const word = currentWord(flashIndex);
  if (!word) { resetDeck(); return renderMode(); }
  const previousExtras = window.OrdrumWordExtras ? $('#word-extras') : null;
  const preserveExtras = flipped && previousExtras?.dataset.wordId === word.id;
  if (!preserveExtras) window.OrdrumWordExtras?.unmount();
  $('#mode-content').innerHTML = `${studyTopline(flashIndex,'flashcard')}${audioNotice(word)}<div class="flash-layout"><div class="flash-main"><article class="flash-card ${flipped ? 'back' : ''}" data-flashcard="true" aria-label="单词卡"><div class="flash-card-tools"><span class="flash-label">${esc(posLabel(word.pos))} · ${word.chapter}</span><div><button class="sound-button" data-action="speak" data-id="${esc(word.id)}" aria-label="听读此词">${icon('sound')}</button><button class="edit-button" data-action="edit" data-id="${esc(word.id)}" aria-label="编辑词条">${icon('edit')}</button></div></div><div class="flash-source"><h3 class="flash-word" lang="sv">${esc(word.swedish)}</h3></div><div class="flash-definition" id="flash-definition" ${flipped ? '' : 'hidden'}>${flipped ? `<p class="flash-english" lang="en">${esc(word.english || '释义待补充')}</p>${flashFormsMarkup(word)}<div id="word-extras" class="word-extras"></div>` : ''}</div><button type="button" class="flip-toggle" data-action="flip" aria-expanded="${flipped}" aria-controls="flash-definition">${icon('flip')}${flipped ? '收起释义' : '翻开释义'}</button></article><div class="flash-actions"><button class="small-square" data-action="flash-prev" ${flashIndex === 0 ? 'disabled' : ''} aria-label="上一张">${icon('left')}</button><button class="secondary-button" data-action="flash-review">再记一次</button><button class="primary-button" data-action="flash-known">已经记住</button><button class="small-square" data-action="flash-next" aria-label="下一张">${icon('right')}</button></div><p class="shortcut-note"><kbd>空格</kbd> 翻面 · <kbd>←</kbd><kbd>→</kbd> 换词 · 文字可选中复制</p></div></div>`;
  if (flipped && window.OrdrumWordExtras) {
    const placeholder = $('#word-extras');
    if (preserveExtras && placeholder !== previousExtras) placeholder.replaceWith(previousExtras);
    const extras = preserveExtras ? previousExtras : placeholder;
    extras.dataset.wordId = word.id;
    window.OrdrumWordExtras.mount(extras,word,{onStop:stopAudio});
  }
  $('#auto-play')?.addEventListener('change',event => {
    state.autoPlay = event.target.checked;
    renderToken++;
    save();
    if (state.autoPlay && !flipped) speak(word.swedish);
  });
}
function flashFormsMarkup(word) {
  const forms = visibleForms(word);
  const brief = label => ({'命令式':'命令','不定式':'不定','现在时':'现在','过去时':'过去','完成式用形 (supinum)':'完成','完成式':'完成'}[label] || label);
  return forms.length ? `<dl class="word-forms flash-forms">${forms.map(form => `<div class="form-row"><dt title="${esc(form.label)}">${esc(brief(form.label))}</dt><dd><button class="form-value-button" data-action="speak-text" data-text="${esc(form.value)}" aria-label="听读 ${esc(form.value)}">${esc(form.value)}</button></dd></div>`).join('')}</dl>` : '';
}
function toggleFlashcard() {
  const word = currentWord(flashIndex);
  if (!word) return;
  flipped = !flipped;
  renderToken++;
  renderFlashcard();
  if (!flipped && state.autoPlay) speak(word.swedish);
}
function renderDictation() {
  const word = currentWord(dictationIndex);
  if (!word) { resetDeck(); return renderMode(); }
  const answered = Object.keys(dictationAnswers).length;
  const correct = Object.values(dictationAnswers).filter(answer => answer === 'correct').length;
  let feedback = '';
  if (dictationResult) {
    const good = dictationResult.status === 'correct';
    feedback = `<div class="dictation-feedback ${good ? '' : 'wrong'}" role="status"><strong>${good ? '写对了，bra jobbat!' : dictationResult.status === 'revealed' ? '一起再读一遍' : '差一点，再看看这个词'}</strong><span class="answer-word" lang="sv">${esc(studyText(word.swedish))}</span><span class="answer-english" lang="en">${esc(word.english || '释义待核对')}</span>${formsMarkup(word)}</div>`;
  }
  $('#mode-content').innerHTML = `${studyTopline(dictationIndex,'dictation')}${audioNotice(word)}<div class="dictation-panel"><div class="dictation-eyebrow">LYSSNA & SKRIV · 听一听，写下来</div><button class="listen-orb" data-action="speak" data-id="${esc(word.id)}" aria-label="播放听写单词，不显示答案">${icon('sound')}</button><h3>${dictationResult ? '读一遍，让它留在记忆里' : '你听到了什么？'}</h3><p class="dictation-caption">Kapitel ${word.chapter} · ${esc(posLabel(word.pos))} · 点按上方按钮，可重复听读</p><form id="dictation-form"><label class="answer-field ${dictationResult ? dictationResult.status === 'correct' ? 'correct' : 'incorrect' : ''}"><span class="sr-only">输入听到的瑞典语</span><input id="dictation-answer" type="text" lang="sv" placeholder="在这里写下瑞典语…" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" value="${esc(dictationResult?.input ?? dictationDraft)}" ${dictationResult ? 'readonly' : ''}></label>${!dictationResult ? '<div class="swedish-keys" aria-label="瑞典语字母"><button type="button" data-action="insert-letter" data-letter="å">å</button><button type="button" data-action="insert-letter" data-letter="ä">ä</button><button type="button" data-action="insert-letter" data-letter="ö">ö</button></div>' : '<div style="height:21px"></div>'}<div class="dictation-actions">${!dictationResult ? `<button type="button" class="secondary-button" data-action="reveal-answer">看答案</button><button type="submit" class="primary-button">检查答案 ${icon('right')}</button>` : dictationResult.status === 'correct' ? `<button type="button" class="secondary-button" data-action="dict-retry">再写一次</button><button type="button" class="primary-button" data-action="dict-next">${dictationIndex === currentDeck.length-1 ? '完成本轮' : '下一个'} ${icon('right')}</button>` : `<button type="button" class="secondary-button" data-action="dict-next">跳过此词 ${icon('right')}</button><button type="button" class="primary-button" data-action="dict-retry">重新听写 ${icon('reset')}</button>`}</div></form>${feedback}<div class="dictation-session"><span><strong>${answered}</strong>已练习</span><span><strong>${correct}</strong>首次写对</span><span><strong>${mistakes.size}</strong>需要再记</span></div></div><p class="shortcut-note">冠词 en/ett 可省略；<b>å · ä · ö</b> 要区分。忽略大小写、多余空格和句末标点。<kbd>Enter</kbd> ${!dictationResult ? '检查拼写' : dictationResult.status === 'correct' ? '进入下一个词' : '重新听写本词'}</p>`;
  $('#dictation-form').addEventListener('submit',event => {
    event.preventDefault();
    if (dictationResult) advanceDictation();
    else checkAnswer();
  });
  $('#dictation-answer').addEventListener('input',event => {
    dictationDraft = event.target.value;
    save();
  });
}
function studyText(text) {
  return String(text).replace(/^\s*\((en|ett)\)\s*/i,'$1 ').replace(/\s*\((?:adj\.?|adv\.?|v\.?|s\.?|noun|verb|adjective|adverb)\)/gi,'').trim();
}
function normalizeAnswer(text) {
  return String(text).normalize('NFC').toLocaleLowerCase('sv').trim().replace(/\s+/g,' ').replace(/[.!?。！？]+$/u,'').trim();
}
function checkAnswer() {
  const input = $('#dictation-answer');
  const typed = input.value.trim();
  if (!typed) { notify('先写下你听到的单词。'); input.focus(); return; }
  const word = currentWord(dictationIndex);
  const expected = studyText(word.swedish);
  const answers = [expected,expected.replace(/^(?:en|ett)\s+/i,''),...(Array.isArray(word.answers) ? word.answers : [])];
  const correct = answers.some(answer => normalizeAnswer(answer) === normalizeAnswer(typed));
  const status = correct ? 'correct' : 'wrong';
  const firstAttempt = !(word.id in dictationAnswers);
  if (firstAttempt) dictationAnswers[word.id] = status;
  recordReviewAssessment(word.id,status,firstAttempt);
  if (!correct) mistakes.add(word.id);
  dictationDraft = typed;
  dictationResult = {status,input:typed};
  recordStudyResult(word.id,status,typed);
  renderDictation();
  $('#dictation-answer')?.focus({preventScroll:true});
}
function changeChapters(chapters) {
  save();
  state.activeTaskId = null;
  state.reviewSession = null;
  if (state.selectedBook === '__notebook__') state.selectedNotebookChapters = StudyCore.notebookChapterSelection({...state,selectedNotebookChapters:chapters});
  else state.selectedChapters = chapters;
  stopAudio(); resetDeck(); save(); renderChapters(); renderSummary(); renderMode();
}
function flashMove(delta, wrap = false) {
  const next = flashIndex + delta;
  if (next < 0) return;
  if (next >= currentDeck.length) {
    if (isPlanPractice()) { finishPlanStage(); return; }
    if (planKind === 'today') {
      stopAudio(); save();
      openDialog('今日计划已完成',`<p>已走完本轮 ${currentDeck.length} 张卡片。翻卡自评与听写首次结果分别记录；之后会按复习间隔安排。</p><div class="dialog-actions"><button class="primary-button" data-action="return-to-study">返回原学习进度</button></div>`);
      return;
    }
    notify('这一轮翻完了。再看一遍，让记忆更牢。');
    flashIndex = wrap ? 0 : currentDeck.length - 1;
  } else flashIndex = next;
  flipped = false; stopAudio(); renderMode();
}
function dictNext() {
  if (dictationIndex >= currentDeck.length-1) { stopAudio(); if (isPlanPractice()) finishPlanStage(); else showRoundComplete(); return; }
  dictationIndex++; dictationResult = null; dictationDraft = ''; stopAudio(); renderMode();
}
function retryDictation() {
  dictationResult = null;
  dictationDraft = '';
  stopAudio();
  renderDictation();
  $('#dictation-answer')?.focus({preventScroll:true});
  speak(currentWord(dictationIndex).swedish);
  save();
}
function advanceDictation() {
  if (dictationResult?.status === 'correct') dictNext();
  else if (dictationResult) retryDictation();
}
function shuffleDeck() {
  for (let i=currentDeck.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [currentDeck[i],currentDeck[j]] = [currentDeck[j],currentDeck[i]];
  }
  flashIndex = 0; flipped = false; dictationIndex = 0; dictationResult = null;
  dictationDraft = '';
  stopAudio(); renderMode(); notify('已打乱本轮卡片。');
}
function openDialog(title, body, mount = null) {
  if (mount) { mount.innerHTML = `<div class="dialog-body settings-inline-content">${body}</div>`; return; }
  window.OrdrumStudyUI?.dialogChanged();
  $('#dialog-content').innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${esc(title)}</h2><button class="close-button" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></div><div class="dialog-body">${body}</div>`;
  const dialog = $('#app-dialog');
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  pendingRestore = null;
  if ($('#app-dialog').open) $('#app-dialog').close();
  else window.OrdrumSettings?.close();
}
function showHelp(mount = null) {
  if (!mount && window.OrdrumSettings) return window.OrdrumSettings.open('archive');
  openDialog('使用说明',`<h3>先选章节，再挑一个练习方式</h3><p>「预览」查看词义和词形；「翻卡片」先回想，再翻面；「听写」反复听读并写下瑞典语。单词卡沿用原书的章节，同一词语可能在不同章节出现。</p><h3>词义与词形</h3><p>单词卡从你提供的 Rivstart A1/A2 Ordkort 提取。英文释义与语法形式由公开词典自动匹配，可能有多义词或短语未完全匹配。缺失内容会明确标出，可点「编辑」补充或订正。请结合教材语境理解。</p><p>名词展示可查到的单数不定、单数定、复数不定、复数定形式；动词展示可查到的命令式、不定式、现在、过去、完成式。没有可靠匹配的形式留空。</p><h3>听读与听写</h3><p>${Object.keys(audioMap).length ? '已内置瑞典语合成发音；词形和你自行补充的内容使用浏览器提供的瑞典语语音。' : '听读使用浏览器中可用的瑞典语语音。'}可在「设置 → 发音」调整语速。听写每到一个新词会自动播放，输入后按回车检查；答对后再次回车进入下一词，答错后再次回车重新听写本词并播放音频。听写保留 å、ä、ö 的区别，忽略大小写、多余空格和句末标点。</p><h3>今日计划与词卡参考</h3><p>右上角「计划学习」按到期词优先安排，提供分组主动回忆（30新＋90复习）、听写巩固（20新＋80复习）、快速交错复习（40新＋160复习）。这是约一小时的可调整上限，使用实际可用词数；新词和复习词合计，不代表一小时能掌握同等数量的新词。每组10–25词，保存分组、首次答案、位置与前台学习时间，可暂停续学。成功后默认按1、3、7、14、30天安排，未记住的词约10分钟后再出现；间隔可调整。翻卡自评与听写首答分别统计。词卡可按需联网查询同义词、反义词、瑞典语音标和例句，当前词形缺失时补查原型；再次关闭即收起，不修改释义。参考资料可在档案中展开。</p><h3>你的学习记录</h3><p>可以用已选章节或整本书创建学习任务。每个任务分别记录掌握进度、错词和学习位置；刷新或重新打开网页可继续。在书架中选择「错题本」这本书，可勾选今天、本周或固定单元作为章节；管理按钮可整理、重命名或删除分组，删除分组不删除错词。错题本还可按任务、原书章节、状态筛选，批量重练、标为掌握或删除。任务可重命名、归档、重置和删除。章节选择、任务、错题与修改会保存在此设备；在「设置 → 同步设置」连接同一个 GitHub 私有进度仓库后，会在电脑、手机及主屏幕 App 之间自动同步。同步状态和操作统一放在「设置 → 同步设置」。离线时先保存在本机，联网后合并上传。设置中的档案标签可以导出或导入全部记录。清理浏览器数据会清除本地记录，请按需备份。</p><h3>资料来源与许可</h3><p>教材：Rivstart A1/A2 Ordkort，来自你提供的 PDF。教材内容用于你的个人学习。词典来源：</p><a class="source-link" href="https://folkets-lexikon.csc.kth.se/folkets/om.en.html" target="_blank" rel="noopener noreferrer">Folkets lexikon · 英文释义 · CC BY-SA 2.5</a><a class="source-link" href="https://sprakbanken.se/en/resources/saldom" target="_blank" rel="noopener noreferrer">Språkbanken Text · SALDO 瑞典语词形 · CC BY 4.0</a><div class="dialog-actions"><button class="primary-button" data-action="close-dialog">开始学习</button></div>`,mount);
}
function showAudioSettings(mount = null) {
  if (!mount && window.OrdrumSettings) return window.OrdrumSettings.open('audio');
  const builtin = Object.keys(audioMap).length;
  openDialog('发音设置',`<p>${builtin ? '已内置瑞典语合成发音。点按单词旁的喇叭就能听读。' : '使用设备或浏览器提供的瑞典语语音来读出单词。'}</p><label>听读语速</label><div class="settings-rates"><button data-action="set-rate" data-rate="0.7" class="${state.rate === 0.7 ? 'active' : ''}">慢一点</button><button data-action="set-rate" data-rate="0.85" class="${state.rate === 0.85 ? 'active' : ''}">适中</button><button data-action="set-rate" data-rate="1" class="${state.rate === 1 ? 'active' : ''}">自然</button></div><label for="voice-select">词形及自定义内容的发音</label>${voices.length ? `<select id="voice-select">${voices.map(voice => `<option value="${esc(voice.voiceURI)}" ${state.voiceURI === voice.voiceURI ? 'selected' : ''}>${esc(voice.name)} · ${esc(voice.lang)}</option>`).join('')}</select><p style="font-size:10px;margin-top:7px">使用浏览器中的瑞典语语音。语音可用性取决于设备。</p>` : `<div class="no-voice">当前浏览器没有提供瑞典语语音。${builtin ? '书中单词的内置发音仍可正常播放。' : '暂时无法听读。'}如需读出词形，可在设备的语音设置中安装瑞典语声音，然后重新打开页面。</div>`}<label class="inline-label"><input type="checkbox" id="settings-autoplay" ${state.autoPlay ? 'checked' : ''}>翻卡片时自动播放读音</label><div class="dialog-actions"><button class="secondary-button" data-action="test-audio">${icon('sound')}试听：hej</button><button class="primary-button" data-action="close-dialog">完成</button></div>`,mount);
  $('#voice-select')?.addEventListener('change',event => { state.voiceURI = event.target.value; save(); });
  $('#settings-autoplay').addEventListener('change',event => { state.autoPlay = event.target.checked; save(); });
}
function formEditRow(label = '', value = '') {
  return `<div class="edit-form-row"><input class="form-label-input" aria-label="词形名称" placeholder="例如：过去式" value="${esc(label)}"><input class="form-value-input" aria-label="瑞典语词形" placeholder="瑞典语词形" lang="sv" value="${esc(value)}"><button type="button" class="remove-form" data-action="remove-form" aria-label="移除这个词形">×</button></div>`;
}
function showEdit(id) {
  const base = data.words.find(word => word.id === id);
  if (!base) return;
  const word = wordFor(base);
  const forms = visibleForms(word);
  openDialog(`编辑 · ${word.swedish}`,`<form id="edit-word-form" data-id="${esc(id)}"><p>补充你在教材中遇到的意思，或订正自动匹配的词形。</p><label for="edit-english">英文释义</label><textarea id="edit-english" lang="en" placeholder="写下英文释义…">${esc(word.english || '')}</textarea><label for="edit-pos">词性</label><input id="edit-pos" value="${esc(word.pos || '')}" placeholder="noun / verb / adjective / phrase…"><label>词形 · 点「添加」可补充更多形式</label><div class="edit-forms" id="edit-forms">${forms.map(form => formEditRow(form.label,form.value)).join('')}</div><button type="button" class="add-form" data-action="add-form">＋ 添加词形</button><div class="form-source">修改保存在学习记录中，连接 GitHub 私有进度仓库后会同步，并包含在备份中。原书中的瑞典语词条保留不变。</div><div class="dialog-actions">${state.overrides[id] ? `<button type="button" class="secondary-button" data-action="restore-word" data-id="${esc(id)}">恢复词典内容</button>` : ''}<button type="submit" class="primary-button">保存修改</button></div></form>`);
  $('#edit-word-form').addEventListener('submit',event => {
    event.preventDefault();
    const forms = $$('.edit-form-row').map(row => ({label:$('.form-label-input',row).value.trim() || '词形',value:$('.form-value-input',row).value.trim()})).filter(form => form.value);
    state.overrides[id] = {english:$('#edit-english').value.trim(),pos:$('#edit-pos').value.trim(),forms,definitionStatus:'manual'};
    save(); closeDialog(); renderMode({autoplay:false}); notify('已保存你的修改。');
  });
}
function showProgress(mount = null) {
  if (!mount && window.OrdrumSettings) return window.OrdrumSettings.open('archive');
  const known = data.words.filter(word => (typeof state.marks[word.id] === 'string' ? state.marks[word.id] : state.marks[word.id]?.status) === 'known').length;
  const requestedCredits = window.OrdrumWordExtras?.getCredits?.();
  const references = (Array.isArray(requestedCredits) ? requestedCredits : []).slice(0,80).filter(record => {
    try { const url = new URL(record.url); return url.protocol === 'https:' && url.hostname === 'en.wiktionary.org' && !url.port && !url.username && !url.password && url.pathname.startsWith('/wiki/') && url.hash === '#Swedish'; } catch (_) { return false; }
  });
  const credits = `<details class="archive-references"><summary>参考资料${references.length ? ` · ${references.length}` : ''}</summary><p>词卡扩展取自 Wiktionary 瑞典语条目，摘录经过筛选与简化排版。文本采用 <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a> 许可；下列链接保留所查询的具体修订。</p>${references.length ? `<ul>${references.map(record => `<li><a href="${esc(record.url)}" target="_blank" rel="noopener noreferrer"><span lang="sv">${esc(record.title)}</span></a> · ${esc(record.source)}${Number.isSafeInteger(record.revision) && record.revision > 0 ? ` · 修订 ${record.revision}` : ''}</li>`).join('')}</ul>` : '<p>按需查询后，本次会话的参考条目会显示在这里。</p>'}</details>`;
  openDialog('学习档案',`<p>全书共有 <b>${known}</b> 张卡片标为已掌握，<b>${state.tasks.length}</b> 个学习任务，错题本有 <b>${Object.keys(state.notebook).length}</b> 个词条，<b>${Object.keys(state.overrides).length}</b> 个词条有你的修改。记录同时保存在此设备；连接同一个 GitHub 私有进度仓库后，可与其他设备自动同步。</p><div class="progress-actions"><button class="secondary-button" data-action="export-progress">${icon('download')}导出学习记录</button><button class="secondary-button" data-action="import-progress">${icon('upload')}从备份恢复记录</button></div><p style="font-size:10px;margin-top:18px">备份包含任务、错词章节、复习历史与计划、学习位置、掌握标记和词条修改。恢复前先预览变化，并自动备份当前记录；已有学习位置优先保留。</p>${credits}`,mount);
}
function downloadBackup(backup,prefix = 'ordrum-progress') {
  const blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `${prefix}-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
function exportProgress() {
  captureStudySession();
  downloadBackup({app:'ordrum',version:1,book:data.book.id,exportedAt:new Date().toISOString(),state});
  notify('学习记录已导出。');
}
function recoveryScope() {
  return {accountId:window.OrdrumCloud?.getHealth?.().accountId || null,bookId:data?.book?.id || 'rivstart-a1-a2'};
}
function mergedBackupState(incoming,replace = false) {
  const next = replace ? normaliseCloudState(window.OrdrumSyncHealth.safeState(incoming)) : JSON.parse(JSON.stringify(state));
  const validIds = new Set(data.words.map(word => word.id));
  if (!replace) {
    if (incoming.marks && typeof incoming.marks === 'object' && !Array.isArray(incoming.marks)) {
      Object.entries(incoming.marks).forEach(([id,mark]) => { if (validIds.has(id) && ['known','review'].includes(typeof mark === 'string' ? mark : mark?.status)) next.marks[id] = mark; });
    }
    if (incoming.overrides && typeof incoming.overrides === 'object' && !Array.isArray(incoming.overrides)) {
      Object.entries(incoming.overrides).forEach(([id,override]) => {
        if (!validIds.has(id) || !override || typeof override !== 'object') return;
        next.overrides[id] = {english:String(override.english || '').slice(0,10000),pos:String(override.pos || '').slice(0,100),forms:Array.isArray(override.forms) ? override.forms.filter(form => form && typeof form.value === 'string').slice(0,30).map(form => ({label:String(form.label || '词形').slice(0,100),value:form.value.slice(0,1000)})) : [],definitionStatus:'manual'};
      });
    }
    if (Array.isArray(incoming.selectedChapters)) next.selectedChapters = incoming.selectedChapters.map(Number).filter(id => data.chapters.some(chapter => Number(chapter.id) === id));
    if ([0.7,0.85,1].includes(Number(incoming.rate))) next.rate = Number(incoming.rate);
    if (typeof incoming.autoPlay === 'boolean') next.autoPlay = incoming.autoPlay;
    if (typeof incoming.voiceURI === 'string') next.voiceURI = incoming.voiceURI;
    StudyCore.merge(next,incoming,data);
    next.planSessions = window.OrdrumCloud.mergeThreeWay({}, {planSessions:next.planSessions || {}}, {planSessions:incoming.planSessions || {}}).planSessions || {};
  }
  // Review events are immutable history, including events collected since a recovery point.
  next.reviewEvents = window.OrdrumReview?.mergeEvents(state.reviewEvents,incoming.reviewEvents,data) || next.reviewEvents || {};
  if (!replace && incoming.reviewPreferences && Date.parse(incoming.reviewPreferences.updatedAt || '') > Date.parse(next.reviewPreferences?.updatedAt || '1970-01-01')) next.reviewPreferences = incoming.reviewPreferences;
  return normaliseCloudState(next);
}
function previewRestore(backup,{replace = false} = {}) {
  if (backup?.app !== 'ordrum' || backup.version !== 1 || !backup.state || typeof backup.state !== 'object' || Array.isArray(backup.state) || (backup.book && backup.book !== data.book.id)) throw new Error('format');
  if (window.OrdrumCloud?.getHealth?.().recoveryPending) { notify('同步恢复尚未完成。请先在同步设置中重试，或导出当前记录。'); return; }
  if (isPlanPractice()) pausePlannedSession();
  captureStudySession();
  const candidate = mergedBackupState(backup.state,replace);
  const comparison = window.OrdrumSyncHealth?.preview(state,candidate);
  pendingRestore = {backup,replace,scope:recoveryScope(),before:JSON.stringify(state),candidate};
  window.OrdrumSettings?.close();
  openDialog(replace ? '预览恢复点' : '预览备份合并',`${comparison ? window.OrdrumSyncHealth.previewMarkup(comparison) : '<p>确认后恢复备份中的学习记录。</p>'}<p>${replace ? '此恢复点将替换任务、标记、错词及偏好；之后产生的复习事件仍保留。' : '任务和错词将合并；备份中的标记和词条修改将按此预览恢复。当前学习位置优先保留。'}</p><p>确认前会自动备份此设备当前记录。恢复点仅存在此浏览器，可在设置 → 同步设置中导出或恢复。</p><div class="dialog-actions"><button class="secondary-button" data-action="close-dialog">取消</button><button class="primary-button" data-action="confirm-restore">备份当前记录并恢复</button></div>`);
}
function commitRestore() {
  const pending = pendingRestore;
  if (!pending) return;
  const health = window.OrdrumCloud?.getHealth?.();
  if (health?.recoveryPending) { notify('同步恢复尚未完成，请先重试同步。'); return; }
  if (JSON.stringify(pending.scope) !== JSON.stringify(recoveryScope())) { pendingRestore = null; closeDialog(); notify('同步账号已变化，请重新打开本账号的恢复入口。'); return; }
  captureStudySession();
  if (pending.before !== JSON.stringify(state)) { previewRestore(pending.backup,{replace:pending.replace}); notify('记录已有变化，已更新恢复预览，请重新核对。'); return; }
  const recovery = window.OrdrumSyncHealth?.saveRecovery(state,{...pending.scope,reason:pending.replace ? 'recovery' : 'import'});
  if (!recovery?.ok) { notify('无法保存恢复前备份，尚未更改记录。请先导出档案并检查浏览器存储空间。'); return; }
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify({...pending.candidate,__cloudCommitId:cloudCommitId})); }
  catch (_) { notify('无法保存恢复后的记录，尚未更改当前进度。恢复前备份仍可导出。'); return; }
  planClockStarted = 0; moveStudySurface(false);
  state = pending.candidate; pendingRestore = null;
  restoreSavedStudy(); save(); renderChapters(); renderSummary(); renderMode({autoplay:false});
  closeDialog(); window.OrdrumSyncHealth?.refresh(); notify('记录已恢复，恢复前的备份保存在同步设置中。');
}
async function importProgress(file) {
  if (!file) return;
  try {
    if (file.size > 10*1024*1024) throw new Error('size');
    previewRestore(JSON.parse(await file.text()));
  } catch (_) { notify('无法读取这个备份，请选择 Ordrum 导出的同一本书的 JSON 文件。'); }
  $('#import-file').value = '';
}
function retryMistakes() {
  if (!mistakes.size) return;
  startNotebookReview(Array.from(mistakes),state.activeTaskId);
}
function showRoundComplete() {
  const answered = Object.keys(dictationAnswers).length;
  const correct = Object.values(dictationAnswers).filter(value => value === 'correct').length;
  openDialog('这一轮，完成了',`<p>你练习了 <b>${answered}</b> 张卡片，其中 <b>${correct}</b> 张首次写对。${mistakes.size ? `还有 <b>${mistakes.size}</b> 张值得再相遇一次。` : '给今天的坚持一个小小的肯定。'}</p><div class="dialog-actions"><button class="secondary-button" data-action="new-round">再练一轮</button>${mistakes.size ? '<button class="primary-button" data-action="retry-mistakes">重练错词</button>' : `<button class="primary-button" data-action="${retryMode ? 'return-to-study' : 'close-dialog'}">${retryMode ? '返回原学习进度' : '完成'}</button>`}${retryMode && mistakes.size ? '<button class="secondary-button" data-action="return-to-study">返回原学习进度</button>' : ''}</div>`);
}

document.addEventListener('click',event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || !data) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  const word = id ? data.words.find(item => item.id === id) : null;
  switch (action) {
    case 'speak': if (word) speak(word.swedish); break;
    case 'speak-text': speak(button.dataset.text); break;
    case 'audio-settings': showAudioSettings(); break;
    case 'toggle-known': setMark(id,markStatus(id) === 'known' ? null : 'known'); renderPreviewResults(); break;
    case 'edit': showEdit(id); break;
    case 'layout': state.layout = button.dataset.layout; save(); renderPreview(); break;
    case 'clear-search': search = ''; page = 1; renderPreview(); save(); break;
    case 'page-prev': page--; renderPreviewResults(); save(); $('#mode-content').scrollIntoView({block:'start',behavior:'smooth'}); break;
    case 'page-next': page++; renderPreviewResults(); save(); $('#mode-content').scrollIntoView({block:'start',behavior:'smooth'}); break;
    case 'start-first': changeChapters([Number(data.chapters[0].id)]); break;
    case 'flip': toggleFlashcard(); save(); break;
    case 'flash-prev': flashMove(-1); break;
    case 'flash-next': flashMove(1,true); break;
    case 'flash-known': recordReviewAssessment(currentDeck[flashIndex],'known'); setMark(currentDeck[flashIndex],'known'); flashMove(1,true); break;
    case 'flash-review': recordReviewAssessment(currentDeck[flashIndex],'again'); setMark(currentDeck[flashIndex],'review'); flashMove(1,true); break;
    case 'shuffle': shuffleDeck(); break;
    case 'reveal-answer': {
      const word = currentWord(dictationIndex);
      const input = $('#dictation-answer').value;
      const firstAttempt = !(word.id in dictationAnswers);
      if (firstAttempt) dictationAnswers[word.id] = 'revealed';
      recordReviewAssessment(word.id,'revealed',firstAttempt);
      mistakes.add(word.id); dictationDraft = input;
      dictationResult = {status:'revealed',input};
      recordStudyResult(word.id,'revealed',input); renderDictation();
      $('#dictation-answer')?.focus({preventScroll:true}); break;
    }
    case 'dict-retry': retryDictation(); break;
    case 'dict-next': dictNext(); break;
    case 'insert-letter': {
      const input = $('#dictation-answer');
      if (!input || input.readOnly) break;
      const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
      input.value = input.value.slice(0,start)+button.dataset.letter+input.value.slice(end);
      dictationDraft = input.value; save();
      input.focus({preventScroll:true}); input.setSelectionRange(start+1,start+1); break;
    }
    case 'retry-mistakes': retryMistakes(); break;
    case 'new-round':
      if (retryMode) startNotebookReview(currentDeck,state.activeTaskId);
      else { closeDialog(); resetDeck(); renderMode(); }
      break;
    case 'return-to-study': returnToStudy(); break;
    case 'skip-today': skipTodayWord(); break;
    case 'confirm-restore': commitRestore(); break;
    case 'close-dialog': closeDialog(); break;
    case 'set-rate': state.rate = Number(button.dataset.rate); save(); if (window.OrdrumSettings) window.OrdrumSettings.refresh('audio'); else showAudioSettings(); break;
    case 'test-audio': {
      const hej = data.words.find(item => normalizeAnswer(studyText(item.swedish)) === 'hej');
      speak(hej?.swedish || Object.keys(audioMap)[0] || 'hej'); break;
    }
    case 'add-form': $('#edit-forms').insertAdjacentHTML('beforeend',formEditRow()); break;
    case 'remove-form': button.closest('.edit-form-row').remove(); break;
    case 'restore-word': delete state.overrides[id]; save(); closeDialog(); renderMode({autoplay:false}); notify('已恢复词典提供的内容。'); break;
    case 'export-progress': exportProgress(); break;
    case 'import-progress': $('#import-file').click(); break;
  }
});
document.addEventListener('keydown',event => {
  if (!data || $('#app-dialog').open || $('dialog[open]') || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
  if (appPage === 'plan' && !isPlanPractice()) return;
  const tag = document.activeElement?.tagName;
  const inputFocused = ['INPUT','TEXTAREA','SELECT'].includes(tag);
  if (state.mode === 'flashcard' && !inputFocused && currentDeck.length) {
    if (event.shiftKey || window.getSelection?.()?.toString()) return;
    if (event.code === 'Space' && !['BUTTON','A'].includes(tag)) { event.preventDefault(); if (!event.repeat) { toggleFlashcard(); save(); } }
    if (event.key === 'ArrowLeft') { event.preventDefault(); flashMove(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); flashMove(1,true); }
  }
  if (state.mode === 'dictation' && event.key === 'Enter' && currentDeck.length) {
    const answerFocused = document.activeElement?.id === 'dictation-answer';
    if (!answerFocused && ['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(tag)) return;
    event.preventDefault();
    if (event.repeat) return;
    if (dictationResult) advanceDictation();
    else checkAnswer();
  }
});
$$('.mode-tab').forEach(tab => {
  tab.addEventListener('click',() => {
    if (!data || isPlanPractice()) return;
    stopAudio(); state.mode = tab.dataset.mode; save(); renderMode();
  });
  tab.addEventListener('keydown',event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = $$('.mode-tab');
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (index+(event.key === 'ArrowRight' ? 1 : -1)+tabs.length)%tabs.length;
    tabs[next].click(); tabs[next].focus();
    event.stopPropagation();
  });
});
$('#chapter-list').addEventListener('change',event => {
  if (!data || event.target.type !== 'checkbox') return;
  const notebook = state.selectedBook === '__notebook__';
  const id = notebook ? event.target.value : Number(event.target.value);
  const selected = notebook ? state.selectedNotebookChapters : state.selectedChapters;
  changeChapters(event.target.checked ? [...selected,id] : selected.filter(chapter => chapter !== id));
});
$('#select-all').addEventListener('click',() => { if (data) changeChapters(state.selectedBook === '__notebook__' ? StudyCore.notebookChapters(state).map(chapter => chapter.id) : data.chapters.map(chapter => Number(chapter.id))); });
$('#select-none').addEventListener('click',() => { if (data) changeChapters([]); });
$('#book-select').addEventListener('change',event => {
  if (!data) return;
  save(); state.activeTaskId = null; state.reviewSession = null;
  state.selectedBook = event.target.value === '__notebook__' ? '__notebook__' : data.book.id;
  state.selectedNotebookChapters = StudyCore.notebookChapterSelection(state);
  stopAudio(); resetDeck(); refreshStudyView();
});
$('#help-button')?.addEventListener('click',() => { if (data) showHelp(); });
$('#audio-settings-button')?.addEventListener('click',() => { if (data) showAudioSettings(); });
$('#progress-button')?.addEventListener('click',() => { if (data) showProgress(); });
$('#tasks-button').addEventListener('click',() => { if (data) { if (appPage === 'plan') showAppPage('study'); window.OrdrumStudyUI.showTasks(); } });
$('#create-task-button').addEventListener('click',() => { if (data) window.OrdrumStudyUI.showCreateTask(); });
$('#notebook-button').addEventListener('click',() => { if (data) window.OrdrumStudyUI.showNotebook(); });
$('#import-file').addEventListener('change',event => importProgress(event.target.files[0]));
$('#app-dialog').addEventListener('click',event => {
  if (event.target !== $('#app-dialog')) return;
  const box = event.target.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog();
});

async function init() {
  hydrateIcons(); restore(); refreshVoices();
  const chapterPicker = $('#chapter-picker');
  if (chapterPicker && window.matchMedia?.('(max-width:760px)')?.matches) chapterPicker.open = false;
  if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged',refreshVoices);
  try {
    const response = await fetch('vocab.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    if (!data || !Array.isArray(data.words) || !Array.isArray(data.chapters) || !data.chapters.length) throw new Error('词库格式不正确');
    data.book = data.book || {id:'rivstart-a1-a2',title:'Rivstart A1/A2 Ordkort'};
    try {
      const audioResponse = await fetch('audio-map.json');
      if (audioResponse.ok) audioMap = await audioResponse.json();
    } catch (_) { /* Browser Swedish speech remains available without bundled audio. */ }
    const chapterIds = new Set(data.chapters.map(chapter => Number(chapter.id)));
    state.selectedChapters = state.selectedChapters === null ? data.chapters.slice(0,2).map(chapter => Number(chapter.id)) : state.selectedChapters.filter(id => chapterIds.has(id));
    $('#book-select').innerHTML = `<option value="${esc(data.book.id)}">${esc(data.book.title.replace(/\s*Ordkort\s*/i,''))}</option><option value="__notebook__">错题本</option>`;
    $('#source-footer').textContent = `${data.book.title} · ${data.chapters.length} 章 · ${data.words.length} 张卡片`;
    restoreSavedStudy();
    mountPlanPage();
    renderChapters(); renderSummary(); renderMode();
    renderedDay = window.OrdrumReview?.localDay(new Date()) || new Date().toDateString();
    window.OrdrumSettings?.refresh('audio');
    window.OrdrumSettings?.refresh('archive');
    window.OrdrumCloud?.start({
      ...(window.OrdrumGitHubSync?.cloudOptions(notify) || {}),
      onStatus:updateSettingsStatus,
      onHealth:()=>window.OrdrumSyncHealth?.refresh(),
      getState:() => { captureStudySession(); return JSON.parse(JSON.stringify(state)); },
      normalise:normaliseCloudState,
      emptyState:emptyStudyState,
      applyState:applyCloudState,
      getLocalCommitId:() => cloudCommitId,
      persistState:(next,{commitId} = {}) => {
        try {
          localStorage.setItem(STORAGE_KEY,JSON.stringify({...next,__cloudCommitId:commitId || cloudCommitId}));
          if (commitId) cloudCommitId = commitId;
          return true;
        } catch (_) { return false; }
      },
    });
  } catch (error) {
    $('#selection-title').textContent = '单词库暂时没有打开';
    $('#selection-description').textContent = '刷新页面，或稍后再试。';
    $('#chapter-list').innerHTML = '<div class="loading-small">章节暂时无法加载</div>';
    $('#mode-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('book')}</div><h3>书架需要一点时间</h3><p>请确认词库文件已经就位，或刷新页面重试。</p><button class="primary-button" id="reload-page">重新打开</button><div class="error-detail">${esc(error.message)}</div></div>`;
    $('#reload-page').addEventListener('click',() => location.reload());
  }
}
function emptyStudyState() {
  return {selectedChapters:data.chapters.slice(0,2).map(chapter => Number(chapter.id)),selectedBook:data.book.id,selectedNotebookChapters:['all'],mode:'preview',layout:'grid',marks:{},overrides:{},rate:0.85,autoPlay:false,voiceURI:'',tasks:[],notebook:{},notebookUnits:{},reviewEvents:{},reviewPreferences:{},planSessions:{},activePlanId:null,activeTaskId:null,studySession:null,reviewSession:null};
}
function normaliseCloudState(incoming) {
  const next = {...emptyStudyState(),...(incoming || {})};
  const chapterIds = new Set(data.chapters.map(chapter => Number(chapter.id)));
  next.selectedChapters = Array.isArray(next.selectedChapters) ? [...new Set(next.selectedChapters.map(Number).filter(id => chapterIds.has(id)))] : [];
  if (!['preview','flashcard','dictation'].includes(next.mode)) next.mode = 'preview';
  if (!['grid','list'].includes(next.layout)) next.layout = 'grid';
  if (![0.7,0.85,1].includes(next.rate)) next.rate = 0.85;
  if (!next.overrides || typeof next.overrides !== 'object' || Array.isArray(next.overrides)) next.overrides = {};
  delete next.__cloudCommitId;
  next.autoPlay = !!next.autoPlay;
  if (typeof next.voiceURI !== 'string') next.voiceURI = '';
  StudyCore.normalise(next,data);
  window.OrdrumReview?.normalise(next,data);
  window.OrdrumPlanCore?.normalise(next,data);
  return next;
}
function applyCloudState(incoming,{commitId} = {}) {
  const planned = isPlanPractice();
  const previousStage = planned ? currentPlanStage()?.id : null;
  const studyDialog = window.OrdrumStudyUI?.captureDialogState();
  const input = $('#dictation-answer');
  const caret = input && document.activeElement === input ? [input.selectionStart,input.selectionEnd] : null;
  stopAudio();
  if (commitId) cloudCommitId = commitId;
  state = normaliseCloudState(incoming);
  if (planned && activePlan()?.status === 'active' && currentPlanStage()?.id === previousStage) enterPlanStage({autoplay:false});
  else {
    planClockStarted = 0; moveStudySurface(false);
    restoreSavedStudy(); renderChapters(); renderSummary(); renderMode({autoplay:false});
  }
  const restored = $('#dictation-answer');
  if (caret && restored && !dictationResult) {
    restored.focus({preventScroll:true});
    restored.setSelectionRange(...caret);
  }
  window.OrdrumStudyUI?.refreshOpenDialog(studyDialog);
}
window.addEventListener('ordrum:before-update',() => {flushPlanClock();save();});
window.addEventListener('beforeunload',() => {flushPlanClock();save();});
window.addEventListener('focus',refreshCalendarViews);
document.addEventListener('visibilitychange',refreshCalendarViews);
window.setInterval?.(refreshCalendarViews,60000);
function updateSettingsStatus(code) {
  const syncNow = $('#sync-now-button');
  if (syncNow) syncNow.disabled = ['syncing','connecting'].includes(code) || !window.OrdrumGitHubSync?.isConnected();
  const badge = $('#settings-sync-badge');
  if (!badge) return;
  const warning = ['error','signin','limit'].includes(code);
  const pending = ['pending','offline','syncing','connecting'].includes(code);
  badge.hidden = !warning && !pending;
  badge.dataset.state = warning ? 'error' : 'pending';
  const message = warning ? '同步需要处理，请查看设置' : code === 'offline' ? '当前离线，记录保存在此设备' : code === 'pending' ? '有本机记录等待同步' : '同步进行中';
  badge.title = message;
  badge.setAttribute('aria-label',message);
  $('#settings-button')?.setAttribute('aria-label',badge.hidden ? '设置' : `设置：${message}`);
}
window.OrdrumSettings?.configure({
  sync:mount => {
    const health = document.createElement('div'); health.id = 'sync-health'; mount.appendChild(health);
    window.OrdrumSyncHealth?.mount(health,{getScope:recoveryScope,getTarget:()=>window.OrdrumGitHubSync?.getStatus(),onReconnect:()=>window.OrdrumGitHubSync?.connect(),onSync:()=>window.OrdrumCloud?.sync(),onExportRecovery:backup=>downloadBackup(backup,'ordrum-recovery'),onRestoreRecovery:backup=>previewRestore(backup,{replace:true})});
    window.OrdrumGitHubSync?.mount(mount);
  },
  audio:mount => { if (data) showAudioSettings(mount); else mount.textContent = '正在加载发音设置…'; },
  archive:mount => { if (data) showProgress(mount); else mount.textContent = '正在加载学习档案…'; },
  help:mount => showHelp(mount),
  iphone:mount => window.OrdrumPWA?.renderInstallHelp(mount),
});
window.OrdrumStudyUI?.configure({onNotebookChange:()=>{
  if (state.selectedBook === '__notebook__' && !activeStudyTask() && !retryMode) resetDeck();
  renderChapters(); renderSummary(); renderMode({autoplay:false}); save();
}});

init();
