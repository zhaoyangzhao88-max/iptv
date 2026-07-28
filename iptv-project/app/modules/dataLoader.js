import { DATA_FALLBACK_URL, CONFIG, ROUTE_FAILURE_LIMIT,
  LOCAL_OVERRIDES_KEY, RECOMMENDATION_LIMIT, SILENT_MERGE_DELAY_MS,
  WATCH_STATS_KEY } from './constants.js';
import { electronAPI } from './constants.js';
import { state, loadLocalOverrides, normalizeLocalOverrides,
  readJsonFromStorage, writeJsonToStorage,
  isUserActiveRecently, isRenderPending, pendingRenderTimer,
  recordUserActivity, lastUserActivityTime } from './state.js';
import { computeTopRecommendations, prepareRecommendations } from './recommend.js';

// ─── Data loading ──────────────────────────────────────

export async function loadChannels() {
  const nodeLoadedChannels = await loadChannelsFromNode();
  if (nodeLoadedChannels) return nodeLoadedChannels;
  return loadChannelsFromFetch();
}

function loadChannelsFromNode() {
  if (!electronAPI) return Promise.resolve(null);
  try {
    const dataPath = electronAPI.pathJoin(electronAPI.getAppPath(), 'app', '..', 'data', 'channels.json');
    const raw = electronAPI.readFile(dataPath);
    return Promise.resolve(normalizeChannelSource(JSON.parse(raw)));
  } catch (error) {
    console.warn('[OWL IPTV] Node 读取 data/channels.json 失败，将尝试 fetch 降级。', error);
    return Promise.resolve(null);
  }
}

async function loadChannelsFromFetch() {
  try {
    const response = await fetch(DATA_FALLBACK_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return normalizeChannelSource(await response.json());
  } catch (error) {
    console.error('[OWL IPTV] 数据加载失败：', error);
    return [];
  }
}

// ─── Channel normalization — channels.json delay_ms always wins ────────

export function isGarbageChannelName(name) {
  if (!name) return true;
  const trimmed = String(name).trim();
  if (!trimmed) return true;
  if (trimmed.includes('#')) return true;
  if (/^#EXT/i.test(trimmed)) return true;
  if (/^EXTINF/i.test(trimmed)) return true;
  if (!/[一-龥a-zA-Z0-9]/.test(trimmed)) return true;
  return false;
}

export function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeChannelSource(data) {
  const source = Array.isArray(data) ? data : data && Array.isArray(data.channels) ? data.channels : [];
  return source
    .filter((channel) => channel && typeof channel === 'object')
    .map((channel) => ({
      name: String(channel.name || '').trim(),
      group: String(channel.group || '未分组').trim() || '未分组',
      urls: Array.isArray(channel.urls) ? channel.urls : undefined,
      url: String(channel.url || '').trim() || undefined,
      delay_ms: toFiniteNumber(channel.delay_ms),
      logo: channel.logo ? String(channel.logo).trim() : undefined
    }))
    .filter((channel) => {
      if (isGarbageChannelName(channel.name)) return false;
      if (!((channel.urls && channel.urls.length > 0) || channel.url)) return false;
      return true;
    });
}

export function normalizeChannels(data) {
  return data.map((channel) => normalizeChannel(channel)).filter(Boolean);
}

function normalizeChannel(channel) {
  if (!channel || typeof channel !== 'object') return null;
  const name = String(channel.name || '').trim();
  const group = String(channel.group || '未分组').trim() || '未分组';
  const override = state.localOverrides.channels[name] || {};
  if (!name || override.failed || override.failures >= ROUTE_FAILURE_LIMIT || override.hidden) return null;
  const routes = normalizeRoutes(channel, override);
  if (routes.length === 0) return null;
  const delayMs = toFiniteNumber(routes[0].delay_ms) ?? toFiniteNumber(channel.delay_ms) ?? 0;
  return { name, group, url: routes[0].url, routes, delay_ms: delayMs, failed: false, failures: 0 };
}

function normalizeRoutes(channel, override) {
  const rawRoutes = Array.isArray(channel.urls) && channel.urls.length > 0
    ? channel.urls
    : channel.url
      ? [{ url: channel.url, delay_ms: channel.delay_ms }]
      : [];
  const routes = rawRoutes
    .map((route, index) => normalizeRoute(route, index, channel, override))
    .filter(Boolean);
  if (routes.length === 0) return [];
  return sortRoutes(routes, override.routeOrder);
}

function normalizeRoute(route, index, channel, override) {
  if (!route || typeof route !== 'object') return null;
  const url = String(route.url || '').trim();
  if (!url) return null;
  const routeOverride = override.routes ? override.routes[url] : null;
  const routeFailed = Boolean(routeOverride && (routeOverride.failed || routeOverride.failures >= ROUTE_FAILURE_LIMIT));
  if (routeFailed) return null;
  const delayMs = toFiniteNumber(route.delay_ms) ?? toFiniteNumber(channel.delay_ms) ?? 0;
  return { url, index, delay_ms: delayMs, failures: routeOverride ? routeOverride.failures : 0 };
}

function sortRoutes(routes, routeOrder) {
  if (!routeOrder || routeOrder.length === 0) {
    return routes.sort((left, right) => left.delay_ms - right.delay_ms || left.index - right.index);
  }
  const orderIndex = new Map(routeOrder.map((item, index) => [item, index]));
  return routes.sort((left, right) => {
    const leftOrder = getOrderIndex(orderIndex, left.url, left.index);
    const rightOrder = getOrderIndex(orderIndex, right.url, right.index);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.delay_ms - right.delay_ms || left.index - right.index;
  });
}

function getOrderIndex(orderIndex, url, index) {
  if (orderIndex.has(url)) return orderIndex.get(url);
  if (orderIndex.has(index)) return orderIndex.get(index);
  return Number.MAX_SAFE_INTEGER;
}

// ─── Categories ────────────────────────────────────────

export function buildCategories() {
  const groups = new Map();
  state.channels.forEach((channel) => {
    const group = channel.group || '未分组';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(channel);
  });
  const categories = [];
  if (state.recommendedChannels.length > 0) {
    categories.push({ key: 'recommended', label: '★ 常用推荐', channels: state.recommendedChannels });
  }
  categories.push({ key: 'all', label: '全部频道', channels: state.channels });
  groups.forEach((channels, groupName) => {
    categories.push({ key: groupName, label: groupName, channels });
  });
  return categories;
}

export function getInitialCategoryIndex() {
  if (state.recommendedChannels.length > 0) return 0;
  const allIndex = state.categories.findIndex((category) => category.key === 'all');
  return allIndex >= 0 ? allIndex : 0;
}

// ─── Remote merge (第 7 课：云端静默数据合并) ──────────

export async function fetchAndMergeRemoteChannels() {
  let remoteData = null;
  try {
    if (typeof fetch === 'function') {
      const resp = await fetch(CONFIG.remote_json_url, { cache: 'no-cache' });
      if (resp.ok) {
        remoteData = await resp.json();
      }
    }
  } catch (err) {
    console.warn('[OWL IPTV] 云端数据拉取失败，跳过本次静默更新。', err);
    return;
  }
  if (!remoteData) return;

  const remoteNormalized = normalizeChannelSource(remoteData);
  if (remoteNormalized.length === 0) return;

  const remoteMap = new Map();
  remoteNormalized.forEach((ch) => { remoteMap.set(ch.name, ch); });

  const currentMap = new Map();
  state.allChannels.forEach((ch) => { currentMap.set(ch.name, ch); });

  const playingName = state.currentChannelName;
  let playingChannelUpdated = false;

  remoteMap.forEach((remoteCh, name) => {
    const existing = currentMap.get(name);
    if (existing) {
      if (remoteCh.urls && remoteCh.urls.length > 0) existing.urls = remoteCh.urls;
      if (remoteCh.url && !existing.urls) existing.url = remoteCh.url;
      if (remoteCh.delay_ms != null) existing.delay_ms = remoteCh.delay_ms;
      if (remoteCh.logo != null) existing.logo = remoteCh.logo;
      if (name === playingName) {
        const playingChannel = state.channelByName.get(name);
        if (playingChannel) {
          const freshRoutes = buildRoutesFromChannel(remoteCh);
          if (freshRoutes.length > 0) {
            playingChannel.routes = freshRoutes;
            playingChannel.url = freshRoutes[0].url;
            if (state.currentChannel && state.currentChannel.name === name) {
              state.currentChannel.routes = freshRoutes;
              state.currentChannel.url = freshRoutes[0].url;
            }
            playingChannelUpdated = true;
          }
        }
      }
    } else {
      currentMap.set(name, remoteCh);
    }
  });

  const toDelete = [];
  currentMap.forEach((_, name) => { if (!remoteMap.has(name)) toDelete.push(name); });
  toDelete.forEach((name) => { currentMap.delete(name); });

  state.allChannels = Array.from(currentMap.values());
  state.channels = normalizeChannels(state.allChannels);
  state.channelByName = new Map(state.channels.map((ch) => [ch.name, ch]));
  state.recommendedChannels = computeTopRecommendations(RECOMMENDATION_LIMIT);
  state.categories = buildCategories();
  state.categoryIndex = Math.min(state.categoryIndex, Math.max(0, state.categories.length - 1));
  if (state.channelIndex >= state.currentChannels.length) {
    state.channelIndex = Math.max(0, state.currentChannels.length - 1);
  }

  if (playingChannelUpdated && playingName) {
    const updated = state.channelByName.get(playingName);
    if (updated) {
      state.currentChannel = { ...updated, routes: updated.routes, url: updated.url };
    }
  }

  scheduleIdleRender();
}

export function buildRoutesFromChannel(channel) {
  const rawRoutes = Array.isArray(channel.urls) && channel.urls.length > 0
    ? channel.urls
    : channel.url
      ? [{ url: channel.url, delay_ms: channel.delay_ms }]
      : [];
  return rawRoutes
    .map((route, index) => {
      if (!route || typeof route === 'object' && !route.url) return null;
      const url = typeof route === 'string' ? route : String(route.url || '').trim();
      if (!url) return null;
      const delayMs = toFiniteNumber(typeof route === 'object' ? route.delay_ms : null)
        ?? toFiniteNumber(channel.delay_ms)
        ?? 0;
      return { url, index, delay_ms: delayMs, failures: 0 };
    })
    .filter(Boolean)
    .sort((a, b) => a.delay_ms - b.delay_ms || a.index - b.index);
}

// ─── Filter reset and overrides ────────────────────────

export function resetLocalFilters() {
  const overrides = loadLocalFiltersFromStorage();
  let resetCount = 0;
  Object.keys(overrides.channels || {}).forEach((name) => {
    const ch = overrides.channels[name];
    if (ch && ch.hidden === true) {
      overrides.channels[name] = { ...ch, hidden: false };
      resetCount++;
    }
  });
  state.localOverrides = normalizeLocalOverrides(overrides);
  writeJsonToStorage(LOCAL_OVERRIDES_KEY, state.localOverrides);
  state.channels = normalizeChannels(state.allChannels);
  prepareRecommendations();
  state.categories = buildCategories();
  state.categoryIndex = Math.min(state.categoryIndex, state.categories.length - 1);
  state.channelIndex = 0;
  // Re-render handled by caller
  console.log(`[OWL IPTV] 已重置 ${resetCount} 个频道的 hidden 标记。`);
}

export function loadLocalFiltersFromStorage() {
  const rawOverrides = readJsonFromStorage(LOCAL_OVERRIDES_KEY);
  return normalizeLocalOverrides(rawOverrides);
}

export function updateChannelOverrides(name, override) {
  const channelName = String(name || '');
  if (!channelName || !state.channelByName.has(channelName)) return false;
  const existingOverride = state.localOverrides.channels[channelName] || {};
  const incomingRoutes = override && override.routes && typeof override.routes === 'object' ? override.routes : {};
  const existingRoutes = existingOverride.routes && typeof existingOverride.routes === 'object' ? existingOverride.routes : {};
  state.localOverrides.channels[channelName] = {
    ...existingOverride,
    delay_ms: null,
    ...(override && typeof override === 'object' ? override : {}),
    routes: { ...existingRoutes, ...incomingRoutes }
  };
  state.localOverrides = normalizeLocalOverrides(state.localOverrides);
  state.channels = normalizeChannels(state.allChannels);
  state.channelByName = new Map(state.channels.map((channel) => [channel.name, channel]));
  state.recommendedChannels = computeTopRecommendations(RECOMMENDATION_LIMIT);
  state.categories = buildCategories();
  state.categoryIndex = Math.min(state.categoryIndex, state.categories.length - 1);
  state.channelIndex = 0;
  writeJsonToStorage(LOCAL_OVERRIDES_KEY, state.localOverrides);
  return true;
}

export function markChannelFailed(name, failed = true) {
  return updateChannelOverrides(name, {
    failed,
    failures: failed ? ROUTE_FAILURE_LIMIT : 0
  });
}

// ─── Idle render scheduling ────────────────────────────

export function isVideoFullscreen() {
  return !!document.fullscreenElement;
}

export function scheduleIdleRender() {
  if (isRenderPending) return;
  isRenderPending = true;
  const tryRender = () => {
    if (isUserActiveRecently() || isVideoFullscreen()) {
      pendingRenderTimer = window.setTimeout(tryRender, 500);
      return;
    }
    isRenderPending = false;
    pendingRenderTimer = null;
    // imports full virtualGrid at runtime to avoid circular deps
    import('./virtualGrid.js').then(vg => vg.renderChannels());
  };
  if (pendingRenderTimer) {
    window.clearTimeout(pendingRenderTimer);
  }
  pendingRenderTimer = window.setTimeout(tryRender, SILENT_MERGE_DELAY_MS);
}
