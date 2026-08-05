const assert = require('node:assert/strict');
const test = require('node:test');
const { resolve: resolveBilibili } = require('../src/resolvers/bilibili.js');
const { resolve: resolveDouyin } = require('../src/resolvers/douyin.js');
const { resolve: resolveKuaishou } = require('../src/resolvers/kuaishou.js');
const { withCache } = require('../src/resolvers/cache.js');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; }, async text() { return body; } };
}

const cases = [
  {
    name: 'bilibili',
    resolve: resolveBilibili,
    body: { code: 0, data: { durl: [{ url: 'https://cdn.example/live.m3u8?token=secret' }] } },
  },
  {
    name: 'douyin',
    resolve: resolveDouyin,
    body: 'window.__INIT_STATE__ = {"roomStore":{"roomInfo":{"room":{"streamUrl":"https://cdn.example/live.flv?signature=secret"}}}};',
  },
  {
    name: 'kuaishou',
    resolve: resolveKuaishou,
    body: 'window.__INITIAL_STATE__ = {"liveStream":{"playUrls":[{"url":"https://cdn.example/live.m3u8?auth=secret"}]}};',
  },
];

for (const item of cases) {
  test(`${item.name} resolver accepts injectable fixture client`, async () => {
    let requestedUrl = '';
    const result = await item.resolve('room-123', {
      fetchImpl: async (url) => {
        requestedUrl = url;
        return jsonResponse(item.body);
      },
      timeoutMs: 50,
    });
    assert.equal(result.platform, item.name);
    assert.equal(result.fallback, false);
    assert.match(result.realUrl, /^https:\/\/cdn\.example\//);
    assert.match(requestedUrl, /^https:\/\//);
  });

  test(`${item.name} resolver fails closed on fixture errors and schema changes`, async () => {
    const result = await item.resolve('room-123', {
      fetchImpl: async () => { throw new Error('upstream timeout token=secret'); },
      timeoutMs: 1,
    });
    assert.equal(result.platform, item.name);
    assert.equal(result.fallback, true);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  });
}

test('resolver cache coalesces success but does not cache fallback', async () => {
  let calls = 0;
  const cached = withCache(async () => {
    calls += 1;
    return calls === 1 ? { realUrl: 'https://cdn.example/live.m3u8' } : { fallback: true };
  }, { ttlMs: 10_000, maxEntries: 4 });
  const [one, two] = await Promise.all([cached('room'), cached('room')]);
  assert.deepEqual(one, two);
  assert.equal(calls, 1);
  await cached('fallback');
  await cached('fallback');
  assert.equal(calls, 3);
  assert.equal(cached.cacheSize(), 1);
});
