/**
 * resolvers/cache.js — Shared TTL memory cache wrapper for resolvers.
 *
 * Wraps a resolver function with a Map-based cache that evicts entries
 * after ttlMs milliseconds (default: 60,000ms = 60 seconds).
 *
 * Each wrapped resolver gets its own isolated cache Map.
 */

const DEFAULT_TTL_MS = 60000;

/**
 * Wrap a resolver function with TTL caching.
 * Supports both sync and async resolver functions.
 * @param {Function} resolverFn — (roomId: string) => { roomId, platform } | null | Promise
 * @param {number} [ttlMs=60000] — Cache TTL in milliseconds
 * @returns {Function} — Cached resolver (always returns Promise)
 */
function withCache(resolverFn, ttlMs = DEFAULT_TTL_MS) {
    const cache = new Map();

    return async function cachedResolve(roomId) {
        const now = Date.now();
        const entry = cache.get(roomId);

        // Cache hit — check TTL
        if (entry && (now - entry.timestamp) < ttlMs) {
            return entry.result;
        }

        // Cache miss or expired — call the underlying resolver (may be sync or async)
        const result = await resolverFn(roomId);

        // Only cache non-null results (don't cache validation failures)
        if (result !== null) {
            cache.set(roomId, { result, timestamp: now });
        }

        return result;
    };
}

module.exports = { withCache, DEFAULT_TTL_MS };
