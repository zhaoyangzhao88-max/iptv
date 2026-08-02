/** Focused tests for bounded TTL cache behavior. */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { withCache } = require("../src/resolvers/cache.js");

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

describe("resolver cache", () => {
    it("coalesces concurrent requests for the same key", async () => {
        const gate = deferred();
        let calls = 0;
        const cachedResolve = withCache(async (roomId) => {
            calls += 1;
            await gate.promise;
            return { roomId, platform: "bilibili", realUrl: "https://streams.example/live.m3u8" };
        }, { ttlMs: 1000, maxEntries: 4 });

        const first = cachedResolve("room");
        const second = cachedResolve("room");
        assert.equal(calls, 1);
        assert.equal(cachedResolve.pendingSize(), 1);

        gate.resolve();
        assert.deepEqual(await Promise.all([first, second]), [
            { roomId: "room", platform: "bilibili", realUrl: "https://streams.example/live.m3u8" },
            { roomId: "room", platform: "bilibili", realUrl: "https://streams.example/live.m3u8" },
        ]);
        assert.equal(cachedResolve.pendingSize(), 0);
        assert.equal(cachedResolve.cacheSize(), 1);
        await cachedResolve("room");
        assert.equal(calls, 1);
    });

    it("expires entries after TTL and does not cache null/fallback failures", async () => {
        let now = 1000;
        let calls = 0;
        const cachedResolve = withCache(async (roomId) => {
            calls += 1;
            if (roomId === "missing") return null;
            if (roomId === "offline") return { roomId, platform: "bilibili", fallback: true };
            return { roomId, platform: "bilibili", realUrl: "https://streams.example/live.m3u8" };
        }, { ttlMs: 100, maxEntries: 4, now: () => now });

        await cachedResolve("room");
        await cachedResolve("room");
        assert.equal(calls, 1);

        now = 1100;
        await cachedResolve("room");
        assert.equal(calls, 2);

        await cachedResolve("missing");
        await cachedResolve("missing");
        await cachedResolve("offline");
        await cachedResolve("offline");
        assert.equal(calls, 6);
        assert.equal(cachedResolve.cacheSize(), 1);
    });

    it("evicts the least-recently-used entry at capacity", async () => {
        let calls = 0;
        const cachedResolve = withCache(async (roomId) => {
            calls += 1;
            return { roomId, platform: "bilibili", realUrl: "https://streams.example/live.m3u8" };
        }, { ttlMs: 1000, maxEntries: 2 });

        await cachedResolve("one");
        await cachedResolve("two");
        await cachedResolve("one"); // make one most recently used
        await cachedResolve("three"); // evicts two
        assert.equal(cachedResolve.cacheSize(), 2);
        await cachedResolve("two");
        assert.equal(calls, 4);
    });

    it("clears rejected pending calls so the next request can retry", async () => {
        let calls = 0;
        const cachedResolve = withCache(async () => {
            calls += 1;
            throw new Error("upstream failed");
        }, { ttlMs: 1000, maxEntries: 2 });

        await assert.rejects(cachedResolve("room"), /upstream failed/);
        assert.equal(cachedResolve.pendingSize(), 0);
        await assert.rejects(cachedResolve("room"), /upstream failed/);
        assert.equal(calls, 2);
        assert.equal(cachedResolve.cacheSize(), 0);
    });
});
