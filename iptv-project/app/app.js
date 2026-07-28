import { electronAPI, CONFIG, LAST_WATCHED_KEY, RECOMMENDATION_LIMIT, LOCAL_OVERRIDES_KEY, WATCH_STATS_KEY } from './modules/constants.js';
import { state, els, cacheElements, loadWatchStats, loadLocalOverrides,
  pruneWatchStats, writeJsonToStorage,
  getStorage,
  lastUserActivityTime, isRenderPending, pendingRenderTimer } from './modules/state.js';
import { playChannel, getBootChannel,
  scheduleLazyAutoplay, preloadAdjacentChannels,
  handleCheckerWorkerMessage } from './modules/player.js';
import { loadChannels, normalizeChannels, buildCategories,
  getInitialCategoryIndex, prepareRecommendations,
  fetchAndMergeRemoteChannels, resetLocalFilters,
  updateChannelOverrides, markChannelFailed } from './modules/dataLoader.js';
import { computeTopRecommendations, getTopRecommendations } from './modules/recommend.js';
import { renderCategories, renderChannels, applyFocus } from './modules/virtualGrid.js';
import { bindEvents, showTvToast } from './modules/inputHandler.js';
import { runCategoryDiagnostic } from './modules/diagnostic.js';

// ══════════════════════════════════════════════════════
// OWL IPTV — 入口文件
// ══════════════════════════════════════════════════════

function exposeGlobals() {
  window.owlIptvData = state.channels;
  window.owlIptv = {
    getChannels: () => state.channels.slice(),
    getAllChannels: () => state.allChannels.slice(),
    getWatchStats: () => ({ ...state.watchStats }),
    getTopRecommendations,
    getLocalOverrides: () => ({ ...state.localOverrides }),
    updateChannelOverrides,
    markChannelFailed,
    playChannel,
    renderCategories,
    renderChannels,
    applyFocus,
    runCategoryDiagnostic,
    resetLocalFilters,
    isDiagnosticRunning: () => state.isDiagnosticRunning,
    _getHls: () => state.hls,
    _getState: () => state,
    _getEnv: () => ({ video: els.video }),
    fetchAndMergeRemoteChannels,
    showTvToast,
    _getCONFIG: () => CONFIG,
    _getLastUserActivityTime: () => lastUserActivityTime,
    _setLastUserActivityTime: (ts) => { lastUserActivityTime = ts; },
    _isRenderPending: () => isRenderPending,
    _clearPendingRenderTimer: () => { if (pendingRenderTimer) { clearTimeout(pendingRenderTimer); pendingRenderTimer = null; } isRenderPending = false; },
    _getLastWatched: () => {
      const s = getStorage();
      return s ? s.getItem(LAST_WATCHED_KEY) : null;
    },
    _preloadAdjacentChannels: preloadAdjacentChannels,
    _getPreloadTimer: () => state._preloadTimer,
    _getCurrentChannels: () => state.currentChannels.slice(),
  };
}

async function init() {
  cacheElements();
  bindEvents();
  // Initialize settings module (Phase 5)
  import('./modules/settings.js').then(s => s.initSettings());
  state.watchStats = loadWatchStats();

  // 1. Load channels.json first
  state.allChannels = await loadChannels();
  // 2. Load localStorage overrides
  state.localOverrides = loadLocalOverrides();
  // 3. Normalize with channels.json priority
  state.channels = normalizeChannels(state.allChannels);
  prepareRecommendations();

  // ─── 绍兴本地频道专项特调注入 ─────────────────────
  const SHAOXING_CHANNELS = ['绍兴新闻综合', '绍兴公共频道', '绍兴文化影视'];
  const shaoxingLocalOverrides = state.localOverrides;
  SHAOXING_CHANNELS.forEach((name) => {
    if (shaoxingLocalOverrides.channels[name]) {
      shaoxingLocalOverrides.channels[name].hidden = false;
    } else {
      shaoxingLocalOverrides.channels[name] = { hidden: false, delay_ms: null, routeOrder: [], failed: false, failures: 0, routes: {} };
    }
    if (!state.watchStats[name]) {
      state.watchStats[name] = { count: 99, duration_sec: 7200 };
    } else {
      state.watchStats[name].count = Math.max(state.watchStats[name].count || 0, 99);
      state.watchStats[name].duration_sec = Math.max(state.watchStats[name].duration_sec || 0, 7200);
    }
  });
  writeJsonToStorage(LOCAL_OVERRIDES_KEY, shaoxingLocalOverrides);
  writeJsonToStorage(WATCH_STATS_KEY, state.watchStats);
  state.localOverrides = shaoxingLocalOverrides;
  state.recommendedChannels = computeTopRecommendations(RECOMMENDATION_LIMIT);
  // ─── 绍兴特调注入结束 ─────────────────────────────

  state.watchStats = pruneWatchStats(state.watchStats);
  state.categories = buildCategories();
  state.categoryIndex = getInitialCategoryIndex();

  exposeGlobals();
  renderCategories();
  renderChannels();
  applyFocus();

  scheduleLazyAutoplay(getBootChannel());

  // 断点续播 Toast
  const _storage = getStorage();
  if (_storage) {
    try {
      const _last = _storage.getItem(LAST_WATCHED_KEY);
      if (_last) {
        setTimeout(() => { showTvToast(`📺 上次看至：${_last}，已恢复播放`); }, 500);
      }
    } catch (_) {}
  }

  // Initialize background speed test worker
  if (typeof Worker !== 'undefined') {
    try {
      state.checkerWorker = new Worker('./checker-worker.js');
      state.checkerWorker.onmessage = handleCheckerWorkerMessage;
      state.checkerWorker.onerror = (error) => {
        console.warn('[OWL IPTV] Checker worker error:', error);
      };
      state._checkerWorkerInitialized = true;

      const channelList = state.channels.map((ch) => ({
        name: ch.name,
        urls: ch.routes ? ch.routes.map((r) => r.url) : [ch.url].filter(Boolean),
        routeCount: ch.routes ? ch.routes.length : 1
      }));
      state.checkerWorker.postMessage({ type: 'start', channels: channelList });
    } catch (error) {
      console.warn('[OWL IPTV] Worker 初始化失败，后台测速已禁用：', error);
    }
  }

  // 开机 30 秒后静默拉取云端数据
  setTimeout(() => fetchAndMergeRemoteChannels(), 30000);

  console.info('[OWL IPTV] 播放器业务脚本已启动，所有模块加载完成。');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
