import assert from 'node:assert/strict';
import test, { after } from 'node:test';

const timers = new Map();
const listeners = new Map();
const storage = new Map([['owl_iptv_local_overrides', '{"channels":{}}']]);

const video = {
  currentTime: 0,
  muted: false,
  paused: false,
  ended: false,
  src: '',
  addEventListener(type, handler) { listeners.set(`video:${type}`, handler); },
  removeEventListener(type, handler) { if (listeners.get(`video:${type}`) === handler) listeners.delete(`video:${type}`); },
  pause() { this.paused = true; },
  play() { this.paused = false; return Promise.resolve(); },
  removeAttribute(name) { if (name === 'src') this.src = ''; },
  load() {}
};

const elements = new Map();
function element(id) {
  const value = {
    id, style: {}, textContent: '', classList: { add() {}, remove() {} },
    addEventListener() {}, removeEventListener() {}, append() {}, appendChild() {},
    replaceChildren() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, removeAttribute() {}, click() {}
  };
  elements.set(id, value);
  return value;
}
['video-element', 'current-channel', 'current-latency', 'watch-duration', 'channel-grid', 'category-list'].forEach(element);
elements.get('video-element').addEventListener = video.addEventListener.bind(video);
elements.get('video-element').removeEventListener = video.removeEventListener.bind(video);
elements.set('video-element', video);

class MockHls {
  static instances = [];
  static isSupported() { return true; }
  static Events = { MANIFEST_PARSED: 'manifestParsed', ERROR: 'error' };
  static ErrorTypes = { MEDIA_ERROR: 'mediaError' };
  static ErrorDetails = {};
  constructor() { this.handlers = new Map(); this.loaded = ''; this.destroyed = false; MockHls.instances.push(this); }
  attachMedia() {}
  loadSource(url) { this.loaded = url; }
  on(type, handler) { this.handlers.set(type, handler); }
  destroy() { this.destroyed = true; }
  emit(type, ...args) { this.handlers.get(type)?.(...args); }
}

globalThis.window = {
  Hls: MockHls,
  electronAPI: null,
  localStorage: {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  setTimeout(callback, delay) { const timer = { callback, delay }; timers.set(timer, timer); return timer; },
  clearTimeout(timer) { timers.delete(timer); },
  addEventListener() {}, requestAnimationFrame(callback) { return callback(); }
};
globalThis.document = {
  readyState: 'complete',
  fullscreenElement: null,
  getElementById(id) { return elements.get(id) || element(id); },
  createElement(tag) { return element(`created-${tag}`); },
  createDocumentFragment() { return { appendChild() {} }; },
  addEventListener() {}
};
globalThis.setTimeout = window.setTimeout;
globalThis.clearTimeout = window.clearTimeout;
globalThis.alert = () => {};
globalThis.confirm = () => false;

after(() => { timers.clear(); listeners.clear(); });

const { state, els } = await import(new URL('../app/modules/state.js', import.meta.url));
const diagnostic = await import(new URL('../app/modules/diagnostic.js', import.meta.url));
els.video = video;
state._diagHls = null;

function setupChannel() {
  MockHls.instances.length = 0;
  listeners.clear();
  timers.clear();
}

test('diagnostic stops after first successful route', async () => {
  setupChannel();
  const promise = diagnostic.testSingleChannel({ name: 'A', routes: [
    { url: 'https://example.test/one.m3u8' }, { url: 'https://example.test/two.m3u8' }
  ] });
  const hls = MockHls.instances[0];
  hls.emit(MockHls.Events.MANIFEST_PARSED);
  listeners.get('video:playing')?.();
  video.currentTime = 1; listeners.get('video:timeupdate')?.();
  video.currentTime = 2; listeners.get('video:timeupdate')?.();
  const result = await promise;
  assert.equal(result.status, 'ok');
  assert.equal(result.attemptCount, 1);
  assert.equal(MockHls.instances.length, 1);
  assert.equal(hls.loaded, 'https://example.test/one.m3u8');
  assert.equal(hls.destroyed, true);
});

test('diagnostic retries ordered fallback after fatal failure', async () => {
  setupChannel();
  const promise = diagnostic.testSingleChannel({ name: 'B', routes: [
    { url: 'https://example.test/one.m3u8' }, { url: 'https://example.test/two.m3u8' }
  ] });
  const first = MockHls.instances[0];
  first.emit(MockHls.Events.ERROR, {}, { fatal: true });
  await Promise.resolve();
  assert.equal(first.destroyed, true);
  const second = MockHls.instances[1];
  assert.equal(second.loaded, 'https://example.test/two.m3u8');
  second.emit(MockHls.Events.MANIFEST_PARSED);
  listeners.get('video:playing')?.();
  video.currentTime = 3; listeners.get('video:timeupdate')?.();
  video.currentTime = 4; listeners.get('video:timeupdate')?.();
  const result = await promise;
  assert.equal(result.status, 'ok');
  assert.equal(result.attemptCount, 2);
});

test('diagnostic stops after all routes fail', async () => {
  setupChannel();
  const promise = diagnostic.testSingleChannel({ name: 'C', routes: [
    { url: 'https://example.test/one.m3u8' }, { url: 'https://example.test/two.m3u8' }
  ] });
  MockHls.instances[0].emit(MockHls.Events.ERROR, {}, { fatal: true });
  await Promise.resolve();
  MockHls.instances[1].emit(MockHls.Events.ERROR, {}, { fatal: true });
  const result = await promise;
  assert.equal(result.status, 'error');
  assert.equal(result.attemptCount, 2);
  assert.equal(MockHls.instances.length, 2);
  assert.equal(MockHls.instances[1].destroyed, true);
});

test('diagnostic supports legacy single url channels', async () => {
  setupChannel();
  const promise = diagnostic.testSingleChannel({ name: 'Legacy', url: 'https://example.test/legacy.m3u8' });
  const hls = MockHls.instances[0];
  assert.equal(hls.loaded, 'https://example.test/legacy.m3u8');
  hls.emit(MockHls.Events.MANIFEST_PARSED);
  listeners.get('video:playing')?.();
  video.currentTime = 5; listeners.get('video:timeupdate')?.();
  video.currentTime = 6; listeners.get('video:timeupdate')?.();
  const result = await promise;
  assert.equal(result.status, 'ok');
  assert.equal(result.routeCount, 1);
  assert.equal(result.attemptCount, 1);
});
test('diagnostic report redacts credentials, secrets, fragments, and reasons', async () => {
  setupChannel();
  let downloaded = '';
  globalThis.Blob = class { constructor(parts) { downloaded = parts.join(''); } };
  const NativeURL = globalThis.URL;
  globalThis.URL = class extends NativeURL {
    static createObjectURL() { return 'blob:test'; }
    static revokeObjectURL() {}
  };
  const anchor = element('report-anchor');
  anchor.click = () => {};
  globalThis.document.createElement = () => anchor;
  await diagnostic.generateReport('Test', [{
    name: 'A', status: 'error', reason: 'https://user:pass@example.test/x?token=secret',
    url: 'https://user:pass@example.test/live.m3u8?token=secret#fragment', attemptCount: 2, routeCount: 2
  }]);
  assert.match(downloaded, /https:\/\/example\.test\/live\.m3u8/);
  assert.doesNotMatch(downloaded, /user|pass|secret|token=|fragment/);
  assert.doesNotMatch(downloaded, /https:\/\/user/);
});

test('diagnostic report redacts sensitive path segments', async () => {
  setupChannel();
  let downloaded = '';
  globalThis.Blob = class { constructor(parts) { downloaded = parts.join(''); } };
  const NativeURL = globalThis.URL;
  globalThis.URL = class extends NativeURL {
    static createObjectURL() { return 'blob:test'; }
    static revokeObjectURL() {}
  };
  const anchor = element('path-report-anchor');
  anchor.click = () => {};
  globalThis.document.createElement = () => anchor;
  await diagnostic.generateReport('Test', [{
    name: 'Path', status: 'error',
    url: 'https://example.test/live/account-token-secret.m3u8?x=1#fragment',
    attemptCount: 1, routeCount: 1
  }]);
  assert.match(downloaded, /\/\[redacted\]\?x=1/);
  assert.doesNotMatch(downloaded, /account-token-secret|fragment/);
});
