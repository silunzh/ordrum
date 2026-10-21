(function () {
  'use strict';
  const APP = 'ordrum-local-sync';
  const MAX_BYTES = 1024 * 1024;
  const body = document.body;
  const origin = body.dataset.localOrigin;
  const sourcePath = body.dataset.sourcePath || '';
  const pages = origin === 'https://silunzh.github.io' && sourcePath === '/ordrum/';
  const channel = body.dataset.channel;
  const opener = window.opener;
  const status = document.getElementById('bridge-status');
  const connect = document.getElementById('bridge-connect');
  const signIn = document.getElementById('bridge-signin');
  const pending = new Set();
  let connected = false, heartbeat = null;

  function stopHeartbeat() {
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
  }

  function validOrigin(value) {
    if (pages) return true;
    if (sourcePath) return false;
    try {
      const url = new URL(value);
      const port = Number(url.port || '80');
      return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
        && url.origin === value && !url.username && !url.password
        && Number.isInteger(port) && port >= 1 && port <= 65535;
    } catch (_) { return false; }
  }
  function send(message) {
    if (!opener || opener.closed) {
      connected = false;
      stopHeartbeat();
      status.textContent = pages ? 'GitHub 网页已关闭。请返回 GitHub 单词室，重新连接。' : '本地网页已关闭。请返回本地单词室，重新连接。';
      connect.hidden = true;
      return false;
    }
    opener.postMessage({app: APP, channel, ...(sourcePath ? {sourcePath} : {}), ...message}, origin);
    return true;
  }
  function needsSignIn(id) {
    connected = false;
    stopHeartbeat();
    connect.hidden = true;
    signIn.hidden = false;
    status.textContent = pages ? '登录已失效。请登录同一账号后重新连接；GitHub 网页中的学习记录会保留。' : '登录已失效。请登录同一账号后重新连接；本地学习记录会保留。';
    send({type: 'signin', ...(id !== undefined ? {id} : {})});
  }
  function respond(id, code, payload) {
    send({type: 'response', id, status: code, body: payload, contentType: 'application/json'});
  }
  async function request(message) {
    const id = message.id;
    if (pending.has(id)) { respond(id, 409, {error: 'request_in_progress'}); return; }
    if (pending.size >= 4) { respond(id, 429, {error: 'too_many_requests'}); return; }
    if (!connected) { respond(id, 403, {error: 'local_connection_required'}); return; }
    const method = message.method;
    let payload;
    try {
      if (method !== 'GET' && method !== 'PUT') throw new Error('invalid_method');
      if (method === 'PUT') {
        if (!message.body || typeof message.body !== 'object' || Array.isArray(message.body)) throw new Error('invalid_payload');
        payload = JSON.stringify(message.body);
        if (new TextEncoder().encode(payload).byteLength > MAX_BYTES) {
          respond(id, 413, {error: 'state_too_large'}); return;
        }
      }
    } catch (_) { respond(id, 400, {error: 'invalid_request'}); return; }
    pending.add(id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/progress', {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'manual', signal: controller.signal,
        headers: {Accept: 'application/json', ...(method === 'PUT' ? {'Content-Type': 'application/json'} : {})},
        ...(payload ? {body: payload} : {}),
      });
      if (response.type === 'opaqueredirect' || response.redirected
        || response.status >= 300 && response.status < 400 || response.status === 401 || response.status === 403) {
        needsSignIn(id); respond(id, 401, {error: 'sign_in_required'}); return;
      }
      if (!response.headers.get('Content-Type')?.includes('application/json')) {
        needsSignIn(id); respond(id, 401, {error: 'sign_in_required'}); return;
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BYTES + 65536) throw new Error('response_too_large');
      const result = JSON.parse(text);
      respond(id, response.status, result);
      if (connected) status.textContent = response.ok || response.status === 409
        ? `已连接。请回到${pages ? ' GitHub ' : '本地'}单词室继续学习，并保持此窗口打开。`
        : '暂时无法同步。学习记录会保留在原来的网页，稍后自动重试。';
    } catch (_) {
      respond(id, 503, {error: controller.signal.aborted ? 'sync_timeout' : 'cloud_unavailable'});
      if (connected) status.textContent = '连接暂时中断。学习记录会保留在原来的网页，稍后自动重试。';
    } finally {
      clearTimeout(timeout);
      pending.delete(id);
    }
  }

  if (!validOrigin(origin) || !/^[a-f0-9]{64}$/.test(channel || '') || !opener) {
    status.textContent = pages ? '没有找到原来的 GitHub 网页。请从 GitHub 单词室重新连接。' : '没有找到原来的本地网页。请从 Ordrum 本地单词室重新连接。';
    connect.hidden = true;
    signIn.hidden = true;
    return;
  }
  connect.addEventListener('click', () => {
    if (body.dataset.authenticated !== 'true') { needsSignIn(); return; }
    connected = true;
    connect.hidden = true;
    status.textContent = `已连接。请回到${pages ? ' GitHub ' : '本地'}单词室继续学习，并保持此窗口打开。`;
    if (send({type: 'ready'}) && heartbeat === null) {
      heartbeat = setInterval(() => { if (connected) send({type: 'ready'}); }, 2000);
    }
  });
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== opener || event.origin !== origin || !message || typeof message !== 'object'
      || Array.isArray(message) || message.app !== APP || message.channel !== channel) return;
    if (sourcePath ? message.sourcePath !== sourcePath : Object.prototype.hasOwnProperty.call(message, 'sourcePath')) return;
    if (message.type === 'hello') {
      if (connected) send({type: 'ready'});
      return;
    }
    if (message.type !== 'request') return;
    if (!(typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 128)
      && !(Number.isSafeInteger(message.id) && message.id >= 0)) return;
    let bytes;
    try { bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength; }
    catch (_) { respond(message.id, 400, {error: 'invalid_request'}); return; }
    if (bytes > MAX_BYTES + 2048) { respond(message.id, 413, {error: 'state_too_large'}); return; }
    if (body.dataset.authenticated !== 'true') {
      needsSignIn(message.id); respond(message.id, 401, {error: 'sign_in_required'}); return;
    }
    request(message);
  });
  window.addEventListener('beforeunload', () => {
    stopHeartbeat();
    if (connected) send({type: 'disconnected'});
    connected = false;
  });
})();
