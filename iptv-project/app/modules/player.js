import {
  HLS_CONNECTION_TIMEOUT_MS, HLS_FATAL_RETRY_LIMIT,
  FREEZE_DETECT_MS, FREEZE_POLL_JITTER_MS,
  ROUTE_FAILURE_LIMIT, PRELOAD_DELAY_MS,
  AUTOPLAY_DELAY_MS, VALID_VIEW_DELAY_MS, DURATION_TICK_MS,
  LAST_WATCHED_KEY, RECOMMENDATION_LIMIT
} from './constants.js';
import { electronAPI } from './constants.js';
import { state, els, getStorage, saveRouteOrderToStorage,
  getOrCreateWatchStat, addWatchCount, addWatchDuration,
  saveLastWatched, saveWatchStats, writeJsonToStorage,
  readJsonFromStorage, loadLocalOverrides, normalizeLocalOverrides,
  isUserActiveRecently
} from './state.js';
import { renderChannels, applyFocus, renderChannelGrid } from './virtualGrid.js';

function isCurrentChannel(channel) {
  if (!channel || !state.currentChannel) return false;
  if (channel.channelKey && state.currentChannelKey) return channel.channelKey === state.currentChannelKey;
  return channel.name === state.currentChannelName;
}

// ─── Playback — instant start, no black screen ─────────

export function playChannel(channel, options = {}) {
  const resolvedChannel = resolveChannel(channel);
  if (!resolvedChannel || resolvedChannel.failed || !resolvedChannel.routes || resolvedChannel.routes.length === 0) {
    console.warn('[OWL IPTV] 频道不可播放或暂无可用线路，已跳过。', channel);
    return false;
  }

  stopPlaybackTimers();
  clearHlsConnectionTimeout();
  state.hlsConnectionTimedOut = false;
  destroyHlsInstance();

  const channelName = resolvedChannel.name;
  const channelKey = resolvedChannel.channelKey || channelName;
  const watchStat = getOrCreateWatchStat(resolvedChannel);
  state.currentChannel = resolvedChannel;
  state.currentChannelName = channelName;
  state.currentChannelKey = channelKey;
  state.currentWatchDurationSec = watchStat.duration_sec;
  state.hlsRouteIndex = 0;
  state.hlsFatalRetryCount = 0;
  state.isSwitching = false;

  els.currentChannel.textContent = channelName;
  els.currentLatency.textContent = formatLatency(resolvedChannel.delay_ms);
  els.video.muted = false;
  updateWatchDuration();

  const route = resolvedChannel.routes[0];
  startPlaybackTimers(channelName);
  playRoute(resolvedChannel, route, 0, options);

  return true;
}

function resolveChannel(channel) {
  if (!channel) return null;
  if (typeof channel === 'string') return state.channelByName.get(channel) || null;
  const existing = state.channelByName.get(channel.name);
  if (!existing) return channel;
  return {
    ...existing,
    ...channel,
    routes: channel.routes && channel.routes.length > 0 ? channel.routes : existing.routes
  };
}

function playRoute(channel, route, routeIndex, options = {}) {
  stopAllBackgroundTimers();
  pauseCheckerWorker();

  if (state.hls) {
    destroyHlsInstance();
  }

  clearVideoElementListeners();
  stopVideoStalledMonitor();

  if (window.Hls && window.Hls.isSupported()) {
    setupHlsInstance(channel, route, routeIndex, true);
    return;
  }

  // Native HLS (Safari)
  const video = els.video;
  video.src = route.url;
  autoplayVideo(Boolean(options.autoplay));
}

// ─── HLS configuration ────────────────────────────────

function getHlsConfig() {
  return {
    enableWorker: true,
    lowLatencyMode: true,
    manifestLoadingTimeOut: HLS_CONNECTION_TIMEOUT_MS,
    levelLoadingTimeOut: HLS_CONNECTION_TIMEOUT_MS,
    fragmentLoadingTimeOut: HLS_CONNECTION_TIMEOUT_MS,
    xhrSetup: (xhr) => { xhr.timeout = HLS_CONNECTION_TIMEOUT_MS; }
  };
}

export function isMediaDecodeError(data) {
  if (!data) return false;
  if (data.fatal && data.type === window.Hls.ErrorTypes.MEDIA_ERROR) return true;
  const details = data.details;
  if (details === window.Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR) return true;
  if (details === window.Hls.ErrorDetails.FRAG_PARSING_ERROR) return true;
  if (details === window.Hls.ErrorDetails.BUFFER_APPENDING_ERROR) return true;
  return false;
}

function setupHlsInstance(channel, route, routeIndex, enableConnectionTimeout) {
  state.hlsRouteIndex = routeIndex;
  state.hls = new window.Hls(getHlsConfig());
  state.hls.attachMedia(els.video);
  state.hls.loadSource(route.url);

  if (enableConnectionTimeout) {
    startHlsConnectionTimeout(channel, route, routeIndex);
  }

  state.hls.on(window.Hls.Events.MANIFEST_LOADING, () => {
    clearHlsConnectionTimeout();
    if (isCurrentChannel(channel) && state.hls) {
      autoplayVideo(true);
    }
  });

  state.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    clearHlsConnectionTimeout();
    if (isCurrentChannel(channel) && state.hls) {
      autoplayVideo(true);
    }
  });

  const hlsInstance = state.hls;
  state.hls.on(window.Hls.Events.ERROR, (event, data) => {
    if (state.hls !== hlsInstance || !isCurrentChannel(channel)) return;
    console.warn('[OWL IPTV] Hls.js 播放错误：', data && data.type, data && data.details);

    if (isMediaDecodeError(data)) {
      console.warn('[OWL IPTV] 检测到媒体解码错误（可能为 H.265 不兼容），立即切换备用线路。');
      markRouteLocallyIncompatible(channel, route);
      switchToNextRoute(channel, route, routeIndex);
      return;
    }

    if (data && data.fatal) {
      recoverFromFatalHlsError(channel, route, routeIndex);
    }
  });

  bindVideoStalledAndError(channel, route, routeIndex);
}

// ─── Video stalled / error monitoring ─────────────────

function bindVideoStalledAndError(channel, failedRoute, failedRouteIndex) {
  const video = els.video;

  const onWaiting = () => {
    if (state.isSwitching) return;
    if (!isCurrentChannel(channel)) return;
    console.warn('[OWL IPTV] 播放卡顿（waiting 事件），启动停滞监测器...');
    startVideoStalledMonitor(channel, failedRoute, failedRouteIndex);
  };

  video.addEventListener('waiting', onWaiting);
  // Stored for cleanup
  video._owl_waitingHandler = onWaiting;
}

export function startVideoStalledMonitor(channel, failedRoute, failedRouteIndex) {
  if (state._freezeMonitorInterval) {
    window.clearInterval(state._freezeMonitorInterval);
  }
  state._lastCurrentTime = 0;

  const pollInterval = FREEZE_DETECT_MS + Math.random() * FREEZE_POLL_JITTER_MS;

  state._freezeMonitorInterval = window.setInterval(() => {
    if (!isCurrentChannel(channel)) return;
    if (state.isSwitching) return;

    const video = els.video;
    if (video.paused || video.ended) return;

    const nowTime = video.currentTime;

    if (state._lastCurrentTime === 0) {
      state._lastCurrentTime = nowTime;
      return;
    }

    if (nowTime === state._lastCurrentTime) {
      console.warn('[OWL IPTV] 视频播放物理停滞（currentTime 未前进），自动切换备用线路。');
      stopVideoStalledMonitor();
      markRouteLocallyIncompatible(channel, failedRoute);
      switchToNextRoute(channel, failedRoute, failedRouteIndex);
      return;
    }

    state._lastCurrentTime = nowTime;
  }, pollInterval);
}

export function stopVideoStalledMonitor() {
  if (state._freezeMonitorInterval) {
    window.clearInterval(state._freezeMonitorInterval);
    state._freezeMonitorInterval = null;
  }
  state._lastCurrentTime = 0;
  state.stalledDetected = false;
}

// ─── Route failure & switching ────────────────────────

export function markRouteLocallyIncompatible(channel, route) {
  if (!channel || !route || !route.url) return;
  const ch = state.channelByName.get(channel.name);
  if (!ch) return;
  if (!ch._failedRouteUrls) ch._failedRouteUrls = new Set();
  ch._failedRouteUrls.add(route.url);
  if (ch.routes && ch._failedRouteUrls.size >= ch.routes.length) {
    ch.failed = true;
  }
}

export function switchToNextRoute(channel, failedRoute, failedRouteIndex) {
  if (!channel || state.isSwitching) return;
  state.isSwitching = true;

  try {
    const routes = channel.routes || [];
    const failedSet = new Set(channel._failedRouteUrls || []);
    const chOverride = state.localOverrides.channels[channel.name];
    if (chOverride && chOverride.routes) {
      Object.entries(chOverride.routes).forEach(([url, ov]) => {
        if (ov && (ov.failed || ov.failures >= ROUTE_FAILURE_LIMIT)) {
          failedSet.add(url);
        }
      });
    }

    let scanFrom = failedRouteIndex;
    if (failedRoute && failedRoute.url) {
      const actualIndex = routes.findIndex((r) => r.url === failedRoute.url);
      if (actualIndex !== -1) scanFrom = actualIndex;
    }

    let nextRoute = null;
    let nextRouteIndex = -1;
    for (let i = scanFrom + 1; i < routes.length; i++) {
      if (!failedSet.has(routes[i].url)) {
        nextRoute = routes[i];
        nextRouteIndex = i;
        break;
      }
    }

    if (nextRoute) {
      console.warn(`[OWL IPTV] 主线路连接中断/解码失败，正在无缝尝试第 ${nextRouteIndex + 1} 条备用线...`);
      state.hlsFatalRetryCount = 0;
      playRoute(channel, nextRoute, nextRouteIndex, { autoplay: true });
    } else {
      console.warn('[OWL IPTV] 所有备用线路均已尝试失败，频道当前不可用。');
      if (channel && channel.name) {
        saveRouteOrderToStorage(channel);
      }
      renderChannelGrid();
    }
  } finally {
    state.isSwitching = false;
  }
}

// ─── HLS fatal error recovery ─────────────────────────

function recoverFromFatalHlsError(channel, route, routeIndex) {
  state.hlsFatalRetryCount = (state.hlsFatalRetryCount || 0) + 1;
  if (state.hlsFatalRetryCount <= HLS_FATAL_RETRY_LIMIT) {
    console.warn(`[OWL IPTV] HLS 致命错误，重试第 ${state.hlsFatalRetryCount} 次...`);
    destroyHlsInstance();

    // Short delay before retrying same route
    setTimeout(() => {
      if (state.currentChannelName === channel.name) {
        setupHlsInstance(channel, route, routeIndex, true);
      }
    }, 200);
  } else {
    console.warn(`[OWL IPTV] HLS 已重试 ${HLS_FATAL_RETRY_LIMIT} 次仍失败，切换备用线路。`);
    markRouteLocallyIncompatible(channel, route);
    switchToNextRoute(channel, route, routeIndex);
  }
}

// ─── HLS connection timeout ───────────────────────────

function startHlsConnectionTimeout(channel, route, routeIndex) {
  clearHlsConnectionTimeout();
  state.hlsConnectionTimedOut = false;

  state.hlsConnectionTimer = window.setTimeout(() => {
    if (!isCurrentChannel(channel)) return;
    if (state.hls && state.hls.loaded) return;

    state.hlsConnectionTimedOut = true;
    console.warn(`[OWL IPTV] HLS 连接超时 (${HLS_CONNECTION_TIMEOUT_MS}ms)，切换备用线路。`);
    markRouteLocallyIncompatible(channel, route);
    switchToNextRoute(channel, route, routeIndex);
  }, HLS_CONNECTION_TIMEOUT_MS * 2);
}

export function clearHlsConnectionTimeout() {
  if (state.hlsConnectionTimer) {
    window.clearTimeout(state.hlsConnectionTimer);
    state.hlsConnectionTimer = null;
  }
  state.hlsConnectionTimedOut = false;
}

// ─── Hls.js instance management ───────────────────────

export function destroyHlsInstance() {
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  if (state._diagHls) {
    state._diagHls.destroy();
    state._diagHls = null;
  }
  clearHlsConnectionTimeout();
  stopAllBackgroundTimers();
  clearVideoElementListeners();
}

// ─── Background speed test worker ─────────────────────

export function handleCheckerWorkerMessage(event) {
  const data = event.data || {};
  if (data.type !== 'test_result') return;

  const channelName = data.channelName;
  if (!channelName) return;

  const channel = state.channelByName.get(channelName);
  if (!channel) return;

  if (data.success && typeof data.delay_ms === 'number' && data.delay_ms >= 0) {
    if (channel.routes && channel.routes.length > 0) {
      channel.routes[0].delay_ms = data.delay_ms;
    }
    channel.delay_ms = data.delay_ms;
    channel.hidden = false;

    const existing = state.localOverrides.channels[channelName] || {};
    state.localOverrides.channels[channelName] = {
      ...existing, delay_ms: data.delay_ms, failed: false, failures: 0, hidden: false
    };
  } else if (!data.success) {
    channel.hidden = true;
    const existing = state.localOverrides.channels[channelName] || {};
    const existingRoutes = (existing.routes && typeof existing.routes === 'object') ? existing.routes : {};
    const failedUrl = Array.isArray(data.urls) && data.urls.length > 0 ? data.urls[0] : null;

    state.localOverrides.channels[channelName] = {
      ...existing, delay_ms: null, hidden: true,
      routes: { ...existingRoutes, ...(failedUrl ? { [failedUrl]: { failed: true, failures: 1 } } : {}) }
    };
  }

  state.localOverrides = normalizeLocalOverrides(state.localOverrides);
  writeJsonToStorage('owl_iptv_local_overrides', state.localOverrides);

  if (!data.success && !isKeyboardChannelSelectionActive()) {
    renderChannelGrid();
  }
}

function isKeyboardChannelSelectionActive() {
  return state.activeColumn === 'channel' && isUserActiveRecently();
}

export function pauseCheckerWorker() {
  if (state.checkerWorker && state._checkerWorkerInitialized) {
    state.checkerWorker.postMessage({ type: 'pause' });
  }
}

export function resumeCheckerWorker() {
  if (state.checkerWorker && state._checkerWorkerInitialized) {
    state.checkerWorker.postMessage({ type: 'resume' });
  }
}

export function syncCheckerWorkerChannels() {
  if (!state.checkerWorker || !state._checkerWorkerInitialized) return;
  if (state.isDiagnosticRunning) return;

  const channelList = state.channels.map((ch) => ({
    name: ch.name,
    urls: ch.routes ? ch.routes.map((r) => r.url) : [ch.url].filter(Boolean),
    routeCount: ch.routes ? ch.routes.length : 1
  }));
  state.checkerWorker.postMessage({ type: 'start', channels: channelList });
}

// ─── Autoplay ─────────────────────────────────────────

export function autoplayVideo(force = false) {
  if (!force && !state.userHasInteracted) return;
  const playPromise = els.video.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch((error) => {
      console.warn('[OWL IPTV] 自动播放被浏览器策略拦截，尝试静音后播放。', error);
      els.video.muted = true;
      els.video.play().catch((retryError) => {
        console.warn('[OWL IPTV] 静音自动播放仍失败。', retryError);
      });
    });
  }
}

export function scheduleLazyAutoplay(channel) {
  if (!channel || state.userHasInteracted) return;
  if (state.lazyAutoplayTimer) {
    window.clearTimeout(state.lazyAutoplayTimer);
  }
  state.lazyAutoplayChannel = channel;
  state.lazyAutoplayTimer = window.setTimeout(() => {
    if (state.lazyAutoplayChannel !== channel || state.userHasInteracted) return;
    playChannel(channel, { autoplay: true });
  }, AUTOPLAY_DELAY_MS);
}

// ─── Playback timers ──────────────────────────────────

export function startPlaybackTimers(channelName) {
  if (!channelName) return;

  state.validViewTimer = window.setTimeout(() => {
    if (!isCurrentChannelPlaying(channelName)) return;
    addWatchCount(channelName);
  }, VALID_VIEW_DELAY_MS);

  state.durationTimer = window.setInterval(() => {
    if (!isCurrentChannelPlaying(channelName)) return;
    addWatchDuration(channelName, DURATION_TICK_MS / 1000);
  }, DURATION_TICK_MS);

  if (state._preloadTimer) {
    window.clearTimeout(state._preloadTimer);
  }
  state._preloadTimer = window.setTimeout(() => {
    if (state.currentChannelName === channelName && !els.video.paused && !els.video.ended) {
      preloadAdjacentChannels(state.currentChannel);
    }
  }, PRELOAD_DELAY_MS);
}

function isCurrentChannelPlaying(channelName) {
  return state.currentChannelName === channelName && !els.video.paused && !els.video.ended;
}

export function stopPlaybackTimers() {
  if (state.validViewTimer) {
    window.clearTimeout(state.validViewTimer);
    state.validViewTimer = null;
  }
  if (state.durationTimer) {
    window.clearInterval(state.durationTimer);
    state.durationTimer = null;
  }
}

// ─── Duration & latency display ───────────────────────

export function updateWatchDuration() {
  els.watchDuration.textContent = formatDuration(state.currentWatchDurationSec);
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export function formatLatency(delayMs) {
  const safeDelay = Number(delayMs);
  if (!Number.isFinite(safeDelay) || safeDelay < 0) return '-- ms';
  const icon = safeDelay < 500 ? '🟢' : safeDelay < 1500 ? '🟡' : '🔴';
  const value = safeDelay < 1000 ? `${Math.round(safeDelay)} ms` : `${(safeDelay / 1000).toFixed(1)} s`;
  return `${icon} ${value}`;
}

// ─── Fullscreen ───────────────────────────────────────

export function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  if (typeof els.video.requestFullscreen === 'function') {
    els.video.requestFullscreen().catch((error) => {
      console.warn('[OWL IPTV] 进入全屏失败。', error);
    });
  }
}

// ─── Preload adjacent channels ────────────────────────

export function preloadAdjacentChannels(currentChannel) {
  if (!currentChannel || !currentChannel.name) return;
  const channels = state.currentChannels;
  if (!channels || channels.length === 0) return;

  const currentIndex = channels.findIndex(ch => ch.name === currentChannel.name);
  if (currentIndex === -1) return;

  const prevChannel = currentIndex > 0 ? channels[currentIndex - 1] : null;
  const nextChannel = currentIndex < channels.length - 1 ? channels[currentIndex + 1] : null;
  if (!prevChannel && !nextChannel) return;

  const urls = [];
  if (prevChannel) {
    const route = (prevChannel.routes && prevChannel.routes[0]) || { url: prevChannel.url };
    if (route.url) urls.push(route.url);
  }
  if (nextChannel) {
    const route = (nextChannel.routes && nextChannel.routes[0]) || { url: nextChannel.url };
    if (route.url) urls.push(route.url);
  }
  if (urls.length === 0) return;

  const head = document.head || document.getElementsByTagName('head')[0];
  if (!head) return;

  urls.forEach(url => {
    try {
      const urlObj = new URL(url);
      const origin = urlObj.origin;

      const dnsLink = document.createElement('link');
      dnsLink.setAttribute('rel', 'dns-prefetch');
      dnsLink.setAttribute('href', origin);
      head.appendChild(dnsLink);

      const preconnectLink = document.createElement('link');
      preconnectLink.setAttribute('rel', 'preconnect');
      preconnectLink.setAttribute('href', origin);
      preconnectLink.setAttribute('crossorigin', 'anonymous');
      head.appendChild(preconnectLink);
    } catch (e) { /* ignore */ }
  });
}

// ─── Boot channel selection ───────────────────────────

export function getBootChannel() {
  const storage = getStorage();
  if (storage) {
    try {
      const lastWatched = storage.getItem('owl_iptv_last_channel');
      if (lastWatched) {
        const found = state.channelByName.get(lastWatched);
        if (found) return found;
        const allFound = state.allChannels.find(ch => ch.name === lastWatched);
        if (allFound) return allFound;
      }
    } catch (_) { /* ignore */ }
  }
  if (state.recommendedChannels.length > 0) {
    return state.recommendedChannels[0];
  }
  return state.channels[0] || null;
}

// ─── Cleanup helpers ──────────────────────────────────

export function clearVideoElementListeners() {
  const video = els.video;
  if (!video) return;
  if (video._owl_waitingHandler) {
    video.removeEventListener('waiting', video._owl_waitingHandler);
    delete video._owl_waitingHandler;
  }
}

export function stopAllBackgroundTimers() {
  if (state._preloadTimer) {
    window.clearTimeout(state._preloadTimer);
    state._preloadTimer = null;
  }
  if (state._freezeMonitorInterval) {
    window.clearInterval(state._freezeMonitorInterval);
    state._freezeMonitorInterval = null;
  }
  state._lastCurrentTime = 0;
}

export function resumeBackgroundTimers() {
  state._backgroundTimersActive = true;
  resumeCheckerWorker();
}
