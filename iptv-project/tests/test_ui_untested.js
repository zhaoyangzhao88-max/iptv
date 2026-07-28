'use strict';

/**
 * 未测试徽章微调校验脚本
 * 模拟浏览器沙箱环境，验证 updateCardContent() 的未测试灰标渲染逻辑
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ─── 1. 读取 CSS 验证 untested 样式存在 ────────────────────────────────
const CSS_PATH = path.join(__dirname, '..', 'app', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  [PASS] ' + message);
    passed++;
  } else {
    console.log('  [FAIL] ' + message);
    failed++;
  }
}

// ─── 2. 构建模拟浏览器沙箱 ──────────────────────────────────────────────
function createSandbox() {
  // 模拟 DOM 元素
  function createMockElement(tag) {
    var el = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      attributes: {},
      children: [],
      style: {},
      setAttribute: function(k, v) { this.attributes[k] = v; },
      getAttribute: function(k) { return this.attributes[k]; },
      appendChild: function(child) { this.children.push(child); },
      querySelector: function(sel) {
        // 简单支持 .class 选择器
        var match = sel.match(/^\.([a-zA-Z_-][a-zA-Z0-9_-]*)$/);
        if (match) {
          var cls = match[1];
          for (var i = 0; i < this.children.length; i++) {
            if (this.children[i].className.indexOf(cls) !== -1) return this.children[i];
          }
        }
        return null;
      },
      addEventListener: function() {},
      removeEventListener: function() {}
    };
    return el;
  }

  // 模拟 document
  var mockDocument = {
    createElement: function(tag) { return createMockElement(tag); },
    createDocumentFragment: function() { return createMockElement('fragment'); },
    addEventListener: function() {},
    removeEventListener: function() {},
    fullscreenElement: null,
    exitFullscreen: function() { return Promise.resolve(); },
    head: createMockElement('head'),
    body: createMockElement('body'),
    getElementById: function() { return null; }
  };

  // 模拟 window
  var mockWindow = {
    addEventListener: function() {},
    removeEventListener: function() {},
    setTimeout: function(fn, ms) { return { _fn: fn, _ms: ms }; },
    clearTimeout: function() {},
    setInterval: function() { return 1; },
    clearInterval: function() {},
    requestAnimationFrame: function(fn) { fn(); return 1; },
    cancelAnimationFrame: function() {},
    Hls: null,
    Worker: undefined
  };

  // 模拟 localStorage
  var storageData = {};
  var mockStorage = {
    getItem: function(k) { return storageData[k] || null; },
    setItem: function(k, v) { storageData[k] = String(v); },
    removeItem: function(k) { delete storageData[k]; }
  };

  return {
    document: mockDocument,
    window: mockWindow,
    localStorage: mockStorage,
    console: console,
    JSON: JSON,
    Math: Math,
    Number: Number,
    String: String,
    Array: Array,
    Map: Map,
    Set: Set,
    Promise: Promise,
    setTimeout: mockWindow.setTimeout,
    clearTimeout: mockWindow.clearTimeout,
    setInterval: mockWindow.setInterval,
    clearInterval: mockWindow.clearInterval,
    requestAnimationFrame: mockWindow.requestAnimationFrame,
    cancelAnimationFrame: mockWindow.cancelAnimationFrame,
    URL: URL,
    fetch: function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve([]); } }); },
    __dirname: path.join(__dirname, '..', 'app')
  };
}

// ─── 3. 从 app.js 中提取 updateCardContent 函数 ─────────────────────────
const APP_JS_PATH = path.join(__dirname, '..', 'app', 'app.js');
const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');

// 用 vm 在沙箱中执行 app.js，提取 updateCardContent
var updateCardContent = null;
var sandbox = createSandbox();

try {
  // 注入一个捕获器，在 IIFE 执行后拿到 updateCardContent
  // app.js 是 IIFE，内部 updateCardContent 是私有函数，无法直接访问
  // 策略：在 app.js 末尾注入一行暴露语句，然后 vm.runInNewContext
  var instrumentedJs = appJs.replace(
    'if (document.readyState === \'loading\')',
    'if (typeof __captureUpdateCardContent === "function") __captureUpdateCardContent(updateCardContent);\nif (document.readyState === \'loading\')'
  );

  sandbox.__captureUpdateCardContent = function(fn) {
    updateCardContent = fn;
  };

  vm.runInNewContext(instrumentedJs, sandbox, { timeout: 5000 });
} catch (err) {
  // IIFE 可能因为 DOM 不存在而报错，但只要 __captureUpdateCardContent 被调用就能拿到函数
  if (!updateCardContent) {
    console.error('[ERROR] 无法从 app.js 提取 updateCardContent: ' + err.message);
    process.exit(1);
  }
}

if (!updateCardContent) {
  console.error('[ERROR] updateCardContent 未被捕获，请检查 app.js 结构。');
  process.exit(1);
}

// ─── 4. 辅助：创建模拟频道卡片 ─────────────────────────────────────────
function createMockCard() {
  var nameEl = { className: 'channel-name', textContent: '', style: {}, setAttribute: function(){}, getAttribute: function(){}, children: [], appendChild: function(){}, querySelector: function(){ return null; }, addEventListener: function(){}, removeEventListener: function(){} };
  var latencyEl = { className: '', textContent: '', style: {}, setAttribute: function(){}, getAttribute: function(){}, children: [], appendChild: function(){}, querySelector: function(){ return null; }, addEventListener: function(){}, removeEventListener: function(){} };
  var card = {
    className: 'channel-card',
    style: {},
    dataset: {},
    attributes: {},
    children: [nameEl, latencyEl],
    setAttribute: function(k, v) { this.attributes[k] = v; },
    getAttribute: function(k) { return this.attributes[k]; },
    appendChild: function(child) { this.children.push(child); },
    querySelector: function(sel) {
      if (sel === '.channel-name') return nameEl;
      if (sel === '.latency-badge') return latencyEl;
      if (sel === '.channel-logo') return null;
      return null;
    },
    addEventListener: function() {},
    removeEventListener: function() {}
  };
  return { card: card, nameEl: nameEl, latencyEl: latencyEl };
}

// ─── 5. 运行测试用例 ───────────────────────────────────────────────────
console.log('=================== 未测试徽章微调校验完成 ===================');
console.log('');

// ─── 用例 A：delay_ms 为 null ──────────────────────────────────────────
console.log('[Case A] delay_ms = null（从未测速）');
var mockA = createMockCard();
updateCardContent(mockA.card, { name: '测试频道-null', delay_ms: null });
assert(
  mockA.latencyEl.className === 'latency-badge untested',
  '类名应为 "latency-badge untested"，实际: "' + mockA.latencyEl.className + '"'
);
assert(
  mockA.latencyEl.textContent === '🔘 未测试',
  '文字应为 "🔘 未测试"，实际: "' + mockA.latencyEl.textContent + '"'
);

// ─── 用例 B：delay_ms 为 99999 ─────────────────────────────────────────
console.log('');
console.log('[Case B] delay_ms = 99999（标记为失效/未测试）');
var mockB = createMockCard();
updateCardContent(mockB.card, { name: '测试频道-99999', delay_ms: 99999 });
assert(
  mockB.latencyEl.className === 'latency-badge untested',
  '类名应为 "latency-badge untested"，实际: "' + mockB.latencyEl.className + '"'
);
assert(
  mockB.latencyEl.textContent === '🔘 未测试',
  '文字应为 "🔘 未测试"，实际: "' + mockB.latencyEl.textContent + '"'
);

// ─── 用例 C：delay_ms 为 45（正常绿标）─────────────────────────────────
console.log('');
console.log('[Case C] delay_ms = 45（正常秒开绿标）');
var mockC = createMockCard();
updateCardContent(mockC.card, { name: '测试频道-正常', delay_ms: 45 });
assert(
  mockC.latencyEl.className === 'latency-badge green',
  '类名应为 "latency-badge green"，实际: "' + mockC.latencyEl.className + '"'
);
assert(
  mockC.latencyEl.textContent === '🟢 45ms',
  '文字应为 "🟢 45ms"，实际: "' + mockC.latencyEl.textContent + '"'
);

// ─── 用例 D：delay_ms 为 undefined ─────────────────────────────────────
console.log('');
console.log('[Case D] delay_ms = undefined（从未测速）');
var mockD = createMockCard();
updateCardContent(mockD.card, { name: '测试频道-undefined', delay_ms: undefined });
assert(
  mockD.latencyEl.className === 'latency-badge untested',
  '类名应为 "latency-badge untested"，实际: "' + mockD.latencyEl.className + '"'
);
assert(
  mockD.latencyEl.textContent === '🔘 未测试',
  '文字应为 "🔘 未测试"，实际: "' + mockD.latencyEl.textContent + '"'
);

// ─── 用例 E：delay_ms 为 0（边界值，应视为已测试绿标）──────────────────
console.log('');
console.log('[Case E] delay_ms = 0（边界值，应视为已测试绿标）');
var mockE = createMockCard();
updateCardContent(mockE.card, { name: '测试频道-零延迟', delay_ms: 0 });
assert(
  mockE.latencyEl.className === 'latency-badge green',
  '类名应为 "latency-badge green"，实际: "' + mockE.latencyEl.className + '"'
);
assert(
  mockE.latencyEl.textContent === '🟢 0ms',
  '文字应为 "🟢 0ms"，实际: "' + mockE.latencyEl.textContent + '"'
);

// ─── 用例 F：delay_ms 为 1500（黄标）──────────────────────────────────
console.log('');
console.log('[Case F] delay_ms = 1500（黄标稍慢）');
var mockF = createMockCard();
updateCardContent(mockF.card, { name: '测试频道-稍慢', delay_ms: 1500 });
assert(
  mockF.latencyEl.className === 'latency-badge yellow',
  '类名应为 "latency-badge yellow"，实际: "' + mockF.latencyEl.className + '"'
);
assert(
  mockF.latencyEl.textContent === '🟡 1.5s',
  '文字应为 "🟡 1.5s"，实际: "' + mockF.latencyEl.textContent + '"'
);

// ─── 用例 G：delay_ms 为 5000（红标滞后）───────────────────────────────
console.log('');
console.log('[Case G] delay_ms = 5000（红标滞后）');
var mockG = createMockCard();
updateCardContent(mockG.card, { name: '测试频道-滞后', delay_ms: 5000 });
assert(
  mockG.latencyEl.className === 'latency-badge red',
  '类名应为 "latency-badge red"，实际: "' + mockG.latencyEl.className + '"'
);
assert(
  mockG.latencyEl.textContent === '🔴 5.0s',
  '文字应为 "🔴 5.0s"，实际: "' + mockG.latencyEl.textContent + '"'
);

// ─── 用例 H：CSS untested 样式验证 ─────────────────────────────────────
console.log('');
console.log('[Case H] CSS .latency-badge.untested 样式');
assert(
  css.indexOf('.latency-badge.untested') !== -1,
  'CSS 中存在 .latency-badge.untested 规则'
);
assert(
  css.indexOf('#8a8a93') !== -1,
  'CSS 中 untested 颜色为 #8a8a93 低饱和灰'
);
assert(
  css.indexOf('text-shadow: none') !== -1,
  'CSS 中 untested 移除了发光阴影'
);

// ─── 汇总 ──────────────────────────────────────────────────────────────
console.log('');
console.log('======================================================');
console.log('  总计: ' + (passed + failed) + ' 项  |  通过: ' + passed + '  |  失败: ' + failed);
if (failed === 0) {
  console.log('  ✅ 全部 [PASS] — 未测试徽章逻辑与样式校验通过！');
} else {
  console.log('  ⚠️  存在 ' + failed + ' 项未通过，请检查代码。');
}
console.log('======================================================');
console.log('');

process.exit(failed > 0 ? 1 : 0);
