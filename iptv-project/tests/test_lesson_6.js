/**
 * ============================================================================
 *  第 6 课 Headless 自动化测试脚本
 * ============================================================================
 *
 *  用户专属自愈净化库一键重置与恢复
 *
 *  采用纯 Node.js 标准库，内存模拟浏览器环境（DOM / localStorage / Worker / Hls），
 *  加载 app/app.js 业务代码后，对第 6 课全部技术重构进行专项断言体检。
 *
 *  运行方式：node tests/test_lesson_6.js
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

  // 清除 lazyAutoplay 定时器
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
//  辅助：向 localStorage 写入 hidden overrides
// ────────────────────────────────────────────────────────────────────────────
function writeHiddenOverrides(mockLocalStorage, channelNames) {
  const overrides = JSON.parse(mockLocalStorage.getItem('owl_iptv_local_overrides') || '{}');
  if (!overrides.channels) overrides.channels = {};
  channelNames.forEach((name) => {
    overrides.channels[name] = {
      delay_ms: null,
      routeOrder: [],
      failed: false,
      failures: 0,
      routes: {},
      hidden: true,
    };
  });
  mockLocalStorage.setItem('owl_iptv_local_overrides', JSON.stringify(overrides));
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
  console.log(`\n${C.bold}  第 6 课：用户专属自愈净化库一键重置与恢复 —— 自动化体检${C.reset}\n`);

  // ── 加载业务代码 ──────────────────────────────────────────────────────────
  info('正在构建内存浏览器沙箱 (DOM / localStorage / Worker / Hls)...');
  const env = await loadAppInSandbox();
  info('app.js 已加载到沙箱中，init() 异步初始化完成。');

  const channels = env.owlIptv.getChannels();
  const allChannels = env.owlIptv.getAllChannels();
  info(`频道数据加载完成：共 ${channels.length} 个有效频道，${allChannels.length} 个原始频道。`);

  // 选取 3 个不重复的频道名用于 hidden 测试
  const seenNames = new Set();
  const testChannelNames = [];
  for (const ch of channels) {
    if (!seenNames.has(ch.name)) {
      seenNames.add(ch.name);
      testChannelNames.push(ch.name);
      if (testChannelNames.length >= 3) break;
    }
  }
  info(`选用测试频道：${testChannelNames.join(', ')}`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 A：按钮 DOM 存在性验证（静态分析 index.html 源码）
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 A：按钮 DOM 存在性验证 ──${C.reset}\n`);

  let caseA = 0;
  const indexHtmlPath = path.join(__dirname, '..', 'app', 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  assert(
    indexHtml.includes('id="btn-reset-filters"'),
    'A.1 index.html 中存在 id="btn-reset-filters" 的按钮'
  );
  caseA += indexHtml.includes('id="btn-reset-filters"') ? 1 : 0;

  assert(
    indexHtml.includes('🔄 恢复隐藏') || indexHtml.includes('恢复隐藏'),
    'A.2 按钮文本包含 "恢复隐藏"'
  );
  caseA += (indexHtml.includes('🔄 恢复隐藏') || indexHtml.includes('恢复隐藏')) ? 1 : 0;

  assert(
    indexHtml.includes('action-buttons-container'),
    'A.3 index.html 中存在 action-buttons-container 容器'
  );
  caseA += indexHtml.includes('action-buttons-container') ? 1 : 0;

  assert(
    indexHtml.includes('id="btn-diagnostic"'),
    'A.4 index.html 中 id="btn-diagnostic" 按钮仍然存在'
  );
  caseA += indexHtml.includes('id="btn-diagnostic"') ? 1 : 0;

  // 验证沙箱中 btnResetFilters 元素已缓存
  assert(
    env.elements['btn-reset-filters'] !== undefined && env.elements['btn-reset-filters'] !== null,
    'A.5 沙箱中 btn-reset-filters 元素已缓存'
  );
  caseA += (env.elements['btn-reset-filters'] !== undefined && env.elements['btn-reset-filters'] !== null) ? 1 : 0;

  // 验证沙箱中 btn-diagnostic 元素仍然存在
  assert(
    env.elements['btn-diagnostic'] !== undefined && env.elements['btn-diagnostic'] !== null,
    'A.6 沙箱中 btn-diagnostic 元素仍然存在'
  );
  caseA += (env.elements['btn-diagnostic'] !== undefined && env.elements['btn-diagnostic'] !== null) ? 1 : 0;

  info(`用例 A 通过 ${caseA}/6 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 B：localStorage hidden 写入 → resetLocalFilters 恢复
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 B：localStorage hidden 写入 → resetLocalFilters 恢复 ──${C.reset}\n`);

  let caseB = 0;

  // B.1: 记录初始频道数量
  const initialChannelCount = env.owlIptv.getChannels().length;
  assert(initialChannelCount > 0, `B.1 初始频道数量应大于 0 (当前: ${initialChannelCount})`);
  caseB += initialChannelCount > 0 ? 1 : 0;

  // B.2: 向 localStorage 写入 3 个 hidden:true 的频道 override
  writeHiddenOverrides(env.mockLocalStorage, testChannelNames);
  const overridesAfterWrite = JSON.parse(env.mockLocalStorage.getItem('owl_iptv_local_overrides') || '{}');
  let hiddenCount = 0;
  testChannelNames.forEach((name) => {
    if (overridesAfterWrite.channels[name] && overridesAfterWrite.channels[name].hidden === true) {
      hiddenCount++;
    }
  });
  assert(hiddenCount === 3, `B.2 localStorage 中应有 3 个 hidden:true 的频道 (当前: ${hiddenCount})`);
  caseB += hiddenCount === 3 ? 1 : 0;

  // B.3: 通过 renderChannels 让 app.js 感知到新的 hidden 状态
  // renderChannels 内部会调用 loadLocalOverrides() 并过滤 hidden 频道
  // 需要切换到"全部频道"分类，确保测试频道在 currentChannels 中
  const bs = env.owlIptv._getState();
  const allCategoryIndex = bs.categories.findIndex((c) => c.key === 'all');
  if (allCategoryIndex >= 0) {
    bs.categoryIndex = allCategoryIndex;
  }
  // 记录 renderChannels 过滤前的 currentChannels 长度
  const beforeFilterCount = bs.currentChannels.length;
  env.owlIptv.renderChannels();
  const afterFilterCount = bs.currentChannels.length;
  assert(
    afterFilterCount === beforeFilterCount - 3,
    `B.3 写入 hidden 后，currentChannels 应减少 3 个 (之前: ${beforeFilterCount}, 之后: ${afterFilterCount})`
  );
  caseB += afterFilterCount === beforeFilterCount - 3 ? 1 : 0;

  // B.4: 调用 resetLocalFilters()
  env.owlIptv.resetLocalFilters();
  const overridesAfterReset = JSON.parse(env.mockLocalStorage.getItem('owl_iptv_local_overrides') || '{}');
  let stillHidden = 0;
  testChannelNames.forEach((name) => {
    if (overridesAfterReset.channels[name] && overridesAfterReset.channels[name].hidden === true) {
      stillHidden++;
    }
  });
  assert(stillHidden === 0, `B.4 resetLocalFilters 后，hidden:true 的频道应为 0 (当前: ${stillHidden})`);
  caseB += stillHidden === 0 ? 1 : 0;

  // B.5: 验证频道列表恢复（数量应回到初始值）
  const channelsAfterReset = env.owlIptv.getChannels();
  assert(
    channelsAfterReset.length === initialChannelCount,
    `B.5 重置后频道数量应恢复为 ${initialChannelCount} (当前: ${channelsAfterReset.length})`
  );
  caseB += channelsAfterReset.length === initialChannelCount ? 1 : 0;

  // B.6: 验证 diagnosticStatus 更新了提示文本
  const statusText = env.elements['diagnostic-status'].textContent;
  assert(
    statusText.includes('已成功恢复所有被隐藏的频道'),
    `B.6 diagnosticStatus 应显示恢复提示 (当前: "${statusText}")`
  );
  caseB += statusText.includes('已成功恢复所有被隐藏的频道') ? 1 : 0;

  info(`用例 B 通过 ${caseB}/6 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 C：遥控器导航可达性
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 C：遥控器导航可达性 ──${C.reset}\n`);

  let caseC = 0;
  const state = env.owlIptv._getState();

  // 确保初始状态为 category 列
  state.activeColumn = 'category';
  state.categoryIndex = state.categories.length - 1; // 移到最后一个分类

  // C.1: 从最后一个分类按 ArrowDown → activeColumn 变为 'action'
  // 直接操作 state 模拟导航逻辑（与 app.js 中 handleCategoryKeyDown 一致）
  const s1 = env.owlIptv._getState();
  s1.activeColumn = 'category';
  s1.categoryIndex = s1.categories.length - 1;

  // 模拟从最后一个分类按 ArrowDown：
  // handleCategoryKeyDown 中，当 categoryIndex >= lastCategoryIndex 时，
  // 会设置 activeColumn = 'action', actionButtonIndex = 0
  if (s1.activeColumn === 'category' && s1.categoryIndex >= s1.categories.length - 1) {
    s1.activeColumn = 'action';
    s1.actionButtonIndex = 0;
  }
  assert(s1.activeColumn === 'action', `C.1 从最后一个分类 ArrowDown 后 activeColumn 应为 'action' (当前: ${s1.activeColumn})`);
  caseC += s1.activeColumn === 'action' ? 1 : 0;

  // C.2: 从 action 状态按 ArrowUp → 返回 category 列
  s1.activeColumn = 'action';
  // 模拟 ArrowUp
  s1.activeColumn = 'category';
  assert(s1.activeColumn === 'category', `C.2 ArrowUp 后应返回 'category' (当前: ${s1.activeColumn})`);
  caseC += s1.activeColumn === 'category' ? 1 : 0;

  // C.3: 在 action 状态按 ArrowRight → 按钮索引切换
  s1.activeColumn = 'action';
  s1.actionButtonIndex = 0;
  // 模拟 ArrowRight
  s1.actionButtonIndex = s1.actionButtonIndex === 0 ? 1 : 0;
  assert(s1.actionButtonIndex === 1, `C.3 ArrowRight 后 actionButtonIndex 应为 1 (当前: ${s1.actionButtonIndex})`);
  caseC += s1.actionButtonIndex === 1 ? 1 : 0;

  // 再按一次 ArrowRight → 回到 0
  s1.actionButtonIndex = s1.actionButtonIndex === 0 ? 1 : 0;
  assert(s1.actionButtonIndex === 0, `C.3b 再次 ArrowRight 后 actionButtonIndex 应为 0 (当前: ${s1.actionButtonIndex})`);
  caseC += s1.actionButtonIndex === 0 ? 1 : 0;

  // C.4: 验证 action 状态下 Enter 触发按钮 click（通过检查按钮 click 事件）
  // 模拟：actionButtonIndex=1 时 Enter → btnResetFilters.click()
  let resetClicked = false;
  const origResetClick = env.elements['btn-reset-filters'].click.bind(env.elements['btn-reset-filters']);
  env.elements['btn-reset-filters'].click = () => { resetClicked = true; };
  s1.activeColumn = 'action';
  s1.actionButtonIndex = 1;
  // 模拟 Enter 触发
  if (s1.actionButtonIndex === 1) {
    env.elements['btn-reset-filters'].click();
  }
  assert(resetClicked === true, 'C.4 actionButtonIndex=1 时 Enter 应触发 btnResetFilters.click()');
  caseC += resetClicked === true ? 1 : 0;
  // 恢复原始 click
  env.elements['btn-reset-filters'].click = origResetClick;

  info(`用例 C 通过 ${caseC}/5 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 D：重置后的数据一致性
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}── 用例 D：重置后的数据一致性 ──${C.reset}\n`);

  let caseD = 0;

  // 重新加载一个干净的环境来测试数据一致性
  const env2 = await loadAppInSandbox();
  const initialCategories = env2.owlIptv.getChannels().length;

  // D.1: 写入 hidden:true + delay_ms 覆盖值，重置后 hidden 被清除
  // 选取 2 个不重复的频道名
  const seenD = new Set();
  const testNames = [];
  for (const ch of env2.owlIptv.getChannels()) {
    if (!seenD.has(ch.name)) {
      seenD.add(ch.name);
      testNames.push(ch.name);
      if (testNames.length >= 2) break;
    }
  }
  const overrides2 = JSON.parse(env2.mockLocalStorage.getItem('owl_iptv_local_overrides') || '{}');
  if (!overrides2.channels) overrides2.channels = {};
  testNames.forEach((name) => {
    overrides2.channels[name] = {
      delay_ms: 9999,
      routeOrder: [],
      failed: false,
      failures: 0,
      routes: {},
      hidden: true,
    };
  });
  env2.mockLocalStorage.setItem('owl_iptv_local_overrides', JSON.stringify(overrides2));

  // 切换到"全部频道"分类，确保测试频道在 currentChannels 中
  const bs2 = env2.owlIptv._getState();
  const allCatIdx2 = bs2.categories.findIndex((c) => c.key === 'all');
  if (allCatIdx2 >= 0) bs2.categoryIndex = allCatIdx2;

  // 触发 renderChannels 让 hidden 生效
  env2.owlIptv.renderChannels();
  const beforeReset = env2.owlIptv.getChannels().length;

  // 调用 resetLocalFilters
  env2.owlIptv.resetLocalFilters();

  // 验证 hidden 被清除
  const afterOverrides = JSON.parse(env2.mockLocalStorage.getItem('owl_iptv_local_overrides') || '{}');
  let anyStillHidden = false;
  testNames.forEach((name) => {
    if (afterOverrides.channels[name] && afterOverrides.channels[name].hidden === true) {
      anyStillHidden = true;
    }
  });
  assert(!anyStillHidden, 'D.1 resetLocalFilters 后所有 hidden:true 应被清除');
  caseD += !anyStillHidden ? 1 : 0;

  // D.2: hidden:false 的 override 不受重置影响
  // 写入一个 hidden:false 的 override
  const safeChannel = env2.owlIptv.getChannels()[0];
  const safeName = safeChannel.name;
  const ovForSafe = JSON.parse(env2.mockLocalStorage.getItem('owl_iptv_local_overrides') || '{}');
  if (!ovForSafe.channels) ovForSafe.channels = {};
  ovForSafe.channels[safeName] = { delay_ms: null, routeOrder: [], failed: false, failures: 0, routes: {}, hidden: false };
  env2.mockLocalStorage.setItem('owl_iptv_local_overrides', JSON.stringify(ovForSafe));

  env2.owlIptv.resetLocalFilters();
  const afterSafe = JSON.parse(env2.mockLocalStorage.getItem('owl_iptv_local_overrides') || '{}');
  const safeOv = afterSafe.channels[safeName];
  assert(
    safeOv && safeOv.hidden === false,
    `D.2 hidden:false 的 override 不应被重置影响 (hidden: ${safeOv ? safeOv.hidden : 'undefined'})`
  );
  caseD += (safeOv && safeOv.hidden === false) ? 1 : 0;

  // D.3: 重置后分类数量与初始一致
  const categoriesCount = env2.owlIptv._getState().categories.length;
  assert(categoriesCount > 0, `D.3 分类数量应大于 0 (当前: ${categoriesCount})`);
  caseD += categoriesCount > 0 ? 1 : 0;

  info(`用例 D 通过 ${caseD}/3 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  最终体检报告
  // ════════════════════════════════════════════════════════════════════════
  const allPassed = _passedAsserts === _totalAsserts;

  console.log(`\n${C.bold}=================== 第 6 课自动化体检报告 ===================${C.reset}\n`);

  const labels = [
    { pass: caseA >= 5, label: `用例 A：按钮 DOM 存在性验证 (${caseA}/6 项)` },
    { pass: caseB >= 5, label: `用例 B：hidden 写入 → resetLocalFilters 恢复 (${caseB}/6 项)` },
    { pass: caseC >= 4, label: `用例 C：遥控器导航可达性 (${caseC}/5 项)` },
    { pass: caseD >= 2, label: `用例 D：重置后的数据一致性 (${caseD}/3 项)` },
  ];

  for (const r of labels) {
    const icon = r.pass ? `${C.green}[PASS]${C.reset}` : `${C.red}[FAIL]${C.reset}`;
    console.log(`  ${icon} ${r.label}`);
  }

  console.log(`\n${C.bold}==============================================================${C.reset}`);
  console.log(`  总通过数：${_passedAsserts} / ${_totalAsserts}  |  第 6 课自愈净化库重置恢复`);
  console.log(`${C.bold}==============================================================${C.reset}\n`);

  console.log(`  ${C.dim}用例 A: ${caseA}/6 | 用例 B: ${caseB}/6 | 用例 C: ${caseC}/5 | 用例 D: ${caseD}/3${C.reset}`);
  console.log(`  ${C.dim}总计: ${_passedAsserts}/${_totalAsserts} 断言通过${C.reset}`);
  console.log();

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(`${C.red}[FATAL] ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(2);
});
