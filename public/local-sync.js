(function (global) {
  'use strict';
  const APP = 'ordrum-local-sync';
  const ONLINE_ORIGIN = 'https://ordrum-rivstart-silun.genialcomet16.chatgpt.site';
  const PAGES_ORIGIN = 'https://silunzh.github.io';
  const PAGES_PATH = '/ordrum/';
  const MAX_BYTES = 1024 * 1024;
  let popup = null, ready = false, lastSeen = 0, notice = () => {};
  const pending = new Map();
  function isLocalOrigin(value) {
    try {
      const url = new URL(value);
      const port = Number(url.port || '80');
      return url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)
        && url.origin === value && !url.username && !url.password && port >= 1 && port <= 65535;
    } catch (_) { return false; }
  }
  const pages = global.location.origin === PAGES_ORIGIN && [PAGES_PATH,`${PAGES_PATH}index.html`].includes(global.location.pathname);
  const sourcePath = pages ? PAGES_PATH : '';
  const CHANNEL_KEY = pages ? 'ordrum.rivstart.channel.v1' : 'ordrum.local.channel.v1';
  const enabled = pages || isLocalOrigin(global.location.origin);
  if (!enabled) { global.OrdrumLocalSync = {enabled:false,cloudOptions:() => ({})}; return; }
  function random() {
    const bytes = new Uint8Array(32);
    global.crypto.getRandomValues(bytes);
    return Array.from(bytes,value => value.toString(16).padStart(2,'0')).join('');
  }
  let channel;
  try { channel = global.sessionStorage.getItem(CHANNEL_KEY); } catch (_) { /* Memory-only pairing still works. */ }
  if (!/^[a-f0-9]{64}$/.test(channel || '')) {
    channel = random();
    try { global.sessionStorage.setItem(CHANNEL_KEY,channel); } catch (_) { /* Memory-only pairing still works. */ }
  }
  function disconnectedError() { const error = new Error('Connect the online account window first'); error.code = 'LOCAL_SYNC_DISCONNECTED'; return error; }
  function abortError() { const error = new Error('Sync request was cancelled'); error.name = 'AbortError'; return error; }
  function isConnected() {
    return !!(ready && popup && !popup.closed);
  }
  function update() { global.OrdrumCloud?.updateConnectionStatus(); }
  function renderConnection() {
    const connected = isConnected();
    const button = document.querySelector('#sync-account-button');
    if (button) {
      button.hidden = false;
      button.textContent = connected ? '账号连接' : '连接线上账号';
      button.onclick = connect;
    }
    const holder = document.querySelector('#local-sync-context');
    if (!holder) return;
    holder.hidden = false;
    holder.innerHTML = `<div class="local-sync-notice"><div><strong>${connected ? '已连接账号窗口' : pages ? '把 GitHub 学习接到同一个账号' : '把本地学习接到同一个账号'}</strong><p>${connected ? '请保持账号窗口打开；同步完成后，下方会显示“学习进度已同步”。' : pages ? '登录原来使用的同一账号并确认连接，继续学习任务、掌握记录和错题。此网页的新记录也会自动合并。' : '首次连接时，登录线上使用的同一账号并确认连接。原有本地记录会保留并自动合并。'}</p></div><button type="button" class="secondary-button" id="connect-local-sync">${connected ? '查看账号连接' : '连接线上账号'}</button></div>`;
    document.querySelector('#connect-local-sync').addEventListener('click',connect);
  }
  function settle(id,error,response) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timeout);
    request.signal?.removeEventListener('abort',request.abort);
    if (error) request.reject(error); else request.resolve(response);
  }
  function disconnect() {
    const wasReady = ready;
    ready = false;
    for (const id of pending.keys()) settle(id,disconnectedError());
    if (wasReady) update();
    renderConnection();
  }
  function connect() {
    // Reusing a window is safe only while it has recently confirmed the bridge.
    // A live window may have navigated through sign-in or away from the bridge.
    // Rebuild that page on an explicit reconnect click, rather than sending
    // hello forever to a document which no longer runs the message listener.
    const recent = ready && Date.now() - lastSeen <= 45000;
    if (popup && !popup.closed && recent) {
      popup.focus();
      try { popup.postMessage({app:APP,channel,type:'hello',...(sourcePath ? {sourcePath} : {})},ONLINE_ORIGIN); } catch (_) { /* The sign-in page may still be navigating. */ }
      notice('请在同步窗口确认连接；如果登录已失效，请先登录同一账号。');
      return true;
    }
    disconnect();
    const url = new URL('/sync-bridge',ONLINE_ORIGIN);
    url.searchParams.set('origin',global.location.origin);
    url.searchParams.set('channel',channel);
    if (sourcePath) url.searchParams.set('path',sourcePath);
    // The fixed name reuses the existing window when the browser permits it.
    // If an authentication navigation severed its opener, opening afresh gives
    // the consent page a new opener without weakening the browser's policy.
    try { popup = global.open(url.href,`ordrum-local-sync-${channel}`,'popup,width=540,height=710'); }
    catch (_) { popup = null; }
    if (!popup) {
      notice(pages ? '浏览器拦截了同步窗口。请允许此网页打开弹出窗口，再点“连接账号并同步”。' : '浏览器拦截了同步窗口。请允许此本地网页打开弹出窗口，再点“连接账号并同步”。');
      return false;
    }
    notice(`请在打开的在线窗口登录同一账号，并点击“${pages ? '连接此 GitHub 网页' : '连接此本地网页'}”。`);
    return true;
  }
  function transport(method,body,options = {}) {
    if (!isConnected()) return Promise.reject(disconnectedError());
    if (!['GET','PUT'].includes(method)) return Promise.reject(new Error('Invalid sync method'));
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(abortError());
    let packet;
    const id = random();
    try {
      packet = {app:APP,channel,type:'request',id,method,...(sourcePath ? {sourcePath} : {}),...(method === 'PUT' ? {body} : {})};
      if (new TextEncoder().encode(JSON.stringify(packet)).byteLength > MAX_BYTES+2048) {
        return Promise.resolve(new Response(JSON.stringify({error:'state_too_large'}),{status:413,headers:{'Content-Type':'application/json'}}));
      }
    } catch (_) { return Promise.reject(new Error('Invalid sync data')); }
    return new Promise((resolve,reject) => {
      const abort = () => settle(id,abortError());
      // Fail this connection before cloud.js's 12 s request abort, so a dead
      // message bridge cannot stay marked ready indefinitely.
      const timeout = setTimeout(() => {
        settle(id,new Error('Local sync connection timed out'));
        disconnect();
        notice(pages ? '账号窗口没有响应。请点击“连接线上账号”重新连接；此网页的进度已保留。' : '账号窗口没有响应。请点击“连接线上账号”重新连接；本地进度已保留。');
      },11000);
      pending.set(id,{resolve,reject,signal,abort,timeout});
      signal?.addEventListener('abort',abort,{once:true});
      try { popup.postMessage(packet,ONLINE_ORIGIN); }
      catch (_) { settle(id,disconnectedError()); disconnect(); }
    });
  }
  global.addEventListener('message',event => {
    const message = event.data;
    if (event.origin !== ONLINE_ORIGIN || !event.source || !message || typeof message !== 'object'
      || Array.isArray(message) || message.app !== APP || message.channel !== channel) return;
    if (sourcePath ? message.sourcePath !== sourcePath : Object.prototype.hasOwnProperty.call(message,'sourcePath')) return;
    if (popup && event.source !== popup) return;
    // A consented bridge retains the same opener WindowProxy across a local
    // reload. The per-tab 256-bit channel permits that window to reconnect.
    if (message.type === 'ready') {
      const wasConnected = isConnected();
      popup = event.source;
      ready = true; lastSeen = Date.now();
      if (!wasConnected) { renderConnection(); notice(pages ? '账号已连接，正在恢复并合并 GitHub 网页与原来的学习记录。' : '账号已连接，正在合并本地和线上学习记录。'); update(); }
      return;
    }
    if (!popup || event.source !== popup) return;
    if (message.type === 'signin') {
      disconnect(); notice(pages ? '请在同步窗口重新登录同一账号；此网页的进度已保留。' : '请在同步窗口重新登录同一账号；本地进度已保留。'); return;
    }
    if (message.type === 'disconnected') { disconnect(); return; }
    if (message.type !== 'response' || !pending.has(message.id)) return;
    if (!Number.isInteger(message.status) || message.status < 200 || message.status > 599 || [204,205,304].includes(message.status) || message.contentType !== 'application/json') {
      settle(message.id,new Error('Invalid sync response')); return;
    }
    let encoded;
    try { encoded = JSON.stringify(message.body); }
    catch (_) { settle(message.id,new Error('Invalid sync response')); return; }
    if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).byteLength > MAX_BYTES+65536) {
      settle(message.id,new Error('Sync response is too large')); return;
    }
    lastSeen = Date.now();
    try { settle(message.id,null,new Response(encoded,{status:message.status,headers:{'Content-Type':'application/json'}})); }
    catch (_) { settle(message.id,new Error('Invalid sync response')); }
  });
  global.setInterval(() => { if (ready && !isConnected()) disconnect(); },2000);
  function cloudOptions(onNotice) {
    if (typeof onNotice === 'function') notice = onNotice;
    renderConnection();
    return {transport,isConnected,connect,localLabel:pages ? '连接账号并同步学习进度' : '连接账号并同步本地进度',localHref:'#',signInLabel:'重新连接账号以同步',signInHref:'#'};
  }
  global.OrdrumLocalSync = {enabled:true,cloudOptions,connect,isConnected,transport};
})(window);
