import assert from 'node:assert/strict';
import test from 'node:test';

const timers = new Map();
const listeners = new Map();
const elements = new Map();

function makeElement(id) {
  const element = {
    id,
    style: {},
    dataset: {},
    className: '',
    textContent: '',
    children: [],
    scrollTop: 0,
    clientHeight: 640,
    addEventListener(type, listener) {
      listeners.set(`${id}:${type}`, listener);
    },
    append(...items) {
      this.children.push(...items);
    },
    appendChild(item) {
      this.children.push(item);
      return item;
    },
    replaceChildren(...items) {
      this.children = items.flatMap((item) => item?.children || [item]).filter(Boolean);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {},
    remove() {},
    classList: { add() {}, remove() {} },
    scrollIntoView() {},
    click() {}
  };
  elements.set(id, element);
  return element;
}

[
  'category-list', 'channel-grid', 'player-container', 'video-element',
  'current-channel', 'current-latency', 'watch-duration',
  'btn-diagnostic', 'btn-reset-filters', 'diagnostic-overlay',
  'diagnostic-progress', 'diagnostic-status'
].forEach(makeElement);

const storage = new Map([
  ['owl_iptv_watch_stats', '{}'],
  ['owl_iptv_local_overrides', '{"channels":{}}']
]);
const localStorage = {
  get length() { return storage.size; },
  key(index) { return [...storage.keys()][index] ?? null; },
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

globalThis.window = {
  electronAPI: {
    async readPublicSnapshot() {
      return JSON.stringify([
        { name: '测试频道', group: '测试', urls: ['https://example.test/live.m3u8'], tvg_id: 'test-1' }
      ]);
    }
  },
  localStorage,
  setTimeout(callback, delay) {
    const timer = { callback, delay };
    timers.set(timer, timer);
    return timer;
  },
  clearTimeout(timer) { timers.delete(timer); },
  addEventListener(type, listener) { listeners.set(`window:${type}`, listener); },
  clearTimeout(timer) { timers.delete(timer); },
  requestAnimationFrame(callback) { return callback(); }
};
globalThis.document = {
  readyState: 'loading',
  fullscreenElement: null,
  addEventListener(type, listener) { listeners.set(`document:${type}`, listener); },
  getElementById(id) { return elements.get(id) || makeElement(id); },
  createElement(tag) { return makeElement(`created:${tag}:${elements.size}`); },
  createDocumentFragment() { return { children: [], appendChild(item) { this.children.push(item); } }; }
};
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.confirm = () => false;
globalThis.Worker = class {
  postMessage() {}
};
globalThis.setTimeout = (callback, delay) => {
  const timer = { callback, delay };
  timers.set(timer, timer);
  return timer;
};
globalThis.clearTimeout = (timer) => timers.delete(timer);

const appModule = await import(new URL('../app/app.js', import.meta.url));
const stateModule = await import(new URL('../app/modules/state.js', import.meta.url));

test.after(() => {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  timers.clear();
});

test('native ESM entry waits for DOMContentLoaded and completes initialization', async () => {
  assert.equal(typeof appModule.init, 'function');
  assert.equal(window.owlIptv, undefined);

  const domReady = listeners.get('document:DOMContentLoaded');
  assert.equal(typeof domReady, 'function');
  await domReady();

  assert.equal(stateModule.state.channels.length, 1);
  assert.equal(stateModule.state.channels[0].name, '测试频道');
  assert.ok(stateModule.state.categories.length > 0);
  assert.equal(window.owlIptvData, stateModule.state.channels);
  assert.equal(typeof window.owlIptv.getChannels, 'function');
  assert.ok(timers.size >= 1, 'background refresh timer should be registered');
});

test('entry initialization records delayed work in the controllable timer registry', () => {
  assert.ok([...timers.values()].some((timer) => timer.delay === 30_000));
  for (const timer of timers.values()) assert.ok(Number.isFinite(timer.delay));
});
