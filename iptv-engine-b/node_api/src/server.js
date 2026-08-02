/**
 * server.js — Modular HTTP server factory for IPTV redirect microservice
 *
 * Exports createServer(options) that returns a configured http.Server.
 * Routes are delegated to pluggable resolver functions.
 *
 * Options:
 *   port                 — Port reported by /health when the server is not bound
 *                          (default: process.env.PORT || 3000). 0 is reserved for
 *                          callers/tests that bind an ephemeral port with listen(0).
 *   m3u8BaseUrl          — Retained for configuration compatibility. Resolver
 *                          failures never redirect to this value.
 *   allowedRedirectHosts — HTTPS host allowlist for resolver realUrl values.
 *   resolvers            — { bilibili?: fn, douyin?: fn, kuaishou?: fn }
 *                          Each resolver: (roomId: string) =>
 *                          { roomId, platform, realUrl } | null
 */

const http = require("node:http");
const url = require("node:url");

const DEFAULT_PORT = 3000;
const EPHEMERAL_TEST_PORT = 0;
const DEFAULT_M3U8_BASE_URL = "https://test-stream.com";
const MAX_ROOM_ID_LENGTH = 128;
const ALLOWED_METHODS = ["GET", "HEAD"];
const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// These are the platform/CDN host families returned by the built-in resolvers.
// Deployments and tests can provide a narrower list through allowedRedirectHosts.
const DEFAULT_ALLOWED_REDIRECT_HOSTS = [
    "live.bilibili.com",
    "*.bilibili.com",
    "*.bilivideo.com",
    "live.douyin.com",
    "*.douyin.com",
    "*.douyincdn.com",
    "*.douyinvod.com",
    "*.bytecdn.cn",
    "*.ibytedtos.com",
    "live.kuaishou.com",
    "*.kuaishou.com",
    "*.kwaicdn.com",
    "*.yximgs.com",
    "*.gifshow.com",
];

/**
 * Route table. The room ID is deliberately captured broadly so malformed or
 * overlong IDs receive a deterministic 400 instead of falling through to 404.
 * Validation happens after percent-decoding below.
 */
const ROUTE_DEFS = [
    { pattern: /^\/api\/bilibili(?:\/(.*))?$/, platform: "bilibili", resolverKey: "bilibili" },
    { pattern: /^\/api\/douyin(?:\/(.*))?$/, platform: "douyin", resolverKey: "douyin" },
    { pattern: /^\/api\/kuaishou(?:\/(.*))?$/, platform: "kuaishou", resolverKey: "kuaishou" },
];

function resolveConfiguredPort(options) {
    const hasOptionPort = Object.prototype.hasOwnProperty.call(options, "port");
    const configured = hasOptionPort ? options.port : process.env.PORT;

    // An explicit 0 is meaningful: it asks the caller to bind an ephemeral port.
    if (configured === undefined || configured === "") return DEFAULT_PORT;
    if (configured === null || configured === false) {
        throw new RangeError("port must be an integer between 0 and 65535");
    }

    const port = Number(configured);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new RangeError("port must be an integer between 0 and 65535");
    }
    return port;
}

function getAllowedHosts(config, platform) {
    if (config === undefined) return DEFAULT_ALLOWED_REDIRECT_HOSTS;
    if (typeof config === "string") {
        return config.split(",").map((host) => host.trim()).filter(Boolean);
    }
    if (Array.isArray(config)) return config;
    if (config && typeof config === "object") {
        const shared = Array.isArray(config["*"]) ? config["*"] : [];
        const platformHosts = Array.isArray(config[platform]) ? config[platform] : [];
        return [...shared, ...platformHosts];
    }
    return [];
}

function normalizeAllowedHost(host) {
    if (typeof host !== "string") return null;
    const value = host.trim().toLowerCase();
    if (!value) return null;

    if (value.startsWith("*.")) {
        const suffix = value.slice(2);
        return suffix ? { wildcard: true, value: suffix } : null;
    }

    // Accept either a hostname or a URL in configuration. URL parsing also
    // prevents entries such as "https://host.evil" from being treated as a
    // hostname with embedded punctuation.
    if (value.includes("://")) {
        try {
            const parsed = new URL(value);
            if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
                return null;
            }
            return parsed.hostname ? { wildcard: false, value: parsed.hostname } : null;
        } catch (err) {
            return null;
        }
    }

    return { wildcard: false, value };
}

function isAllowedHost(hostname, allowedHosts) {
    const normalizedHostname = String(hostname).toLowerCase().replace(/\.$/, "");
    return allowedHosts.some((entry) => {
        const normalized = normalizeAllowedHost(entry);
        if (!normalized) return false;
        if (normalized.wildcard) {
            return normalizedHostname === normalized.value
                || normalizedHostname.endsWith(`.${normalized.value}`);
        }
        return normalizedHostname === normalized.value;
    });
}

/**
 * Validate a resolver-provided redirect target.
 * Only HTTPS URLs without credentials and with an allowlisted hostname pass.
 * The original string is returned so valid Location headers remain stable.
 */
function validateRedirectUrl(value, allowedHosts) {
    if (typeof value !== "string" || !value) return null;

    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:") return null;
        if (parsed.username || parsed.password || !parsed.hostname) return null;
        if (!isAllowedHost(parsed.hostname, allowedHosts)) return null;
        return parsed.href;
    } catch (err) {
        return null;
    }
}

function sendJson(req, res, statusCode, body, extraHeaders = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        ...extraHeaders,
    });
    // node:http suppresses response bodies for HEAD, but ending explicitly
    // keeps the behavior deterministic for mocked ServerResponse objects too.
    res.end(req.method === "HEAD" ? undefined : payload);
}

function sendRedirect(req, res, location) {
    res.writeHead(302, {
        Location: location,
        "Access-Control-Allow-Origin": "*",
    });
    res.end();
}

function sendRetryableFailure(req, res, platform, roomId, error = "Stream unavailable") {
    sendJson(req, res, 503, {
        error,
        platform,
        roomId,
        retryable: true,
    });
}

function validateRoomId(rawRoomId) {
    if (typeof rawRoomId !== "string" || !rawRoomId) return null;

    let roomId;
    try {
        roomId = decodeURIComponent(rawRoomId);
    } catch (err) {
        return null;
    }

    if (roomId.length === 0 || roomId.length > MAX_ROOM_ID_LENGTH) return null;
    if (!ROOM_ID_PATTERN.test(roomId)) return null;
    return roomId;
}

function getBoundPort(server, configuredPort) {
    const address = server.address();
    if (address && typeof address === "object" && typeof address.port === "number") {
        return address.port;
    }
    return configuredPort;
}

/**
 * Create an HTTP server with configurable resolvers.
 * @param {Object} options
 * @param {number} [options.port] — Port used by /health when unbound. 0 is an
 *   explicit ephemeral-port test value and is never replaced with 3000.
 * @param {string} [options.m3u8BaseUrl] — Retained for compatibility; never
 *   used as a resolver-failure redirect.
 * @param {string[]|Object} [options.allowedRedirectHosts] — HTTPS host allowlist.
 * @param {Object} [options.resolvers] — Map of resolver functions keyed by platform name
 * @returns {http.Server}
 */
function createServer(options = {}) {
    const port = resolveConfiguredPort(options);
    // Keep these options in the factory contract for existing callers. A
    // failed resolver must not use m3u8BaseUrl as a placeholder redirect.
    const m3u8BaseUrl = options.m3u8BaseUrl || process.env.M3U8_BASE_URL || DEFAULT_M3U8_BASE_URL;
    const allowedRedirectHosts = options.allowedRedirectHosts ?? options.allowedHosts;
    const resolvers = options.resolvers || {};

    const server = http.createServer((req, res) => {
        handleRequest(req, res, {
            resolvers,
            m3u8BaseUrl,
            allowedRedirectHosts,
            port,
            server,
        }).catch(() => {
            if (res.headersSent) {
                res.destroy();
                return;
            }
            sendJson(req, res, 500, { error: "Internal Server Error", retryable: false });
        });
    });

    return server;
}

/**
 * Async request handler that supports both sync and async resolvers.
 */
async function handleRequest(req, res, context) {
    const parsedUrl = url.parse(req.url || "/", true);
    const pathname = parsedUrl.pathname || "/";
    const route = ROUTE_DEFS.find((candidate) => candidate.pattern.test(pathname));

    if (route) {
        if (!ALLOWED_METHODS.includes(req.method)) {
            sendJson(req, res, 405, {
                error: "Method Not Allowed",
                allowedMethods: ALLOWED_METHODS,
            }, { Allow: ALLOWED_METHODS.join(", ") });
            return;
        }

        const match = route.pattern.exec(pathname);
        const roomId = validateRoomId(match ? match[1] : null);
        if (!roomId) {
            sendJson(req, res, 400, { error: "Invalid room ID", retryable: false });
            return;
        }

        const resolver = context.resolvers[route.resolverKey];
        if (typeof resolver !== "function") {
            sendRetryableFailure(req, res, route.platform, roomId, "Resolver unavailable");
            return;
        }

        let result;
        try {
            result = await resolver(roomId);
        } catch (err) {
            sendRetryableFailure(req, res, route.platform, roomId, "Resolver failed");
            return;
        }

        // Request syntax was validated before invoking the resolver, so a null
        // result here represents a failed lookup rather than malformed input.
        // It must remain retryable and never become a placeholder redirect.
        if (result === null) {
            sendRetryableFailure(req, res, route.platform, roomId);
            return;
        }
        if (!result || result.fallback === true || result.retryable === true) {
            sendRetryableFailure(req, res, route.platform, roomId);
            return;
        }

        const allowedHosts = getAllowedHosts(context.allowedRedirectHosts, route.platform);
        const location = validateRedirectUrl(result.realUrl, allowedHosts);
        if (!location) {
            sendRetryableFailure(req, res, route.platform, roomId, "Invalid stream URL");
            return;
        }

        sendRedirect(req, res, location);
        return;
    }

    if (pathname === "/health") {
        if (!ALLOWED_METHODS.includes(req.method)) {
            sendJson(req, res, 405, {
                error: "Method Not Allowed",
                allowedMethods: ALLOWED_METHODS,
            }, { Allow: ALLOWED_METHODS.join(", ") });
            return;
        }

        sendJson(req, res, 200, {
            status: "ok",
            port: getBoundPort(context.server, context.port),
        });
        return;
    }

    sendJson(req, res, 404, { error: "Not Found" });
}

module.exports = {
    createServer,
    DEFAULT_PORT,
    EPHEMERAL_TEST_PORT,
    MAX_ROOM_ID_LENGTH,
    DEFAULT_ALLOWED_REDIRECT_HOSTS,
    validateRedirectUrl,
};
