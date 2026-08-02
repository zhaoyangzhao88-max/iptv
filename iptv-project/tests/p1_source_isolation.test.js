import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, key: () => null } };
const { state } = await import('../app/modules/state.js');
const { makeSourceId, makeChannelKey, normalizeChannelSource, setSourceEnabled } = await import('../app/modules/dataLoader.js');

test('source ids and channel keys are stable and source-aware', () => {
  assert.equal(makeSourceId('https://example.test/a.m3u'), makeSourceId('https://example.test/a.m3u'));
  assert.notEqual(makeChannelKey('source-a', 'CCTV-1'), makeChannelKey('source-b', 'CCTV-1'));
  const channels = normalizeChannelSource({ sourceId: 'source-a', channels: [{ name: 'CCTV-1', urls: ['https://a.test/live'] }] });
  assert.equal(channels[0].sourceId, 'source-a');
  assert.equal(channels[0].channelKey, makeChannelKey('source-a', 'CCTV-1'));
});

test('private source enablement is isolated from public data', () => {
  state.publicChannels = [{ name: 'CCTV-1', sourceId: 'public', channelKey: makeChannelKey('public', 'CCTV-1'), urls: ['https://public.test/live'] }];
  state.privateSources = [{ sourceId: 'private-a', enabled: true, channels: normalizeChannelSource({ sourceId: 'private-a', channels: [{ name: 'CCTV-1', urls: ['https://private.test/live'] }] }) }];
  state.privateChannels = state.privateSources[0].channels;
  state.allChannels = [...state.publicChannels, ...state.privateChannels];
  state.localOverrides = { channels: {} };
  assert.equal(setSourceEnabled('private-a', false), true);
  assert.equal(state.allChannels.length, 1);
  assert.equal(state.allChannels[0].sourceId, 'public');
  assert.equal(setSourceEnabled('private-a', true), true);
  assert.equal(state.allChannels.length, 2);
});
