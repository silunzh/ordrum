(function (global) {
  'use strict';
  const META_KEY = 'ordrum.cloud.v1';
  const JOURNAL_KEY = 'ordrum.cloud.journal.v1';
  const STATE_KEY = 'ordrum.rivstart.v1';
  const COMMIT_MARKER = '__cloudCommitId';
  const ACCOUNT_PREFIX = 'ordrum.account.';
  const HEALTH_KEY = 'ordrum.cloud.health.v1';
  const healthListeners = new Set();
  let successTimes = {};
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const own = (value,key) => object(value) && Object.prototype.hasOwnProperty.call(value,key);
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
  const time = value => Date.parse(value?.updatedAt || value?.updated || value?.lastWrongAt || '') || 0;
  function equal(a,b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v,i) => equal(v,b[i]));
    if (!object(a) || !object(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => own(b,key) && equal(a[key],b[key]));
  }
  function cleanReviewPreferences(value) {
    if (typeof global.OrdrumReview?.cleanPreferences === 'function') return global.OrdrumReview.cleanPreferences(value);
    const prefs = object(value) ? value : {}, proposed = prefs.intervals, fresh = !Object.keys(prefs).length;
    const clamp = (value,fallback,max) => Number.isFinite(Number(value)) ? Math.min(max,Math.max(0,Math.floor(Number(value)))) : fallback;
    const intervals = Array.isArray(proposed) && proposed.length === 5 && proposed.every((day,index) => Number.isInteger(day) && day >= 1 && day <= 365 && (!index || day > proposed[index-1])) ? proposed.slice() : [1,3,7,14,30];
    const stamp = prefs.updatedAt !== null && prefs.updatedAt !== undefined && prefs.updatedAt !== '' && typeof prefs.updatedAt !== 'boolean' ? new Date(prefs.updatedAt) : null;
    const scope = object(prefs.scope) ? prefs.scope : {};
    return {method:['recall','dictation','quick'].includes(prefs.method) ? prefs.method : 'recall',targetMinutes:Math.max(10,clamp(prefs.targetMinutes,60,180)),chunkSize:Math.max(10,clamp(prefs.chunkSize,20,25)),reviewLimit:clamp(prefs.reviewLimit,fresh ? 90 : 20,200),newLimit:clamp(prefs.newLimit,fresh ? 30 : 5,200),intervals,
      scope:{kind:['selected','book','chapters','notebook'].includes(scope.kind) ? scope.kind : 'selected',chapterIds:Array.isArray(scope.chapterIds) ? [...new Set(scope.chapterIds.filter(id=>Number.isInteger(id) && id >= 1 && id <= 1000))].sort((a,b)=>a-b).slice(0,200) : [],notebookChapterIds:Array.isArray(scope.notebookChapterIds) ? [...new Set(scope.notebookChapterIds.filter(safeId))].slice(0,1000) : []},
      paused:prefs.paused === true,updatedAt:stamp && Number.isFinite(stamp.getTime()) ? stamp.toISOString() : '1970-01-01T00:00:00.000Z'};
  }
  function mergeReviewEvents(local,remote) {
    if (typeof global.OrdrumReview?.mergeEvents === 'function') return global.OrdrumReview.mergeEvents(local,remote);
    // Standalone cloud clients use the same canonical field order as review.js.
    // The ordinary object merger must never assemble two immutable events.
    const result = {}, safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
    const modes = {dictation:['correct','wrong','revealed','skip'],flashcard:['known','again','skip']};
    const dayNumber = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00.000Z')) && new Date(value+'T00:00:00.000Z').toISOString().slice(0,10) === value ? Date.parse(value+'T00:00:00.000Z')/86400000 : null;
    for (const input of [local,remote]) if (object(input)) Object.keys(input).sort().forEach(id => {
      const event = input[id];
      if (!safeId(id) || !object(event) || event.id !== id || !safeId(event.wordId) || !safeId(event.sessionId) || !own(modes,event.mode) || !modes[event.mode].includes(event.outcome)) return;
      if (event.at === null || event.at === undefined || event.at === '' || typeof event.at === 'boolean') return;
      const stamp = new Date(event.at);
      if (!Number.isFinite(stamp.getTime())) return;
      const at = stamp.toISOString(),day = event.day;
      if (dayNumber(day) === null || Math.abs(dayNumber(day)-dayNumber(at.slice(0,10))) > 1) return;
      const row = {id,wordId:event.wordId,sessionId:event.sessionId,mode:event.mode,outcome:event.outcome,at,day};
      if (!own(result,id) || JSON.stringify(row) < JSON.stringify(result[id])) result[id] = row;
    });
    return result;
  }
  function canonical(value) {
    if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
    if (object(value)) return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
    return JSON.stringify(value);
  }
  function latestWhole(left,right) {
    return !left ? right : !right ? left : time(left) > time(right) ? left : time(right) > time(left) ? right : canonical(left) <= canonical(right) ? left : right;
  }
  function mergePlanSessions(...inputs) {
    const result = {}, outcomes = ['known','again','correct','wrong','revealed','skip','seen'];
    const maps = value => object(value) ? value : {};
    const ids = value => Array.isArray(value) ? [...new Set(value.filter(safeId))] : [];
    const metadata = value => object(value) ? Object.fromEntries(Object.entries(value).filter(([key])=>!['results','completedStages','resolvedStages','stageSessions','stageIndex','elapsedMs','__proto__','constructor','prototype'].includes(key))) : null;
    for (const input of inputs) if (object(input)) Object.keys(input).sort().forEach(id=>{
      const incoming = input[id];
      if (!safeId(id) || !object(incoming) || incoming.id !== id) return;
      const prior = result[id], row = copy(latestWhole(metadata(prior),metadata(incoming)));
      row.results = {};
      for (const source of [prior,incoming]) Object.keys(maps(source?.results)).sort().filter(safeId).forEach(stageId=>{
        const stage = maps(source.results[stageId]);
        Object.keys(stage).sort().filter(safeId).forEach(wordId=>{
          const value = stage[wordId];
          if (!object(value) || !outcomes.includes(value.outcome) || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))) return;
          const answer = {outcome:value.outcome,at:new Date(value.at).toISOString()};
          const target = row.results[stageId] || (row.results[stageId] = {}), previous = target[wordId];
          // First attempts are immutable, including an initial wrong/revealed answer.
          if (!previous || Date.parse(answer.at) < Date.parse(previous.at) || answer.at === previous.at && canonical(answer) < canonical(previous)) target[wordId] = answer;
        });
      });
      row.completedStages = {};
      for (const source of [prior,incoming]) Object.keys(maps(source?.completedStages)).sort().filter(safeId).forEach(stageId=>{if (source.completedStages[stageId] === true) row.completedStages[stageId] = true;});
      row.resolvedStages = {};
      for (const source of [prior,incoming]) Object.keys(maps(source?.resolvedStages)).sort().filter(safeId).forEach(stageId=>{
        row.resolvedStages[stageId] = [...new Set([...(row.resolvedStages[stageId] || []),...ids(source.resolvedStages[stageId])])];
      });
      row.stageSessions = {};
      for (const source of [prior,incoming]) Object.keys(maps(source?.stageSessions)).sort().filter(safeId).forEach(stageId=>{
        const session = source.stageSessions[stageId];
        if (object(session)) row.stageSessions[stageId] = copy(latestWhole(row.stageSessions[stageId],session));
      });
      row.elapsedMs = Math.max(0,...[prior,incoming].map(source=>Number.isFinite(source?.elapsedMs) ? source.elapsedMs : 0));
      const stages = Array.isArray(row.stages) ? row.stages : [];
      row.stageIndex = 0;
      while (row.stageIndex < stages.length && safeId(stages[row.stageIndex]?.id) && row.completedStages[stages[row.stageIndex].id] === true) row.stageIndex++;
      result[id] = row;
    });
    Object.keys(result).forEach(id=>{
      const row = result[id];
      Object.keys(row.resolvedStages).forEach(stageId=>{
        const arrays = inputs.filter(input=>object(input?.[id]?.resolvedStages) && Array.isArray(input[id].resolvedStages[stageId])).map(input=>ids(input[id].resolvedStages[stageId]));
        const baseline = Array.isArray(inputs[0]?.[id]?.resolvedStages?.[stageId]) ? ids(inputs[0][id].resolvedStages[stageId]) : arrays.sort((a,b)=>canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0)[0] || [];
        const existing = new Set(baseline), combined = new Set(arrays.flat());
        row.resolvedStages[stageId] = [...baseline,...Array.from(combined).filter(wordId=>!existing.has(wordId)).sort()];
      });
    });
    return result;
  }
  function mergeThreeWay(base,local,remote) {
    function merge(b,l,r,path) {
      if (equal(l,b)) return copy(r);
      if (equal(r,b) || equal(l,r)) return copy(l);
      // An explicit deletion wins over an older or concurrently edited record.
      if (b !== undefined && (l === undefined || r === undefined)) return undefined;
      if (l === undefined) return copy(r);
      if (r === undefined) return copy(l);
      if (path === 'tasks' && Array.isArray(l) && Array.isArray(r)) {
        const keyed = rows => Object.fromEntries((Array.isArray(rows) ? rows : []).filter(t => t && typeof t.id === 'string' && !['__proto__','constructor','prototype'].includes(t.id)).map(t => [t.id,t]));
        return Object.values(merge(keyed(b),keyed(l),keyed(r),'taskRecords'));
      }
      if (/^notebookUnits\.[^.]+\.wordIds$/.test(path) && Array.isArray(l) && Array.isArray(r)) {
        const combined = new Set([...l,...r]);
        const prior = Array.isArray(b) ? b : [];
        const existing = new Set(prior);
        return [...prior.filter(id => combined.has(id)),...Array.from(combined).filter(id => !existing.has(id)).sort()];
      }
      const session = /(?:^|\.)(?:session|studySession|reviewSession)$/.test(path);
      if (session) {
        if (b !== undefined && (l === null || r === null)) return null;
        const lt = time(l?.session || l), rt = time(r?.session || r);
        return copy(rt > lt ? r : l);
      }
      const mark = /(?:^|\.)marks\.[^.]+$/.test(path);
      const error = /(?:^|\.)(?:notebook|errors)\.[^.]+$/.test(path);
      if (mark) return copy(time(r) > time(l) ? r : l);
      if (error && object(l) && object(r)) {
        const latest = time(r) > time(l) ? r : l;
        const lastWrong = Date.parse(r.lastWrongAt || '') > Date.parse(l.lastWrongAt || '') ? r : l;
        return {...copy(latest),count:Math.max(Number(l.count)||0,Number(r.count)||0),lastWrongAt:lastWrong.lastWrongAt || null,lastAnswer:lastWrong.lastAnswer || '',taskIds:[...new Set([...(l.taskIds || []),...(r.taskIds || [])])]};
      }
      if (object(l) && object(r)) {
        const result = {};
        const keys = new Set([...Object.keys(object(b) ? b : {}),...Object.keys(l),...Object.keys(r)]);
        keys.forEach(key => {
          if (['__proto__','constructor','prototype'].includes(key)) return;
          const value = merge(own(b,key) ? b[key] : undefined,own(l,key) ? l[key] : undefined,own(r,key) ? r[key] : undefined,path ? `${path}.${key}` : key);
          if (value !== undefined) result[key] = value;
        });
        return result;
      }
      if (/\.(?:updatedAt|updated)$/.test(path)) return Date.parse(r) > Date.parse(l) ? r : l;
      return copy(l);
    }
    const result = merge(base,local,remote,'');
    if (object(result)) {
      // Apply these top-level policies even when an ancestor equality shortcut
      // would otherwise erase records omitted by an older device snapshot.
      if ([base,local,remote].some(value => own(value,'reviewEvents'))) result.reviewEvents = mergeReviewEvents(local?.reviewEvents,remote?.reviewEvents);
      if ([base,local,remote].some(value => own(value,'planSessions'))) result.planSessions = mergePlanSessions(base?.planSessions,local?.planSessions,remote?.planSessions);
      if ([local,remote].some(value => own(value,'reviewPreferences'))) {
        const l = own(local,'reviewPreferences') ? cleanReviewPreferences(local.reviewPreferences) : null;
        const r = own(remote,'reviewPreferences') ? cleanReviewPreferences(remote.reviewPreferences) : null;
        result.reviewPreferences = copy(!l ? r : !r ? l : time(r) > time(l) ? r : time(l) > time(r) ? l : JSON.stringify(r) < JSON.stringify(l) ? r : l);
      }
    }
    return result;
  }
  function hasLocalProgress(value) {
    if ((value.tasks || []).length || ['marks','overrides','notebook','notebookUnits','reviewEvents','planSessions'].some(key => Object.keys(value[key] || {}).length)) return true;
    const preferences = cleanReviewPreferences(value.reviewPreferences), defaults = cleanReviewPreferences(undefined);
    if (!equal(preferences,defaults) && !equal(preferences,{...defaults,reviewLimit:20,newLimit:5})) return true;
    const sessions = [value.studySession,value.reviewSession?.session];
    return sessions.some(s => s && (s.mode !== 'preview' || s.flashIndex || s.dictationIndex || s.flipped || s.draft || s.dictationResult || Object.keys(s.dictationAnswers || {}).length));
  }
  let config, metadata = null, started = false, applying = false, running = false, rerun = false;
  let timer = null, poll = null, currentStatus = 'connecting', abortRequest = null;
  function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function write(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch (_) { return false; } }
  function remove(key) { try { localStorage.removeItem(key); return true; } catch (_) { return write(key,null); } }
  function connected() { return typeof config?.isConnected !== 'function' || config.isConnected() !== false; }
  function localState() { const value = copy(config.getState()); if (object(value)) delete value[COMMIT_MARKER]; return value; }
  function changeSummary(base,current) {
    const groups = {};
    const maps = ['marks','overrides','notebook','notebookUnits','reviewEvents','planSessions'];
    for (const key of maps) {
      const before = object(base?.[key]) ? base[key] : {}, after = object(current?.[key]) ? current[key] : {};
      const changed = [...new Set([...Object.keys(before),...Object.keys(after)])].filter(id => !equal(before[id],after[id])).length;
      if (changed) groups[key] = changed;
    }
    const tasks = rows => Object.fromEntries((Array.isArray(rows) ? rows : []).filter(row => object(row) && typeof row.id === 'string' && !['__proto__','constructor','prototype'].includes(row.id)).map(row => [row.id,row]));
    const beforeTasks = tasks(base?.tasks), afterTasks = tasks(current?.tasks);
    const changedTasks = [...new Set([...Object.keys(beforeTasks),...Object.keys(afterTasks)])].filter(id => !equal(beforeTasks[id],afterTasks[id])).length;
    if (changedTasks) groups.tasks = changedTasks;
    const preferences = ['selectedChapters','selectedBook','selectedNotebookChapters','mode','layout','rate','autoPlay','voiceURI','activeTaskId','reviewPreferences'];
    const positions = ['studySession','reviewSession','activePlanId'];
    if (preferences.some(key => !equal(base?.[key],current?.[key]))) groups.preferences = 1;
    if (positions.some(key => !equal(base?.[key],current?.[key]))) groups.positions = 1;
    return {knownBaseline:base !== undefined && base !== null,count:Object.values(groups).reduce((sum,n) => sum+n,0),groups};
  }
  function getHealth() {
    let pending;
    try { pending = changeSummary(metadata?.base,config ? localState() : {}); }
    catch (_) { pending = {knownBaseline:false,count:0,groups:{},unavailable:true}; }
    const accountId = metadata?.accountId || null;
    const code = currentStatus === 'synced' && pending.count ? 'pending' : currentStatus;
    const action = code === 'signin' || code === 'local' ? 'reconnect' : ['error','limit','offline','pending'].includes(code) ? 'retry' : null;
    return {status:code,connected:config ? connected() : false,online:global.navigator?.onLine !== false,accountId,lastSuccessAt:accountId ? successTimes[accountId] || null : null,pending,action,recoveryPending:!!read(JOURNAL_KEY)};
  }
  function emitHealth() {
    const health = getHealth();
    // Diagnostic subscribers get counts and opaque scope only, never state or credentials.
    if (typeof config?.onHealth === 'function') { try { config.onHealth(copy(health)); } catch (_) {} }
    healthListeners.forEach(listener => { try { listener(copy(health)); } catch (_) {} });
  }
  function onHealth(listener) {
    if (typeof listener !== 'function') return () => {};
    healthListeners.add(listener);
    try { listener(getHealth()); } catch (_) {}
    return () => healthListeners.delete(listener);
  }
  function successfulSync(accountId) {
    const supplied = typeof config.now === 'function' ? config.now() : Date.now();
    const parsed = new Date(supplied);
    const now = Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
    successTimes[accountId] = now;
    const entries = Object.entries(successTimes).sort((a,b) => Date.parse(b[1])-Date.parse(a[1])).slice(0,12);
    successTimes = Object.fromEntries(entries);
    write(HEALTH_KEY,{version:1,accounts:successTimes});
  }
  function status(code,detail) {
    currentStatus = code;
    if (config?.onStatus) config.onStatus(code,detail);
    emitHealth();
    const element = document.querySelector('#cloud-status');
    if (!element) return;
    const labels = {connecting:'正在连接云端',syncing:'正在同步学习进度',synced:'学习进度已同步',pending:'进度已保存本机 · 等待同步',offline:'离线学习 · 联网后同步',signin:'登录以同步学习进度',local:'进度已保存本机 · 连接账号后同步',error:'已保存在此设备 · 等待重试',limit:'进度已保存本机 · 云端记录过大'};
    const customLabel = code === 'local' ? config?.localLabel : code === 'signin' ? config?.signInLabel : null;
    element.textContent = customLabel || labels[code] || labels.error;
    element.dataset.status = code;
    element.title = detail || '';
    element.href = code === 'local' ? config?.localHref || '#' : code === 'signin' ? config?.signInHref || '/signin-with-chatgpt?return_to=%2F' : '#';
  }
  function apply(next,commitId) {
    applying = true;
    try { config.applyState(copy(next),{commitId}); } finally { applying = false; }
  }
  function valid(payload) {
    return object(payload) && typeof payload.accountId === 'string' && /^[a-f0-9]{64}$/.test(payload.accountId) && Number.isSafeInteger(payload.revision) && payload.revision >= 0 && (payload.state === null || object(payload.state));
  }
  async function request(method,body) {
    const Controller = global.AbortController || (typeof AbortController === 'function' ? AbortController : null);
    const controller = Controller ? new Controller() : null;
    let deadline, cancel, cancelled = false;
    const bounded = new Promise((_,reject) => {
      cancel = () => { cancelled = true; controller?.abort(); reject(new Error('Sync request interrupted')); };
      deadline = setTimeout(cancel,12000);
    });
    abortRequest = cancel;
    try {
      const operation = (async () => {
        const response = typeof config.transport === 'function'
          ? await config.transport(method,body,{signal:controller?.signal})
          : await fetch('/api/progress',{method,credentials:'same-origin',cache:'no-store',redirect:'manual',signal:controller?.signal,headers:{'Accept':'application/json',...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
        if (cancelled) throw new Error('Sync request interrupted');
        // Expired cookies must use a top-level sign-in, never an auth redirect in fetch.
        if (response.type === 'opaqueredirect' || response.redirected || (response.status >= 300 && response.status < 400)) { status('signin'); return null; }
        if (response.status === 401 || response.status === 403) { status('signin'); return null; }
        if (response.status === 404) { status('local'); return null; }
        if (response.status === 413) { status('limit'); return null; }
        if (!response.ok && response.status !== 409) throw new Error(`Sync HTTP ${response.status}`);
        if (!response.headers.get('Content-Type')?.includes('application/json')) { status('signin'); return null; }
        const payload = await response.json();
        if (cancelled) throw new Error('Sync request interrupted');
        if (!valid(payload)) throw new Error('Invalid sync response');
        return {...payload,conflict:response.status === 409};
      })();
      return await Promise.race([operation,bounded]);
    } finally {
      clearTimeout(deadline);
      if (abortRequest === cancel) abortRequest = null;
    }
  }
  function validMetadata(value) {
    return object(value) && /^[a-f0-9]{64}$/.test(value.accountId || '') && Number.isSafeInteger(value.revision) && value.revision >= 0 && (value.base === undefined || value.base === null || object(value.base));
  }
  function localCommitId() {
    return typeof config.getLocalCommitId === 'function' ? config.getLocalCommitId() : read(config.stateKey || STATE_KEY)?.[COMMIT_MARKER];
  }
  function persistLocal(next,commitId) {
    if (typeof config.persistState === 'function') return config.persistState(copy(next),{commitId}) === true;
    return write(config.stateKey || STATE_KEY,{...copy(next),[COMMIT_MARKER]:commitId});
  }
  function finishJournal(journal) {
    const current = localState();
    // The marker and app state are one localStorage write. If the state already
    // committed, retain every edit made since that write, including deletions.
    if (localCommitId() !== journal.id) {
      // A failed account switch must not reclassify subsequent edits to the
      // previous account as changes belonging to the newly signed-in account.
      if (journal.replaceAccount && validMetadata(journal.previousMetadata) && !write(ACCOUNT_PREFIX+journal.previousMetadata.accountId,{state:current,metadata:journal.previousMetadata})) throw new Error('Cannot preserve the previous account on this device');
      // An explicitly authorized provider migration imports the old account's
      // records. Preserve edits made before recovery; ordinary account switches
      // must still replace rather than import another account's state.
      const next = config.normalise(journal.replaceAccount && !journal.providerMigration ? copy(journal.merged) : mergeThreeWay(journal.before,current,journal.merged));
      if (!equal(current,next)) apply(next,journal.id);
    }
    if (!persistLocal(localState(),journal.id) || !write(META_KEY,journal.metadata)) throw new Error('Cannot preserve sync state');
    metadata = copy(journal.metadata);
    if (journal.providerMigration && typeof config.onProviderMigrationCommitted === 'function') {
      const result = config.onProviderMigrationCommitted({fromAccountId:journal.previousMetadata.accountId,toAccountId:journal.metadata.accountId});
      if (result === false || result && typeof result.then === 'function') throw new Error('Cannot finish provider migration');
    }
    remove(JOURNAL_KEY);
  }
  function recoverJournal() {
    const journal = read(JOURNAL_KEY);
    if (!journal) return;
    if (!object(journal) || journal.version !== 1 || typeof journal.id !== 'string' || !object(journal.before) || !object(journal.merged) || !validMetadata(journal.metadata) || (journal.replaceAccount && !validMetadata(journal.previousMetadata)) || (own(journal,'providerMigration') && (journal.providerMigration !== true || journal.replaceAccount !== true || journal.previousMetadata?.accountId === journal.metadata.accountId))) throw new Error('Invalid sync recovery record');
    finishJournal(journal);
  }
  function commitMerge(local,merged,nextMetadata,replaceAccount = false,providerMigration = false) {
    const random = global.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const journal = {version:1,id:random,before:copy(local),merged:copy(merged),metadata:copy(nextMetadata)};
    if (replaceAccount) { journal.replaceAccount = true; journal.previousMetadata = copy(metadata); }
    if (providerMigration) journal.providerMigration = true;
    if (!write(JOURNAL_KEY,journal)) throw new Error('Cannot preserve sync recovery record');
    finishJournal(journal);
  }
  function archiveCurrent() {
    return !metadata?.accountId || write(ACCOUNT_PREFIX+metadata.accountId,{state:localState(),metadata});
  }
  function adoptAccount(remote) {
    if (!metadata?.accountId || metadata.accountId === remote.accountId) return;
    if (!archiveCurrent()) throw new Error('Cannot preserve the previous account on this device');
    const saved = read(ACCOUNT_PREFIX+remote.accountId);
    const savedMetadata = saved?.metadata?.accountId === remote.accountId && validMetadata(saved.metadata) ? saved.metadata : null;
    const migration = {fromAccountId:metadata.accountId,toAccountId:remote.accountId};
    if (typeof config.allowProviderMigration === 'function' && config.allowProviderMigration(migration) === true) {
      const local = localState();
      const target = saved?.state ? mergeThreeWay(savedMetadata?.base || undefined,saved.state,remote.state || undefined) : remote.state || undefined;
      const next = config.normalise(mergeThreeWay(undefined,local,target));
      // The grant applies only to this account pair. Persist the authorization
      // in the recovery journal before consuming it after the durable commit.
      commitMerge(local,next,{accountId:remote.accountId,revision:remote.revision,base:copy(remote.state)},true,true);
      return;
    }
    const next = config.normalise(saved?.state || remote.state || config.emptyState());
    // Do not transmit a previous account's browser-local records to a new account.
    commitMerge(localState(),next,savedMetadata || {accountId:remote.accountId,revision:remote.revision,base:copy(remote.state)},true);
  }
  async function sync() {
    if (!started) return;
    if (running) { rerun = true; return; }
    clearTimeout(timer); timer = null;
    if (global.navigator?.onLine === false) { status('offline'); return; }
    if (!connected()) { status('local'); return; }
    running = true; status('syncing');
    try {
      recoverJournal();
      let remote = await request('GET');
      if (!remote) return;
      adoptAccount(remote);
      for (let attempt=0;attempt<4;attempt++) {
        const local = localState();
        const baseline = remote.state && metadata?.accountId === remote.accountId ? metadata.base || undefined : undefined;
        const fresh = baseline === undefined && remote.state && !hasLocalProgress(local);
        const merged = config.normalise(fresh ? copy(remote.state) : mergeThreeWay(baseline,local,remote.state || undefined));
        // Persist the remote side of this merge before writing. A failed CAS or
        // interrupted request must not turn previously downloaded words into new local edits.
        commitMerge(local,merged,{accountId:remote.accountId,revision:remote.revision,base:copy(remote.state)});
        if (equal(merged,remote.state)) {
          archiveCurrent(); successfulSync(remote.accountId); status('synced'); return;
        }
        const sent = copy(merged);
        const result = await request('PUT',{state:sent,baseRevision:remote.revision,expectedAccountId:remote.accountId});
        if (!result) return;
        if (result.accountId !== remote.accountId) {
          adoptAccount(result); rerun = true; return;
        }
        if (result.conflict) { remote = result; continue; }
        const afterRequest = localState();
        commitMerge(afterRequest,afterRequest,{accountId:result.accountId,revision:result.revision,base:copy(result.state)});
        archiveCurrent();
        // Input may have changed while the request was in flight. Keep it locally and upload next.
        if (!equal(localState(),sent)) rerun = true;
        successfulSync(result.accountId);
        status(equal(localState(),result.state) ? 'synced' : 'pending'); return;
      }
      status('error','另一台设备也在更新进度，稍后自动重试。');
    } catch (_) {
      status(global.navigator?.onLine === false ? 'offline' : !connected() ? 'local' : 'error');
    } finally {
      running = false;
      if (rerun) { rerun = false; schedule(); }
    }
  }
  function schedule() {
    if (!started || applying) return;
    clearTimeout(timer); timer = null;
    if (global.navigator?.onLine === false) { status('offline'); return; }
    if (!connected()) { status('local'); return; }
    const delay = Number.isFinite(config.debounceMs) && config.debounceMs >= 0 ? config.debounceMs : 1000;
    timer = setTimeout(sync,delay);
    if (!running && getHealth().pending.count && !['error','signin','limit'].includes(currentStatus)) status('pending');
    else emitHealth();
  }
  function start(options) {
    config = options;
    metadata = read(META_KEY);
    const savedHealth = read(HEALTH_KEY);
    successTimes = {};
    if (savedHealth?.version === 1 && object(savedHealth.accounts)) {
      Object.entries(savedHealth.accounts).filter(([id,stamp]) => /^[a-f0-9]{64}$/.test(id) && typeof stamp === 'string' && Number.isFinite(Date.parse(stamp))).slice(0,12).forEach(([id,stamp]) => { successTimes[id] = stamp; });
    }
    if (metadata && !validMetadata(metadata)) metadata = null;
    started = true;
    if (!poll) {
      const interval = Number.isFinite(config.pollIntervalMs) && config.pollIntervalMs > 0 ? config.pollIntervalMs : 20000;
      poll = setInterval(() => { if (document.visibilityState !== 'hidden') sync(); },interval);
      global.addEventListener('online',sync);
      global.addEventListener('offline',() => { clearTimeout(timer); timer = null; abortRequest?.(); status('offline'); });
      global.addEventListener('focus',sync);
      document.addEventListener('visibilitychange',() => { if (document.visibilityState !== 'hidden') sync(); });
      document.addEventListener('click',event => {
        const link = event.target.closest?.('#cloud-status');
        if (!link) return;
        const bridgeSignIn = currentStatus === 'signin' && typeof config.transport === 'function';
        if ((currentStatus === 'local' || bridgeSignIn) && typeof config.connect === 'function') {
          event.preventDefault();
          // Opening the login popup must stay in the trusted click call stack.
          try {
            const result = config.connect();
            if (result && typeof result.then === 'function') result.then(updateConnectionStatus,() => status('local'));
            else if (connected()) updateConnectionStatus();
          } catch (_) { status('local'); }
        } else if (!['signin','local'].includes(currentStatus)) { event.preventDefault(); sync(); }
      });
    }
    try { recoverJournal(); } catch (_) { status('error','无法恢复同步记录，请先导出备份或释放设备空间。'); return Promise.resolve(); }
    status('connecting'); return sync();
  }
  function updateConnectionStatus() { return sync(); }
  global.OrdrumCloud = {mergeThreeWay,equal,changeSummary,start,schedule,sync,updateConnectionStatus,getHealth,onHealth};
})(window);
