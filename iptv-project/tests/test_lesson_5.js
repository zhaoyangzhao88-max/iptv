/**
 * ============================================================================
 *  第 5 课 Headless 自动化测试脚本
 * ============================================================================
 *
 *  多线路备用源 3 级静默无感切线回滚与 Hls.js 错误高阶自愈
 *
 *  采用纯 Node.js 标准库，内存模拟浏览器环境（DOM / localStorage / Worker / Hls），
 *  加载 app/app.js 业务代码后，对第 5 课全部技术重构进行专项断言体检。
 *
 *  运行方式：node tests/test_lesson_5.js
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
  const classList = {
    _set: new Set(),
    add(cls)       { this._set.add(cls); },
    remove(cls)    { this._set.delete(cls); },
    contains(cls)  { return this._set.has(cls); },
    toggle(cls)    { if (this._set.has(cls)) this._set.delete(cls); else this._set.add(cls); },
    toString()     { return [...this._set].join(' '); },
  };

  return {
    id,
    tagName: 'DIV',
    nodeType: 1,
    className: '',
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
//  4. Mock Hls.js —— 模拟 Hls.js 核心行为
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
    startLoad() { /* no-op: 模拟 Hls.js startLoad 重试 */ }
    loadSource(url) {
      this._url = url;
      // 异步触发 MANIFEST_LOADING/PARSED 以清除连接超时定时器
      // 注意：必须用 setTimeout 确保 app.js 先注册事件监听器，
      // 否则 MANIFEST_LOADING 会在监听器注册之前触发，导致 clearHlsConnectionTimeout 不被调用
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
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  5. 构建沙箱全局对象 并 加载 app.js
// ────────────────────────────────────────────────────────────────────────────
function createSandbox() {
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
    createElement:       (tag) => tag === 'video' ? createMockVideoElement('') : createMockElement(''),
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
    fetch:                   undefined,
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
    fetch:                   undefined,
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

async function loadAppInSandbox() {
  const { sandbox, mockWorker, mockLocalStorage, elements, mockVideoElement, mockDocument } = createSandbox();

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

  // 清除 lazyAutoplay 定时器，防止它在测试前自动播放
  const state = win.owlIptv._getState();
  if (state.lazyAutoplayTimer) {
    clearTimeout(state.lazyAutoplayTimer);
    state.lazyAutoplayTimer = null;
    state.lazyAutoplayChannel = null;
  }

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
//  辅助函数
// ────────────────────────────────────────────────────────────────────────────
function findMultiRouteChannel(channels, minRoutes) {
  for (const ch of channels) {
    const routes = ch.routes || ch.urls || [];
    if (routes.length >= minRoutes) return ch;
  }
  return null;
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
  console.log(`\n${C.bold}  第 5 课：多线路静默切线自愈 —— 自动化体检${C.reset}\n`);

  // ── 加载业务代码 ──────────────────────────────────────────────────────────
  info('正在构建内存浏览器沙箱 (DOM / localStorage / Worker / Hls)...');
  const env = await loadAppInSandbox();
  info('app.js 已加载到沙箱中，init() 异步初始化完成。');

  // ── 选取一个含 3 条线路的真实频道 ────────────────────────────────────────
  const channels = env.owlIptv.getChannels();
  const testChannel = findMultiRouteChannel(channels, 3);

  if (!testChannel) {
    console.error(`${C.red}[CRITICAL] 未找到含 3 条以上线路的频道${C.reset}`);
    process.exit(1);
  }

  info(`选用测试频道：${testChannel.name} (${testChannel.routes.length} 条线路)`);
  for (let i = 0; i < testChannel.routes.length; i++) {
    info(`  routes[${i}]: ${testChannel.routes[i].url}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  用例 A：播放含 3 条 urls 的测试频道
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 A：播放含 3 条备用线路的测试频道 ──${C.reset}\n`);

  let caseA = 0;

  assert(
    env.win.Hls && env.win.Hls.isSupported && env.win.Hls.isSupported() === true,
    'A.1 沙箱中 Hls.js 模拟类已就绪且 isSupported() = true'
  );
  caseA += (env.win.Hls && env.win.Hls.isSupported && env.win.Hls.isSupported() === true) ? 1 : 0;

  assert(
    testChannel.routes.length >= 3,
    `A.2 测试频道应至少含 3 条线路 (当前: ${testChannel.routes.length})`
  );
  caseA += (testChannel.routes.length >= 3) ? 1 : 0;

  // 播放测试频道
  const playResult = env.owlIptv.playChannel(testChannel);
  assert(playResult === true, 'A.3 playChannel() 应返回 true');
  caseA += (playResult === true) ? 1 : 0;

  // 通过 _getHls() 获取当前 Hls 实例
  const hls = env.owlIptv._getHls();
  assert(hls !== null, 'A.4 Hls 实例应已创建');
  caseA += (hls !== null) ? 1 : 0;

  if (hls) {
    assert(
      hls._url === testChannel.routes[0].url,
      `A.5 Hls 应加载 routes[0].url (当前: "${hls._url}")`
    );
    caseA += (hls._url === testChannel.routes[0].url) ? 1 : 0;
  }

  // 验证 UI 更新
  assert(
    env.elements['current-channel'].textContent === testChannel.name,
    `A.6 当前频道名称应显示 "${testChannel.name}" (当前: "${env.elements['current-channel'].textContent}")`
  );
  caseA += (env.elements['current-channel'].textContent === testChannel.name) ? 1 : 0;

  info(`用例 A 通过 ${caseA}/6 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 B：模拟主线 routes[0] fatal networkError → 自动切到 routes[1]
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 B：主线 fatal networkError → 无缝切到 routes[1] ──${C.reset}\n`);

  let caseB = 0;

  const hlsForB = env.owlIptv._getHls();
  if (hlsForB && !hlsForB.destroyed) {
    // 第一次 fatal networkError → recoverFromFatalHlsError 会重试 1 次（startLoad）
    hlsForB._emit(HlsEvents.ERROR, {
      type: HlsErrorTypes.NETWORK_ERROR,
      fatal: true,
      details: 'manifestLoadError',
    });

    // 等待重试完成
    await new Promise(resolve => setTimeout(resolve, 200));

    // 第二次 fatal networkError → hlsFatalRetryCount 已达上限，触发 switchToNextRoute
    const hlsRetry = env.owlIptv._getHls();
    if (hlsRetry && !hlsRetry.destroyed) {
      hlsRetry._emit(HlsEvents.ERROR, {
        type: HlsErrorTypes.NETWORK_ERROR,
        fatal: true,
        details: 'manifestLoadError',
      });

      // 等待 isSwitching 定时器重置（1s + 缓冲）
      await new Promise(resolve => setTimeout(resolve, 1300));
    }

    // 验证 Hls 已切换到 routes[1]
    const hlsAfterB = env.owlIptv._getHls();
    assert(hlsAfterB !== null && hlsAfterB !== hlsForB, 'B.1 切换后应创建新的 Hls 实例');
    caseB += (hlsAfterB !== null && hlsAfterB !== hlsForB) ? 1 : 0;

    if (hlsAfterB) {
      assert(
        hlsAfterB._url === testChannel.routes[1].url,
        `B.2 应自动切换到 routes[1] = "${testChannel.routes[1].url}" (当前: "${hlsAfterB._url}")`
      );
      caseB += (hlsAfterB._url === testChannel.routes[1].url) ? 1 : 0;
    }

    // 验证旧 Hls 实例已销毁
    assert(hlsForB.destroyed === true, 'B.3 旧 Hls 实例应已销毁');
    caseB += (hlsForB.destroyed === true) ? 1 : 0;
  } else {
    fail('B.1 跳过：Hls 实例不可用');
    fail('B.2 跳过：Hls 实例不可用');
    fail('B.3 跳过：Hls 实例不可用');
  }

  info(`用例 B 通过 ${caseB}/3 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 C：模拟 routes[1] H.265 BUFFER_ADD_CODEC_ERROR → 切到 routes[2]
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 C：备用线 H.265 解码错误 → 切到 routes[2] ──${C.reset}\n`);

  let caseC = 0;

  const hlsForC = env.owlIptv._getHls();
  if (hlsForC && !hlsForC.destroyed) {
    // 模拟 BUFFER_ADD_CODEC_ERROR（H.265 不兼容）
    hlsForC._emit(HlsEvents.ERROR, {
      type: HlsErrorTypes.MEDIA_ERROR,
      fatal: true,
      details: HlsErrorDetails.BUFFER_ADD_CODEC_ERROR,
    });

    // 等待 isSwitching 定时器重置
    await new Promise(resolve => setTimeout(resolve, 1300));

    // 验证 Hls 已切换到 routes[2]
    const hlsAfterC = env.owlIptv._getHls();
    assert(hlsAfterC !== null && hlsAfterC !== hlsForC, 'C.1 切换后应创建新的 Hls 实例');
    caseC += (hlsAfterC !== null && hlsAfterC !== hlsForC) ? 1 : 0;

    if (hlsAfterC) {
      assert(
        hlsAfterC._url === testChannel.routes[2].url,
        `C.2 应自动切换到 routes[2] = "${testChannel.routes[2].url}" (当前: "${hlsAfterC._url}")`
      );
      caseC += (hlsAfterC._url === testChannel.routes[2].url) ? 1 : 0;
    }

    // 验证旧 Hls 实例已销毁
    assert(hlsForC.destroyed === true, 'C.3 旧 Hls 实例应已销毁');
    caseC += (hlsForC.destroyed === true) ? 1 : 0;
  } else {
    fail('C.1 跳过：Hls 实例不可用');
    fail('C.2 跳过：Hls 实例不可用');
    fail('C.3 跳过：Hls 实例不可用');
  }

  info(`用例 C 通过 ${caseC}/3 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 D：模拟 routes[2] 停滞 2.5s → 全部失败提示
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 D：第三条线停滞 2.5s → 全部失败提示 ──${C.reset}\n`);

  let caseD = 0;

  const hlsForD = env.owlIptv._getHls();
  if (hlsForD && !hlsForD.destroyed) {
    // 让 video 播放了一段时间（currentTime > 0），然后固定 currentTime 模拟停滞
    const video = env.elements['video-element'];
    video.currentTime = 5.0;
    video.paused = false; // 确保不是暂停状态（stalled 监控器需要 paused=false）

    // 等待 stalled 监控器检测到停滞
    // 第一次轮询设置 _lastCurrentTime，第二次轮询检测停滞
    // 轮询间隔 = 2.5s + jitter(0-0.5s)，两次轮询最多需要 6s
    info('  等待停滞监控器检测（最多 6s）...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    // 验证右侧面板显示 "所有备用线路均已异常，请手动切台。"
    const latencyText = env.elements['current-latency'].textContent;
    assert(
      latencyText === '所有备用线路均已异常，请手动切台。',
      `D.1 右侧面板应显示 "所有备用线路均已异常，请手动切台。" (当前: "${latencyText}")`
    );
    caseD += (latencyText === '所有备用线路均已异常，请手动切台。') ? 1 : 0;

    // 验证 Hls 实例已销毁（或为空）
    const hlsAfterD = env.owlIptv._getHls();
    assert(
      hlsAfterD === null || (hlsForD && hlsForD.destroyed),
      'D.2 Hls 实例应已销毁'
    );
    caseD += (hlsAfterD === null || (hlsForD && hlsForD.destroyed)) ? 1 : 0;
  } else {
    fail('D.1 跳过：Hls 实例不可用');
    fail('D.2 跳过：Hls 实例不可用');
  }

  info(`用例 D 通过 ${caseD}/2 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 E：验证 hidden: true 写入 localStorage
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 E：验证 hidden: true 写入 localStorage ──${C.reset}\n`);

  let caseE = 0;

  // 从 localStorage 读取 overrides
  const overrides = JSON.parse(env.mockLocalStorage.getItem('owl_iptv_local_overrides') || '{}');
  const channelOverride = overrides.channels && overrides.channels[testChannel.name];

  assert(
    channelOverride !== undefined,
    `E.1 localStorage overrides 中应存在 "${testChannel.name}" 的条目`
  );
  caseE += (channelOverride !== undefined) ? 1 : 0;

  if (channelOverride) {
    assert(
      channelOverride.hidden === true,
      `E.2 "${testChannel.name}" 的 hidden 应为 true (当前: ${channelOverride.hidden})`
    );
    caseE += (channelOverride.hidden === true) ? 1 : 0;
  } else {
    fail(`E.2 hidden 应为 true  (跳过：无 "${testChannel.name}" override 条目)`);
  }

  info(`用例 E 通过 ${caseE}/2 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  最终体检报告
  // ════════════════════════════════════════════════════════════════════════
  const allPassed = _passedAsserts === _totalAsserts;

  console.log(`\n${C.bold}=================== 第 5 课自动化体检报告 ===================${C.reset}\n`);

  const labels = [
    { pass: caseA >= 5, label: `用例 A：播放含 3 条备用线路的测试频道 (${caseA}/6 项)` },
    { pass: caseB >= 2, label: `用例 B：主线 fatal networkError → 切到 routes[1] (${caseB}/3 项)` },
    { pass: caseC >= 2, label: `用例 C：H.265 解码错误 → 切到 routes[2] (${caseC}/3 项)` },
    { pass: caseD >= 1, label: `用例 D：全部失败 → 右侧面板提示 (${caseD}/2 项)` },
    { pass: caseE >= 1, label: `用例 E：hidden: true 写入 localStorage (${caseE}/2 项)` },
  ];

  for (const r of labels) {
    const icon = r.pass ? `${C.green}[PASS]${C.reset}` : `${C.red}[FAIL]${C.reset}`;
    console.log(`  ${icon} ${r.label}`);
  }

  console.log(`\n${C.bold}==============================================================${C.reset}`);
  console.log(`  总通过数：${_passedAsserts} / ${_totalAsserts}  |  第 5 课切线自愈系统`);
  console.log(`${C.bold}==============================================================${C.reset}\n`);

  console.log(`  ${C.dim}用例 A: ${caseA}/6 | 用例 B: ${caseB}/3 | 用例 C: ${caseC}/3 | 用例 D: ${caseD}/2 | 用例 E: ${caseE}/2${C.reset}`);
  console.log(`  ${C.dim}总计: ${_passedAsserts}/${_totalAsserts} 断言通过${C.reset}`);
  console.log();

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(`${C.red}[FATAL] ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(2);
});
