/**
 * resolvers/cache.js — Shared bounded TTL memory cache for resolvers.
 *
 * A wrapped resolver coalesces concurrent requests for the same key, stores
 * successful results for a bounded TTL, and evicts the least-recently-used
 * entry when the capacity is reached. Rejected, null, fallback, and retryable
 * results are deliberately not cached so callers can retry an unavailable
 * upstream immediately.
 */

const DEFAULT_TTL_MS = 60000;
const DEFAULT_MAX_ENTRIES = 256;

function parseOptions(ttlOrOptions, maxEntries) {
    if (typeof ttlOrOptions === "number" || ttlOrOptions === undefined) {
        return {
            ttlMs: ttlOrOptions === undefined ? DEFAULT_TTL_MS : ttlOrOptions,
            maxEntries: maxEntries === undefined ? DEFAULT_MAX_ENTRIES : maxEntries,
            now: Date.now,
        };
    }

    if (!ttlOrOptions || typeof ttlOrOptions !== "object") {
        throw new TypeError("cache options must be a number or object");
    }

    const ttlMs = ttlOrOptions.ttlMs ?? ttlOrOptions.ttl ?? DEFAULT_TTL_MS;
    const configuredMaxEntries = ttlOrOptions.maxEntries
        ?? ttlOrOptions.maxSize
        ?? ttlOrOptions.capacity
        ?? DEFAULT_MAX_ENTRIES;

    return {
        ttlMs,
        maxEntries: configuredMaxEntries,
        now: typeof ttlOrOptions.now === "function" ? ttlOrOptions.now : Date.now,
    };
}

function validateOptions(options) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs < 0) {
        throw new RangeError("ttlMs must be a finite number >= 0");
    }
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 0) {
        throw new RangeError("maxEntries must be an integer >= 0");
    }
}

function isCacheable(result) {
    return result !== null
        && result !== undefined
        && result.fallback !== true
        && result.retryable !== true;
}

/**
 * Wrap a resolver function with bounded TTL caching and pending-call
 * coalescing. Supports both sync and async resolver functions.
 *
 * @param {Function} resolverFn — (roomId: string) => result | Promise<result>
 * @param {number|Object} [ttlOrOptions=60000] — TTL in milliseconds, or
 *   { ttlMs, maxEntries, now }. maxSize/capacity are accepted aliases.
 * @param {number} [maxEntries=256] — Capacity when the second argument is a number
 * @returns {Function} — Cached resolver (always returns Promise)
 */
function withCache(resolverFn, ttlOrOptions = DEFAULT_TTL_MS, maxEntries) {
    if (typeof resolverFn !== "function") {
        throw new TypeError("resolverFn must be a function");
    }

    const options = parseOptions(ttlOrOptions, maxEntries);
    validateOptions(options);

    const cache = new Map();
    const pending = new Map();

    function removeExpired(now) {
        for (const [key, entry] of cache) {
            if (now - entry.timestamp >= options.ttlMs) {
                cache.delete(key);
            }
        }
    }

    function store(key, result, timestamp) {
        if (!isCacheable(result) || options.maxEntries === 0 || options.ttlMs === 0) return;

        // Map insertion order represents recency. Refreshing a key moves it to
        // the newest position before capacity eviction.
        cache.delete(key);
        cache.set(key, { result, timestamp });

        while (cache.size > options.maxEntries) {
            const oldestKey = cache.keys().next().value;
            cache.delete(oldestKey);
        }
    }

    const cachedResolve = async function cachedResolve(roomId) {
        const now = options.now();
        removeExpired(now);

        const entry = cache.get(roomId);
        if (entry && now - entry.timestamp < options.ttlMs) {
            // Refresh LRU order on a live hit without changing its age.
            cache.delete(roomId);
            cache.set(roomId, entry);
            return entry.result;
        }

        const existing = pending.get(roomId);
        if (existing) return existing;

        let call;
        try {
            // Invoke immediately so the pending map is populated in the same
            // turn as the first request, while still normalizing sync throws.
            call = Promise.resolve(resolverFn(roomId));
        } catch (error) {
            call = Promise.reject(error);
        }
        pending.set(roomId, call);

        try {
            const result = await call;
            store(roomId, result, options.now());
            return result;
        } finally {
            // A rejected resolver is never retained as a pending or cached
            // failure, allowing the next request to retry upstream.
            pending.delete(roomId);
        }
    };

    // These non-contractual inspection helpers keep focused tests and local
    // diagnostics able to verify bounded state without reaching into closures.
    cachedResolve.clear = () => {
        cache.clear();
        pending.clear();
    };
    cachedResolve.cacheSize = () => cache.size;
    cachedResolve.pendingSize = () => pending.size;

    return cachedResolve;
}

module.exports = {
    withCache,
    DEFAULT_TTL_MS,
    DEFAULT_MAX_ENTRIES,
};
