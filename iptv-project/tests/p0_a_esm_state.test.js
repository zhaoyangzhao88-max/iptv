import assert from 'node:assert/strict';
import test from 'node:test';

const timers = new Map();
const documentListeners = new Map();
globalThis.window = {
  electronAPI: null,
  setTimeout(callback, delay) {
    const timer = { callback, delay };
    timers.set(timer, timer);
    return timer;
  },
  clearTimeout(timer) {
    timers.delete(timer);
  }
};
globalThis.document = {
  readyState: 'loading',
  addEventListener(type, listener) {
    documentListeners.set(type, listener);
  },
  fullscreenElement: null,
  createElement() {
    return { className: '', textContent: '', style: {}, setAttribute() {}, appendChild() {} };
  }
};

const stateModule = await import(new URL('../app/modules/state.js', import.meta.url));
const dataLoader = await import(new URL('../app/modules/dataLoader.js', import.meta.url));
const appModule = await import(new URL('../app/app.js', import.meta.url));


test('app entry loads as native ESM without initializing while document is loading', () => {
  assert.ok(appModule);
  assert.equal(document.readyState, 'loading');
  assert.equal(typeof documentListeners.get('DOMContentLoaded'), 'function');
  assert.equal(window.owlIptv, undefined);
});

test('app entry exposes live channel data after state replacement', () => {
  appModule.exposeGlobals();
  assert.equal(window.owlIptvData, stateModule.state.channels);
  stateModule.state.channels = [{ name: 'updated' }];
  assert.equal(window.owlIptvData, stateModule.state.channels);
});

test('activity state is updated through the shared state contract', () => {
  const before = stateModule.getLastUserActivityTime();
  const timestamp = before - 10000;

  stateModule.setLastUserActivityTime(timestamp);
  assert.equal(stateModule.getLastUserActivityTime(), timestamp);
  assert.equal(stateModule.isUserActiveRecently(), false);

  stateModule.recordUserActivity();
  assert.ok(stateModule.getLastUserActivityTime() >= before);
  assert.equal(stateModule.isUserActiveRecently(), true);
});

test('idle render state can be scheduled and cancelled through state', () => {
  stateModule.clearPendingRenderTimer();
  dataLoader.scheduleIdleRender();
  assert.equal(stateModule.state.isRenderPending, true);
  assert.ok(stateModule.state.pendingRenderTimer);

  stateModule.clearPendingRenderTimer();
  assert.equal(stateModule.state.isRenderPending, false);
  assert.equal(stateModule.state.pendingRenderTimer, null);
  assert.equal(timers.size, 0);
});
