(function (global) {
  'use strict';
  const KEY = 'ordrum.appearance.v1';
  const THEMES = ['forest','paper','night'];
  const DENSITIES = ['comfortable','compact'];
  const TABS = ['sync','audio','appearance','archive','iphone'];
  const LABELS = {sync:'同步设置',audio:'发音',appearance:'外观',archive:'档案',iphone:'iPhone App'};
  const renderers = {}, mounted = new Set(), cleanups = new Map();
  let appearance = readAppearance(), dialog = null, activeTab = 'sync', opener = null, closing = false;
  let onClose = null;

  function validAppearance(value) {
    return {
      theme:THEMES.includes(value?.theme) ? value.theme : 'forest',
      density:DENSITIES.includes(value?.density) ? value.density : 'comfortable'
    };
  }
  function readAppearance() {
    try { return validAppearance(JSON.parse(global.localStorage.getItem(KEY))); }
    catch (_) { return validAppearance(null); }
  }
  function applyAppearance() {
    const root = document.documentElement;
    root.dataset.theme = appearance.theme;
    root.dataset.density = appearance.density;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute('content',appearance.theme === 'night' ? '#17221e' : appearance.theme === 'paper' ? '#f4f1e9' : '#f7f7f2');
    if (!dialog) return;
    dialog.querySelectorAll('[data-theme-choice]').forEach(button => {
      const selected = button.dataset.themeChoice === appearance.theme;
      button.setAttribute('aria-pressed',String(selected));
    });
    const compact = dialog.querySelector('#settings-compact');
    if (compact) compact.checked = appearance.density === 'compact';
  }
  function setAppearance(value) {
    appearance = validAppearance({...appearance,...value});
    applyAppearance();
    try { global.localStorage.setItem(KEY,JSON.stringify({version:1,...appearance})); }
    catch (_) { /* A restricted browser can still use the selected appearance this visit. */ }
    return {...appearance};
  }
  function getPanel(tab) {
    ensureDialog();
    return dialog?.querySelector('#settings-'+tab+'-content') || null;
  }
  function render(tab,force = false) {
    const mount = getPanel(tab);
    if (!mount || typeof renderers[tab] !== 'function' || mounted.has(tab) && !force) return;
    const focused = document.activeElement;
    const focusKey = force && focused && mount.contains(focused) ? {
      id:focused.id,
      action:focused.dataset?.action,
      data:focused.dataset ? {...focused.dataset} : {},
      start:focused.selectionStart,end:focused.selectionEnd
    } : null;
    if (force) {
      cleanups.get(tab)?.(); cleanups.delete(tab);
      mount.replaceChildren();
    }
    const cleanup = renderers[tab](mount);
    if (typeof cleanup === 'function') cleanups.set(tab,cleanup);
    mounted.add(tab);
    if (focusKey) {
      const next = focusKey.id
        ? Array.from(mount.querySelectorAll('[id]')).find(node => node.id === focusKey.id)
        : focusKey.action
          ? Array.from(mount.querySelectorAll('[data-action]')).find(node => node.dataset.action === focusKey.action && Object.entries(focusKey.data).every(([key,value]) => node.dataset[key] === value))
          : null;
      next?.focus({preventScroll:true});
      if (next?.setSelectionRange && Number.isInteger(focusKey.start) && Number.isInteger(focusKey.end)) {
        try { next.setSelectionRange(focusKey.start,focusKey.end); } catch (_) { /* Some control types do not expose a caret. */ }
      }
    }
  }
  function selectTab(tab,focus = false) {
    if (!TABS.includes(tab)) tab = 'sync';
    activeTab = tab;
    TABS.forEach(id => {
      const button = dialog.querySelector('#settings-tab-'+id);
      const selected = id === tab;
      button.setAttribute('aria-selected',String(selected));
      button.tabIndex = selected ? 0 : -1;
      dialog.querySelector('#settings-panel-'+id).hidden = !selected;
    });
    // These panels display current study data. Refresh only when the user enters
    // them; the sync form always stays mounted so background work keeps drafts.
    render(tab,['audio','archive'].includes(tab) && mounted.has(tab));
    if (tab === 'archive' && dialog.querySelector('#settings-help').open) render('help');
    if (focus) dialog.querySelector('#settings-tab-'+tab).focus();
  }
  function finishClose() {
    if (!closing && !opener) return;
    closing = false;
    try { onClose?.(); }
    finally {
      global.dispatchEvent(new CustomEvent('ordrum:settings-close',{detail:{tab:activeTab}}));
      const previous = opener; opener = null;
      if (previous?.isConnected !== false) previous?.focus?.({preventScroll:true});
    }
  }
  function close() {
    if (!dialog?.open) return;
    closing = true; dialog.close();
  }
  function open(tab = activeTab) {
    ensureDialog();
    if (!dialog) return false;
    selectTab(tab);
    if (!dialog.open) {
      opener = document.activeElement;
      dialog.showModal();
      dialog.querySelector('#settings-tab-'+activeTab).focus();
    }
    return true;
  }
  function refresh(tab) {
    if (!TABS.includes(tab) && tab !== 'help') return false;
    render(tab,true); return true;
  }
  function configure(value = {}) {
    for (const name of [...TABS,'help']) {
      if (typeof value[name] !== 'function') continue;
      if (renderers[name] !== value[name]) {
        cleanups.get(name)?.(); cleanups.delete(name); mounted.delete(name);
      }
      renderers[name] = value[name];
    }
    if (typeof value.onClose === 'function') onClose = value.onClose;
    ensureDialog();
    if (dialog?.open) render(activeTab);
    return global.OrdrumSettings;
  }
  function ensureDialog() {
    if (dialog || !document.body) return;
    dialog = document.createElement('dialog');
    dialog.id = 'settings-dialog'; dialog.className = 'settings-dialog';
    dialog.setAttribute('aria-labelledby','settings-title');
    const tabs = TABS.map((id,index) => `<button type="button" id="settings-tab-${id}" role="tab" aria-controls="settings-panel-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-settings-tab="${id}">${LABELS[id]}</button>`).join('');
    const closeIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
    dialog.innerHTML = `<div class="dialog-header settings-header"><div><h2 id="settings-title">设置</h2><p>学习偏好与设备</p></div><button type="button" class="close-button" data-settings-close aria-label="关闭设置">${closeIcon}</button></div>
      <div class="settings-layout"><div class="settings-tabs" role="tablist" aria-label="设置分类">${tabs}</div><div class="settings-panels">
      <section id="settings-panel-sync" role="tabpanel" aria-labelledby="settings-tab-sync" tabindex="0"><div class="settings-section-heading"><h3>同步学习进度</h3><p>电脑和手机连接同一个私有仓库。</p></div><div class="settings-sync-state"><span class="settings-status-dot" aria-hidden="true"></span><a id="cloud-status" href="#" aria-live="polite">进度保存在此设备</a></div><div id="local-sync-context" class="settings-sync-context" hidden></div><button type="button" class="secondary-button sync-account-button" id="sync-account-button" hidden>连接 GitHub 同步</button><button type="button" class="secondary-button" id="sync-now-button">立即同步</button><div id="settings-sync-content" class="settings-content dialog-body"></div></section>
      <section id="settings-panel-audio" role="tabpanel" aria-labelledby="settings-tab-audio" tabindex="0" hidden><div class="settings-section-heading"><h3>发音</h3><p>语速、声音与自动播放。</p></div><div id="settings-audio-content" class="settings-content dialog-body"></div></section>
      <section id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" tabindex="0" hidden><div class="settings-section-heading"><h3>界面样式</h3><p>仅影响此浏览器，可随时切换。</p></div><div class="appearance-choices" role="group" aria-label="界面样式"><button type="button" class="appearance-choice" data-theme-choice="forest" aria-pressed="true"><span class="appearance-sample sample-forest" aria-hidden="true"><i></i><i></i><i></i></span><strong>浅绿</strong><span>柔和、清爽</span></button><button type="button" class="appearance-choice" data-theme-choice="paper" aria-pressed="false"><span class="appearance-sample sample-paper" aria-hidden="true"><i></i><i></i><i></i></span><strong>纸白</strong><span>温暖、专注</span></button><button type="button" class="appearance-choice" data-theme-choice="night" aria-pressed="false"><span class="appearance-sample sample-night" aria-hidden="true"><i></i><i></i><i></i></span><strong>夜读</strong><span>低光、沉静</span></button></div><label class="settings-density"><span><strong>紧凑布局</strong><small>减少卡片间距，便于浏览更多单词。</small></span><input type="checkbox" id="settings-compact" role="switch"></label><p class="settings-local-note">外观单独保存在此设备，不会改变其他设备的设置。</p></section>
      <section id="settings-panel-archive" role="tabpanel" aria-labelledby="settings-tab-archive" tabindex="0" hidden><div class="settings-section-heading"><h3>学习档案</h3><p>备份、恢复与使用说明。</p></div><div id="settings-archive-content" class="settings-content dialog-body"></div><details id="settings-help" class="settings-help"><summary>使用说明与资料来源</summary><div id="settings-help-content" class="settings-content dialog-body"></div></details></section>
      <section id="settings-panel-iphone" role="tabpanel" aria-labelledby="settings-tab-iphone" tabindex="0" hidden><div class="settings-section-heading"><h3>iPhone App</h3><p>从主屏幕继续学习，支持离线使用。</p></div><div id="settings-iphone-content" class="settings-content dialog-body"></div></section>
      </div></div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('click',event => {
      const tab = event.target.closest('[data-settings-tab]');
      if (tab) { selectTab(tab.dataset.settingsTab); return; }
      const theme = event.target.closest('[data-theme-choice]');
      if (theme) { setAppearance({theme:theme.dataset.themeChoice}); return; }
      if (event.target.closest('[data-settings-close]')) { close(); return; }
      if (event.target === dialog) {
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
      }
    });
    dialog.addEventListener('keydown',event => {
      const tab = event.target.closest('[data-settings-tab]');
      if (!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      const index = TABS.indexOf(tab.dataset.settingsTab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length-1 : (index+(event.key === 'ArrowRight' ? 1 : -1)+TABS.length)%TABS.length;
      selectTab(TABS[next],true);
    });
    dialog.querySelector('#settings-compact').addEventListener('change',event => setAppearance({density:event.target.checked ? 'compact' : 'comfortable'}));
    dialog.querySelector('#settings-help').addEventListener('toggle',event => { if (event.target.open) render('help'); });
    dialog.addEventListener('cancel',event => { event.preventDefault(); close(); });
    dialog.addEventListener('close',finishClose);
    document.querySelector('#settings-button')?.addEventListener('click',() => open());
    applyAppearance();
  }
  global.OrdrumSettings = {configure,open,close,refresh,getPanel,setAppearance,getAppearance:() => ({...appearance}),getActiveTab:() => activeTab};
  applyAppearance();
  ensureDialog();
  if (!document.body) document.addEventListener('DOMContentLoaded',ensureDialog,{once:true});
  global.addEventListener('storage',event => {
    if (event.key !== KEY && event.key !== null) return;
    appearance = readAppearance(); applyAppearance();
  });
})(window);
