/**
 * ============================================================================
 *  微调第三步：静默扫雷子线程优先体检
 * ============================================================================
 *
 *  验证内容：
 *  1. checker-worker.js 收到 start / 重新初始化列表时，未测试频道 100% 排到队首。
 *  2. app.js 收到子线程成功结果时，将 🔘 未测试频道升级为真实延迟绿/黄卡片。
 *  3. app.js 收到子线程失败结果时，写入 hidden: true 并在非活跃状态下静默重绘移除。
 *
 *  运行方式：node tests/test_ui_sweeper.js
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
};

let _totalAsserts = 0;
let _passedAsserts = 0;

function pass(label) {
  console.log(`  ${C.green}[PASS]${C.reset} ${label}`);
  _passedAsserts++;
}

function fail(label) {
  console.log(`  ${C.red}[FAIL]${C.reset} ${label}`);
}

function assert(condition, message) {
  _totalAsserts++;
  if (condition) {
    pass(message);
  } else {
    fail(message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  1. Mock Worker：运行 app/checker-worker.js
// ────────────────────────────────────────────────────────────────────────────

class MockAbortController {
  constructor() {
    this.signal = {};
    this.aborted = false;
  }

  abort() {
    this.aborted = true;
  }
}

function createWorkerSandbox() {
  const messages = [];
  const timerQueue = [];

  const self = {
    onmessage: null,
    postMessage(data) {
      messages.push(JSON.parse(JSON.stringify(data)));
    },
  };

  const sandbox = {
    self,
    console,
    fetch: async () => ({ ok: true }),
    AbortController: MockAbortController,
    setTimeout(fn) {
      timerQueue.push(fn);
      return timerQueue.length;
    },
    clearTimeout() {},
    Number,
    String,
    Boolean,
    Array,
    Object,
    Math,
    Date,
    undefined,
    NaN,
    Infinity,
  };

  self.self = self;

  return {
    sandbox,
    messages,
    timerQueue,
    flushTimers() {
      while (timerQueue.length > 0) {
        const fn = timerQueue.shift();
        fn();
      }
    },
  };
}

async function runWorkerPriorityCase() {
  console.log(`\n${C.bold}${C.yellow}── 用例 A：子线程未测试频道优先扫雷 ──${C.reset}\n`);

  const workerJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'checker-worker.js'), 'utf8');
  const { sandbox, messages, timerQueue, flushTimers } = createWorkerSandbox();

  vm.runInNewContext(workerJs, sandbox, { timeout: 5000 });

  const mixedChannels = [
    { name: '已测-绿-1', urls: ['https://green-1.example/stream.m3u8'], delay_ms: 120 },
    { name: '未测-null-1', urls: ['https://null-1.example/stream.m3u8'], delay_ms: null },
    { name: '未测-undefined-1', urls: ['https://undefined-1.example/stream.m3u8'], delay_ms: undefined },
    { name: '已测-黄-1', urls: ['https://yellow-1.example/stream.m3u8'], delay_ms: 1600 },
    { name: '未测-99999-1', urls: ['https://dead-1.example/stream.m3u8'], delay_ms: 99999 },
    { name: '未测-null-2', urls: ['https://null-2.example/stream.m3u8'], delay_ms: null },
    { name: '已测-红-1', urls: ['https://red-1.example/stream.m3u8'], delay_ms: 3000 },
    { name: '未测-undefined-2', urls: ['https://undefined-2.example/stream.m3u8'], delay_ms: undefined },
    { name: '未测-null-3', urls: ['https://null-3.example/stream.m3u8'], delay_ms: null },
    { name: '未测-99999-2', urls: ['https://dead-2.example/stream.m3u8'], delay_ms: 99999 },
  ];

  sandbox.self.onmessage({ data: { type: 'start', channels: mixedChannels } });

  // start 后会立即跑第一个频道；后续频道由 TEST_INTERVAL_MS 定时器驱动。
  // flush 定时器队列直到产出至少 7 个结果。
  let safety = 0;
  while (messages.length < 7 && safety < 200) {
    safety++;
    flushTimers();
    // 每次 flush 后让微任务队列清空，使 async testUrl 有机会 resolve
    await new Promise((resolve) => setImmediate(resolve));
  }

  const firstSevenNames = messages.slice(0, 7).map((msg) => msg.channelName);
  const untestedNames = new Set([
    '未测-null-1',
    '未测-null-2',
    '未测-null-3',
    '未测-undefined-1',
    '未测-undefined-2',
    '未测-99999-1',
    '未测-99999-2',
  ]);
  const testedNames = new Set(['已测-绿-1', '已测-黄-1', '已测-红-1']);

  assert(
    messages.length >= 7,
    `A.1 子线程至少应产出前 7 个测试结果（当前: ${messages.length}）`
  );
  assert(
    firstSevenNames.every((name) => untestedNames.has(name)),
    `A.2 前 7 个被测试频道必须全部是未测试频道（当前: ${firstSevenNames.join(', ')}）`
  );
  assert(
    firstSevenNames.every((name) => !testedNames.has(name)),
    'A.3 已测出正常延迟的绿/黄/红频道不得进入前 7 个扫雷位'
  );
  assert(
    firstSevenNames.length === 7,
    'A.4 前 7 个扫雷位数量必须等于未测试频道数量'
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  2. Mock DOM / localStorage：加载 app/app.js 并捕获私有回调
// ────────────────────────────────────────────────────────────────────────────

function createMockElement(id) {
  const listeners = {};
  const children = [];
  const attributes = {};
  const dataset = {};
  const style = {};
  let _className = '';

  const classList = {
    _set: new Set(),
    add(cls) { this._set.add(cls); syncClassName(); },
    remove(cls) { this._set.delete(cls); syncClassName(); },
    contains(cls) { return this._set.has(cls); },
    toggle(cls) {
      if (this._set.has(cls)) this._set.delete(cls);
      else this._set.add(cls);
      syncClassName();
    },
    toString() { return [...this._set].join(' '); },
  };

  function syncClassName() {
    _className = [...classList._set].join(' ');
  }

  const el = {
    id,
    tagName: 'DIV',
    nodeType: 1,
    innerHTML: '',
    textContent: '',
    value: '',
    scrollTop: 0,
    clientHeight: 480,
    clientWidth: 600,
    offsetHeight: 480,
    offsetWidth: 600,
    parentNode: null,
    _listeners: listeners,
    _children: children,
    dataset,
    style,
    classList,
    children: { get length() { return children.length; } },

    appendChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      children.push(child);
      child.parentNode = this;
      return child;
    },

    append(...nodes) {
      nodes.forEach((node) => this.appendChild(node));
      return this;
    },

    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },

    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },

    replaceChildren(...newChildren) {
      children.forEach((child) => { child.parentNode = null; });
      children.length = 0;
      newChildren.forEach((child) => this.appendChild(child));
    },

    querySelector(sel) {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        for (const child of children) {
          if (child.classList && child.classList.contains(cls)) return child;
          const found = child.querySelector && child.querySelector(sel);
          if (found) return found;
        }
      }
      if (sel.startsWith('#')) {
        const idToFind = sel.slice(1);
        for (const child of children) {
          if (child.id === idToFind) return child;
          const found = child.querySelector && child.querySelector(sel);
          if (found) return found;
        }
      }
      return null;
    },

    querySelectorAll(sel) {
      const results = [];
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      const scan = (nodes) => {
        nodes.forEach((node) => {
          if (cls && node.classList && node.classList.contains(cls)) results.push(node);
          if (node._children) scan(node._children);
        });
      };
      scan(children);
      return results;
    },

    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },

    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter((listener) => listener !== fn);
    },

    dispatchEvent(event) {
      const type = event.type || event;
      (listeners[type] || []).forEach((fn) => fn(event));
    },

    setAttribute(k, v) { attributes[k] = String(v); },
    getAttribute(k) { return attributes[k] || null; },
    removeAttribute(k) { delete attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attributes, k); },
    scrollIntoView() {},
    focus() {},
    click() { this.dispatchEvent({ type: 'click' }); },
    closest() { return null; },
    matches() { return false; },
    getBoundingClientRect() {
      return { top: 0, left: 0, bottom: 480, right: 600, width: 600, height: 480 };
    },
  };

  Object.defineProperty(el, 'className', {
    get() { return _className; },
    set(v) {
      _className = String(v || '');
      classList._set.clear();
      _className.split(/\s+/).filter(Boolean).forEach((cls) => classList._set.add(cls));
    },
  });

  return el;
}

function createMockLocalStorage() {
  const store = {};
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { Object.keys(store).forEach((key) => delete store[key]); },
    get length() { return Object.keys(store).length; },
    key(index) { return Object.keys(store)[index] || null; },
    _store: store,
  };
}

class FixedDate extends Date {
  constructor(value) {
    if (arguments.length === 0) {
      super(1_700_000_000_000);
    } else if (arguments.length === 1) {
      super(value);
    } else {
      super(...arguments);
    }
  }

  static now() {
    return 1_700_000_000_000;
  }
}

function createAppSandbox() {
  const localStorage = createMockLocalStorage();
  const elements = {
    'custom-titlebar': createMockElement('custom-titlebar'),
    'btn-win-min': createMockElement('btn-win-min'),
    'btn-win-close': createMockElement('btn-win-close'),
    'category-list': createMockElement('category-list'),
    'channel-grid': createMockElement('channel-grid'),
    'player-container': createMockElement('player-container'),
    'video-element': createMockElement('video-element'),
    'current-channel': createMockElement('current-channel'),
    'current-latency': createMockElement('current-latency'),
    'watch-duration': createMockElement('watch-duration'),
    'btn-diagnostic': createMockElement('btn-diagnostic'),
    'btn-reset-filters': createMockElement('btn-reset-filters'),
    'diagnostic-overlay': createMockElement('diagnostic-overlay'),
    'diagnostic-progress': createMockElement('diagnostic-progress'),
    'diagnostic-status': createMockElement('diagnostic-status'),
    'tv-toast': createMockElement('tv-toast'),
  };

  elements['channel-grid'].appendChild(createMockElement('grid-spacer'));

  const docListeners = {};
  const mockDocument = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => {
      const el = createMockElement('');
      el.tagName = tag.toUpperCase();
      return el;
    },
    createDocumentFragment: () => createMockElement('fragment'),
    addEventListener: (type, fn) => {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (docListeners[type]) docListeners[type] = docListeners[type].filter((listener) => listener !== fn);
    },
    readyState: 'loading',
    fullscreenElement: null,
    exitFullscreen: () => Promise.resolve(),
    body: createMockElement('body'),
    head: createMockElement('head'),
    documentElement: createMockElement('documentElement'),
  };

  const mockWindow = {
    localStorage,
    Worker: undefined,
    Hls: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
    alert: () => {},
    confirm: () => false,
    prompt: () => null,
    console,
    location: { href: '', pathname: '/' },
    navigator: { userAgent: 'Node.js Sweeper Test' },
    URL,
    Blob,
    document: mockDocument,
    window: null,
    self: null,
    globalThis: null,
  };
  mockWindow.window = mockWindow;
  mockWindow.self = mockWindow;
  mockWindow.globalThis = mockWindow;

  const sandbox = {
    window: mockWindow,
    document: mockDocument,
    self: mockWindow,
    global: mockWindow,
    globalThis: mockWindow,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
    alert: () => {},
    confirm: () => false,
    prompt: () => null,
    Blob,
    URL,
    Date: FixedDate,
    require: (mod) => {
      if (mod === 'fs') return fs;
      if (mod === 'path') return path;
      if (mod === 'electron') return { ipcRenderer: { send: () => {} } };
      return {};
    },
    __dirname: path.join(__dirname, '..', 'app'),
    __filename: path.join(__dirname, '..', 'app', 'app.js'),
    module: { exports: {} },
    exports: {},
    Map,
    Set,
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    JSON,
    Math,
    Date: FixedDate,
    RegExp,
    Error,
    TypeError,
    RangeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    undefined,
    NaN,
    Infinity,
  };

  return { sandbox, localStorage, elements, mockDocument };
}

function loadAppForSweeperTests() {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  const instrumentedJs = appJs.replace(
    "if (document.readyState === 'loading')",
    "if (typeof __captureCheckerApi === 'function') __captureCheckerApi({ handleCheckerWorkerMessage, renderChannels, renderChannelGrid, updateCardContent, state, els });\nif (document.readyState === 'loading')"
  );

  const { sandbox, localStorage, elements, mockDocument } = createAppSandbox();
  let captured = null;

  sandbox.__captureCheckerApi = (api) => {
    captured = api;
  };

  vm.runInNewContext(instrumentedJs, sandbox, { timeout: 10000 });

  if (!captured) {
    throw new Error('无法从 app.js 捕获 handleCheckerWorkerMessage / renderChannels / updateCardContent');
  }

  return { captured, localStorage, elements, mockDocument };
}

function prepareAppState(api, elements, channels, activeColumn = 'category') {
  const { state, els } = api;

  state.allChannels = channels.slice();
  state.channels = channels.slice();
  state.channelByName = new Map(channels.map((channel) => [channel.name, channel]));
  state.categories = [{ key: 'all', label: '全部频道', channels: channels.slice() }];
  state.recommendedChannels = [];
  state.currentChannels = channels.slice();
  state.categoryIndex = 0;
  state.channelIndex = 0;
  state.activeColumn = activeColumn;
  state.localOverrides = { channels: {} };
  state.watchStats = {};
  state.virtualGridDirty = true;
  state.visibleCardElements = [];
  state.cardRecyclePool = [];
  state._vgStartIndex = 0;
  state._vgEndIndex = 0;

  els.channelGrid = elements['channel-grid'];
  els.categoryList = elements['category-list'];

  return channels[0];
}

function createMockCard() {
  const nameEl = createMockElement('channel-name');
  const latencyEl = createMockElement('latency-badge');
  latencyEl.className = 'latency-badge';
  const card = createMockElement('channel-card');
  card.appendChild(nameEl);
  card.appendChild(latencyEl);

  return { card, nameEl, latencyEl };
}

async function runAppSuccessCase() {
  console.log(`\n${C.bold}${C.yellow}── 用例 B：测通未测试频道并升级徽章 ──${C.reset}\n`);

  const { captured, localStorage, elements } = loadAppForSweeperTests();
  const url = 'https://success.example/stream.m3u8';
  const channel = {
    name: '未测试升级台',
    group: '测试',
    url,
    routes: [{ url, index: 0, delay_ms: null, failures: 0 }],
    delay_ms: null,
    failed: false,
    failures: 0,
  };
  const target = prepareAppState(captured, elements, [channel]);

  captured.handleCheckerWorkerMessage({
    data: {
      type: 'test_result',
      channelName: target.name,
      urls: [url],
      delay_ms: 120,
      success: true,
    },
  });

  const storedOverrides = JSON.parse(localStorage.getItem('owl_iptv_local_overrides') || '{}');
  const { card, latencyEl } = createMockCard();
  captured.updateCardContent(card, channel);

  assert(
    channel.delay_ms === 120,
    'B.1 成功测速后内存 delay_ms 应升级为 120ms'
  );
  assert(
    channel.routes[0].delay_ms === 120,
    'B.2 成功测速后首条线路 delay_ms 应升级为 120ms'
  );
  assert(
    channel.hidden === false,
    'B.3 成功测速后应清除内存 hidden 标记'
  );
  assert(
    storedOverrides.channels[target.name].delay_ms === 120,
    'B.4 localStorage 应保存真实延迟 120ms'
  );
  assert(
    storedOverrides.channels[target.name].hidden !== true,
    'B.5 localStorage 不应保留 hidden: true'
  );
  assert(
    latencyEl.className === 'latency-badge green',
    `B.6 卡片徽章应升级为绿色 latency-badge green（当前: ${latencyEl.className}）`
  );
  assert(
    latencyEl.textContent === '🟢 120ms',
    `B.7 卡片徽章文本应显示真实延迟（当前: ${latencyEl.textContent}）`
  );
}

async function runAppFailureCase() {
  console.log(`\n${C.bold}${C.yellow}── 用例 C：测死未测试频道并静默除雷 ──${C.reset}\n`);

  const { captured, localStorage, elements } = loadAppForSweeperTests();
  const url = 'https://dead.example/stream.m3u8';
  const channel = {
    name: '未测试除雷台',
    group: '测试',
    url,
    routes: [{ url, index: 0, delay_ms: null, failures: 0 }],
    delay_ms: null,
    failed: false,
    failures: 0,
  };
  const target = prepareAppState(captured, elements, [channel], 'category');

  captured.handleCheckerWorkerMessage({
    data: {
      type: 'test_result',
      channelName: target.name,
      urls: [url],
      delay_ms: -1,
      success: false,
    },
  });

  const storedOverrides = JSON.parse(localStorage.getItem('owl_iptv_local_overrides') || '{}');

  assert(
    channel.hidden === true,
    'C.1 失败测速后内存 channel.hidden 应为 true'
  );
  assert(
    storedOverrides.channels[target.name].hidden === true,
    'C.2 localStorage 中 owl_iptv_local_overrides 应写入 hidden: true'
  );
  assert(
    storedOverrides.channels[target.name].delay_ms === null,
    'C.3 失败测速后 localStorage delay_ms 应保持 null'
  );
  assert(
    !captured.state.currentChannels.some((item) => item.name === target.name),
    'C.4 非活跃状态下静默重绘后，当前渲染数组 currentChannels 应移除该频道'
  );
  assert(
    captured.state.virtualGridDirty === true,
    'C.5 静默除雷后应标记虚拟网格脏状态以便重绘'
  );
}

async function main() {
  await runWorkerPriorityCase();
  await runAppSuccessCase();
  await runAppFailureCase();

  console.log('');
  console.log(`${C.bold}=================== 自动静默除雷体检完成 ===================${C.reset}`);
  console.log(`${C.bold}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║        微调第三步 · 静默扫雷子线程优先体检报告              ║${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log('');

  const allPassed = _passedAsserts === _totalAsserts;

  const summaryLabels = [
    { pass: allPassed, label: '用例 A：子线程未测试频道 100% 优先扫雷' },
    { pass: allPassed, label: '用例 B：测通未测试频道升级真实延迟徽章' },
    { pass: allPassed, label: '用例 C：测死未测试频道写入 hidden 并静默重绘' },
  ];

  for (const item of summaryLabels) {
    const icon = item.pass ? `${C.green}[PASS]${C.reset}` : `${C.red}[FAIL]${C.reset}`;
    console.log(`  ${icon} ${item.label}`);
  }

  console.log('');
  console.log(`  ${C.dim}总计: ${_passedAsserts}/${_totalAsserts} 断言通过${C.reset}`);
  console.log('');

  if (!allPassed) {
    console.log(`  ${C.red}${C.bold}❌ 存在失败断言，请检查上方 [FAIL] 项${C.reset}`);
  } else {
    console.log(`  ${C.green}${C.bold}✅ 全部通过：${_passedAsserts} / ${_totalAsserts} 项断言 —— 静默除雷机制校验成功！${C.reset}`);
  }
  console.log('');

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(`${C.red}[FATAL] ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(2);
});
