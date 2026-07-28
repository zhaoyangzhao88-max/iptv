'use strict';

/**
 * 样式重叠修复校验脚本
 * 验证 app/style.css 中频道卡片布局修复是否正确落地
 */

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '..', 'app', 'style.css');

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

/**
 * 从 CSS 文本中提取某个选择器的声明块内容
 * 简单可靠：找到 "selector {" 后，逐字符匹配大括号深度，提取到闭合的 "}"
 */
function extractBlock(css, selector) {
  // 找到选择器起始位置（确保前面是空白或开头，避免子串误匹配）
  var searchStart = 0;
  var startIdx = -1;
  while (true) {
    var idx = css.indexOf(selector, searchStart);
    if (idx === -1) break;
    // 确认选择器前面是行首或空白字符
    var prevChar = idx > 0 ? css[idx - 1] : ' ';
    if (/\s/.test(prevChar) || idx === 0) {
      // 确认选择器后面紧跟 { 或空白后 {
      var after = css.substring(idx + selector.length).trim();
      if (after.charAt(0) === '{') {
        startIdx = idx;
        break;
      }
    }
    searchStart = idx + 1;
  }

  if (startIdx === -1) return null;

  // 找到 { 的位置
  var braceIdx = css.indexOf('{', startIdx);
  if (braceIdx === -1) return null;

  // 从 { 之后逐字符匹配，找到闭合的 }
  var depth = 1;
  var i = braceIdx + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }

  if (depth !== 0) return null; // 未闭合
  return css.substring(braceIdx + 1, i - 1);
}

/**
 * 检查声明块中是否包含指定的 CSS 属性:值
 */
function hasProperty(block, prop, value) {
  if (!block) return false;
  // 构建正则：属性名:值;  （允许前后空白）
  var valPattern = value
    ? value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : '[^;]+';
  var regex = new RegExp(
    '(^|[{;\\s])\\s*' + prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*' + valPattern + '\\s*;'
  );
  return regex.test(block);
}

// ─── 读取 CSS ──────────────────────────────────────────────────────────
var css;
try {
  css = fs.readFileSync(CSS_PATH, 'utf8');
} catch (err) {
  console.error('[ERROR] 无法读取 ' + CSS_PATH + ': ' + err.message);
  process.exit(1);
}

console.log('=================== 样式重叠修复校验 ===================');
console.log('');

// ─── 1. .channel-name 省略号截断验证 ──────────────────────────────────
console.log('[Group 1] .channel-name 省略号截断');

var nameBlock = extractBlock(css, '.channel-name');
assert(nameBlock !== null, '.channel-name 声明块存在');
assert(hasProperty(nameBlock, 'white-space', 'nowrap'), 'white-space: nowrap — 禁止自动折行');
assert(hasProperty(nameBlock, 'overflow', 'hidden'), 'overflow: hidden — 超出部分隐藏');
assert(hasProperty(nameBlock, 'text-overflow', 'ellipsis'), 'text-overflow: ellipsis — 优雅省略号');
assert(hasProperty(nameBlock, 'max-width', '90%'), 'max-width: 90% — 防止撑满卡片');

// ─── 2. .channel-card 盒模型验证 ──────────────────────────────────────
console.log('');
console.log('[Group 2] .channel-card 盒模型');

var cardBlock = extractBlock(css, '.channel-card');
assert(cardBlock !== null, '.channel-card 声明块存在');
assert(hasProperty(cardBlock, 'position', 'absolute'), 'position: absolute — 虚拟网格定位');
assert(hasProperty(cardBlock, 'overflow', 'hidden'), 'overflow: hidden — 内容不溢出');
assert(hasProperty(cardBlock, 'padding', '16px'), 'padding: 16px — 规范内边距');
assert(hasProperty(cardBlock, 'justify-content', 'flex-start'), 'justify-content: flex-start — 名称置顶');

// ─── 3. .latency-badge 绝对定位验证 ───────────────────────────────────
console.log('');
console.log('[Group 3] .latency-badge 绝对定位');

var badgeBlock = extractBlock(css, '.latency-badge');
assert(badgeBlock !== null, '.latency-badge 声明块存在');
assert(hasProperty(badgeBlock, 'position', 'absolute'), 'position: absolute — 绝对定位');
assert(hasProperty(badgeBlock, 'bottom', '12px'), 'bottom: 12px — 固定底边间距');
assert(hasProperty(badgeBlock, 'left', '16px'), 'left: 16px — 左侧对齐');

// ─── 4. .grid-spacer 健康检查 ─────────────────────────────────────────
console.log('');
console.log('[Group 4] .grid-spacer 虚拟滚动占位');

var spacerBlock = extractBlock(css, '.grid-spacer');
assert(spacerBlock !== null, '.grid-spacer 声明块存在');
assert(hasProperty(spacerBlock, 'position', 'absolute'), 'position: absolute — 占位元素');
assert(hasProperty(spacerBlock, 'pointer-events', 'none'), 'pointer-events: none — 不拦截点击');

// ─── 5. .channel-logo 位置验证 ────────────────────────────────────────
console.log('');
console.log('[Group 5] .channel-logo 台标位置');

var logoBlock = extractBlock(css, '.channel-logo');
assert(logoBlock !== null, '.channel-logo 声明块存在');
assert(hasProperty(logoBlock, 'position', 'absolute'), 'position: absolute — 绝对定位');
assert(hasProperty(logoBlock, 'top', '8px'), 'top: 8px — 右上角');
assert(hasProperty(logoBlock, 'right', '8px'), 'right: 8px — 右上角');

// ─── 汇总 ─────────────────────────────────────────────────────────────
console.log('');
console.log('======================================================');
console.log('  总计: ' + (passed + failed) + ' 项  |  通过: ' + passed + '  |  失败: ' + failed);
if (failed === 0) {
  console.log('  ✅ 所有样式校验全部通过！频道名称重叠 Bug 已修复。');
} else {
  console.log('  ⚠️  存在未通过的校验项，请检查 CSS 文件。');
}
console.log('======================================================');
console.log('');

process.exit(failed > 0 ? 1 : 0);
