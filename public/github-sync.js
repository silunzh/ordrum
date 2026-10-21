(function (global) {
  'use strict';
  const CONFIG_KEY = 'ordrum.github.connection.v1';
  const MIGRATION_KEY = 'ordrum.github.migration.v1';
  const API = 'https://api.github.com';
  const API_VERSION = '2026-03-10';
  const MAX_BYTES = 3 * 1024 * 1024;
  const MAX_WIRE_BYTES = Math.ceil(MAX_BYTES * 1.5) + 65536;
  const HEX = /^[a-f0-9]{64}$/;
  const activeRequests = new Set();
  const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  let connection = null, identity = null, generation = 0, configureAttempt = 0, notice = () => {}, lastError = '', dialog = null;
  let retryAt = 0;
  function read(storage,key) { try { return JSON.parse(storage?.getItem(key) || 'null'); } catch (_) { return null; } }
  function remove(storage,key) { try { storage?.removeItem(key); } catch (_) { /* Storage may be disabled. */ } }
  function store(storage,key,value) { try { storage.setItem(key,JSON.stringify(value)); return true; } catch (_) { return false; } }
  function safeConfig(value) {
    if (!object(value) || typeof value.owner !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value.owner)
      || typeof value.repo !== 'string' || !/^[a-z\d_.-]{1,100}$/i.test(value.repo) || ['.','..'].includes(value.repo)
      || typeof value.token !== 'string' || !/^github_pat_[a-z\d_]{20,244}$/i.test(value.token)) return null;
    return {owner:value.owner,repo:value.repo,token:value.token,remember:value.remember === true};
  }
  const savedSession = safeConfig(read(global.sessionStorage,CONFIG_KEY));
  const savedLocal = safeConfig(read(global.localStorage,CONFIG_KEY));
  connection = savedSession || (savedLocal?.remember ? savedLocal : null);
  function error(code,message) { const value = new Error(message); value.code = code; return value; }
  function abortError() { const value = new Error('Sync request was cancelled'); value.name = 'AbortError'; return value; }
  function json(body,status = 200) { return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}); }
  function report(value) {
    lastError = value?.message || '';
    if (lastError) notice(lastError);
    render();
  }
  function isConnected() { return !!connection; }
  function snapshot() {
    return {configured:!!connection,owner:connection?.owner || 'silunzh',repo:connection?.repo || 'ordrum-progress',accountId:identity?.accountId || null,error:lastError,retryAt};
  }
  function current(config,version) {
    if (connection !== config || generation !== version) throw error('GITHUB_CONNECTION_CHANGED','同步连接已更改，请重试。');
  }
  async function readJson(response,max = MAX_WIRE_BYTES) {
    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) throw error('GITHUB_INVALID_RESPONSE','GitHub 返回了无效响应；此设备记录已保留。');
    const length = Number(response.headers.get('Content-Length') || 0);
    if (length > max) throw error('GITHUB_TOO_LARGE','同步记录过大；请先导出备份。');
    let text;
    if (response.body?.getReader) {
      const reader = response.body.getReader(); const chunks = []; let total = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          total += part.value.byteLength;
          if (total > max) { await reader.cancel(); throw error('GITHUB_TOO_LARGE','同步记录过大；请先导出备份。'); }
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(total); let offset = 0;
        chunks.forEach(chunk => { bytes.set(chunk,offset); offset += chunk.byteLength; });
        text = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      } finally { reader.releaseLock?.(); }
    } else {
      text = await response.text();
      if (new TextEncoder().encode(text).byteLength > max) throw error('GITHUB_TOO_LARGE','同步记录过大；请先导出备份。');
    }
    try { return JSON.parse(text); } catch (_) { throw error('GITHUB_INVALID_RESPONSE','GitHub 返回了无效记录；此设备记录已保留。'); }
  }
  async function api(config,path,options = {}) {
    if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) throw error('GITHUB_INVALID_URL','无效的同步地址。');
    if (options.signal?.aborted) throw abortError();
    if (Date.now() < retryAt) throw error('GITHUB_RATE_LIMIT','GitHub 暂时限制同步请求，稍后会自动重试；记录已保存在此设备。');
    const url = new URL(path,API);
    if (url.origin !== API) throw error('GITHUB_INVALID_URL','无效的同步地址。');
    const controller = new global.AbortController(); activeRequests.add(controller);
    const abort = () => controller.abort(); options.signal?.addEventListener('abort',abort,{once:true});
    const deadline = global.setTimeout(abort,10000);
    let response;
    try {
      response = await global.fetch(url.href,{method:options.method || 'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal,
        headers:{Accept:options.objectMedia ? 'application/vnd.github.object+json' : 'application/vnd.github+json',Authorization:`Bearer ${config.token}`,'X-GitHub-Api-Version':API_VERSION,...(options.body ? {'Content-Type':'application/json'} : {})},
        ...(options.body ? {body:JSON.stringify(options.body)} : {})});
    } finally { global.clearTimeout(deadline); activeRequests.delete(controller); options.signal?.removeEventListener('abort',abort); }
    if (response.redirected || response.type === 'opaqueredirect') throw error('GITHUB_REDIRECT','GitHub 请求发生跳转；请检查仓库名称。');
    if (response.status === 429 || (response.status === 403 && (response.headers.get('X-RateLimit-Remaining') === '0' || response.headers.has('Retry-After')))) {
      const after = Number(response.headers.get('Retry-After'));
      const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000;
      retryAt = Math.max(Date.now()+60000,Number.isFinite(after) && after > 0 ? Date.now()+after*1000 : 0,Number.isFinite(reset) ? reset : 0);
      throw error('GITHUB_RATE_LIMIT','GitHub 暂时限制同步请求，稍后会自动重试；记录已保存在此设备。');
    }
    return response;
  }
  async function required(config,path,signal) {
    const response = await api(config,path,{signal});
    if (response.status === 401 || response.status === 403) throw error('GITHUB_AUTH','GitHub 授权已失效或权限不足，请重新连接。');
    if (response.status === 404) throw error('GITHUB_REPO_NOT_FOUND','找不到私有同步仓库，或令牌没有访问权限。请检查仓库和授权。');
    if (!response.ok) throw error('GITHUB_HTTP',`GitHub 暂时无法同步（${response.status}）；记录已保存在此设备。`);
    return readJson(response,65536);
  }
  function repoPath(config) { return `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`; }
  async function identify(config,signal,knownIdentity) {
    const user = knownIdentity?.user || await required(config,'/user',signal);
    const repo = await required(config,repoPath(config),signal);
    if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.login !== 'string'
      || !Number.isSafeInteger(repo.id) || repo.id <= 0 || typeof repo.default_branch !== 'string' || !repo.default_branch
      || repo.default_branch.length > 255 || typeof repo.full_name !== 'string'
      || repo.full_name.toLowerCase() !== `${config.owner}/${config.repo}`.toLowerCase()) throw error('GITHUB_INVALID_REPO','GitHub 账号或仓库信息无效。');
    if (repo.private !== true || (repo.visibility && repo.visibility !== 'private')) throw error('GITHUB_PUBLIC_REPO','学习进度只能保存到私有仓库，请将同步仓库设为 Private。');
    if (knownIdentity && (knownIdentity.repoId !== repo.id || knownIdentity.user.id !== user.id)) throw error('GITHUB_IDENTITY_CHANGED','同步仓库或账号已更改，请重新连接。');
    const digest = await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(`ordrum:github:${user.id}:${repo.id}`));
    return {user:{id:user.id,login:user.login},repoId:repo.id,branch:repo.default_branch,accountId:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')};
  }
  function validState(value) {
    if (!object(value)) return false;
    let entries = 0;
    function visit(item,depth) {
      if (depth > 40 || ++entries > 150000) return false;
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
      if (typeof item === 'number') return Number.isFinite(item);
      if (Array.isArray(item)) return item.every(child=>visit(child,depth+1));
      if (!object(item)) return false;
      return Object.keys(item).every(key=>!['__proto__','prototype','constructor','token','access_token','refresh_token','authorization'].includes(key.toLowerCase()) && visit(item[key],depth+1));
    }
    return !own(value,'__cloudCommitId') && visit(value,0);
  }
  function encode(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = ''; for (let offset=0;offset<bytes.length;offset+=32768) binary += String.fromCharCode(...bytes.subarray(offset,offset+32768));
    return global.btoa(binary);
  }
  function decode(value) {
    if (typeof value !== 'string' || value.length > MAX_WIRE_BYTES || !/^[a-z\d+/=\r\n]*$/i.test(value)) throw error('GITHUB_INVALID_FILE','同步文件编码无效；原有记录已保留。');
    const clean = value.replace(/[\r\n]/g,'');
    if (clean.length % 4 || !/^(?:[a-z\d+/]{4})*(?:[a-z\d+/]{2}==|[a-z\d+/]{3}=)?$/i.test(clean)) throw error('GITHUB_INVALID_FILE','同步文件编码无效；原有记录已保留。');
    try {
      const binary = global.atob(clean);
      if (binary.length > MAX_BYTES) throw error('GITHUB_TOO_LARGE','同步记录过大；请先导出备份。');
      return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,char=>char.charCodeAt(0)));
    } catch (value) { if (value.code) throw value; throw error('GITHUB_INVALID_FILE','同步文件编码无效；原有记录已保留。'); }
  }
  async function load(config,account,signal) {
    const response = await api(config,`${repoPath(config)}/contents/progress.json?ref=${encodeURIComponent(account.branch)}`,{signal,objectMedia:true});
    if (response.status === 404) {
      // Repository metadata can be visible even when Contents permission is
      // absent. Confirm the default branch is readable before treating 404 as
      // a new snapshot. Initialize an empty repository with a README first.
      const branch = await required(config,`${repoPath(config)}/git/ref/heads/${encodeURIComponent(account.branch)}`,signal);
      if (!object(branch) || !object(branch.object) || !/^[a-f0-9]{40,64}$/.test(branch.object.sha || '')) throw error('GITHUB_INVALID_REPO','请先用 README 初始化私有同步仓库，并确认令牌具有 Contents 读写权限。');
      return {state:null,revision:0,accountId:account.accountId,sha:null};
    }
    if (response.status === 401 || response.status === 403) throw error('GITHUB_AUTH','GitHub 授权已失效或权限不足，请重新连接。');
    if (!response.ok) throw error('GITHUB_HTTP',`GitHub 暂时无法读取进度（${response.status}）。`);
    const file = await readJson(response);
    if (!object(file) || file.type !== 'file' || !['base64','none'].includes(file.encoding) || file.truncated === true
      || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_BYTES || !/^[a-f0-9]{40,64}$/.test(file.sha || '')) throw error('GITHUB_INVALID_FILE','同步文件不完整或格式无效；原有记录已保留。');
    let encoded = file.content;
    if (file.encoding === 'none') {
      // The Contents API omits base64 above 1 MB. A blob read is immutable and
      // keeps the same SHA precondition without following a download URL.
      const blobResponse = await api(config,`${repoPath(config)}/git/blobs/${file.sha}`,{signal});
      if (!blobResponse.ok) throw error('GITHUB_INVALID_FILE','无法完整读取同步文件；原有记录已保留。');
      const blob = await readJson(blobResponse);
      if (!object(blob) || blob.sha !== file.sha || blob.encoding !== 'base64' || blob.size !== file.size || blob.truncated === true) throw error('GITHUB_INVALID_FILE','同步文件不完整；原有记录已保留。');
      encoded = blob.content;
    }
    const text = decode(encoded);
    if (new TextEncoder().encode(text).byteLength !== file.size) throw error('GITHUB_INVALID_FILE','同步文件不完整；原有记录已保留。');
    let record; try { record = JSON.parse(text); } catch (_) { throw error('GITHUB_INVALID_FILE','同步文件格式无效；原有记录已保留。'); }
    if (!object(record) || record.version !== 1 || record.accountId !== account.accountId || !Number.isSafeInteger(record.revision) || record.revision < 1
      || !validState(record.state)) throw error('GITHUB_INVALID_FILE','同步文件版本、账号或记录无效；原有记录已保留。');
    return {state:record.state,revision:record.revision,accountId:account.accountId,lastUpdated:typeof record.updatedAt === 'string' ? record.updatedAt : null,sha:file.sha};
  }
  function publicRecord(record) { const {sha,...safe} = record; return safe; }
  async function transport(method,body,options = {}) {
    if (!['GET','PUT'].includes(method)) throw error('GITHUB_INVALID_METHOD','无效的同步操作。');
    if (!connection) throw error('GITHUB_DISCONNECTED','请先连接 GitHub 私有同步仓库。');
    const config = connection, version = generation;
    try {
      if (method === 'PUT' && (!object(body) || !Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0 || !HEX.test(body.expectedAccountId || '') || !validState(body.state))) throw error('GITHUB_INVALID_STATE','学习记录格式无效；请先导出备份。');
      if (method === 'PUT' && new TextEncoder().encode(JSON.stringify(body.state)).byteLength > MAX_BYTES-2048) return json({error:'state_too_large'},413);
      const account = await identify(config,options.signal,identity);
      current(config,version); identity = account;
      const remote = await load(config,account,options.signal);
      current(config,version);
      if (method === 'GET') { lastError = ''; render(); return json(publicRecord(remote)); }
      if (body.expectedAccountId !== account.accountId || body.baseRevision !== remote.revision) return json(publicRecord(remote),409);
      if (remote.revision === Number.MAX_SAFE_INTEGER) throw error('GITHUB_INVALID_STATE','同步版本超出限制，请导出备份。');
      // Check privacy immediately before writing, including a repository that
      // became public after the last read. The API still authorizes the token.
      await identify(config,options.signal,account); current(config,version);
      const updatedAt = new Date().toISOString();
      const record = {version:1,accountId:account.accountId,revision:remote.revision+1,updatedAt,state:body.state};
      const encoded = JSON.stringify(record);
      if (new TextEncoder().encode(encoded).byteLength > MAX_BYTES) return json({error:'state_too_large'},413);
      const response = await api(config,`${repoPath(config)}/contents/progress.json`,{method:'PUT',signal:options.signal,
        body:{message:'Sync Ordrum learning progress',branch:account.branch,content:encode(encoded),...(remote.sha ? {sha:remote.sha} : {})}});
      current(config,version);
      if ([409,422].includes(response.status)) {
        const latestAccount = await identify(config,options.signal,account); current(config,version);
        const latest = await load(config,latestAccount,options.signal); current(config,version);
        if (latest.revision !== remote.revision || latest.sha !== remote.sha) return json(publicRecord(latest),409);
        throw error('GITHUB_WRITE_FAILED','GitHub 暂时无法保存进度；此设备记录已保留。');
      }
      if (response.status === 401 || response.status === 403) throw error('GITHUB_AUTH','GitHub 授权已失效或没有 Contents 读写权限，请重新连接。');
      if (!response.ok) throw error('GITHUB_WRITE_FAILED',`GitHub 暂时无法保存进度（${response.status}）；此设备记录已保留。`);
      const written = await readJson(response,65536); current(config,version);
      if (!object(written) || !object(written.content) || !/^[a-f0-9]{40,64}$/.test(written.content.sha || '')
        || !object(written.commit) || !/^[a-f0-9]{40,64}$/.test(written.commit.sha || '')) throw error('GITHUB_INVALID_RESPONSE','无法确认 GitHub 是否保存成功；稍后会重新检查，此设备记录已保留。');
      lastError = ''; render();
      return json({accountId:account.accountId,state:body.state,revision:record.revision,lastUpdated:updatedAt});
    } catch (value) { if (value.name !== 'AbortError') report(value); throw value; }
  }
  async function configure(value,options = {}) {
    const config = safeConfig(value);
    if (!config) throw error('GITHUB_INVALID_CONFIG','请填写有效的 GitHub 用户名、仓库名和 Fine-grained 访问令牌。');
    const attempt = ++configureAttempt, version = generation;
    const account = await identify(config,options.signal,null);
    if (attempt !== configureAttempt || generation !== version) throw error('GITHUB_CONNECTION_CHANGED','同步连接已更改，请重新连接。');
    const previous = read(global.localStorage,'ordrum.cloud.v1');
    if (value.migrateExisting === true && HEX.test(previous?.accountId || '') && previous.accountId !== account.accountId) {
      if (!store(global.localStorage,MIGRATION_KEY,{targetAccountId:account.accountId,sourceAccountId:previous.accountId})) throw error('GITHUB_STORAGE','无法保存首次迁移授权；请允许此网页使用浏览器存储，再重试。');
    } else remove(global.localStorage,MIGRATION_KEY);
    for (const controller of activeRequests) controller.abort();
    generation++; connection = config; identity = account; retryAt = 0; lastError = '';
    remove(global.localStorage,CONFIG_KEY); remove(global.sessionStorage,CONFIG_KEY);
    const storage = config.remember ? global.localStorage : global.sessionStorage;
    if (!store(storage,CONFIG_KEY,config)) notice('浏览器不允许保存连接信息，本次打开期间仍可同步。');
    render(); return snapshot();
  }
  function disconnect() {
    configureAttempt++;
    for (const controller of activeRequests) controller.abort();
    generation++; connection = null; identity = null; retryAt = 0; lastError = '';
    remove(global.localStorage,CONFIG_KEY); remove(global.sessionStorage,CONFIG_KEY); remove(global.localStorage,MIGRATION_KEY);
    render(); global.OrdrumCloud?.updateConnectionStatus();
    notice('已断开 GitHub 同步，此设备的学习记录仍保留。');
  }
  function allowProviderMigration({toAccountId,fromAccountId}) {
    const grant = read(global.localStorage,MIGRATION_KEY);
    return HEX.test(toAccountId || '') && HEX.test(fromAccountId || '') && grant?.targetAccountId === toAccountId && grant?.sourceAccountId === fromAccountId;
  }
  function onProviderMigrationCommitted(pair) {
    const grant = read(global.localStorage,MIGRATION_KEY);
    if (!grant) return true;
    if (allowProviderMigration(pair)) {
      try { global.localStorage.removeItem(MIGRATION_KEY); } catch (_) { throw error('GITHUB_STORAGE','无法完成迁移记录保存；稍后将自动重试。'); }
      if (read(global.localStorage,MIGRATION_KEY)) throw error('GITHUB_STORAGE','无法完成迁移记录保存；稍后将自动重试。');
    }
    return true;
  }
  function render() {
    const button = document.querySelector('#sync-account-button');
    if (button) { button.hidden = false; button.textContent = connection ? 'GitHub 同步设置' : '连接 GitHub 同步'; button.onclick = connect; }
    const syncNow = document.querySelector('#sync-now-button');
    if (syncNow) { syncNow.disabled = !connection; syncNow.onclick = () => global.OrdrumCloud?.sync(); }
    const holder = document.querySelector('#local-sync-context');
    if (holder) {
      holder.hidden = false;
      holder.textContent = connection ? `已连接私有同步仓库 ${connection.owner}/${connection.repo}。学习记录会自动同步。${lastError ? ' '+lastError : ''}` : '连接 GitHub 私有同步仓库，让本地网页与 iPhone 共用学习任务和进度。未连接时，记录仍保存在此设备。';
    }
  }
  function mount(target) {
    if (!target) return null;
    if (dialog) { if (dialog.parentNode !== target) target.appendChild(dialog); return dialog; }
    if (!dialog) {
      dialog = document.createElement('div'); dialog.id = 'github-sync-panel'; dialog.className = 'github-sync-panel';
      dialog.innerHTML = '<form id="github-sync-form"><h3>私有进度仓库</h3><p>在每台设备连接同一个私有仓库，之后自动同步任务、进度和错词。</p><p><a href="https://github.com/new" target="_blank" rel="noopener noreferrer">新建仓库</a> · <a href="https://github.com/settings/personal-access-tokens/new?name=Ordrum%20progress&description=Only%20the%20private%20ordrum-progress%20repository&target_name=silunzh&contents=write" target="_blank" rel="noopener noreferrer">创建访问令牌</a></p><p>令牌只选择同步仓库，授予 Contents 读写权限。请直接粘贴在这里。</p><label>GitHub 用户名<input name="owner" autocomplete="off" required maxlength="39" style="display:block;width:100%;margin:6px 0 14px"></label><label>私有仓库名<input name="repo" autocomplete="off" required maxlength="100" style="display:block;width:100%;margin:6px 0 14px"></label><label>访问令牌<input name="token" type="password" autocomplete="off" required maxlength="255" spellcheck="false" style="display:block;width:100%;margin:6px 0 14px"></label><label style="display:block;margin:12px 0"><input type="checkbox" name="remember"> 在此浏览器记住连接</label><p style="font-size:13px">默认仅在当前标签页会话保存。勾选后，令牌将保存在此浏览器；请只在自己的设备使用。</p><label style="display:block;margin:12px 0"><input type="checkbox" name="migrateExisting"> 将此设备现有学习记录合并到这个 GitHub 账号（首次迁移）</label><p id="github-sync-message" role="status" style="white-space:pre-wrap"></p><div style="display:flex;gap:12px;flex-wrap:wrap"><button type="submit" class="primary-button">保存连接并同步</button><button type="button" class="secondary-button" id="github-sync-disconnect">断开连接</button></div></form>';
      target.appendChild(dialog);
      const form = dialog.querySelector('form');
      form.addEventListener('submit',async event => {
        event.preventDefault(); const message = dialog.querySelector('#github-sync-message'); const submit = form.querySelector('[type="submit"]');
        submit.disabled = true; message.textContent = '正在检查账号与私有仓库…';
        try {
          await configure({owner:form.elements.owner.value.trim(),repo:form.elements.repo.value.trim(),token:form.elements.token.value.trim(),remember:form.elements.remember.checked,migrateExisting:form.elements.migrateExisting.checked});
          form.elements.token.value = ''; message.textContent = '已连接，正在同步学习记录。';
          notice('GitHub 已连接，正在同步学习记录。'); global.OrdrumCloud?.updateConnectionStatus();
        } catch (value) { message.textContent = value.message || '无法连接，请检查仓库与令牌权限。'; }
        finally { submit.disabled = false; }
      });
      dialog.querySelector('#github-sync-disconnect').onclick = () => { form.elements.token.value = ''; disconnect(); messageDisconnected(); };
      global.addEventListener('ordrum:settings-close',() => { form.elements.token.value = ''; });
    }
    const form = dialog.querySelector('form'); form.elements.owner.value = connection?.owner || 'silunzh'; form.elements.repo.value = connection?.repo || 'ordrum-progress';
    form.elements.token.value = ''; form.elements.remember.checked = connection?.remember === true; form.elements.migrateExisting.checked = !connection;
    dialog.querySelector('#github-sync-message').textContent = lastError;
    return dialog;
  }
  function messageDisconnected() {
    const message = dialog?.querySelector('#github-sync-message');
    if (message) message.textContent = '已断开同步，学习记录保留在此设备。';
  }
  function connect() {
    if (!global.OrdrumSettings) return false;
    global.OrdrumSettings.open('sync');
    dialog?.querySelector('input[name="token"]')?.focus();
    return true;
  }
  function cloudOptions(onNotice) {
    if (typeof onNotice === 'function') notice = onNotice;
    render();
    return {transport,isConnected,connect,allowProviderMigration,onProviderMigrationCommitted,pollIntervalMs:120000,debounceMs:5000,localLabel:'连接 GitHub 以同步学习进度',localHref:'#',signInLabel:'重新连接 GitHub 同步',signInHref:'#'};
  }
  global.OrdrumGitHubSync = {enabled:true,cloudOptions,connect,mount,disconnect,isConnected,transport,configure,getStatus:snapshot,allowProviderMigration,onProviderMigrationCommitted};
})(window);
