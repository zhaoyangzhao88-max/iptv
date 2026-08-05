import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map();
globalThis.window = {
  electronAPI: null,
  localStorage: {
    get length() { return storage.size; },
    key(index) { return [...storage.keys()][index] || null; },
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  setTimeout() { return { pending: true }; },
  clearTimeout() {}
};
globalThis.document = { fullscreenElement: null };

globalThis.fetch = async () => ({ ok: false, json: async () => null });

const { state } = await import(new URL('../app/modules/state.js', import.meta.url));
const {
  buildRoutesFromChannel,
  fetchAndMergeRemoteChannels,
  normalizeChannelSource,
  normalizeChannels
} = await import(new URL('../app/modules/dataLoader.js', import.meta.url));

function setStableState(channels) {
  state.localOverrides = { channels: {} };
  state.allChannels = normalizeChannelSource(channels);
  state.publicChannels = state.allChannels.slice();
  state.privateChannels = [];
  state.channels = normalizeChannels(state.allChannels);
  state.channelByName = new Map(state.channels.map((channel) => [channel.name, channel]));
  state.recommendedChannels = [];
  state.categories = [];
  state.currentChannels = [];
  state.currentChannelName = null;
  state.currentChannel = null;
  state.categoryIndex = 0;
  state.channelIndex = 0;
  state.pendingRenderTimer = null;
  state.isRenderPending = false;
}

test('route strategy changes deterministic route ordering', () => {
  const routes = [
    { url: 'http://fast.example/live.m3u8', delay_ms: 20 },
    { url: 'https://slower.example/live.m3u8', delay_ms: 200 }
  ];
  storage.set('owl_iptv_settings', JSON.stringify({ routeStrategy: 'latency-first' }));
  setStableState({ channels: [{ name: 'Strategy', urls: routes }] });
  assert.equal(state.channels[0].routes[0].url, 'http://fast.example/live.m3u8');

  storage.set('owl_iptv_settings', JSON.stringify({ routeStrategy: 'source-quality' }));
  setStableState({ channels: [{ name: 'Strategy', urls: routes }] });
  assert.equal(state.channels[0].routes[0].url, 'https://slower.example/live.m3u8');
});


test('normalization accepts string and object routes while preserving metadata', () => {
  setStableState({
    channels: [{
      name: 'CCTV-1', group: '央视频道',
      urls: ['https://one.example/live.m3u8', { url: 'https://two.example/live.m3u8', delay_ms: 88 }],
      delay_ms: 120, logo: 'https://logo.example/cctv1.png', tvg_id: 'CCTV1.cn', is_multicast: false, risk_flags: ['http']
    }]
  });
  const channel = state.channels[0];
  assert.equal(channel.name, 'CCTV-1');
  assert.equal(channel.tvg_id, 'CCTV1.cn');
  assert.equal(channel.is_multicast, false);
  assert.deepEqual(channel.risk_flags, ['http']);
  assert.equal(channel.routes.length, 2);
  assert.equal(channel.routes[0].url, 'https://two.example/live.m3u8');
  assert.equal(channel.routes[0].delay_ms, 88);
  assert.equal(channel.routes[1].url, 'https://one.example/live.m3u8');
  assert.equal(channel.routes[1].delay_ms, 120);
  assert.deepEqual(buildRoutesFromChannel(state.allChannels[0]).map((route) => route.url), ['https://two.example/live.m3u8', 'https://one.example/live.m3u8']);
});

test('loopback routes remain ordinary routes when multicast is false', () => {
  setStableState({ channels: [{ name: 'B站直播', group: '其他频道', urls: ['http://127.0.0.1:3000/api/bilibili/12345'], is_multicast: false, risk_flags: [] }] });
  const channel = state.channels[0];
  assert.equal(channel.is_multicast, false);
  assert.equal(channel.routes[0].url, 'http://127.0.0.1:3000/api/bilibili/12345');
});

test('remote merge updates known channels but keeps local-only channels', async () => {
  setStableState({ channels: [
    { name: 'Known', group: '测试', urls: ['https://old.example/live.m3u8'], tvg_id: 'old.id' },
    { name: 'Local only', group: '测试', urls: ['https://local.example/live.m3u8'] }
  ] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ channels: [
    { name: 'Known', group: '更新', urls: ['https://new.example/live.m3u8'], tvg_id: 'new.id', risk_flags: ['http'] },
    { name: 'Local only', group: '测试', urls: ['https://local.example/live.m3u8'] }
  ] }) });
  try { await fetchAndMergeRemoteChannels(); } finally { globalThis.fetch = originalFetch; state.pendingRenderTimer = null; state.isRenderPending = false; }
  assert.deepEqual(state.allChannels.map((channel) => channel.name).sort(), ['Known', 'Local only']);
  const known = state.allChannels.find((channel) => channel.name === 'Known');
  assert.equal(known.urls[0], 'https://new.example/live.m3u8');
  assert.equal(known.tvg_id, 'new.id');
  assert.deepEqual(known.risk_flags, ['http']);
});

test('remote merge keeps string delay and sparse local metadata', async () => {
  setStableState({ channels: [{ name: 'Known', group: '本地分组', urls: ['https://old.example/live.m3u8'], delay_ms: 120, logo: 'https://logo.example/known.png', tvg_id: 'known.id', risk_flags: ['http'] }] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ channels: [{ name: 'Known', urls: ['https://new.example/live.m3u8'] }] }) });
  try { await fetchAndMergeRemoteChannels(); } finally { globalThis.fetch = originalFetch; }
  const known = state.channels.find((channel) => channel.name === 'Known');
  assert.equal(known.group, '本地分组'); assert.equal(known.logo, 'https://logo.example/known.png'); assert.equal(known.tvg_id, 'known.id');
  assert.deepEqual(known.risk_flags, ['http']); assert.equal(known.routes[0].delay_ms, 120);
});

test('remote merge preserves sparse metadata after JSON round-trip', async () => {
  setStableState({ channels: [{
    name: 'Round-trip', group: '本地分组', urls: ['https://old.example/live.m3u8'],
    delay_ms: 120, logo: 'https://logo.example/round-trip.png', tvg_id: 'local.id', risk_flags: ['http']
  }] });
  const sparseRemote = normalizeChannelSource({ channels: [{
    name: 'Round-trip', urls: ['https://new.example/live.m3u8']
  }] });
  const roundTripped = JSON.parse(JSON.stringify(sparseRemote));
  assert.deepEqual(roundTripped[0].__providedFields, ['urls']);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ channels: roundTripped }) });
  try { await fetchAndMergeRemoteChannels(); } finally { globalThis.fetch = originalFetch; }

  const merged = state.allChannels.find((channel) => channel.name === 'Round-trip');
  assert.equal(merged.group, '本地分组');
  assert.equal(merged.logo, 'https://logo.example/round-trip.png');
  assert.equal(merged.tvg_id, 'local.id');
  assert.deepEqual(merged.risk_flags, ['http']);
  assert.equal(merged.urls[0], 'https://new.example/live.m3u8');
});

test('a single checker failure does not remove the only route', () => {
  state.localOverrides = {
    channels: {
      'CCTV-1': {
        routes: {
          'http://live.example/cctv.m3u8': { failed: true, failures: 1 }
        }
      }
    }
  };
  state.allChannels = normalizeChannelSource({ channels: [{
    name: 'CCTV-1', urls: ['http://live.example/cctv.m3u8']
  }] });
  state.channels = normalizeChannels(state.allChannels);
  assert.equal(state.channels.length, 1);
  assert.equal(state.channels[0].routes[0].url, 'http://live.example/cctv.m3u8');
});

test('route failures at the configured limit remove a route', () => {
  state.localOverrides = {
    channels: {
      'CCTV-1': {
        routes: {
          'http://live.example/cctv.m3u8': { failed: true, failures: 3 }
        }
      }
    }
  };
  state.allChannels = normalizeChannelSource({ channels: [{
    name: 'CCTV-1', urls: ['http://live.example/cctv.m3u8']
  }] });
  state.channels = normalizeChannels(state.allChannels);
  assert.equal(state.channels.length, 0);
});


test('malformed remote routes do not remove stable channels', async () => {
  setStableState({ channels: [{ name: 'Stable', group: '测试', urls: ['https://stable.example/live.m3u8'] }] });
  const before = JSON.stringify(state.allChannels); const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ channels: [{ name: 'Stable', urls: ['', { bad: true }] }] }) });
  try { await fetchAndMergeRemoteChannels(); } finally { globalThis.fetch = originalFetch; }
  assert.equal(JSON.stringify(state.allChannels), before);
});

test('failed or empty remote responses leave stable state unchanged', async () => {
  setStableState({ channels: [{ name: 'Stable', group: '测试', urls: ['https://stable.example/live.m3u8'] }] });
  const before = JSON.stringify(state.allChannels); const originalFetch = globalThis.fetch;
  for (const response of [{ ok: false, json: async () => null }, { ok: true, json: async () => ({ channels: [] }) }]) {
    globalThis.fetch = async () => response; await fetchAndMergeRemoteChannels(); assert.equal(JSON.stringify(state.allChannels), before);
  }
  globalThis.fetch = originalFetch;
});

test('non-empty incomplete public candidate preserves stable namespaces', async () => {
  setStableState({ channels: [1, 2, 3, 4, 5].map((n) => ({ name: `Stable ${n}`, urls: [`https://stable-${n}.example/live.m3u8`] })) });
  const beforeAll = JSON.stringify(state.allChannels); const beforePublic = JSON.stringify(state.publicChannels); const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ channels: [{ name: 'Only one', urls: ['https://candidate.example/live.m3u8'] }] }) });
  try { const result = await fetchAndMergeRemoteChannels(); assert.equal(result.ok, false); assert.equal(result.reason, 'incomplete-candidate'); } finally { globalThis.fetch = originalFetch; }
  assert.equal(JSON.stringify(state.allChannels), beforeAll); assert.equal(JSON.stringify(state.publicChannels), beforePublic);
});

test('mostly invalid remote candidate is rejected before state mutation', async () => {
  setStableState({ channels: [1, 2, 3, 4, 5].map((n) => ({ name: `Stable ${n}`, urls: [`https://stable-${n}.example/live.m3u8`] })) });
  const before = JSON.stringify(state.allChannels); const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ channels: [
    { name: 'Valid', urls: ['https://valid.example/live.m3u8'] }, { name: 'Bad 1', urls: [{ bad: true }] }, { name: 'Bad 2', urls: [''] }, { name: 'Bad 3', urls: [] }, { name: 'Bad 4', urls: [null] }
  ] }) });
  try { const result = await fetchAndMergeRemoteChannels(); assert.equal(result.ok, false); assert.equal(result.reason, 'incomplete-candidate'); } finally { globalThis.fetch = originalFetch; }
  assert.equal(JSON.stringify(state.allChannels), before);
});
