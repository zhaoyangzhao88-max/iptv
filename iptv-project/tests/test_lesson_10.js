/**
 * ============================================================================
 *  第 10 课 Headless 自动化测试脚本
 * ============================================================================
 *
 *  electron-builder 打包配置验证
 *
 *  采用纯 Node.js 标准库，读取并解析 package.json，
 *  对 electron-builder 配置进行专项断言体检。
 *
 *  运行方式：node tests/test_lesson_10.js
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

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
function warn(label) { console.log(`  ${C.yellow}[WARN]${C.reset} ${label}`); }

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
//  主测试流程
// ────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}  ██████╗ ██╗    ██╗██╗     ██████╗ ████████╗██╗   ██╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ██╔══██╗██║    ██║██║     ██╔══██╗╚══██╔══╝██║   ██║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ██████╔╝██║ █╗ ██║██║     ██████╔╝   ██║   ██║   ██║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ██╔═══╝ ██║███╗██║██║     ██╔═══╝    ██║   ╚██╗ ██╔╝${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ██║     ╚███╔███╔╝███████╗██║        ██║    ╚████╔╝ ${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ╚═╝      ╚══╝╚══╝ ╚══════╝╚═╝        ╚═╝     ╚═══╝  ${C.reset}`);
  console.log(`\n${C.bold}  第 10 课：electron-builder 打包配置验证 —— 自动化体检${C.reset}\n`);

  // ── 读取 package.json ────────────────────────────────────────────────────
  const pkgPath = path.join(__dirname, '..', 'package.json');
  info(`读取 package.json: ${pkgPath}`);

  let pkg;
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    pkg = JSON.parse(raw);
  } catch (err) {
    console.error(`${C.red}[FATAL] 读取或解析 package.json 失败: ${err.message}${C.reset}`);
    process.exit(2);
  }

  info(`解析成功，项目名称: ${C.bold}${pkg.name}${C.reset}，版本: ${C.bold}${pkg.version}${C.reset}`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 A：验证 scripts 包含 dist 命令
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}${C.yellow}── 用例 A：验证 scripts 包含 dist 命令 ──${C.reset}\n`);

  let caseA = 0;

  // A.1: scripts 字段存在
  assert(
    pkg.scripts != null && typeof pkg.scripts === 'object',
    'A.1 package.json 应包含 "scripts" 字段'
  );
  caseA += (pkg.scripts != null && typeof pkg.scripts === 'object') ? 1 : 0;

  // A.2: scripts.dist 存在
  assert(
    pkg.scripts && 'dist' in pkg.scripts,
    'A.2 scripts 应包含 "dist" 命令'
  );
  caseA += (pkg.scripts && 'dist' in pkg.scripts) ? 1 : 0;

  // A.3: scripts.dist 包含 electron-builder
  const distCmd = pkg.scripts ? pkg.scripts.dist : '';
  assert(
    distCmd.includes('electron-builder'),
    `A.3 dist 命令应包含 "electron-builder" (当前值: "${distCmd}")`
  );
  caseA += distCmd.includes('electron-builder') ? 1 : 0;

  // A.4: scripts.dist 包含 --win
  assert(
    distCmd.includes('--win'),
    `A.4 dist 命令应包含 "--win" (当前值: "${distCmd}")`
  );
  caseA += distCmd.includes('--win') ? 1 : 0;

  info(`用例 A 通过 ${caseA}/4 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 B：验证 build 顶层字段结构
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}${C.yellow}── 用例 B：验证 build 顶层字段结构 ──${C.reset}\n`);

  let caseB = 0;

  // B.1: build 字段存在
  assert(
    pkg.build != null && typeof pkg.build === 'object',
    'B.1 package.json 应包含顶层 "build" 字段'
  );
  caseB += (pkg.build != null && typeof pkg.build === 'object') ? 1 : 0;

  // B.2: build.appId 正确
  assert(
    pkg.build && pkg.build.appId === 'com.owl.iptv.player',
    `B.2 build.appId 应为 "com.owl.iptv.player" (当前值: "${pkg.build ? pkg.build.appId : 'undefined'}")`
  );
  caseB += (pkg.build && pkg.build.appId === 'com.owl.iptv.player') ? 1 : 0;

  // B.3: build.productName 正确
  assert(
    pkg.build && pkg.build.productName === 'OwlIPTV',
    `B.3 build.productName 应为 "OwlIPTV" (当前值: "${pkg.build ? pkg.build.productName : 'undefined'}")`
  );
  caseB += (pkg.build && pkg.build.productName === 'OwlIPTV') ? 1 : 0;

  // B.4: build.directories.output 为 "dist"
  assert(
    pkg.build && pkg.build.directories && pkg.build.directories.output === 'dist',
    `B.4 build.directories.output 应为 "dist" (当前值: "${pkg.build && pkg.build.directories ? pkg.build.directories.output : 'undefined'}")`
  );
  caseB += (pkg.build && pkg.build.directories && pkg.build.directories.output === 'dist') ? 1 : 0;

  info(`用例 B 通过 ${caseB}/4 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 C：验证 build.win.target 包含 portable
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}${C.yellow}── 用例 C：验证 build.win.target 包含 portable ──${C.reset}\n`);

  let caseC = 0;

  // C.1: build.win 字段存在
  assert(
    pkg.build && pkg.build.win != null && typeof pkg.build.win === 'object',
    'C.1 build 应包含 "win" 字段'
  );
  caseC += (pkg.build && pkg.build.win != null && typeof pkg.build.win === 'object') ? 1 : 0;

  // C.2: build.win.target 是数组
  assert(
    pkg.build && pkg.build.win && Array.isArray(pkg.build.win.target),
    'C.2 build.win.target 应为数组'
  );
  caseC += (pkg.build && pkg.build.win && Array.isArray(pkg.build.win.target)) ? 1 : 0;

  // C.3: build.win.target 包含 "portable"
  const winTarget = pkg.build && pkg.build.win ? pkg.build.win.target : [];
  assert(
    winTarget.includes('portable'),
    `C.3 build.win.target 应包含 "portable" (当前值: [${winTarget.join(', ')}])`
  );
  caseC += winTarget.includes('portable') ? 1 : 0;

  info(`用例 C 通过 ${caseC}/3 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 D：验证 build.files 包含关键文件（不丢失频道数据）
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}${C.yellow}── 用例 D：验证 build.files 包含关键文件（不丢失频道数据） ──${C.reset}\n`);

  let caseD = 0;

  // D.1: build.files 字段存在且为数组
  assert(
    pkg.build && pkg.build.files && Array.isArray(pkg.build.files),
    'D.1 build 应包含 "files" 数组'
  );
  caseD += (pkg.build && pkg.build.files && Array.isArray(pkg.build.files)) ? 1 : 0;

  const buildFiles = pkg.build && pkg.build.files ? pkg.build.files : [];

  // D.2: build.files 包含 "main.js"
  assert(
    buildFiles.includes('main.js'),
    `D.2 build.files 应包含 "main.js" (当前值: [${buildFiles.join(', ')}])`
  );
  caseD += buildFiles.includes('main.js') ? 1 : 0;

  // D.3: build.files 包含 "app/**/*"
  assert(
    buildFiles.includes('app/**/*'),
    `D.3 build.files 应包含 "app/**/*" (当前值: [${buildFiles.join(', ')}])`
  );
  caseD += buildFiles.includes('app/**/*') ? 1 : 0;

  // D.4: build.files 包含 "data/channels.json"（核心频道数据，不可丢失！）
  assert(
    buildFiles.includes('data/channels.json'),
    `D.4 build.files 应包含 "data/channels.json" —— 核心精选频道数据源，打包时不可遗漏！`
  );
  caseD += buildFiles.includes('data/channels.json') ? 1 : 0;

  // D.5: build.files 包含 "node_modules/**/*"
  assert(
    buildFiles.includes('node_modules/**/*'),
    `D.5 build.files 应包含 "node_modules/**/*" (当前值: [${buildFiles.join(', ')}])`
  );
  caseD += buildFiles.includes('node_modules/**/*') ? 1 : 0;

  // D.6: build.files 包含 "preload.js" (Phase 5 新增，之前缺失！)
  assert(
    buildFiles.includes('preload.js'),
    `D.6 build.files 应包含 "preload.js" (当前值: [${buildFiles.join(', ')}])`
  );
  caseD += buildFiles.includes('preload.js') ? 1 : 0;

  info(`用例 D 通过 ${caseD}/6 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  用例 E：验证 build.asar 和 compression 参数 (Phase 5)
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}${C.yellow}── 用例 E：验证 build.asar 和 compression 参数 ──${C.reset}\n`);

  let caseE = 0;

  // E.1: build.asar 存在且为 true
  assert(
    pkg.build && pkg.build.asar === true,
    'E.1 build.asar 应为 true'
  );
  caseE += (pkg.build && pkg.build.asar === true) ? 1 : 0;

  // E.2: build.compression 存在
  assert(
    pkg.build && typeof pkg.build.compression === 'string',
    'E.2 build.compression 应存在（如 "maximum"）'
  );
  caseE += (pkg.build && typeof pkg.build.compression === 'string') ? 1 : 0;

  info(`用例 E 通过 ${caseE}/2 项`);

  // ════════════════════════════════════════════════════════════════════════
  //  最终体检报告
  // ════════════════════════════════════════════════════════════════════════
  const allPassed = _passedAsserts === _totalAsserts;

  console.log(`\n${C.bold}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║          第 10 课 · electron-builder 自动化体检报告          ║${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);

  const labels = [
    { pass: caseA === 4, label: `用例 A：验证 scripts 包含 dist 命令    (${caseA}/4 项)` },
    { pass: caseB === 4, label: `用例 B：验证 build 顶层字段结构        (${caseB}/4 项)` },
    { pass: caseC === 3, label: `用例 C：验证 win.target 包含 portable  (${caseC}/3 项)` },
    { pass: caseD === 6, label: `用例 D：验证 files 包含关键文件        (${caseD}/6 项)` },
  ];

  for (const r of labels) {
    const icon = r.pass ? `${C.green}[PASS]${C.reset}` : `${C.red}[FAIL]${C.reset}`;
    console.log(`  ${icon} ${r.label}`);
  }

  console.log(`\n${C.bold}────────────────────────────────────────────────────────────────${C.reset}`);

  if (allPassed) {
    console.log(`  ${C.green}${C.bold}✅ 全部通过：${_passedAsserts} / ${_totalAsserts} 项断言 —— 打包配置验证成功！${C.reset}`);
  } else {
    console.log(`  ${C.red}${C.bold}❌ 存在失败：${_passedAsserts} / ${_totalAsserts} 项断言 —— 请检查上方 [FAIL] 项${C.reset}`);
  }

  console.log(`${C.bold}────────────────────────────────────────────────────────────────${C.reset}\n`);

  console.log(`  ${C.dim}用例 A: ${caseA}/4 | 用例 B: ${caseB}/4 | 用例 C: ${caseC}/3 | 用例 D: ${caseD}/5${C.reset}`);
  console.log(`  ${C.dim}总计: ${_passedAsserts}/${_totalAsserts} 断言通过${C.reset}`);
  console.log();

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(`${C.red}[FATAL] ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(2);
});
