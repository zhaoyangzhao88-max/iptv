import {
  LOCAL_OVERRIDES_KEY, WATCH_STATS_KEY, LAST_WATCHED_KEY,
  ROUTE_FAILURE_LIMIT, SILENT_MERGE_DELAY_MS,
  STORAGE_MAX_BYTES, WATCH_STATS_MAX_ENTRIES, WATCH_STATS_TRIM_TARGET
} from './constants.js';

// ─── 全局状态单例 ─────────────────────────────────────
export const state = {
  allChannels: [],
  publicChannels: [],
  privateChannels: [],
  privateSources: [],
  sourceStatus: {},
  channels: [],
  categories: [],
  currentChannels: [],
  recommendedChannels: [],
  channelByName: new Map(),
  channelByKey: new Map(),
  localOverrides: {},
  watchStats: {},
  activeColumn: 'category',
  actionButtonIndex: 0,
  categoryIndex: 0,
  channelIndex: 0,
  currentChannel: null,
  currentChannelName: null,
  currentChannelKey: null,
  currentWatchDurationSec: 0,
  hls: null,
  hlsRouteIndex: 0,
  hlsFatalRetryCount: 0,
  validViewTimer: null,
  durationTimer: null,
  lazyAutoplayTimer: null,
  lazyAutoplayChannel: null,
  userHasInteracted: false,
  hlsConnectionTimer: null,
  hlsConnectionTimedOut: false,
  stalledTimer: null,
  stalledDetected: false,
  isSwitching: false,
  isDiagnosticRunning: false,
  _diagHls: null,
  _freezeMonitorInterval: null,
  _lastCurrentTime: 0,
  _backgroundTimersActive: false,
  checkerWorker: null,
  _checkerWorkerInitialized: false,
  virtualGridDirty: true,
  visibleCardElements: [],
  cardRecyclePool: [],
  _vgStartIndex: 0,
  _vgEndIndex: 0,
  _scrollRAF: null,
  _preloadTimer: null,
  lastUserActivityTime: Date.now(),
  pendingRenderTimer: null,
  isRenderPending: false
};

// ─── DOM 元素缓存 ─────────────────────────────────────
export const els = {};

// ─── localStorage helpers ──────────────────────────────

export function getStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn('[OWL IPTV] localStorage 不可用，个性化配置与观看统计将仅在本次会话内生效。', error);
    return null;
  }
}

export function estimateStorageUsage() {
  const storage = getStorage();
  if (!storage) return 0;
  let total = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key) {
      total += (key.length + (storage.getItem(key) || '').length) * 2;
    }
  }
  return total;
}

export function pruneWatchStatsInStorage(neededBytes = 0) {
  const storage = getStorage();
  if (!storage) return;
  const currentUsage = estimateStorageUsage();
  if (currentUsage + neededBytes < STORAGE_MAX_BYTES) return;

  console.warn(`[OWL IPTV] localStorage 接近上限 (${(currentUsage / 1024 / 1024).toFixed(1)}MB)，正在清理旧统计数据...`);

  try {
    const stats = readJsonFromStorage(WATCH_STATS_KEY);
    if (stats && typeof stats === 'object') {
      const entries = Object.entries(stats);
      entries.sort((a, b) => (b[1]?.count || 0) - (a[1]?.count || 0));
      const pruned = {};
      entries.slice(0, WATCH_STATS_TRIM_TARGET).forEach(([name, stat]) => { pruned[name] = stat; });
      storage.setItem(WATCH_STATS_KEY, JSON.stringify(pruned));
      console.log(`[OWL IPTV] 已清理 watchStats (${entries.length} -> ${WATCH_STATS_TRIM_TARGET} 条)`);
    }
  } catch (e) {
    console.warn('[OWL IPTV] 清理 localStorage 时出错', e);
  }
}

export function readJsonFromStorage(key) {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[OWL IPTV] localStorage 键 ${key} 解析失败，已忽略该配置。`, error);
    return null;
  }
}

export function writeJsonToStorage(key, value) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(value);
    const neededBytes = (key.length + serialized.length) * 2;
    // Proactive LRU cleanup to prevent QuotaExceededError
    pruneWatchStatsInStorage(neededBytes);
    storage.setItem(key, serialized);
    return true;
  } catch (error) {
    console.warn(`[OWL IPTV] localStorage 键 ${key} 保存失败。`, error);
    // Emergency retry for QuotaExceededError
    if (error.name === 'QuotaExceededError' && key !== WATCH_STATS_KEY) {
      try {
        pruneWatchStatsInStorage(0); // force cleanup
        storage.setItem(key, JSON.stringify(value));
        console.log(`[OWL IPTV] 紧急清理后重试成功。`);
        return true;
      } catch (retryError) {
        console.warn(`[OWL IPTV] 紧急清理后仍保存失败。`, retryError);
      }
    }
    return false;
  }
}

// ─── localStorage overrides — channels.json always wins ─

export function loadLocalOverrides() {
  const rawOverrides = readJsonFromStorage(LOCAL_OVERRIDES_KEY);
  return normalizeLocalOverrides(rawOverrides);
}

export function normalizeLocalOverrides(value) {
  const normalized = { channels: {} };
  if (!value || typeof value !== 'object') return normalized;
  const source = value.channels && typeof value.channels === 'object'
    ? value.channels
    : value;
  Object.entries(source).forEach(([name, override]) => {
    if (!name || !override || typeof override !== 'object') return;
    const failures = Math.max(0, Number(override.failures) || 0);
    const routeOrder = normalizeRouteOrder(override.routeOrder || override.fastestRoutes || override.fastestRouteOrder);
    normalized.channels[String(name)] = {
      delay_ms: (override.delay_ms != null && typeof override.delay_ms === 'number' && override.delay_ms >= 0 && override.delay_ms < 99999)
        ? override.delay_ms : null,
      routeOrder,
      failed: Boolean(override.failed),
      failures,
      routes: normalizeRouteOverrides(override.routes),
      hidden: Boolean(override.hidden)
    };
  });
  return normalized;
}

export function normalizeRouteOverrides(routes) {
  const entries = Array.isArray(routes)
    ? routes.map((route) => (typeof route === 'string' ? { url: route } : route))
    : routes && typeof routes === 'object'
      ? Object.entries(routes).map(([url, override]) => ({ url, ...(override && typeof override === 'object' ? override : {}) }))
      : [];
  return entries.reduce((map, route) => {
    const url = route && route.url;
    if (!url) return map;
    map[String(url)] = {
      delay_ms: null,
      failed: Boolean(route.failed),
      failures: Math.max(0, Number(route.failures) || 0)
    };
    return map;
  }, {});
}

export function normalizeRouteOrder(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'number' && Number.isFinite(item)) return Math.floor(item);
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && item.url) return String(item.url);
      return null;
    })
    .filter((item) => item !== null);
}

export function saveRouteOrderToStorage(channel) {
  if (!channel || !channel.name || !channel.routes) return;
  const key = getChannelKey(channel);
  const existing = getChannelOverride(channel);
  const newRouteOrder = channel.routes.map((r) => r.url);
  state.localOverrides.channels[key] = {
    ...existing,
    delay_ms: null,
    routeOrder: newRouteOrder,
    failed: false,
    failures: 0
  };
  state.localOverrides = normalizeLocalOverrides(state.localOverrides);
  writeJsonToStorage(LOCAL_OVERRIDES_KEY, state.localOverrides);
}

// ─── Watch stats ───────────────────────────────────────

export function loadWatchStats() {
  const parsed = readJsonFromStorage(WATCH_STATS_KEY);
  const stats = {};
  const add = (key, item) => {
    if (!key || !item || typeof item !== 'object') return;
    stats[String(key)] = normalizeWatchStat(item);
  };
  if (Array.isArray(parsed)) {
    parsed.forEach((item) => add(item && (item.channelKey || item.name), item));
    return stats;
  }
  if (parsed && typeof parsed === 'object') {
    Object.entries(parsed).forEach(([key, item]) => add(key, item));
  }
  return stats;
}

export function normalizeWatchStat(item) {
  return {
    count: Math.max(0, Math.floor(Number(item.count) || 0)),
    duration_sec: Math.max(0, Number(item.duration_sec) || 0)
  };
}

export function getChannelKey(channelOrKey, fallbackName = '') {
  if (channelOrKey && typeof channelOrKey === 'object') return channelOrKey.channelKey || channelOrKey.name || fallbackName;
  return channelOrKey || fallbackName;
}

export function getChannelOverride(channelOrKey, fallbackName = '') {
  const key = getChannelKey(channelOrKey, fallbackName);
  const name = channelOrKey && typeof channelOrKey === 'object' ? channelOrKey.name : fallbackName;
  return state.localOverrides.channels[key] || (name ? state.localOverrides.channels[name] : {}) || {};
}

export function saveWatchStats() {
  // Trim watchStats to prevent unbounded growth
  const entries = Object.entries(state.watchStats);
  if (entries.length > WATCH_STATS_MAX_ENTRIES) {
    entries.sort((a, b) => (b[1]?.count || 0) - (a[1]?.count || 0));
    state.watchStats = Object.fromEntries(entries.slice(0, WATCH_STATS_TRIM_TARGET));
    console.log(`[OWL IPTV] watchStats trimmed (${entries.length} -> ${WATCH_STATS_TRIM_TARGET})`);
  }
  writeJsonToStorage(WATCH_STATS_KEY, state.watchStats);
}

export function pruneWatchStats(stats) {
  return Object.entries(stats).reduce((nextStats, [key, stat]) => {
    if (state.channelByKey.has(key)) {
      nextStats[key] = normalizeWatchStat(stat);
      return nextStats;
    }
    const matches = [...state.channelByName.values()].filter((channel) => channel.name === key);
    if (matches.length === 1) nextStats[matches[0].channelKey || key] = normalizeWatchStat(stat);
    return nextStats;
  }, {});
}

export function getOrCreateWatchStat(channelOrName) {
  const key = getChannelKey(channelOrName);
  if (!state.watchStats[key]) state.watchStats[key] = { count: 0, duration_sec: 0 };
  return state.watchStats[key];
}

export function addWatchCount(channelOrName) {
  const stat = getOrCreateWatchStat(channelOrName);
  stat.count += 1;
  saveWatchStats();
}

export function addWatchDuration(channelOrName, seconds) {
  const stat = getOrCreateWatchStat(channelOrName);
  stat.duration_sec += seconds;
  state.currentWatchDurationSec = stat.duration_sec;
  saveLastWatched(getChannelKey(channelOrName));
  saveWatchStats();
  // updateWatchDuration is called by the caller
}

export function saveLastWatched(channelName) {
  if (!channelName) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(LAST_WATCHED_KEY, channelName);
  } catch (e) { /* ignore */ }
}

// ─── User activity tracking ───────────────────────────

export function recordUserActivity() {
  state.lastUserActivityTime = Date.now();
}

export function setLastUserActivityTime(timestamp) {
  state.lastUserActivityTime = timestamp;
}

export function getLastUserActivityTime() {
  return state.lastUserActivityTime;
}

export function isUserActiveRecently() {
  return (Date.now() - state.lastUserActivityTime) < SILENT_MERGE_DELAY_MS;
}

export function clearPendingRenderTimer() {
  if (state.pendingRenderTimer) {
    window.clearTimeout(state.pendingRenderTimer);
    state.pendingRenderTimer = null;
  }
  state.isRenderPending = false;
}
