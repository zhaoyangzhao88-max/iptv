import { electronAPI } from './constants.js';
import { sanitizeUrl } from './urlPolicy.js';
import { state, els, getStorage, writeJsonToStorage,
  loadLocalOverrides, normalizeLocalOverrides } from './state.js';
import { playChannel, destroyHlsInstance, resumeBackgroundTimers,
  pauseCheckerWorker, autoplayVideo, syncCheckerWorkerChannels } from './player.js';
import { markUserInteraction, renderChannels, applyFocus,
  renderChannelGrid } from './virtualGrid.js';

// ─── Helper ───────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDiagnosticRoutes(channel) {
  if (Array.isArray(channel.routes) && channel.routes.length > 0) {
    return channel.routes.filter((route) => route && typeof route.url === 'string' && route.url);
  }
  return channel.url ? [{ url: channel.url }] : [];
}

function testRoute(video, route) {
  return new Promise((resolve) => {
    let resolved = false;
    let timeupdateCount = 0;
    let lastCurrentTime = 0;
    let playingFired = false;
    let timer;
    const TIMEOUT_MS = 3500;

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('error', onError);
      if (state._diagHls) {
        state._diagHls.destroy();
        state._diagHls = null;
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    const resolveOnce = (status, reason) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({ status, reason });
    };

    const onPlaying = () => { playingFired = true; };
    const onTimeUpdate = () => {
      if (video.currentTime > lastCurrentTime) {
        timeupdateCount++;
        lastCurrentTime = video.currentTime;
      }
      if (playingFired && timeupdateCount >= 2) {
        resolveOnce('ok', '播放正常');
      }
    };
    const onError = () => resolveOnce('error', '播放检测失败');

    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('error', onError);
    timer = setTimeout(() => {
      resolveOnce(
        playingFired && timeupdateCount >= 2 ? 'ok' : 'timeout',
        playingFired && timeupdateCount >= 2 ? '播放正常' : '连接超时'
      );
    }, TIMEOUT_MS);

    video.muted = true;
    if (window.Hls && window.Hls.isSupported()) {
      const diagHls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        manifestLoadingTimeOut: 3000,
        levelLoadingTimeOut: 3000,
        fragmentLoadingTimeOut: 3000,
        xhrSetup: (xhr) => { xhr.timeout = 3000; }
      });
      state._diagHls = diagHls;
      diagHls.attachMedia(video);
      diagHls.loadSource(route.url);
      diagHls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      diagHls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data && data.fatal) resolveOnce('error', '播放检测失败');
      });
    } else {
      video.src = route.url;
      video.play().catch(() => {});
    }
  });
}

// ─── Test single channel ──────────────────────────────

export async function testSingleChannel(channel) {
  const video = els.video;
  const routes = getDiagnosticRoutes(channel);
  const result = {
    name: channel.name,
    group: channel.group,
    url: '',
    routeCount: routes.length,
    attemptCount: 0,
    status: routes.length > 0 ? 'unknown' : 'error',
    reason: routes.length > 0 ? '' : '无可用线路'
  };

  for (const route of routes) {
    result.attemptCount++;
    result.url = sanitizeUrl(route.url);
    const attempt = await testRoute(video, route);
    if (attempt.status === 'ok') {
      result.status = 'ok';
      result.reason = '播放正常';
      return result;
    }
    result.status = attempt.status;
    result.reason = attempt.status === 'timeout' ? '连接超时' : '播放检测失败';
  }
  return result;
}


// ─── Report generation ────────────────────────────────

export async function generateReport(categoryLabel, results, isCapped = false) {
  const now = new Date();
  const total = results.length;
  const okList = results.filter((r) => r.status === 'ok');
  const errList = results.filter((r) => r.status === 'error');
  const timeoutList = results.filter((r) => r.status === 'timeout');
  const ok = okList.length;
  const errors = errList.length;
  const timeouts = timeoutList.length;

  let md = '# 📺 IPTV 播放感知体检报告\n\n';
  md += `> 检测时间：${now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}\n`;
  md += `> 检测分类：${categoryLabel}${isCapped ? ' (仅对前 30 个精品推荐源进行检测)' : ''}\n\n`;
  md += '## 体检摘要\n\n';
  md += '| 指标 | 数值 |\n';
  md += '|---|---|\n';
  md += `| 总测频道数 | ${total} |\n`;
  md += `| ✅ 播放正常 | ${ok} |\n`;
  md += `| ❌ 解码失败 | ${errors} |\n`;
  md += `| ⏱️ 连接超时 | ${timeouts} |\n`;
  md += `| 可用率 | ${total > 0 ? ((ok / total) * 100).toFixed(1) : '0.0'}% |\n\n`;
  md += '## 频道明细\n\n';
  md += '| # | 频道名 | 状态 | 失败原因 | 尝试线路 | 线路总数 | 主播放URL |\n';
  md += '|---|---|---|---|---|---|---|\n';

  results.forEach((r, i) => {
    const statusIcon = r.status === 'ok' ? '✅' : r.status === 'error' ? '❌' : '⏱️';
    const statusText = r.status === 'ok' ? '正常' : r.status === 'error' ? '解码失败' : '超时';
    const reason = r.status === 'ok' ? '播放正常' : r.status === 'timeout' ? '连接超时' : '播放检测失败';
    const safeUrl = sanitizeUrl(r.url);
    md += `| ${i + 1} | ${r.name} | ${statusIcon} ${statusText} | ${reason} | ${r.attemptCount || 0} | ${r.routeCount || 0} | ${safeUrl || '-'} |\n`;
  });

  md += '\n---\n*由 IPTV 智能巡检系统自动生成*\n';

  if (electronAPI) {
    try {
      await electronAPI.writeDiagnosticReport(md);
      console.log('[OWL IPTV] 体检报告已保存到 userData/reports');
    } catch (e) {
      console.error('[OWL IPTV] 报告保存失败：', e);
    }
  } else {
    try {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'playback_client_report.md';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[OWL IPTV] Blob 下载也失败：', e);
    }
  }
}

// ─── Main diagnostic runner ───────────────────────────

export async function runCategoryDiagnostic() {
  const category = state.categories[state.categoryIndex] || state.categories[0];
  if (!category || !category.channels || category.channels.length === 0) {
    console.warn('[OWL IPTV] 当前分类没有频道可检测。');
    return;
  }

  if (category.key === 'all' || category.label === '全部频道') {
    alert('全部频道规模过大（含 6000+ 频道），请切换到特定子分类（如央视、卫视、各省地方台）再进行智能体检。');
    return;
  }

  const DIAGNOSTIC_CAP = 30;
  const allChannels = category.channels;
  const isCapped = allChannels.length > DIAGNOSTIC_CAP;
  const channels = isCapped ? allChannels.slice(0, DIAGNOSTIC_CAP) : allChannels;
  const total = channels.length;
  const results = [];
  const savedChannel = state.currentChannel;

  channels.forEach((ch) => {
    ch.hidden = false;
    const ov = state.localOverrides.channels[ch.name];
    if (ov) {
      state.localOverrides.channels[ch.name] = { ...ov, hidden: undefined };
    }
  });
  writeJsonToStorage('owl_iptv_local_overrides', state.localOverrides);

  state.isDiagnosticRunning = true;
  resumeBackgroundTimers();
  if (els.diagnosticOverlay) els.diagnosticOverlay.classList.add('active');
  if (els.diagnosticProgress) els.diagnosticProgress.style.width = '0%';
  if (els.diagnosticStatus) {
    if (isCapped) {
      els.diagnosticStatus.textContent = '正在对当前分类的前 30 个推荐频道进行智能体检，请勿操作键盘...';
    } else {
      els.diagnosticStatus.textContent = `正在对当前分类的 ${total} 个频道进行智能体检，请勿操作键盘...`;
    }
  }

  for (let i = 0; i < total; i++) {
    const channel = channels[i];
    const progressPercent = ((i + 1) / total) * 100;

    if (els.diagnosticProgress) {
      els.diagnosticProgress.style.width = `${progressPercent.toFixed(1)}%`;
    }
    if (els.diagnosticStatus) {
      els.diagnosticStatus.textContent = `当前正在拨测：${channel.name} (进度: ${i + 1} / ${total})`;
    }

    const result = await testSingleChannel(channel);
    results.push(result);

    if (result.status === 'timeout' || result.status === 'error') {
      // A failed probe is recoverable: keep the channel visible so they can retry
      // or choose another route manually instead of permanently hiding it.
      channel.hidden = false;
      const existing = state.localOverrides.channels[channel.name];
      if (existing) {
        state.localOverrides.channels[channel.name] = { ...existing, hidden: undefined };
      }
      writeJsonToStorage('owl_iptv_local_overrides', state.localOverrides);
    } else {
      channel.hidden = false;
      const existing = state.localOverrides.channels[channel.name];
      if (existing) {
        state.localOverrides.channels[channel.name] = { ...existing, hidden: undefined };
      }
      writeJsonToStorage('owl_iptv_local_overrides', state.localOverrides);
    }

    if (i < total - 1) {
      await sleep(300);
    }
  }

  if (els.diagnosticProgress) els.diagnosticProgress.style.width = '100%';
  if (els.diagnosticStatus) els.diagnosticStatus.textContent = '检测完成！正在生成报告...';

  if (savedChannel) {
    playChannel(savedChannel);
  }

  await sleep(500);
  if (els.diagnosticOverlay) els.diagnosticOverlay.classList.remove('active');
  state.isDiagnosticRunning = false;

  generateReport(category.label, results, isCapped);

  state.localOverrides = loadLocalOverrides();
  const survivingTestedChannels = channels.filter((ch) => !ch.hidden);
  const untestedChannels = isCapped ? allChannels.slice(DIAGNOSTIC_CAP) : [];
  category.channels = [...survivingTestedChannels, ...untestedChannels];

  state.channelIndex = 0;
  renderChannels();
  applyFocus();

  if (survivingTestedChannels.length > 0) {
    const best = survivingTestedChannels
      .map((ch) => {
        const stat = state.watchStats[ch.name];
        const score = stat ? (stat.count || 0) * 10 + (stat.duration_sec || 0) / 60 : 0;
        return { ch, score };
      })
      .sort((a, b) => b.score - a.score || a.ch.name.localeCompare(b.ch.name, 'zh-CN'))[0].ch;

    playChannel(best);
  } else {
    console.warn('[OWL IPTV] 自愈净化后当前分类无幸存频道。');
  }
}
