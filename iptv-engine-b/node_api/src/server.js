/**
 * server.js — Modular HTTP server factory for IPTV redirect microservice
 *
 * Exports createServer(options) that returns a configured http.Server.
 * Routes are delegated to pluggable resolver functions.
 *
 * Options:
 *   port          — Port to listen on (default: from process.env.PORT || 3000)
 *   m3u8BaseUrl   — Base URL for M3U8 redirects (default: from env or https://test-stream.com)
 *   resolvers     — { bilibili?: fn, douyin?: fn, kuaishou?: fn }
 *                    Each resolver: (roomId: string) => { roomId, platform } | null
 */

const http = require("node:http");
const url = require("node:url");

const DEFAULT_M3U8_BASE_URL = "https://test-stream.com";
const DEFAULT_PORT = 3000;

/**
 * Route table: maps URL patterns to platform names and resolver keys.
 * Each entry: { pattern: RegExp, platform: string, resolverKey: string }
 */
const ROUTE_DEFS = [
    { pattern: /^\/api\/bilibili\/(.+)$/, platform: "bilibili", resolverKey: "bilibili" },
    { pattern: /^\/api\/douyin\/(.+)$/, platform: "douyin", resolverKey: "douyin" },
    { pattern: /^\/api\/kuaishou\/(.+)$/, platform: "kuaishou", resolverKey: "kuaishou" },
];

/**
 * Create an HTTP server with configurable resolvers.
 * @param {Object} options
 * @param {number} [options.port] — Server port (used only for /health response body)
 * @param {string} [options.m3u8BaseUrl] — Base URL for redirect Location headers
 * @param {Object} [options.resolvers] — Map of resolver functions keyed by platform name
 * @returns {http.Server}
 */
function createServer(options = {}) {
    const port = options.port || process.env.PORT || DEFAULT_PORT;
    const m3u8BaseUrl = options.m3u8BaseUrl || process.env.M3U8_BASE_URL || DEFAULT_M3U8_BASE_URL;
    const resolvers = options.resolvers || {};

    const server = http.createServer((req, res) => {
        // Route all requests through async handler with error fallback
        handleRequest(req, res, resolvers, m3u8BaseUrl, port).catch(() => {
            res.writeHead(500, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            });
            res.end(JSON.stringify({ error: "Internal Server Error" }));
        });
    });

    return server;
}

/**
 * Async request handler that supports both sync and async resolvers.
 */
async function handleRequest(req, res, resolvers, m3u8BaseUrl, port) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Try each route definition
    for (const route of ROUTE_DEFS) {
        const match = pathname.match(route.pattern);
        if (match) {
            const roomId = match[1];
            const resolver = resolvers[route.resolverKey];

            if (typeof resolver === "function") {
                const result = await resolver(roomId);
                if (result) {
                    // If resolver returned a realUrl, redirect to it; otherwise use fallback
                    const location = result.realUrl
                        ? result.realUrl
                        : `${m3u8BaseUrl}/${result.platform}/${result.roomId}.m3u8`;
                    res.writeHead(302, {
                        Location: location,
                        "Access-Control-Allow-Origin": "*",
                    });
                    res.end();
                    return;
                }
                // Invalid room ID
                res.writeHead(400, {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                });
                res.end(JSON.stringify({ error: "Invalid room ID" }));
                return;
            }
        }
    }

    // Health check
    if (pathname === "/health") {
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ status: "ok", port: Number(port) }));
        return;
    }

    // 404
    res.writeHead(404, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ error: "Not Found" }));
}

module.exports = { createServer };
