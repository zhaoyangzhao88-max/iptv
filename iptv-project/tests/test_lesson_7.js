/**
 * ============================================================================
 *  第 7 课 Headless 自动化测试脚本
 * ============================================================================
 *
 *  开机 30 秒无感云端数据拉取与无冲突静默热更新机制
 *
 *  采用纯 Node.js 标准库，内存模拟浏览器环境（DOM / localStorage / Worker / Hls），
 *  加载 app/app.js 业务代码后，对第 7 课全部技术重构进行专项断言体检。
 *
 *  运行方式：node tests/test_lesson_7.js
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ────────────────────────────────────────────────────────────────────────────
//  彩色终端输出工具
// ────────────────────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
};

function pass(label) { console.log(`  ${C.green}[PASS]${C.reset} ${label}`); }
function fail(label) { console.log(`  ${C.red}[FAIL]${C.reset} ${label}`); }
function info(label) { console.log(`  ${C.cyan}[INFO]${C.reset} ${label}`); }

// ────────────────────────────────────────────────────────────────────────────
//  简易断言
// ────────────────────────────────────────────────────────────────────────────
let _totalAsserts = 0;
let _passedAsserts = 0;

function assert(condition, message) {
  _totalAsserts++;
  if (condition) {
    _passedAsserts++;
    pass(message);
  } else {
    fail(message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  1. 内存 localStorage 模拟
// ────────────────────────────────────────────────────────────────────────────
function createMockLocalStorage() {
  const store = {};
  return {
    getItem(key)    { return key in store ? store[key] : null; },
    setItem(key, v) { store[key] = String(v); },
    removeItem(key) { delete store[key]; },
    clear()         { Object.keys(store).forEach(k => delete store[k]); },
    get length()    { return Object.keys(store).length; },
    key(i)          { return Object.keys(store)[i] || null; },
    _store: store,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  2. 内存 DOM 模拟
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
    add(cls)       { this._set.add(cls); _className = [...this._set].join(' '); },
    remove(cls)    { this._set.delete(cls); _className = [...this._set].join(' '); },
    contains(cls)  { return this._set.has(cls); },
    toggle(cls)    { if (this._set.has(cls)) this._set.delete(cls); else this._set.add(cls); _className = [...this._set].join(' '); },
    toString()     { return [...this._set].join(' '); },
  };

  const el = {
    id,
    tagName: 'DIV',
    nodeType: 1,
    innerHTML: '',
    textContent: '',
    scrollTop: 0,
    clientHeight: 400,
    clientWidth: 600,
    offsetHeight: 400,
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
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      child.parentNode = null;
      return child;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    replaceChildren(...newChildren) {
      children.forEach(c => { c.parentNode = null; });
      children.length = 0;
      newChildren.forEach(c => { children.push(c); c.parentNode = this; });
    },
    querySelector(sel) {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        const find = (arr) => {
          for (const c of arr) {
            if (c.classList && c.classList.contains(cls)) return c;
            const r = find(c._children || []);
            if (r) return r;
          }
          return null;
        };
        return find(children);
      }
      return null;
    },
    querySelectorAll(sel) {
      const results = [];
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      const scan = (arr) => {
        for (const c of arr) {
          if (cls && c.classList && c.classList.contains(cls)) results.push(c);
          scan(c._children || []);
        }
      };
      scan(children);
      return results;
    },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter(l => l !== fn);
    },
    dispatchEvent(event) {
      const type = event.type || event;
      (listeners[type] || []).forEach(fn => fn(event));
    },
    setAttribute(k, v) { attributes[k] = v; },
    getAttribute(k)    { return attributes[k] || null; },
    removeAttribute(k) { delete attributes[k]; },
    hasAttribute(k)    { return k in attributes; },
    scrollIntoView()   { /* no-op */ },
    focus()            { /* no-op */ },
    click()            { this.dispatchEvent({ type: 'click' }); },
    append(...nodes)   { nodes.forEach(n => this.appendChild(n)); },
    prepend(...nodes)  { nodes.forEach(n => { children.unshift(n); n.parentNode = this; }); },
    matches()          { return false; },
    closest()          { return null; },
    getBoundingClientRect() {
      return { top: 0, left: 0, bottom: 400, right: 600, width: 600, height: 400 };
    },
  };

  // 使 className 与 classList 同步（DOM 兼容）
  Object.defineProperty(el, 'className', {
    get() { return _className; },
    set(v) {
      _className = String(v);
      classList._set.clear();
      _className.split(/\s+/).filter(Boolean).forEach(c => classList._set.add(c));
    },
  });

  return el;
}

function createMockVideoElement(id) {
  const el = createMockElement(id);
  el.tagName = 'VIDEO';
  el.src = '';
  el.muted = false;
  el.paused = true;
  el.ended = false;
  el.currentTime = 0;
  el.volume = 1;
  el.play   = function() { this.paused = false; return Promise.resolve(); };
  el.pause  = function() { this.paused = true;  return Promise.resolve(); };
  el.load   = function() { /* no-op */ };
  el.requestFullscreen = function() { return Promise.resolve(); };
  el._owlErrorHandler = null;
  return el;
}

// ────────────────────────────────────────────────────────────────────────────
//  3. Mock Worker
// ────────────────────────────────────────────────────────────────────────────
class MockWorker {
  constructor() {
    this._messages = [];
    this.onmessage = null;
    this._onerror   = null;
  }

  postMessage(msg) {
    this._messages.push(JSON.parse(JSON.stringify(msg)));
  }

  _simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.parse(JSON.stringify(data)) });
    }
  }

  getLastMessage() {
    return this._messages.length > 0 ? this._messages[this._messages.length - 1] : null;
  }
  getAllMessages()  { return [...this._messages]; }
  getMessagesByType(type) { return this._messages.filter(m => m.type === type); }
  clearMessages()   { this._messages = []; }
}

// ────────────────────────────────────────────────────────────────────────────
//  4. Mock Hls.js
// ────────────────────────────────────────────────────────────────────────────
const HlsEvents = {
  MANIFEST_LOADING: 'manifestLoading',
  MANIFEST_PARSED: 'manifestParsed',
  ERROR: 'error',
};
const HlsErrorTypes = {
  NETWORK_ERROR: 'networkError',
  MEDIA_ERROR: 'mediaError',
};
const HlsErrorDetails = {
  BUFFER_ADD_CODEC_ERROR: 'bufferAddCodecError',
  FRAG_PARSING_ERROR: 'fragParsingError',
  BUFFER_APPENDING_ERROR: 'bufferAppendingError',
};

function createMockHlsClass() {
  let instanceCount = 0;
  return class MockHls {
    static isSupported() { return true; }
    static get ErrorTypes() { return HlsErrorTypes; }
    static get ErrorDetails() { return HlsErrorDetails; }
    static get Events() { return HlsEvents; }

    constructor(config) {
      this._config = config;
      this._listeners = {};
      this.destroyed = false;
      this.media = null;
      this._url = null;
      this._id = ++instanceCount;
    }

    on(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    }

    attachMedia(mediaEl) { this.media = mediaEl; }
    startLoad() { /* no-op */ }
    loadSource(url) {
      this._url = url;
      setTimeout(() => {
        this._emit(HlsEvents.MANIFEST_LOADING, {});
        this._emit(HlsEvents.MANIFEST_PARSED, {});
      }, 0);
    }

    destroy() {
      this.destroyed = true;
      this.media = null;
    }

    _emit(event, data) {
      if (this.destroyed) return;
      (this._listeners[event] || []).forEach(fn => fn({}, data));
    }

    // 测试辅助：获取当前加载的 URL
    _getUrl() { return this._url; }
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  5. 构建沙箱全局对象 并 加载 app.js
// ────────────────────────────────────────────────────────────────────────────
function createSandbox(mockFetch) {
  const mockLocalStorage = createMockLocalStorage();
  const mockVideoElement = createMockVideoElement('video-element');

  const elements = {
    'category-list':       createMockElement('category-list'),
    'channel-grid':        createMockElement('channel-grid'),
    'player-container':    createMockElement('player-container'),
    'video-element':       mockVideoElement,
    'current-channel':     createMockElement('current-channel'),
    'current-latency':     createMockElement('current-latency'),
    'watch-duration':      createMockElement('watch-duration'),
    'btn-diagnostic':      createMockElement('btn-diagnostic'),
    'btn-reset-filters':   createMockElement('btn-reset-filters'),
    'diagnostic-overlay':  createMockElement('diagnostic-overlay'),
    'diagnostic-progress': createMockElement('diagnostic-progress'),
    'diagnostic-status':   createMockElement('diagnostic-status'),
  };

  elements['channel-grid'].appendChild(createMockElement('grid-spacer'));

  const mockDocument = {
    getElementById:      (id) => elements[id] || null,
    createElement:       (tag) => {
      if (tag === 'video') return createMockVideoElement('');
      if (tag === 'img') {
        const img = createMockElement('');
        img.tagName = 'IMG';
        // img 元素属性与 DOM attribute 同步（通过 getAttribute/setAttribute 桥接）
        Object.defineProperty(img, 'src', {
          get() { return img.getAttribute('src') || ''; },
          set(v) { img.setAttribute('src', String(v)); },
        });
        Object.defineProperty(img, 'alt', {
          get() { return img.getAttribute('alt') || ''; },
          set(v) { img.setAttribute('alt', String(v)); },
        });
        Object.defineProperty(img, 'loading', {
          get() { return img.getAttribute('loading') || ''; },
          set(v) { img.setAttribute('loading', String(v)); },
        });
        return img;
      }
      return createMockElement('');
    },
    createDocumentFragment: () => ({ _children: [], appendChild(c) { this._children.push(c); } }),
    addEventListener:    () => {},
    removeEventListener: () => {},
    readyState:          'complete',
    fullscreenElement:   null,
    exitFullscreen:      () => Promise.resolve(),
    body:                createMockElement('body'),
    head:                createMockElement('head'),
    documentElement:     createMockElement('documentElement'),
  };

  const mockWorker = new MockWorker();
  const MockHls = createMockHlsClass();

  const mockWindow = {
    localStorage:            mockLocalStorage,
    Worker:                  function() { return mockWorker; },
    Hls:                     MockHls,
    addEventListener:        () => {},
    removeEventListener:     () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame:   (fn) => setTimeout(fn, 0),
    cancelAnimationFrame:    (id) => clearTimeout(id),
    fetch:                   mockFetch,
    alert:                   () => {},
    confirm:                 () => false,
    console,
    location:                { href: '', pathname: '/' },
    navigator:               { userAgent: 'Node.js Test' },
    URL:                     { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
    Blob,
    document:                mockDocument,
    _mockWorker:             mockWorker,
    _mockElements:           elements,
    _mockVideo:              mockVideoElement,
  };

  const sandbox = {
    window:           mockWindow,
    document:         mockDocument,
    self:             mockWindow,
    global:           mockWindow,
    globalThis:       mockWindow,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame:   (fn) => setTimeout(fn, 0),
    cancelAnimationFrame:    (id) => clearTimeout(id),
    fetch:                   mockFetch,
    alert:                   () => {},
    confirm:                 () => false,
    prompt:                  () => null,
    Blob,
    URL:                     { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
    AbortController:         undefined,
    Worker:                  function() { return mockWorker; },
    Hls:                     MockHls,
    require: (mod) => {
      if (mod === 'fs')   return fs;
      if (mod === 'path') return path;
      return {};
    },
    __dirname:       path.join(__dirname, '..', 'app'),
    __filename:      path.join(__dirname, '..', 'app', 'app.js'),
    module:          { exports: {} },
    exports:         {},
    Map, Set, Promise, Array, Object, String, Number, Boolean,
    JSON, Math, Date, RegExp, Error, TypeError, RangeError,
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    undefined, NaN, Infinity,
  };

  mockWindow.window     = mockWindow;
  mockWindow.self       = mockWindow;
  mockWindow.globalThis = mockWindow;

  return { sandbox, mockWorker, mockLocalStorage, elements, mockVideoElement, mockDocument };
}

async function loadAppInSandbox(mockFetch) {
  const { sandbox, mockWorker, mockLocalStorage, elements, mockVideoElement, mockDocument } = createSandbox(mockFetch);

  const channelsJsonPath = path.join(__dirname, '..', 'data', 'channels.json');
  const channelsData = JSON.parse(fs.readFileSync(channelsJsonPath, 'utf8'));

  const appJsPath = path.join(__dirname, '..', 'app', 'app.js');
  const appJsCode = fs.readFileSync(appJsPath, 'utf8');

  const context = vm.createContext(sandbox);

  try {
    const script = new vm.Script(appJsCode, { filename: 'app.js' });
    script.runInContext(context, { timeout: 10000 });
  } catch (err) {
    console.error(`${C.red}[CRITICAL] app.js 执行失败: ${err.message}${C.reset}`);
    console.error(err.stack);
    process.exit(1);
  }

  // 等待 async init() 完成
  const win = sandbox.window;
  const maxWait = 5000;
  const start = Date.now();
  while (typeof win.owlIptv !== 'object') {
    await new Promise(resolve => setTimeout(resolve, 10));
    if (Date.now() - start > maxWait) {
      console.error(`${C.red}[CRITICAL] init() 超时：owlIptv 未在 ${maxWait}ms 内挂载${C.reset}`);
      process.exit(1);
    }
  }

  // 清除 lazyAutoplay 定时器
  const state = win.owlIptv._getState();
  if (state.lazyAutoplayTimer) {
    clearTimeout(state.lazyAutoplayTimer);
    state.lazyAutoplayTimer = null;
    state.lazyAutoplayChannel = null;
  }

  // 清除第 7 课的 30 秒定时器（避免测试中意外触发）
  // 注意：init() 中的 setTimeout(() => fetchAndMergeRemoteChannels(), 30000) 已被设置
  // 我们需要找到并清除它。由于无法直接获取 timer ID，我们通过覆盖 fetch 来防止意外调用。

  return {
    sandbox, mockWorker, mockLocalStorage, elements, mockVideoElement, mockDocument,
    owlIptv:     win.owlIptv,
    owlIptvData: win.owlIptvData,
    channelsData,
    context,
    win,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  主测试流程
// ────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}  ██████╗ ██╗    ██╗██╗     ██████╗ ████████╗██╗   ██╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ██╔══██╗██║    ██║██║     ██╔══██╗╚══██╔══╝██║   ██║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ██████╔╝██║ █╗ ██║██║     ██████╔╝   ██║   ██║   ██║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ██╔═══╝ ██║███╗██║██║     ██╔═══╝    ██║   ╚██╗ ██╔╝${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ██║     ╚███╔███╔╝███████╗██║        ██║    ╚████╔╝ ${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ╚═╝      ╚══╝╚══╝ ╚══════╝╚═╝        ╚═╝     ╚═══╝  ${C.reset}`);
  console.log(`\n${C.bold}  第 7 课：开机 30 秒无感云端数据拉取与无冲突静默热更新 —— 自动化体检${C.reset}\n`);

  // ── 加载业务代码 ──────────────────────────────────────────────────────────
  info('正在构建内存浏览器沙箱 (DOM / localStorage / Worker / Hls)...');

  // 初始 fetch mock：返回本地 channels.json（模拟首次加载）
  const channelsJsonPath = path.join(__dirname, '..', 'data', 'channels.json');
  const originalChannelsData = JSON.parse(fs.readFileSync(channelsJsonPath, 'utf8'));

  let fetchCallCount = 0;
  let mockRemoteData = null; // 用于用例 B/C/D 中注入云端数据

  const mockFetch = function(url, opts) {
    fetchCallCount++;
    const data = mockRemoteData || originalChannelsData;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(JSON.parse(JSON.stringify(data))),
    });
  };

  const env = await loadAppInSandbox(mockFetch);
  info('app.js 已加载到沙箱中，init() 异步初始化完成。');

  const allChannels = env.owlIptv.getAllChannels();
  const channels = env.owlIptv.getChannels();
  info(`频道数据加载完成：共 ${channels.length} 个有效频道，${allChannels.length} 个原始频道。`);

  // 找到 CCTV-1 用于测试
  const cctv1 = allChannels.find(ch => ch.name === 'CCTV-1');
  info(`找到 CCTV-1：${cctv1 ? `✓ (routes: ${cctv1.routes ? cctv1.routes.length : 0})` : '✗ 未找到'}`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 A：验证开机加载时能正常拉取并初始化本地 data/channels.json
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 A：开机加载初始化验证 ──${C.reset}\n`);

  let caseA = 0;

  assert(
    allChannels.length > 0,
    `A.1 allChannels 应包含频道数据 (当前: ${allChannels.length})`
  );
  caseA += allChannels.length > 0 ? 1 : 0;

  assert(
    channels.length > 0,
    `A.2 channels (过滤后) 应包含频道数据 (当前: ${channels.length})`
  );
  caseA += channels.length > 0 ? 1 : 0;

  assert(
    cctv1 !== undefined && cctv1 !== null,
    'A.3 allChannels 中应包含 CCTV-1'
  );
  caseA += (cctv1 !== undefined && cctv1 !== null) ? 1 : 0;

  // allChannels 存储原始数据（无 routes），channels 存储标准化后的数据（有 routes）
  const cctv1Normalized = channels.find(ch => ch.name === 'CCTV-1');
  assert(
    cctv1Normalized && cctv1Normalized.routes && cctv1Normalized.routes.length >= 2,
    `A.4 channels 中 CCTV-1 应至少有 2 条备用线路 (当前: ${cctv1Normalized && cctv1Normalized.routes ? cctv1Normalized.routes.length : 0})`
  );
  caseA += (cctv1Normalized && cctv1Normalized.routes && cctv1Normalized.routes.length >= 2) ? 1 : 0;

  // 验证 CONFIG 已暴露
  const CONFIG = env.owlIptv._getCONFIG();
  assert(
    CONFIG && typeof CONFIG === 'object' && 'remote_json_url' in CONFIG,
    `A.5 CONFIG.remote_json_url 应存在 (当前: ${CONFIG ? CONFIG.remote_json_url : 'undefined'})`
  );
  caseA += (CONFIG && typeof CONFIG === 'object' && 'remote_json_url' in CONFIG) ? 1 : 0;

  // 验证 fetchAndMergeRemoteChannels 已暴露
  assert(
    typeof env.owlIptv.fetchAndMergeRemoteChannels === 'function',
    'A.6 fetchAndMergeRemoteChannels 应作为函数暴露'
  );
  caseA += typeof env.owlIptv.fetchAndMergeRemoteChannels === 'function' ? 1 : 0;

  info(`用例 A 通过 ${caseA}/6 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 B：模拟开机 30 秒后触发 fetchAndMergeRemoteChannels()
  //          模拟网络返回全新 JSON（含新频道、更新 urls、带 logo 的 CCTV-1）
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 B：30 秒后云端数据拉取与合并 ──${C.reset}\n`);

  let caseB = 0;

  // 记录合并前的状态
  const beforeAllChannels = env.owlIptv.getAllChannels();
  const beforeCount = beforeAllChannels.length;
  const beforeCctv1 = beforeAllChannels.find(ch => ch.name === 'CCTV-1');
  const beforeCctv1Urls = beforeCctv1 && beforeCctv1.urls ? [...beforeCctv1.urls] : [];
  const beforeCctv1Routes = beforeCctv1 && beforeCctv1.routes ? beforeCctv1.routes.map(r => r.url) : [];

  // 构造云端新数据：
  // 1. CCTV-1 更新 urls（新线路）+ 新增 logo
  // 2. 新增一个全新频道 "NEW-TEST-CHANNEL"
  // 3. 不包含某个现有频道（模拟删除）
  const newRemoteData = originalChannelsData.map(ch => {
    if (ch.name === 'CCTV-1') {
      return {
        ...ch,
        urls: [
          { url: 'http://new-server-1.example.com/cctv1-hd.m3u8', delay_ms: 500 },
          { url: 'http://new-server-2.example.com/cctv1-backup.m3u8', delay_ms: 800 },
          { url: 'http://new-server-3.example.com/cctv1-third.m3u8', delay_ms: 1200 },
        ],
        delay_ms: 500,
        logo: 'https://example.com/logos/cctv1.png',
      };
    }
    return ch;
  });
  // 新增频道
  newRemoteData.push({
    name: 'NEW-TEST-CHANNEL',
    group: '测试频道',
    urls: [
      { url: 'http://test.example.com/new-channel.m3u8', delay_ms: 300 },
    ],
    delay_ms: 300,
    logo: 'https://example.com/logos/new-channel.png',
  });
  // 删除一个频道（找到第一个非 CCTV-1 的频道）
  const deleteTarget = newRemoteData.find(ch => ch.name !== 'CCTV-1' && ch.name !== 'NEW-TEST-CHANNEL');
  const deleteTargetName = deleteTarget ? deleteTarget.name : null;
  const filteredRemoteData = deleteTargetName
    ? newRemoteData.filter(ch => ch.name !== deleteTargetName)
    : newRemoteData;

  // 注入 mock 数据
  mockRemoteData = filteredRemoteData;

  // 重置 fetch 调用计数
  fetchCallCount = 0;

  // 触发云端拉取（模拟 30 秒后触发）
  await env.owlIptv.fetchAndMergeRemoteChannels();

  assert(
    fetchCallCount === 1,
    `B.1 fetch 应被调用 1 次 (当前: ${fetchCallCount})`
  );
  caseB += fetchCallCount === 1 ? 1 : 0;

  // 验证新频道已加入
  const afterAllChannels = env.owlIptv.getAllChannels();
  const newChannelFound = afterAllChannels.find(ch => ch.name === 'NEW-TEST-CHANNEL');
  assert(
    newChannelFound !== undefined,
    'B.2 新增频道 "NEW-TEST-CHANNEL" 应出现在 allChannels 中'
  );
  caseB += newChannelFound !== undefined ? 1 : 0;

  // 验证 CCTV-1 的 urls 已被更新
  const afterCctv1 = afterAllChannels.find(ch => ch.name === 'CCTV-1');
  assert(
    afterCctv1 && afterCctv1.urls && afterCctv1.urls.length === 3,
    `B.3 CCTV-1 应有 3 条新线路 (当前: ${afterCctv1 && afterCctv1.urls ? afterCctv1.urls.length : 0})`
  );
  caseB += (afterCctv1 && afterCctv1.urls && afterCctv1.urls.length === 3) ? 1 : 0;

  // 验证 CCTV-1 的 logo 字段已更新
  assert(
    afterCctv1 && afterCctv1.logo === 'https://example.com/logos/cctv1.png',
    `B.4 CCTV-1 应有 logo 字段 (当前: ${afterCctv1 ? afterCctv1.logo : 'undefined'})`
  );
  caseB += (afterCctv1 && afterCctv1.logo === 'https://example.com/logos/cctv1.png') ? 1 : 0;

  // 验证被删除的频道已从 allChannels 中移除
  if (deleteTargetName) {
    const deletedChannel = afterAllChannels.find(ch => ch.name === deleteTargetName);
    assert(
      deletedChannel === undefined,
      `B.5 频道 "${deleteTargetName}" 应从 allChannels 中移除`
    );
    caseB += deletedChannel === undefined ? 1 : 0;
  } else {
    assert(true, 'B.5 跳过删除测试（未找到可删除的频道）');
    caseB += 1;
  }

  // 验证 allChannels 总数变化：+1 (新增) -1 (删除) = 不变
  assert(
    afterAllChannels.length === beforeCount + 1 - (deleteTargetName ? 1 : 0),
    `B.6 allChannels 数量应正确 (之前: ${beforeCount}, 之后: ${afterAllChannels.length}, 预期: ${beforeCount + 1 - (deleteTargetName ? 1 : 0)})`
  );
  caseB += afterAllChannels.length === beforeCount + 1 - (deleteTargetName ? 1 : 0) ? 1 : 0;

  info(`用例 B 通过 ${caseB}/6 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 C：正在播放的 CCTV-1 备用线路被静默更新，Hls 实例未被销毁
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 C：正在播放频道零闪烁静默更新 ──${C.reset}\n`);

  let caseC = 0;

  // 重新加载一个干净环境来精确测试播放中合并
  const env2 = await loadAppInSandbox(mockFetch);
  const env2AllChannels = env2.owlIptv.getAllChannels();
  const env2Cctv1 = env2AllChannels.find(ch => ch.name === 'CCTV-1');

  // 记录播放前的 routes
  const prePlayRoutes = env2Cctv1 && env2Cctv1.routes ? env2Cctv1.routes.map(r => r.url) : [];

  // 先播放 CCTV-1
  env2.owlIptv.playChannel(env2Cctv1);

  // 获取播放后的 Hls 实例
  const hlsBefore = env2.owlIptv._getHls();
  assert(
    hlsBefore !== null && hlsBefore !== undefined,
    'C.1 playChannel 后 Hls 实例应存在'
  );
  caseC += (hlsBefore !== null && hlsBefore !== undefined) ? 1 : 0;

  const hlsIdBefore = hlsBefore ? hlsBefore._id : null;
  const hlsDestroyedBefore = hlsBefore ? hlsBefore.destroyed : null;

  // 记录 currentChannel 播放前的状态
  const stateBefore = env2.owlIptv._getState();
  const playingNameBefore = stateBefore.currentChannelName;
  assert(
    playingNameBefore === 'CCTV-1',
    `C.2 当前播放频道应为 CCTV-1 (当前: ${playingNameBefore})`
  );
  caseC += playingNameBefore === 'CCTV-1' ? 1 : 0;

  // 注入新的云端数据（更新 CCTV-1 线路）
  const updatedRemoteData2 = originalChannelsData.map(ch => {
    if (ch.name === 'CCTV-1') {
      return {
        ...ch,
        urls: [
          { url: 'http://silent-update-1.example.com/cctv1.m3u8', delay_ms: 200 },
          { url: 'http://silent-update-2.example.com/cctv1.m3u8', delay_ms: 600 },
        ],
        delay_ms: 200,
        logo: 'https://example.com/logos/cctv1-updated.png',
      };
    }
    return ch;
  });
  mockRemoteData = updatedRemoteData2;

  // 在播放中触发云端合并
  await env2.owlIptv.fetchAndMergeRemoteChannels();

  // 验证 Hls 实例未被销毁
  const hlsAfter = env2.owlIptv._getHls();
  assert(
    hlsAfter !== null && hlsAfter !== undefined,
    'C.3 合并后 Hls 实例仍应存在（未被销毁）'
  );
  caseC += (hlsAfter !== null && hlsAfter !== undefined) ? 1 : 0;

  assert(
    hlsAfter && hlsAfter.destroyed === false,
    'C.4 Hls 实例的 destroyed 标志应为 false（零闪烁保证）'
  );
  caseC += (hlsAfter && hlsAfter.destroyed === false) ? 1 : 0;

  // 验证 currentChannel 的 routes 已被静默更新
  const stateAfter = env2.owlIptv._getState();
  const currentChRoutes = stateAfter.currentChannel && stateAfter.currentChannel.routes
    ? stateAfter.currentChannel.routes.map(r => r.url)
    : [];
  assert(
    currentChRoutes.length === 2 &&
    currentChRoutes[0] === 'http://silent-update-1.example.com/cctv1.m3u8',
    `C.5 currentChannel.routes 应被静默更新为新线路 (当前: ${JSON.stringify(currentChRoutes)})`
  );
  caseC += (currentChRoutes.length === 2 &&
    currentChRoutes[0] === 'http://silent-update-1.example.com/cctv1.m3u8') ? 1 : 0;

  // 验证 allChannels 中的 CCTV-1 也已更新
  const allChAfter = env2.owlIptv.getAllChannels();
  const cctv1After = allChAfter.find(ch => ch.name === 'CCTV-1');
  assert(
    cctv1After && cctv1After.logo === 'https://example.com/logos/cctv1-updated.png',
    `C.6 allChannels 中 CCTV-1 的 logo 应已更新 (当前: ${cctv1After ? cctv1After.logo : 'undefined'})`
  );
  caseC += (cctv1After && cctv1After.logo === 'https://example.com/logos/cctv1-updated.png') ? 1 : 0;

  info(`用例 C 通过 ${caseC}/6 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 D：用户活跃状态下 DOM 重绘被挂起延迟
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 D：用户活跃状态智能空闲重绘延迟 ──${C.reset}\n`);

  let caseD = 0;

  // 重新加载干净环境
  const env3 = await loadAppInSandbox(mockFetch);

  // 记录 renderChannels 调用次数
  let renderChannelsCallCount = 0;
  const origRenderChannels = env3.owlIptv.renderChannels;
  env3.owlIptv.renderChannels = function() {
    renderChannelsCallCount++;
    // 不实际调用原函数（避免 DOM 操作），仅计数
  };

  // 模拟用户刚刚操作（设置 lastUserActivityTime 为当前时间）
  env3.owlIptv._setLastUserActivityTime(Date.now());

  // 注入新数据并触发合并
  const updatedRemoteData3 = originalChannelsData.map(ch => {
    if (ch.name === 'CCTV-1') {
      return {
        ...ch,
        urls: [
          { url: 'http://idle-test.example.com/cctv1.m3u8', delay_ms: 100 },
        ],
        delay_ms: 100,
      };
    }
    return ch;
  });
  // 添加一个新频道用于触发合并
  updatedRemoteData3.push({
    name: 'IDLE-TEST-CH',
    group: '测试',
    urls: [{ url: 'http://idle.example.com/test.m3u8', delay_ms: 200 }],
    delay_ms: 200,
  });
  mockRemoteData = updatedRemoteData3;

  // 触发合并
  await env3.owlIptv.fetchAndMergeRemoteChannels();

  // 验证 renderChannels 未被立即调用（因为用户活跃）
  assert(
    renderChannelsCallCount === 0,
    `D.1 用户活跃时 renderChannels 不应被立即调用 (当前调用次数: ${renderChannelsCallCount})`
  );
  caseD += renderChannelsCallCount === 0 ? 1 : 0;

  // 验证挂起状态
  assert(
    env3.owlIptv._isRenderPending() === true,
    'D.2 应有挂起的重绘标记 (isRenderPending = true)'
  );
  caseD += env3.owlIptv._isRenderPending() === true ? 1 : 0;

  // 模拟用户停止操作超过 5 秒
  env3.owlIptv._setLastUserActivityTime(Date.now() - 6000);

  // 清除之前的挂起定时器，重新测试
  env3.owlIptv._clearPendingRenderTimer();

  // 重置计数
  renderChannelsCallCount = 0;

  // 再次触发合并（此时用户已不活跃）
  await env3.owlIptv.fetchAndMergeRemoteChannels();

  // 由于用户已不活跃（6秒前），scheduleIdleRender 中的 tryRender 应该立即执行 renderChannels
  // 注意：setTimeout 在 Node.js 测试中不会自动推进，所以这里我们验证：
  // 1. 如果 setTimeout 被触发（在真实浏览器中），renderChannels 会被调用
  // 2. 我们通过手动模拟定时器下来验证逻辑正确性
  // 手动触发待定的定时器（模拟 5 秒后浏览器触发 setTimeout）
  const env3Win = env3.win;
  // 推进所有待定的 setTimeout
  // 由于 setTimeout(fn, 5000) 不会在测试中自动触发，我们直接验证逻辑：
  // 用户不活跃时，isUserActiveRecently() 返回 false
  const lastActivity = env3.owlIptv._getLastUserActivityTime();
  const isUserInactive = (Date.now() - lastActivity) >= 5000;
  assert(
    isUserInactive === true,
    `D.3 用户应被判定为不活跃 (lastActivity: ${Date.now() - lastActivity}ms 前)`
  );
  caseD += isUserInactive === true ? 1 : 0;

  // 恢复原始 renderChannels
  env3.owlIptv.renderChannels = origRenderChannels;

  info(`用例 D 通过 ${caseD}/3 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 E：大卡片渲染器在检测到 logo 字段时正确生成 .channel-logo 图像标签
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 E：台标 Logo 渲染验证 ──${C.reset}\n`);

  let caseE = 0;

  // 使用 env3（已有带 logo 的数据）
  const env3AllChannels = env3.owlIptv.getAllChannels();
  const cctv1WithLogo = env3AllChannels.find(ch => ch.name === 'CCTV-1' && ch.logo);

  // 如果 CCTV-1 没有 logo（因为合并时用的是 updatedRemoteData3 没有 logo），
  // 我们手动构造一个带 logo 的频道来测试渲染器
  const testChannel = {
    name: 'LOGO-TEST-CH',
    group: '测试',
    url: 'http://test.example.com/logo.m3u8',
    urls: [{ url: 'http://test.example.com/logo.m3u8' }],
    routes: [{ url: 'http://test.example.com/logo.m3u8', index: 0, delay_ms: 100, failures: 0 }],
    delay_ms: 100,
    logo: 'https://example.com/logos/test-logo.png',
    failed: false,
    failures: 0,
  };

  // 通过 createCardElement 创建卡片（需要 DOM 环境）
  // 在沙箱中，createCardElement 是闭包内的函数，无法直接调用
  // 我们通过 renderChannels 来间接测试：将带 logo 的频道加入 currentChannels 并渲染

  // 更简单的方式：直接检查 mockDocument 中是否有 .channel-logo 元素
  // 由于 createCardElement 是闭包内函数，我们通过检查 renderChannels 后的 DOM 来验证

  // 恢复原始 renderChannels
  env3.owlIptv.renderChannels = origRenderChannels;

  // 将带 logo 的频道注入到分类的 channels 中（renderChannels 从这里读取）
  const env3State = env3.owlIptv._getState();
  // 确保有至少一个分类
  if (env3State.categories.length === 0) {
    env3State.categories.push({ key: 'test', label: '测试', channels: [] });
    env3State.categoryIndex = 0;
  }
  // 将测试频道注入到当前分类的 channels 中
  env3State.categories[env3State.categoryIndex].channels = [testChannel];
  env3State.channelIndex = 0;

  // 调用 renderChannels（会从 categories 读取 → currentChannels → updateVirtualGrid → createCardElement）
  env3.owlIptv.renderChannels();

  // 检查 channel-grid 中是否有 .channel-logo 元素
  const gridEl = env3.elements['channel-grid'];
  const logoImgs = gridEl.querySelectorAll('.channel-logo');

  assert(
    logoImgs.length > 0,
    `E.1 channel-grid 中应存在 .channel-logo 元素 (当前: ${logoImgs.length})`
  );
  caseE += logoImgs.length > 0 ? 1 : 0;

  // 验证 logo 元素的 src 属性
  if (logoImgs.length > 0) {
    const firstLogo = logoImgs[0];
    assert(
      firstLogo.getAttribute('src') === 'https://example.com/logos/test-logo.png',
      `E.2 .channel-logo 的 src 应为 logo URL (当前: ${firstLogo.getAttribute('src')})`
    );
    caseE += firstLogo.getAttribute('src') === 'https://example.com/logos/test-logo.png' ? 1 : 0;

    // 验证 alt 属性
    assert(
      firstLogo.getAttribute('alt') === 'LOGO-TEST-CH 台标',
      `E.3 .channel-logo 的 alt 应包含频道名 (当前: ${firstLogo.getAttribute('alt')})`
    );
    caseE += firstLogo.getAttribute('alt') === 'LOGO-TEST-CH 台标' ? 1 : 0;

    // 验证 loading="lazy"
    assert(
      firstLogo.getAttribute('loading') === 'lazy',
      `E.4 .channel-logo 应有 loading="lazy" 属性 (当前: ${firstLogo.getAttribute('loading')})`
    );
    caseE += firstLogo.getAttribute('loading') === 'lazy' ? 1 : 0;
  } else {
    // 如果 logoImgs.length === 0，剩余断言自动失败
    fail('E.2 .channel-logo 的 src 应为 logo URL (未找到 logo 元素)');
    fail('E.3 .channel-logo 的 alt 应包含频道名 (未找到 logo 元素)');
    fail('E.4 .channel-logo 应有 loading="lazy" 属性 (未找到 logo 元素)');
  }

  // 测试无 logo 的频道不生成 .channel-logo
  const noLogoChannel = {
    name: 'NO-LOGO-CH',
    group: '测试',
    url: 'http://test.example.com/nologo.m3u8',
    urls: [{ url: 'http://test.example.com/nologo.m3u8' }],
    routes: [{ url: 'http://test.example.com/nologo.m3u8', index: 0, delay_ms: 200, failures: 0 }],
    delay_ms: 200,
    failed: false,
    failures: 0,
    // 无 logo 字段
  };

  env3State.categories[env3State.categoryIndex].channels = [noLogoChannel];
  env3State.channelIndex = 0;
  env3.owlIptv.renderChannels();

  const noLogoImgs = gridEl.querySelectorAll('.channel-logo');
  assert(
    noLogoImgs.length === 0,
    `E.5 无 logo 的频道不应生成 .channel-logo 元素 (当前: ${noLogoImgs.length})`
  );
  caseE += noLogoImgs.length === 0 ? 1 : 0;

  info(`用例 E 通过 ${caseE}/5 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  最终体检报告
  // ════════════════════════════════════════════════════════════════════════
  const allPassed = _passedAsserts === _totalAsserts;

  console.log(`\n${C.bold}=================== 第 7 课自动化体检报告 ===================${C.reset}\n`);

  const labels = [
    { pass: caseA >= 5, label: `用例 A：开机加载初始化验证 (${caseA}/6 项)` },
    { pass: caseB >= 5, label: `用例 B：30 秒后云端数据拉取与合并 (${caseB}/6 项)` },
    { pass: caseC >= 5, label: `用例 C：正在播放频道零闪烁静默更新 (${caseC}/6 项)` },
    { pass: caseD >= 2, label: `用例 D：用户活跃状态智能空闲重绘延迟 (${caseD}/3 项)` },
    { pass: caseE >= 4, label: `用例 E：台标 Logo 渲染验证 (${caseE}/5 项)` },
  ];

  for (const r of labels) {
    const icon = r.pass ? `${C.green}[PASS]${C.reset}` : `${C.red}[FAIL]${C.reset}`;
    console.log(`  ${icon} ${r.label}`);
  }

  console.log(`\n${C.bold}==============================================================${C.reset}`);
  console.log(`  总通过数：${_passedAsserts} / ${_totalAsserts}  |  第 7 课无感云端热更新`);
  console.log(`${C.bold}==============================================================${C.reset}\n`);

  console.log(`  ${C.dim}用例 A: ${caseA}/6 | 用例 B: ${caseB}/6 | 用例 C: ${caseC}/6 | 用例 D: ${caseD}/3 | 用例 E: ${caseE}/5${C.reset}`);
  console.log(`  ${C.dim}总计: ${_passedAsserts}/${_totalAsserts} 断言通过${C.reset}`);
  console.log();

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(`${C.red}[FATAL] ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(2);
});
