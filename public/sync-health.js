(function (global) {
  'use strict';
  const KEY = 'ordrum.recovery.v1';
  const MAX_SNAPSHOT = 1800000, MAX_STORE = 3000000, MAX_SCOPES = 6;
  const STATE_KEYS = ['selectedChapters','selectedBook','selectedNotebookChapters','mode','layout','marks','overrides','rate','autoPlay','voiceURI','tasks','notebook','notebookUnits','activeTaskId','studySession','reviewSession','reviewEvents','reviewPreferences','planSessions','activePlanId'];
  const MAP_KEYS = ['notebook','marks','reviewEvents','notebookUnits','overrides','planSessions'];
  const LABELS = {tasks:'任务',notebook:'错词记录',marks:'掌握标记',reviewEvents:'复习事件',notebookUnits:'错词单元',overrides:'词条修改',planSessions:'学习计划',preferences:'偏好',positions:'学习位置'};
  const unsafe = /^(?:__proto__|prototype|constructor|__cloudCommitId)$|token|password|authorization|secret|credential|connection|access.?key/i;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g,ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function equal(a,b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value,i) => equal(value,b[i]));
    if (!object(a) || !object(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b,key) && equal(a[key],b[key]));
  }
  function scopeFor(value = {}) {
    if (value.accountId !== undefined && value.accountId !== null && !/^[a-f0-9]{64}$/.test(value.accountId)) return null;
    if (typeof value.bookId !== 'string' || !value.bookId.trim() || value.bookId.length > 160) return null;
    return {accountId:value.accountId || null,bookId:value.bookId};
  }
  function scrub(value,depth = 0) {
    if (depth > 24) throw new Error('depth');
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(item => scrub(item,depth+1));
    if (!object(value)) return null;
    const result = {};
    for (const key of Object.keys(value)) if (!unsafe.test(key)) result[key] = scrub(value[key],depth+1);
    return result;
  }
  function safeState(state) {
    if (!object(state)) throw new Error('state');
    const result = {};
    for (const key of STATE_KEYS) if (Object.prototype.hasOwnProperty.call(state,key)) result[key] = scrub(state[key]);
    return result;
  }
  function scopeKey(scope) { return `${scope.accountId || 'local'}:${scope.bookId}`; }
  function readStore() {
    try {
      const raw = global.localStorage.getItem(KEY) || 'null';
      if (raw.length > MAX_STORE) return {version:1,records:{}};
      const value = JSON.parse(raw);
      return value?.version === 1 && object(value.records) ? value : {version:1,records:{}};
    } catch (_) { return {version:1,records:{}}; }
  }
  function validRecord(value,scope) {
    return object(value) && value.scope?.accountId === scope.accountId && value.scope?.bookId === scope.bookId && typeof value.id === 'string' && Number.isFinite(Date.parse(value.createdAt)) && value.backup?.app === 'ordrum' && value.backup?.version === 1 && value.backup?.book === scope.bookId && object(value.backup?.state);
  }
  function saveRecovery(state,options = {}) {
    const scope = scopeFor(options);
    if (!scope) return {ok:false,error:'invalid-scope'};
    try {
      const stamp = new Date(options.now === undefined ? Date.now() : options.now).toISOString();
      const backup = {app:'ordrum',version:1,book:scope.bookId,exportedAt:stamp,state:safeState(state)};
      if (JSON.stringify(backup).length > MAX_SNAPSHOT) return {ok:false,error:'too-large'};
      const id = global.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const record = {id,createdAt:stamp,reason:['import','recovery','restore'].includes(options.reason) ? options.reason : 'import',scope,backup};
      const records = readStore().records;
      records[scopeKey(scope)] = record;
      const entries = Object.entries(records).filter(([,row]) => object(row) && Number.isFinite(Date.parse(row.createdAt))).sort((a,b) => Date.parse(b[1].createdAt)-Date.parse(a[1].createdAt));
      // Keep the new snapshot first even when a device clock has moved back.
      const retained = [[scopeKey(scope),record],...entries.filter(([key]) => key !== scopeKey(scope))].slice(0,MAX_SCOPES);
      while (retained.length > 1 && JSON.stringify({version:1,records:Object.fromEntries(retained)}).length > MAX_STORE) retained.pop();
      const serialized = JSON.stringify({version:1,records:Object.fromEntries(retained)});
      if (serialized.length > MAX_STORE) return {ok:false,error:'too-large'};
      global.localStorage.setItem(KEY,serialized);
      return {ok:true,id,createdAt:stamp};
    } catch (_) { return {ok:false,error:'storage-unavailable'}; }
  }
  function getRecovery(options = {}) {
    const scope = scopeFor(options);
    if (!scope) return null;
    const record = readStore().records[scopeKey(scope)];
    if (!validRecord(record,scope)) return null;
    try { return {id:record.id,createdAt:record.createdAt,reason:['import','recovery','restore'].includes(record.reason) ? record.reason : 'import',scope:clone(scope),backup:{app:'ordrum',version:1,book:scope.bookId,exportedAt:record.createdAt,state:safeState(record.backup.state)}}; }
    catch (_) { return null; }
  }
  function changedRows(before,after) {
    const result = {added:0,changed:0,removed:0,total:0};
    for (const id of new Set([...Object.keys(before),...Object.keys(after)])) {
      if (!Object.prototype.hasOwnProperty.call(before,id)) result.added++;
      else if (!Object.prototype.hasOwnProperty.call(after,id)) result.removed++;
      else if (!equal(before[id],after[id])) result.changed++;
    }
    result.total = result.added+result.changed+result.removed;
    return result;
  }
  function preview(before,after) {
    before = safeState(before); after = safeState(after);
    const rows = tasks => Object.fromEntries((Array.isArray(tasks) ? tasks : []).filter(row => object(row) && typeof row.id === 'string' && !['__proto__','constructor','prototype'].includes(row.id)).map(row => [row.id,row]));
    const result = {tasks:changedRows(rows(before.tasks),rows(after.tasks))};
    for (const key of MAP_KEYS) result[key] = changedRows(object(before[key]) ? before[key] : {},object(after[key]) ? after[key] : {});
    const otherKeys = STATE_KEYS.filter(key => key !== 'tasks' && !MAP_KEYS.includes(key));
    result.other = {added:0,changed:otherKeys.some(key => !equal(before[key],after[key])) ? 1 : 0,removed:0,total:0};
    result.other.total = result.other.changed;
    result.count = Object.values(result).filter(object).reduce((sum,row) => sum+row.total,0);
    return result;
  }
  function previewMarkup(comparison) {
    const labels = {...LABELS,other:'偏好与学习位置'};
    const rows = Object.entries(labels).filter(([key]) => comparison[key]?.total).map(([key,label]) => {
      const row = comparison[key];
      return `<tr><th scope="row">${label}</th><td>${esc(row.added)}</td><td>${esc(row.changed)}</td><td>${esc(row.removed)}</td></tr>`;
    }).join('');
    return rows ? `<div class="recovery-comparison"><table><caption>恢复后与当前记录的变化</caption><thead><tr><th>记录</th><th>新增</th><th>变化</th><th>移除</th></tr></thead><tbody>${rows}</tbody></table><p>按记录计数；一个词可能同时对应标记、错词和复习事件，不代表不同单词数。</p></div>` : '<p class="sync-health-note">备份与当前记录相同，没有待合并变化。</p>';
  }
  let mounted = null, settings = {}, unsubscribe = null;
  function displayTime(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '尚无成功记录';
    return new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  function targetLabel() {
    try {
      const target = settings.getTarget?.();
      return typeof target === 'string' ? target.slice(0,200) : target?.owner && target?.repo ? `${String(target.owner).slice(0,80)} / ${String(target.repo).slice(0,100)}` : '未连接私有进度仓库';
    } catch (_) { return '未连接私有进度仓库'; }
  }
  function refresh() {
    if (!mounted) return;
    const health = global.OrdrumCloud?.getHealth?.() || {status:'local',pending:{knownBaseline:false,count:0,groups:{}}};
    const pending = health.pending || {};
    const scope = settings.getScope?.() || {};
    const recovery = health.recoveryPending ? null : getRecovery(scope);
    const messages = {connecting:'正在核对云端记录。',syncing:'正在同步；此时仍可继续学习。',synced:'本机记录与上次核对的云端版本一致。',pending:'变化已保存在本机，尚待上传。',offline:'当前离线；记录留在本机，联网后自动重试。',signin:'连接已失效或权限不足。请重新连接；本机记录仍保留。',local:'当前只在此设备保存。连接私有仓库后可自动同步。',error:'同步未完成；本机记录仍保留，可重试或导出备份。',limit:'云端记录达到限制。请先导出备份，再检查同步设置。'};
    const pendingLabel = pending.unavailable ? '暂时无法比较，请先导出记录' : !pending.knownBaseline ? '连接并核对后显示' : pending.count ? `${pending.count} 项记录变化待上传` : '没有待上传变化';
    const groups = Object.entries(pending.groups || {}).filter(([,n]) => n > 0).map(([key,n]) => `${LABELS[key] || '其他'} ${n}`).join(' · ');
    const action = health.action === 'reconnect' ? '<button type="button" class="secondary-button" data-health-action="reconnect">重新连接</button>' : ['error','limit','pending'].includes(health.status) && health.online !== false ? '<button type="button" class="secondary-button" data-health-action="sync">立即重试</button>' : '';
    const html = `<section class="sync-health-summary" aria-label="同步与恢复"><p class="sync-health-message" role="status">${esc(messages[health.status] || messages.error)}</p><dl><div><dt>同步目标</dt><dd>${esc(targetLabel())}</dd></div><div><dt>最近成功核对</dt><dd>${esc(displayTime(health.lastSuccessAt))}</dd></div><div><dt>本机待上传</dt><dd>${esc(pendingLabel)}</dd></div></dl>${pending.knownBaseline && pending.count ? `<details class="sync-health-counts"><summary>查看变化分类</summary><p>${esc(groups)}</p><p>按记录计数，不是答题次数或单词数。本机保存与上传成功分别显示。</p></details>` : ''}${action}<div class="sync-recovery"><h4>恢复保护</h4><p>${health.recoveryPending ? '同步恢复记录尚未提交，请先重试同步；也可先手动导出当前记录。' : recovery ? `最近恢复前备份：${esc(displayTime(recovery.createdAt))}` : '从文件恢复或使用恢复点前，自动保留当前记录。'}</p><p class="sync-health-note">恢复点仅保存在此浏览器；按账号与书籍隔离，每组保留最近一次，最多 6 组；较早恢复点可能被替换。重要记录请手动导出。</p>${recovery ? '<div class="sync-health-actions"><button type="button" class="secondary-button" data-health-action="export">导出恢复点</button><button type="button" class="secondary-button" data-health-action="restore">预览并恢复</button></div>' : ''}</div></section>`;
    if (mounted.innerHTML === html) return;
    const focusedAction = mounted.contains?.(global.document?.activeElement) ? global.document.activeElement.dataset?.healthAction : null;
    mounted.innerHTML = html;
    mounted.querySelectorAll('[data-health-action]').forEach(button => button.addEventListener('click',() => {
      const action = button.dataset.healthAction;
      if (action === 'reconnect') settings.onReconnect?.();
      else if (action === 'sync') settings.onSync?.();
      else {
        const current = getRecovery(settings.getScope?.() || {});
        if (current) (action === 'export' ? settings.onExportRecovery : settings.onRestoreRecovery)?.(current.backup);
      }
    }));
    if (focusedAction) mounted.querySelector(`[data-health-action="${focusedAction}"]`)?.focus({preventScroll:true});
  }
  function mount(target,options = {}) {
    mounted = target; settings = options;
    unsubscribe?.();
    unsubscribe = global.OrdrumCloud?.onHealth?.(refresh) || null;
    refresh();
    return target;
  }
  global.OrdrumSyncHealth = {mount,refresh,saveRecovery,getRecovery,preview,previewMarkup,safeState};
})(window);
