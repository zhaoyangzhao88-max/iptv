import { DATA_FALLBACK_URL, CONFIG, ROUTE_FAILURE_LIMIT,
  LOCAL_OVERRIDES_KEY, RECOMMENDATION_LIMIT, SILENT_MERGE_DELAY_MS,
  WATCH_STATS_KEY, SETTINGS_KEY } from './constants.js';
import { electronAPI } from './constants.js';
import { state, loadLocalOverrides, normalizeLocalOverrides,
  readJsonFromStorage, writeJsonToStorage,
  isUserActiveRecently } from './state.js';
import { computeTopRecommendations, prepareRecommendations } from './recommend.js';

// ─── Data loading ──────────────────────────────────────

export async function loadChannels() {
  const nodeLoadedChannels = await loadChannelsFromNode();
  if (nodeLoadedChannels) return nodeLoadedChannels;
  return loadChannelsFromFetch();
}

async function loadChannelsFromNode() {
  if (!electronAPI) return null;
  try {
    const raw = await electronAPI.readPublicSnapshot();
    return normalizeChannelSource(JSON.parse(raw));
  } catch (error) {
    console.warn('[OWL IPTV] Node 读取 data/channels.json 失败，将尝试 fetch 降级。', error);
    return null;
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
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function makeSourceId(value = 'public') {
  const sourceId = String(value || 'public').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return sourceId || 'public';
}

export function makeChannelKey(sourceId, name) {
  return `${makeSourceId(sourceId)}:${String(name || '').trim().toLowerCase()}`;
}

function hasUsableRoute(route) {
  const rawUrl = typeof route === 'string' ? route : route && route.url;
  return typeof rawUrl === 'string' && rawUrl.trim().length > 0;
}

function selectRouteSource(channel) {
  if (Array.isArray(channel.urls) && channel.urls.some(hasUsableRoute)) {
    return { key: 'urls', routes: channel.urls };
  }
  if (Array.isArray(channel.routes) && channel.routes.some(hasUsableRoute)) {
    return { key: 'routes', routes: channel.routes };
  }
  if (typeof channel.url === 'string' && channel.url.trim()) {
    return { key: 'url', routes: [{ url: channel.url, delay_ms: channel.delay_ms }] };
  }
  return { key: null, routes: undefined };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function normalizeChannelSource(data, sourceId = 'public') {
  const envelope = data && !Array.isArray(data) ? data : null;
  const resolvedSourceId = makeSourceId(envelope && envelope.sourceId ? envelope.sourceId : sourceId);
  const source = Array.isArray(data) ? data : envelope && Array.isArray(envelope.channels) ? envelope.channels : [];
  return source
    .filter((channel) => channel && typeof channel === 'object')
    .map((channel) => {
      const routeSource = selectRouteSource(channel);
      const channelSourceId = makeSourceId(channel.sourceId || resolvedSourceId);
      const channelName = String(channel.name || channel.title || '').trim();
      const normalized = {
        name: channelName,
        sourceId: channelSourceId,
        channelKey: String(channel.channelKey || makeChannelKey(channelSourceId, channelName)),
        group: String(channel.group || '未分组').trim() || '未分组',
        urls: routeSource.routes,
        url: String(channel.url || '').trim() || undefined,
        delay_ms: toFiniteNumber(channel.delay_ms),
        logo: channel.logo ? String(channel.logo).trim() : undefined,
        tvg_id: channel.tvg_id ? String(channel.tvg_id).trim() : undefined,
        epg_id: channel.epg_id ? String(channel.epg_id).trim() : undefined,
        is_multicast: Boolean(channel.is_multicast),
        risk_flags: Array.isArray(channel.risk_flags) ? channel.risk_flags.map(String) : [],
        source_tier: toFiniteNumber(channel.source_tier),
        last_verified: channel.last_verified ? String(channel.last_verified).trim() : undefined
      };
      const providedFieldNames = Array.isArray(channel.__providedFields)
        ? channel.__providedFields.filter((field) => typeof field === 'string')
        : [
          'group', 'delay_ms', 'logo', 'tvg_id', 'epg_id', 'is_multicast',
          'risk_flags', 'source_tier', 'last_verified'
        ].filter((field) => hasOwn(channel, field));
      const providedFields = new Set(providedFieldNames);
      if (routeSource.key) providedFields.add('urls');
      if (typeof channel.url === 'string' && channel.url.trim()) providedFields.add('url');
      normalized.__providedFields = [...providedFields];
      return normalized;
    })
    .filter((channel) => {
      if (isGarbageChannelName(channel.name)) return false;
      if (!Array.isArray(channel.urls) || !channel.urls.some(hasUsableRoute)) return false;
      return true;
    });
}

export function normalizeChannels(data) {
  return (Array.isArray(data) ? data : []).map((channel) => normalizeChannel(channel)).filter(Boolean);
}

function normalizeChannel(channel) {
  if (!channel || typeof channel !== 'object') return null;
  const name = String(channel.name || '').trim();
  const group = String(channel.group || '未分组').trim() || '未分组';
  const overrides = state.localOverrides && state.localOverrides.channels
    ? state.localOverrides.channels
    : {};
  const override = overrides[name] || {};
  if (!name || override.failed || override.failures >= ROUTE_FAILURE_LIMIT || override.hidden) return null;
  const routes = normalizeRoutes(channel, override);
  if (routes.length === 0) return null;
  const delayMs = toFiniteNumber(routes[0].delay_ms) ?? toFiniteNumber(channel.delay_ms) ?? 0;
  return {
    name,
    group,
    sourceId: makeSourceId(channel.sourceId || 'public'),
    channelKey: channel.channelKey || makeChannelKey(channel.sourceId || 'public', name),
    url: routes[0].url,
    routes,
    delay_ms: delayMs,
    logo: channel.logo,
    tvg_id: channel.tvg_id,
    epg_id: channel.epg_id,
    is_multicast: Boolean(channel.is_multicast),
    risk_flags: Array.isArray(channel.risk_flags) ? channel.risk_flags.slice() : [],
    source_tier: toFiniteNumber(channel.source_tier),
    last_verified: channel.last_verified,
    failed: false,
    failures: 0
  };
}

function normalizeRoutes(channel, override = {}) {
  const rawRoutes = Array.isArray(channel.urls) && channel.urls.length > 0
    ? channel.urls
    : channel.url
      ? [{ url: channel.url, delay_ms: channel.delay_ms }]
      : [];
  const routes = rawRoutes
    .map((route, index) => normalizeRoute(route, index, channel, override))
    .filter(Boolean);
  if (routes.length === 0) return [];
  const settings = readJsonFromStorage(SETTINGS_KEY) || {};
  return sortRoutes(routes, override.routeOrder, settings.routeStrategy);
}

function normalizeRoute(route, index, channel, override = {}) {
  const rawUrl = typeof route === 'string' ? route : route && route.url;
  const url = String(rawUrl || '').trim();
  if (!url) return null;
  const routeOverride = override.routes ? override.routes[url] : null;
  const routeFailed = Boolean(routeOverride && routeOverride.failures >= ROUTE_FAILURE_LIMIT);
  if (routeFailed) return null;
  const routeDelay = typeof route === 'object' ? route.delay_ms : undefined;
  const delayMs = toFiniteNumber(routeDelay) ?? toFiniteNumber(channel.delay_ms) ?? 0;
  return { url, index, delay_ms: delayMs, failures: routeOverride ? routeOverride.failures : 0 };
}

function sortRoutes(routes, routeOrder, routeStrategy = 'latency-first') {
  const orderIndex = new Map((routeOrder || []).map((item, index) => [item, index]));
  return routes.sort((left, right) => {
    const leftOrder = getOrderIndex(orderIndex, left.url, left.index);
    const rightOrder = getOrderIndex(orderIndex, right.url, right.index);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (routeStrategy === 'source-quality') {
      const leftQuality = getSourceQuality(left);
      const rightQuality = getSourceQuality(right);
      if (leftQuality !== rightQuality) return rightQuality - leftQuality;
    }
    return left.delay_ms - right.delay_ms || left.index - right.index;
  });
}

function getSourceQuality(route) {
  let score = 0;
  try {
    const parsed = new URL(route.url);
    if (parsed.protocol === 'https:') score += 2;
  } catch {}
  if (route.failures === 0) score += 1;
  return score;
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

export function parseM3UText(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim());
  const channels = [];
  let pending = null;
  lines.forEach((line) => {
    if (!line || /^#EXTM3U/i.test(line)) return;
    if (/^#EXTINF/i.test(line)) {
      const [, attributes = '', rawName = ''] = line.match(/^#EXTINF:-?\d+(?:\s+([^,]*))?,(.*)$/i) || [];
      const name = rawName.trim();
      if (!name || isGarbageChannelName(name)) return;
      const groupMatch = attributes.match(/group-title="([^"]*)"/i);
      const logoMatch = attributes.match(/tvg-logo="([^"]*)"/i);
      pending = { name, group: groupMatch?.[1]?.trim() || '未分组', logo: logoMatch?.[1]?.trim() || undefined };
      return;
    }
    if (!line.startsWith('#') && pending) {
      channels.push({ ...pending, url: line });
      pending = null;
    }
  });
  return normalizeChannelSource(channels, makeSourceId('private-' + text.slice(0, 12)));
}

export function setSourceEnabled(sourceId, enabled) {
  const id = makeSourceId(sourceId);
  const source = state.privateSources.find((item) => item.sourceId === id);
  if (!source) return false;
  source.enabled = Boolean(enabled);
  state.sourceStatus[id] = { ...(state.sourceStatus[id] || {}), sourceId: id, enabled: source.enabled };
  state.privateChannels = state.privateSources.filter((item) => item.enabled !== false).flatMap((item) => item.channels);
  state.allChannels = [...state.publicChannels, ...state.privateChannels];
  state.channels = normalizeChannels(state.allChannels);
  state.channelByName = new Map(state.channels.map((channel) => [channel.name, channel]));
  state.channelByKey = new Map(state.channels.map((channel) => [channel.channelKey, channel]));
  state.categories = buildCategories();
  return true;
}

export async function fetchAndMergeRemoteChannels(sourceUrl) {
  const url = String(sourceUrl || CONFIG.remote_json_url).trim() || CONFIG.remote_json_url;
  let remoteData = null;
  try {
    if (typeof fetch === 'function') {
      const resp = await fetch(url, { cache: 'no-cache' });
      if (resp.ok) {
        const contentType = resp.headers?.get?.('content-type') || '';
        const raw = contentType.includes('json') || typeof resp.text !== 'function'
          ? await resp.json()
          : await resp.text();
        remoteData = typeof raw === 'string' ? parseM3UText(raw) : raw;
      }
    }
  } catch (err) {
    console.warn('[OWL IPTV] 云端数据拉取失败，跳过本次静默更新。', err);
    return { ok: false, count: 0 };
  }
  if (!remoteData) return { ok: false, count: 0 };

  const remoteNormalized = Array.isArray(remoteData) && typeof remoteData[0] === 'object'
    ? normalizeChannelSource(remoteData)
    : normalizeChannelSource(remoteData);
  if (remoteNormalized.length === 0) return { ok: false, count: 0 };

  const isPrivateSource = Boolean(sourceUrl && String(sourceUrl).trim() && String(sourceUrl).trim() !== CONFIG.remote_json_url);
  if (!isPrivateSource) {
    const stablePublicCount = Array.isArray(state.publicChannels) && state.publicChannels.length > 0
      ? state.publicChannels.length
      : state.allChannels.filter((channel) => !channel.sourceId || makeSourceId(channel.sourceId) === 'public').length;
    const minimumCandidateCount = stablePublicCount > 0
      ? Math.max(1, Math.ceil(stablePublicCount * 0.8))
      : 1;
    if (remoteNormalized.length < minimumCandidateCount) {
      console.warn(`[OWL IPTV] 云端候选数据不完整 (${remoteNormalized.length}/${stablePublicCount})，保留稳定频道列表。`);
      return { ok: false, count: 0, reason: 'incomplete-candidate' };
    }
  }

  if (isPrivateSource) {
    const sourceId = makeSourceId(url);
    const existing = state.privateSources.filter((source) => source.sourceId !== sourceId);
    state.privateSources = [...existing, { sourceId, url, enabled: true, channels: remoteNormalized }];
    state.privateChannels = state.privateSources.filter((source) => source.enabled !== false).flatMap((source) => source.channels);
    state.sourceStatus[sourceId] = { sourceId, url, enabled: true };
    const combined = new Map(state.publicChannels.map((channel) => [channel.channelKey, channel]));
    state.privateChannels.forEach((channel) => combined.set(channel.channelKey, channel));
    state.allChannels = Array.from(combined.values());
    state.channels = normalizeChannels(state.allChannels);
    state.channelByName = new Map(state.channels.map((channel) => [channel.name, channel]));
    state.channelByKey = new Map(state.channels.map((channel) => [channel.channelKey, channel]));
    state.recommendedChannels = computeTopRecommendations(RECOMMENDATION_LIMIT);
    state.categories = buildCategories();
    state.categoryIndex = Math.min(state.categoryIndex, Math.max(0, state.categories.length - 1));
    scheduleIdleRender();
    return { ok: true, count: remoteNormalized.length, private: true };
  }

  state.publicChannels = remoteNormalized;
  state.privateChannels = state.privateSources.filter((source) => source.enabled !== false).flatMap((source) => source.channels);
  const remoteMap = new Map();
  state.sourceStatus.public = { sourceId: 'public', enabled: true, url: CONFIG.remote_json_url };
  state.publicChannels.forEach((ch) => { remoteMap.set(ch.name, ch); });
  if (remoteMap.size === 0) return { ok: false, count: 0 };

  const currentMap = new Map();
  state.allChannels.forEach((ch) => { currentMap.set(ch.name, ch); });
  const playingName = state.currentChannelName;
  let playingChannelUpdated = false;

  remoteMap.forEach((remoteCh, name) => {
    const existing = currentMap.get(name);
    if (!existing) {
      currentMap.set(name, remoteCh);
      return;
    }
    const providedFields = remoteCh.__providedFields || new Set(['urls']);
    const mergedChannel = { ...existing };
    for (const field of providedFields) {
      if (field === 'urls' && (!Array.isArray(remoteCh.urls) || !remoteCh.urls.some(hasUsableRoute))) continue;
      if (field === 'url' && (!remoteCh.url || !String(remoteCh.url).trim())) continue;
      if (remoteCh[field] !== undefined && remoteCh[field] !== null) mergedChannel[field] = remoteCh[field];
    }
    currentMap.set(name, mergedChannel);
    if (name === playingName) {
      const playingChannel = state.channelByName.get(name);
      const freshRoutes = buildRoutesFromChannel(mergedChannel);
      if (playingChannel && freshRoutes.length > 0) {
        playingChannel.routes = freshRoutes;
        playingChannel.url = freshRoutes[0].url;
        if (state.currentChannel && state.currentChannel.name === name) {
          state.currentChannel.routes = freshRoutes;
          state.currentChannel.url = freshRoutes[0].url;
        }
        playingChannelUpdated = true;
      }
    }
  });

  state.allChannels = [...Array.from(currentMap.values()), ...state.privateChannels];
  if (playingChannelUpdated && playingName) {
    const updated = state.allChannels.find((channel) => channel.name === playingName);
    if (updated) state.currentChannel = { ...updated, routes: buildRoutesFromChannel(updated) };
  }
  state.channels = normalizeChannels(state.allChannels);
  state.channelByName = new Map(state.channels.map((ch) => [ch.name, ch]));
  state.recommendedChannels = computeTopRecommendations(RECOMMENDATION_LIMIT);
  state.categories = buildCategories();
  state.categoryIndex = Math.min(state.categoryIndex, Math.max(0, state.categories.length - 1));
  scheduleIdleRender();
  return { ok: true, count: remoteNormalized.length, private: false };
}

export function buildRoutesFromChannel(channel) {
  if (!channel || typeof channel !== 'object') return [];
  return normalizeRoutes(channel, {}).sort((a, b) => a.delay_ms - b.delay_ms || a.index - b.index);
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
  state.channelByKey = new Map(state.channels.map((channel) => [channel.channelKey, channel]));
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
  if (state.isRenderPending) return;
  state.isRenderPending = true;
  const tryRender = () => {
    if (isUserActiveRecently() || isVideoFullscreen()) {
      state.pendingRenderTimer = window.setTimeout(tryRender, 500);
      return;
    }
    state.isRenderPending = false;
    state.pendingRenderTimer = null;
    // imports full virtualGrid at runtime to avoid circular deps
    import('./virtualGrid.js').then(vg => vg.renderChannels());
  };
  if (state.pendingRenderTimer) {
    window.clearTimeout(state.pendingRenderTimer);
  }
  state.pendingRenderTimer = window.setTimeout(tryRender, SILENT_MERGE_DELAY_MS);
}
