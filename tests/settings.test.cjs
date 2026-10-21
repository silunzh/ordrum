const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.resolve(__dirname,'../public/settings.js');
const source = fs.readFileSync(sourcePath,'utf8');
const KEY = 'ordrum.appearance.v1';

// This small DOM implements the real tree, tab attributes and focus used by the
// settings controller. It avoids bringing a browser-sized dependency into tests.
function harness({saved,denyStorage = false,bodyReady = true} = {}) {
  const stored = new Map(saved === undefined ? [] : [[KEY,saved]]), writes = [], events = [], windowListeners = new Map(), documentListeners = new Map();
  let document;
  function matches(node,selector) {
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    const part = selector.match(/^([a-z][a-z0-9-]*)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/i);
    return !!part && (!part[1] || node.tagName.toLowerCase() === part[1]) && (!part[2] || node.attributes.has(part[2]) && (part[3] === undefined || node.attributes.get(part[2]) === part[3]));
  }
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase();this.attributes = new Map();this.children = [];this.dataset = {};this.listeners = new Map();this.parentNode = null;this.open = false;this.hidden = false;this.checked = false;this.value = '';this.tabIndex = 0;this._markup = ''; }
    set id(value) { this.setAttribute('id',value); }
    get id() { return this.getAttribute('id') || ''; }
    get isConnected() { let node = this;while (node) {if (node === document.documentElement) return true;node = node.parentNode;}return false; }
    setAttribute(name,value) {
      this.attributes.set(name,String(value));
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter) => letter.toUpperCase())] = String(value);
      if (name === 'hidden') this.hidden = true;
      if (name === 'tabindex') this.tabIndex = Number(value);
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    appendChild(node) { this.children.push(node);node.parentNode = this;return node; }
    replaceChildren(...nodes) { this.children.forEach(node => {node.parentNode = null;});this.children = [];this._markup = '';nodes.forEach(node => this.appendChild(node)); }
    get innerHTML() { return this._markup; }
    set innerHTML(value) {
      this.replaceChildren();this._markup = value;const stack = [this];
      for (const token of value.matchAll(/<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
        const [text,tag,attrs] = token;
        if (text.startsWith('</')) {if (stack.length > 1) stack.pop();continue;}
        const node = new Element(tag);
        for (const attribute of attrs.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g)) node.setAttribute(attribute[1],attribute[2] || '');
        stack.at(-1).appendChild(node);
        if (!['input','meta','link','img','br','hr'].includes(tag) && !text.endsWith('/>')) stack.push(node);
      }
    }
    querySelectorAll(selector) { const found = [];function walk(node) {for (const child of node.children) {if (matches(child,selector)) found.push(child);walk(child);}}walk(this);return found; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { let node = this;while (node) {if (matches(node,selector)) return node;node = node.parentNode;}return null; }
    contains(other) { let node = other;while (node) {if (node === this) return true;node = node.parentNode;}return false; }
    addEventListener(type,fn) { if (!this.listeners.has(type)) this.listeners.set(type,[]);this.listeners.get(type).push(fn); }
    dispatch(type,event = {}) { const value = {target:this,preventDefault(){this.defaultPrevented = true;},stopPropagation(){this.propagationStopped = true;},...event};for (const listener of this.listeners.get(type) || []) listener(value);return value; }
    showModal() { this.open = true; }
    close() { this.open = false;this.dispatch('close'); }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return {left:10,top:10,right:800,bottom:600}; }
  }
  const root = new Element('html'), head = root.appendChild(new Element('head')), body = bodyReady ? root.appendChild(new Element('body')) : null;
  const themeMeta = head.appendChild(new Element('meta'));themeMeta.setAttribute('name','theme-color');
  const button = body?.appendChild(new Element('button'));if (button) button.id = 'settings-button';
  document = {
    documentElement:root,body,activeElement:button,
    createElement:tag => new Element(tag),querySelector:selector => root.querySelector(selector),
    addEventListener(type,fn) { if (!documentListeners.has(type)) documentListeners.set(type,[]);documentListeners.get(type).push(fn); }
  };
  const window = {
    localStorage:{getItem:key => stored.get(key) || null,setItem(key,value) { if (denyStorage) throw new Error('storage denied');stored.set(key,value);writes.push({key,value}); }},
    addEventListener(type,fn) { if (!windowListeners.has(type)) windowListeners.set(type,[]);windowListeners.get(type).push(fn); },
    dispatchEvent(event) { events.push(event);for (const listener of windowListeners.get(event.type) || []) listener(event); }
  };
  function CustomEvent(type,options) { this.type = type;this.detail = options?.detail; }
  vm.runInNewContext(source,{window,document,CustomEvent,console},{filename:sourcePath});
  const api = window.OrdrumSettings;
  return {api,window,document,stored,writes,events,button,themeMeta,Element,
    get dialog(){return document.querySelector('#settings-dialog');},
    tab(id) { return document.querySelector('#settings-tab-'+id); },
    click(selector) { const node = document.querySelector(selector);assert.ok(node,selector);return this.dialog.dispatch('click',{target:node}); },
    key(id,key) { return this.dialog.dispatch('keydown',{target:this.tab(id),key}); },
    makeBody() { const value = root.appendChild(new Element('body'));document.body = value;for (const fn of documentListeners.get('DOMContentLoaded') || []) fn();return value; }
  };
}
let passed = 0;
function test(name,fn) { fn();passed++;console.log('PASS '+name); }

test('creates one tabbed settings dialog with persistent sync controls before provider boot',() => {
  const app = harness();
  for (const id of ['cloud-status','sync-account-button','local-sync-context']) assert.ok(app.document.querySelector('#'+id));
  assert.equal(app.dialog.querySelectorAll('[role="tab"]').length,5);
  assert.equal(app.dialog.querySelectorAll('[role="tabpanel"]').length,5);
  for (const tab of app.dialog.querySelectorAll('[role="tab"]')) {
    const panel = app.document.querySelector('#'+tab.getAttribute('aria-controls'));
    assert.ok(panel);assert.equal(panel.getAttribute('aria-labelledby'),tab.id);
  }
  app.api.getPanel('audio');app.api.configure({});
  assert.equal(app.document.querySelectorAll?.('#settings-dialog')?.length ?? 1,1);
});
test('loads only valid local appearance settings and updates theme colour before opening',() => {
  const app = harness({saved:JSON.stringify({theme:'night',density:'compact',token:'never-export'})});
  assert.equal(app.document.documentElement.dataset.theme,'night');assert.equal(app.document.documentElement.dataset.density,'compact');
  assert.equal(app.themeMeta.getAttribute('content'),'#17221e');assert.equal(app.dialog.open,false);
  assert.equal(JSON.stringify(app.api.getAppearance()).includes('never-export'),false);assert.equal(app.writes.length,0);
});
test('corrupt or unsupported appearance values safely use the default style',() => {
  for (const saved of ['{',JSON.stringify({theme:'url(unsafe)',density:'dense'})]) {
    const app = harness({saved});assert.equal(app.api.getAppearance().theme,'forest');assert.equal(app.api.getAppearance().density,'comfortable');
  }
});
test('theme choice and compact switch persist separately from learning and credentials',() => {
  const app = harness();app.click('[data-theme-choice="paper"]');
  const compact = app.document.querySelector('#settings-compact');compact.checked = true;compact.dispatch('change');
  assert.equal(app.document.documentElement.dataset.theme,'paper');assert.equal(app.document.documentElement.dataset.density,'compact');
  assert.equal(app.document.querySelector('[data-theme-choice="paper"]').getAttribute('aria-pressed'),'true');
  assert.equal(app.document.querySelector('[data-theme-choice="forest"]').getAttribute('aria-pressed'),'false');
  assert.equal(app.writes.length,2);assert.ok(app.writes.every(write => write.key === KEY));
  assert.deepEqual(JSON.parse(app.stored.get(KEY)),{version:1,theme:'paper',density:'compact'});
});
test('storage denial does not prevent changing the current interface',() => {
  const app = harness({denyStorage:true});app.api.setAppearance({theme:'night',density:'compact'});
  assert.equal(app.document.documentElement.dataset.theme,'night');assert.equal(app.writes.length,0);
});
test('tabs mount lazily and retain in-progress forms through switching and status changes',() => {
  const app = harness(), calls = {sync:0,audio:0};
  app.api.configure({sync(mount) { calls.sync++;mount.innerHTML = '<input id="draft-token" type="password">'; },audio(mount) {calls.audio++;mount.innerHTML = '<select id="voice-settings"></select>';} });
  assert.equal(calls.sync,0);app.api.open('sync');assert.equal(calls.sync,1);
  const input = app.document.querySelector('#draft-token');input.value = 'secret-draft';
  app.click('#settings-tab-audio');assert.equal(calls.audio,1);assert.equal(app.api.getActiveTab(),'audio');
  app.document.querySelector('#cloud-status').textContent = '同步中';
  app.click('#settings-tab-sync');assert.equal(app.document.querySelector('#draft-token'),input);assert.equal(input.value,'secret-draft');assert.equal(calls.sync,1);
  assert.equal(app.document.querySelector('#settings-panel-audio').hidden,true);
  assert.equal(app.document.querySelector('#settings-panel-sync').hidden,false);
});
test('arrow, home and end keys select and focus tabs with a single tab stop',() => {
  const app = harness();app.api.open('sync');
  const right = app.key('sync','ArrowRight');assert.equal(right.defaultPrevented,true);assert.equal(right.propagationStopped,true);
  assert.equal(app.api.getActiveTab(),'audio');assert.equal(app.document.activeElement,app.tab('audio'));
  app.key('audio','End');assert.equal(app.api.getActiveTab(),'iphone');app.key('iphone','ArrowRight');assert.equal(app.api.getActiveTab(),'sync');
  app.key('sync','ArrowLeft');assert.equal(app.api.getActiveTab(),'iphone');app.key('iphone','Home');assert.equal(app.api.getActiveTab(),'sync');
  const selected = app.dialog.querySelectorAll('[role="tab"]').filter(tab => tab.tabIndex === 0);
  assert.equal(selected.length,1);assert.equal(selected[0].getAttribute('aria-selected'),'true');
});
test('settings close clears secrets by callback and restores the opener without destroying forms',() => {
  const app = harness();let closed = 0;
  app.api.configure({sync(mount) {mount.innerHTML = '<input id="draft-token" type="password">';},onClose() {closed++;app.document.querySelector('#draft-token').value = '';}});
  app.api.open('sync');const token = app.document.querySelector('#draft-token');token.value = 'secret';
  app.click('[data-settings-close]');assert.equal(app.dialog.open,false);assert.equal(closed,1);assert.equal(token.value,'');assert.equal(app.document.activeElement,app.button);
  assert.equal(app.events.at(-1).type,'ordrum:settings-close');assert.equal(app.events.at(-1).detail.tab,'sync');
  app.api.close();assert.equal(closed,1);assert.equal(JSON.stringify(app.writes).includes('secret'),false);
});
test('Escape and clicks outside the sheet close it while internal whitespace stays open',() => {
  const app = harness();app.api.open('appearance');
  app.dialog.dispatch('click',{target:app.dialog,clientX:50,clientY:50});assert.equal(app.dialog.open,true);
  app.dialog.dispatch('click',{target:app.dialog,clientX:1,clientY:50});assert.equal(app.dialog.open,false);
  app.api.open();const escape = app.dialog.dispatch('cancel');assert.equal(escape.defaultPrevented,true);assert.equal(app.dialog.open,false);
});
test('explicit refresh cleans up only its own renderer and leaves the sync draft intact',() => {
  const app = harness();let calls = 0,cleanups = 0;
  app.api.configure({sync(mount) {mount.innerHTML = '<input id="draft-token">';},audio(mount) {calls++;mount.innerHTML = '<input id="voice-settings">';return () => {cleanups++;};}});
  app.api.open('sync');const token = app.document.querySelector('#draft-token');token.value = 'draft';
  app.api.open('audio');app.api.refresh('audio');assert.equal(calls,2);assert.equal(cleanups,1);assert.equal(token.value,'draft');
  assert.equal(app.api.refresh('unknown'),false);
});
test('re-entering archive and audio shows current progress and voices while sync remains intact',() => {
  const app = harness();let known = 0,voices = 0;
  app.api.configure({
    sync(mount) {mount.innerHTML = '<input id="draft-token">';},
    archive(mount) {mount.innerHTML = `<input id="archive-count" value="${known}">`;},
    audio(mount) {mount.innerHTML = `<input id="voice-count" value="${voices}">`;}
  });
  app.api.open('sync');const token = app.document.querySelector('#draft-token');token.value = 'keep-this-draft';
  app.api.open('archive');assert.equal(app.document.querySelector('#archive-count').getAttribute('value'),'0');
  known = 6;app.api.open('audio');assert.equal(app.document.querySelector('#voice-count').getAttribute('value'),'0');
  voices = 2;app.api.open('archive');assert.equal(app.document.querySelector('#archive-count').getAttribute('value'),'6');
  app.api.open('audio');assert.equal(app.document.querySelector('#voice-count').getAttribute('value'),'2');
  assert.equal(app.document.querySelector('#draft-token'),token);assert.equal(token.value,'keep-this-draft');
});
test('audio rate refresh restores keyboard focus to the same rate button',() => {
  const app = harness();
  app.api.configure({audio(mount) {mount.innerHTML = '<button data-action="set-rate" data-rate="0.7"></button><button data-action="set-rate" data-rate="0.85"></button><button data-action="set-rate" data-rate="1"></button>';}});
  app.api.open('audio');
  const before = app.dialog.querySelectorAll('[data-action]')[1];before.focus();app.api.refresh('audio');
  const after = app.document.activeElement;assert.notEqual(after,before);assert.equal(after.dataset.action,'set-rate');assert.equal(after.dataset.rate,'0.85');assert.equal(after.isConnected,true);
});
test('only explicit refresh or tab re-entry changes a mounted audio panel',() => {
  const app = harness();let calls = 0;
  app.api.configure({audio(mount) {calls++;mount.innerHTML = '<input id="voice-preference">';}});
  app.api.open('audio');const control = app.document.querySelector('#voice-preference');control.focus();
  app.stored.set(KEY,JSON.stringify({theme:'night'}));app.window.dispatchEvent({type:'storage',key:KEY});
  assert.equal(calls,1);assert.equal(app.document.activeElement,control);assert.equal(control.isConnected,true);
});
test('help is available inside the archive tab and is mounted only when expanded',() => {
  const app = harness();let help = 0;
  app.api.configure({help(mount) {help++;mount.innerHTML = '<p>使用说明</p>';}});
  app.api.open('archive');assert.equal(help,0);
  const details = app.document.querySelector('#settings-help');details.open = true;details.dispatch('toggle');details.dispatch('toggle');assert.equal(help,1);
});
test('another tab changing appearance updates the current controls without recreating content',() => {
  const app = harness();app.stored.set(KEY,JSON.stringify({theme:'night',density:'compact'}));
  app.window.dispatchEvent({type:'storage',key:KEY});assert.equal(app.document.documentElement.dataset.theme,'night');
  assert.equal(app.document.querySelector('#settings-compact').checked,true);
  assert.equal(app.document.querySelector('[data-theme-choice="night"]').getAttribute('aria-pressed'),'true');
  app.stored.delete(KEY);app.window.dispatchEvent({type:'storage',key:null});assert.equal(app.api.getAppearance().theme,'forest');
});
test('head-loaded appearance applies immediately and creates settings once the body is available',() => {
  const app = harness({bodyReady:false,saved:JSON.stringify({theme:'paper'})});
  assert.equal(app.document.documentElement.dataset.theme,'paper');assert.equal(app.dialog,null);
  app.makeBody();assert.ok(app.dialog);assert.ok(app.api.getPanel('sync'));
});

console.log(`\n${passed} settings interaction checks passed.`);
