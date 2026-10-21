(function (global) {
  'use strict';
  const META_KEY = 'ordrum.cloud.v1';
  const JOURNAL_KEY = 'ordrum.cloud.journal.v1';
  const STATE_KEY = 'ordrum.rivstart.v1';
  const COMMIT_MARKER = '__cloudCommitId';
  const ACCOUNT_PREFIX = 'ordrum.account.';
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const own = (value,key) => object(value) && Object.prototype.hasOwnProperty.call(value,key);
  const time = value => Date.parse(value?.updatedAt || value?.updated || value?.lastWrongAt || '') || 0;
  function equal(a,b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v,i) => equal(v,b[i]));
    if (!object(a) || !object(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => own(b,key) && equal(a[key],b[key]));
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
    return merge(base,local,remote,'');
  }
  function hasLocalProgress(value) {
    if ((value.tasks || []).length || ['marks','overrides','notebook'].some(key => Object.keys(value[key] || {}).length)) return true;
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
  function status(code,detail) {
    currentStatus = code;
    if (config?.onStatus) config.onStatus(code,detail);
    const element = document.querySelector('#cloud-status');
    if (!element) return;
    const labels = {connecting:'正在连接云端',syncing:'正在同步学习进度',synced:'学习进度已同步',offline:'离线学习 · 联网后同步',signin:'登录以同步学习进度',local:'进度已保存本机 · 连接账号后同步',error:'已保存在此设备 · 等待重试',limit:'进度已保存本机 · 云端记录过大'};
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
          archiveCurrent(); status('synced'); return;
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
        status('synced'); return;
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
  }
  function start(options) {
    config = options;
    metadata = read(META_KEY);
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
  global.OrdrumCloud = {mergeThreeWay,equal,start,schedule,sync,updateConnectionStatus};
})(window);
