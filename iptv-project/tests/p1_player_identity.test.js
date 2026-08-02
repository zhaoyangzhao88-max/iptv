import assert from 'node:assert/strict';
import test from 'node:test';

test('source-aware channel keys stay distinct for same display name', () => {
  const key = (source, name) => `${source}:${name.toLowerCase()}`;
  assert.notEqual(key('public', 'CCTV-1'), key('private-a', 'CCTV-1'));
});
