(function () {
  'use strict';
  const phoneIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/></svg>';
  const closeIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
  let registration = null, installPrompt = null, offlineReady = false, installError = false;
  let changingController = false, hadController = !!navigator.serviceWorker?.controller;
  const installed = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const byId = id => document.getElementById(id);

  function localSaveEvent() { window.dispatchEvent(new Event('ordrum:before-update')); }
  function showInstallHelp() {
    let dialog = byId('pwa-install-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');dialog.id='pwa-install-dialog';dialog.className='pwa-dialog';
      dialog.setAttribute('aria-labelledby','pwa-install-title');document.body.appendChild(dialog);
      dialog.addEventListener('click',event => {
        const action = event.target.closest('[data-pwa-action]')?.dataset.pwaAction;
        if (action === 'close') dialog.close();
        if (action === 'native-install' && installPrompt) {
          installPrompt.prompt();installPrompt.userChoice.finally(() => {installPrompt=null;showInstallHelp();});
        }
      });
    }
    const status = offlineReady ? '界面与词库已准备好，可离线打开。' : installError ? '当前没有完成离线准备，联网时仍可正常学习。' : '正在准备离线界面与词库，首次使用请保持联网。';
    dialog.innerHTML = '<div class="dialog-header"><h2 id="pwa-install-title">'+(installed() ? '你的 Ordrum App' : '把单词室放到 iPhone')+'</h2><button class="close-button" data-pwa-action="close" aria-label="关闭">'+closeIcon+'</button></div><div class="dialog-body"><div class="pwa-app-intro"><img src="icons/apple-touch-icon.png" width="60" height="60" alt="Ordrum 应用图标"><div><strong>Ordrum</strong><span>和网页一样，继续你的学习。</span></div></div>'+(installed() ? '<p>你已经在主屏幕版中，可以直接使用章节、卡片、听写、学习任务和错题本。</p>' : '<ol class="pwa-install-steps"><li><b>在 iPhone 的 Safari 打开本站。</b><span>若当前在其他应用内，请先选择“在 Safari 中打开”。</span></li><li><b>点按 Safari 的“分享”按钮。</b><span>在菜单中找到“添加到主屏幕”。</span></li><li><b>保留“作为网页 App 打开”，再点“添加”。</b><span>此开关如有显示，请保持开启；之后从主屏幕的 Ordrum 图标进入。</span></li></ol>')+(installPrompt ? '<button class="primary-button" data-pwa-action="native-install">'+phoneIcon+'安装到此设备</button>' : '')+'<div class="pwa-offline-status" role="status"><span class="pwa-status-dot '+(offlineReady ? 'ready' : '')+'"></span>'+status+'</div><h3>进度和账号</h3><p>主屏幕版与 Safari 的本地存储可能分开。请在手机和电脑上使用同一账号登录；如需手动迁移，也可以在备份入口导出、导入记录。</p><h3>离线与读音</h3><p>离线准备完成后，界面与词库可离线使用。读音会在联网播放时逐步缓存，离线只能使用已经缓存的部分；语音补读取决于系统。登录与跨设备同步需要联网。</p><p>iPhone 可能要求先点按一次播放按钮，才允许自动读音。若没有声音，请点单词旁的喇叭。设备也可能清理网页缓存，请保留重要记录的备份。</p><div class="dialog-actions"><button class="primary-button" data-pwa-action="close">继续学习</button></div></div>';
    if (!dialog.open) dialog.showModal();
  }
  function makeBanner(id,message,buttonLabel,action) {
    let banner=byId(id);
    if (banner) banner.remove();
    banner=document.createElement('div');banner.id=id;banner.className='pwa-banner';banner.setAttribute('role','status');
    const text=document.createElement('span');text.textContent=message;
    const button=document.createElement('button');button.className='primary-button';button.textContent=buttonLabel;
    button.addEventListener('click',action);banner.append(text,button);document.body.appendChild(banner);return banner;
  }
  function offerUpdate() {
    if (!registration?.waiting) return;
    makeBanner('pwa-update-banner','新版本已准备好，学习进度会保留。','更新并重新打开',() => {
      if (!registration.waiting) return;
      localSaveEvent();registration.waiting.postMessage({type:'ORDRUM_ACTIVATE_UPDATE'});
    });
  }
  function queryOfflineStatus() {
    const worker=navigator.serviceWorker?.controller || registration?.active;
    if (!worker || typeof MessageChannel === 'undefined') return;
    const channel=new MessageChannel();
    channel.port1.onmessage=event => {
      if (event.data?.type !== 'ORDRUM_CACHE_STATUS') return;
      offlineReady=event.data.ready === true;
      channel.port1.close();
      if (byId('pwa-install-dialog')?.open) showInstallHelp();
    };
    worker.postMessage({type:'ORDRUM_CACHE_STATUS'},[channel.port2]);
  }
  function offerAudioStart(text,retry) {
    if (typeof retry !== 'function') return;
    makeBanner('pwa-audio-banner','点按一次，允许手机开始播放读音。','点按开启读音',() => {
      byId('pwa-audio-banner')?.remove();
      // Keep this call synchronous inside the actual tap gesture.
      retry();
    });
  }
  window.OrdrumPWA={showInstallHelp,offerAudioStart,clearAudioStart:() => byId('pwa-audio-banner')?.remove()};
  byId('install-app-button')?.addEventListener('click',showInstallHelp);
  window.addEventListener('beforeinstallprompt',event => {event.preventDefault();installPrompt=event;});
  window.addEventListener('appinstalled',() => {installPrompt=null;byId('install-app-button')?.setAttribute('aria-label','App 使用说明');});

  if (!('serviceWorker' in navigator) || !window.isSecureContext) {installError=true;return;}
  navigator.serviceWorker.addEventListener('controllerchange',() => {
    if (hadController && !changingController) {
      changingController=true;localSaveEvent();location.reload();
    }
    hadController=true;queryOfflineStatus();
  });
  navigator.serviceWorker.register('service-worker.js',{scope:'./',updateViaCache:'none'}).then(reg => {
    registration=reg;offerUpdate();queryOfflineStatus();
    reg.addEventListener('updatefound',() => {
      const worker=reg.installing;
      worker?.addEventListener('statechange',() => {
        if (worker.state === 'installed') {queryOfflineStatus();if (navigator.serviceWorker.controller) offerUpdate();}
        if (worker.state === 'redundant' && !offlineReady) installError=true;
      });
    });
    navigator.serviceWorker.ready.then(() => queryOfflineStatus());
    // Checking on a later visit is enough; no timer polls while the user studies.
    document.addEventListener('visibilitychange',() => {if (document.visibilityState === 'visible') reg.update().catch(() => {});});
  }).catch(() => {installError=true;});
})();
