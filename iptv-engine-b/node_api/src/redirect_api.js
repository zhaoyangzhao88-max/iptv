/**
 * Node.js 重定向微服务 (redirect_api.js)
 * 为 Python 测速引擎提供 B站/抖音/快手的 302 重定向接口。
 *
 * The production entrypoint is deliberately fixed to loopback. Tests should
 * import createServer from server.js and bind it to port 0 themselves.
 */

const { createServer, DEFAULT_PORT } = require("./server.js");
const { resolve: _biliResolve } = require("./resolvers/bilibili.js");
const { resolve: _douyinResolve } = require("./resolvers/douyin.js");
const { resolve: _kuaishouResolve } = require("./resolvers/kuaishou.js");
const { withCache } = require("./resolvers/cache.js");

const LOOPBACK_HOST = "127.0.0.1";

function resolveProductionPort(value = process.env.PORT) {
    if (value === undefined || value === "") return DEFAULT_PORT;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new RangeError("PORT must be an integer between 0 and 65535");
    }
    return port;
}

function isLoopbackAddress(address) {
    const host = typeof address === "string"
        ? address
        : address && typeof address.address === "string"
            ? address.address
            : null;
    return host === "127.0.0.1"
        || host === "::1"
        || host === "::ffff:127.0.0.1";
}

function isReady(server) {
    const address = server?.address?.();
    return Boolean(address && typeof address === "object" && isLoopbackAddress(address));
}

function createProductionServer(options = {}) {
    const port = resolveProductionPort(options.port);
    const m3u8BaseUrl = options.m3u8BaseUrl
        ?? process.env.M3U8_BASE_URL
        ?? "https://test-stream.com";

    return createServer({
        port,
        m3u8BaseUrl,
        allowedRedirectHosts: options.allowedRedirectHosts,
        resolvers: options.resolvers || {
            bilibili: withCache(_biliResolve),
            douyin: withCache(_douyinResolve),
            kuaishou: withCache(_kuaishouResolve),
        },
    });
}

/**
 * Bind a production server only to loopback. The returned server is useful for
 * shutdown and test cleanup; the listening callback fires after readiness.
 */
function startServer(options = {}) {
    const host = options.host === undefined ? LOOPBACK_HOST : options.host;
    if (typeof host !== "string" || !isLoopbackAddress(host)) {
        throw new Error("redirect_api only supports loopback host binding");
    }

    const server = createProductionServer(options);
    server.on("error", (error) => {
        console.error(`[redirect_api] Server failed: ${error.message}`);
        // Keep the failure explicit for a production process while allowing
        // imported tests to observe the error event without a forced exit.
        if (require.main === module) process.exitCode = 1;
    });

    server.listen(resolveProductionPort(options.port), host, () => {
        const address = server.address();
        const boundPort = address && typeof address === "object" ? address.port : options.port;
        console.log(`[redirect_api] Server ready on ${host}:${boundPort}`);
        if (typeof options.onReady === "function") options.onReady(server);
    });

    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = {
    LOOPBACK_HOST,
    DEFAULT_PORT,
    createProductionServer,
    startServer,
    isLoopbackAddress,
    isReady,
};
