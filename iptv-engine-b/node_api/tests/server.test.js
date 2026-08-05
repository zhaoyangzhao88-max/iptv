/**
 * Focused contract tests for the modular HTTP server factory.
 * All resolver behavior is injected; no platform upstream is contacted.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createServer, MAX_ROOM_ID_LENGTH, validateRedirectUrl } = require("../src/server.js");

function request(baseURL, path, method = "GET") {
    return new Promise((resolve, reject) => {
        const requestUrl = new URL(path, baseURL);
        const req = http.request(requestUrl, { method }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body,
            }));
        });
        req.on("error", reject);
        req.end();
    });
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", reject);
            const address = server.address();
            resolve(`http://127.0.0.1:${address.port}`);
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        if (!server || !server.listening) {
            resolve();
            return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

describe("server.js", () => {
    let server;
    let baseURL;

    before(async () => {
        server = createServer({
            // Explicit 0 is reserved for the test harness and must not become
            // production port 3000 in the factory configuration.
            port: 0,
            allowedRedirectHosts: ["streams.example"],
            resolvers: {
                bilibili: async (roomId) => ({
                    roomId,
                    platform: "bilibili",
                    realUrl: "https://streams.example/live/playlist.m3u8",
                }),
            },
        });
        baseURL = await listen(server);
    });

    after(() => close(server));

    it("keeps the factory testable with an ephemeral port and preserves health JSON", async () => {
        const response = await request(baseURL, "/health");
        assert.equal(response.statusCode, 200);
        assert.match(response.headers["content-type"], /application\/json/);
        assert.equal(response.headers["access-control-allow-origin"], "*");

        const body = JSON.parse(response.body);
        assert.deepEqual(body, {
            status: "ok",
            port: server.address().port,
        });
        assert.notEqual(body.port, 0);
    });

    it("redirects a successful resolver result to its validated HTTPS URL", async () => {
        const response = await request(baseURL, "/api/bilibili/12345");
        assert.equal(response.statusCode, 302);
        assert.equal(response.headers.location, "https://streams.example/live/playlist.m3u8");
        assert.equal(response.body, "");
    });

    it("returns retryable JSON for null and fallback resolver failures", async () => {
        const failureServer = createServer({
            port: 0,
            m3u8BaseUrl: "https://test-stream.com",
            resolvers: {
                bilibili: () => null,
                douyin: () => ({ roomId: "room", platform: "douyin", fallback: true }),
            },
        });
        const failureBaseURL = await listen(failureServer);

        try {
            const nullResponse = await request(failureBaseURL, "/api/bilibili/room");
            assert.equal(nullResponse.statusCode, 503);
            assert.equal(nullResponse.headers.location, undefined);
            assert.deepEqual(JSON.parse(nullResponse.body), {
                error: "Stream unavailable",
                platform: "bilibili",
                roomId: "room",
                retryable: true,
            });
            assert.doesNotMatch(nullResponse.body, /test-stream\.com/);

            const fallbackResponse = await request(failureBaseURL, "/api/douyin/room");
            assert.equal(fallbackResponse.statusCode, 503);
            assert.equal(JSON.parse(fallbackResponse.body).retryable, true);
            assert.equal(fallbackResponse.headers.location, undefined);
        } finally {
            await close(failureServer);
        }
    });

    it("returns retryable JSON when a resolver throws or is not configured", async () => {
        const failureServer = createServer({
            port: 0,
            resolvers: {
                bilibili: async () => {
                    throw new Error("upstream unavailable");
                },
            },
        });
        const failureBaseURL = await listen(failureServer);

        try {
            const thrownResponse = await request(failureBaseURL, "/api/bilibili/room");
            assert.equal(thrownResponse.statusCode, 503);
            assert.equal(JSON.parse(thrownResponse.body).retryable, true);

            const missingResponse = await request(failureBaseURL, "/api/douyin/room");
            assert.equal(missingResponse.statusCode, 503);
            assert.equal(JSON.parse(missingResponse.body).error, "Resolver unavailable");
        } finally {
            await close(failureServer);
        }
    });

    it("rejects invalid, encoded, and overlong route IDs before resolver invocation", async () => {
        let calls = 0;
        const validationServer = createServer({
            port: 0,
            resolvers: {
                bilibili: (roomId) => {
                    calls += 1;
                    return { roomId, platform: "bilibili", realUrl: "https://streams.example/live.m3u8" };
                },
            },
            allowedRedirectHosts: ["streams.example"],
        });
        const validationBaseURL = await listen(validationServer);

        try {
            for (const path of [
                "/api/bilibili/",
                "/api/bilibili/a%2Fb",
                "/api/bilibili/%3Cscript%3E",
                `/api/bilibili/${"a".repeat(MAX_ROOM_ID_LENGTH + 1)}`,
            ]) {
                const response = await request(validationBaseURL, path);
                assert.equal(response.statusCode, 400, path);
                assert.equal(JSON.parse(response.body).error, "Invalid room ID");
            }
            assert.equal(calls, 0);
        } finally {
            await close(validationServer);
        }
    });

    it("allows GET and HEAD but rejects other methods on bound routes", async () => {
        const headResponse = await request(baseURL, "/api/bilibili/12345", "HEAD");
        assert.equal(headResponse.statusCode, 302);
        assert.equal(headResponse.headers.location, "https://streams.example/live/playlist.m3u8");
        assert.equal(headResponse.body, "");

        const postResponse = await request(baseURL, "/api/bilibili/12345", "POST");
        assert.equal(postResponse.statusCode, 405);
        assert.equal(postResponse.headers.allow, "GET, HEAD");
        assert.equal(JSON.parse(postResponse.body).error, "Method Not Allowed");
    });

    it("rejects non-HTTPS or non-allowlisted real URLs without redirecting", async () => {
        const urlServer = createServer({
            port: 0,
            allowedRedirectHosts: ["streams.example"],
            resolvers: {
                bilibili: (roomId) => ({
                    roomId,
                    platform: "bilibili",
                    realUrl: roomId === "http"
                        ? "http://streams.example/live.m3u8"
                        : "https://not-allowed.example/live.m3u8",
                }),
            },
        });
        const urlBaseURL = await listen(urlServer);

        try {
            for (const roomId of ["http", "evil"]) {
                const response = await request(urlBaseURL, `/api/bilibili/${roomId}`);
                assert.equal(response.statusCode, 503);
                assert.equal(response.headers.location, undefined);
                assert.equal(JSON.parse(response.body).retryable, true);
            }
        } finally {
            await close(urlServer);
        }
    });

    it("does not treat the Bilibili API host as a redirect destination by default", async () => {
        const apiHostServer = createServer({
            port: 0,
            resolvers: {
                bilibili: (roomId) => ({
                    roomId,
                    platform: "bilibili",
                    realUrl: "https://api.live.bilibili.com/xlive/web-room/v1/playUrl/playUrl",
                }),
            },
        });
        const apiHostBaseURL = await listen(apiHostServer);

        try {
            const response = await request(apiHostBaseURL, "/api/bilibili/room");
            assert.equal(response.statusCode, 503);
            assert.equal(response.headers.location, undefined);
            assert.deepEqual(JSON.parse(response.body), {
                error: "Invalid stream URL",
                platform: "bilibili",
                roomId: "room",
                retryable: true,
            });
        } finally {
            await close(apiHostServer);
        }
    });

    it("supports per-platform exact redirect host configuration", async () => {
        const configuredServer = createServer({
            port: 0,
            allowedRedirectHosts: {
                bilibili: ["cdn.bilibili.example"],
                douyin: ["cdn.douyin.example"],
            },
            resolvers: {
                bilibili: (roomId) => ({ roomId, realUrl: "https://cdn.bilibili.example/live.m3u8" }),
                douyin: (roomId) => ({ roomId, realUrl: "https://cdn.bilibili.example/live.m3u8" }),
            },
        });
        const configuredBaseURL = await listen(configuredServer);
        try {
            const allowed = await request(configuredBaseURL, "/api/bilibili/room");
            assert.equal(allowed.statusCode, 302);
            const rejected = await request(configuredBaseURL, "/api/douyin/room");
            assert.equal(rejected.statusCode, 503);
        } finally {
            await close(configuredServer);
        }
    });

    it("does not let wildcard hosts include the apex domain", () => {
        assert.equal(
            validateRedirectUrl("https://cdn.example/live.m3u8", ["*.example"]),
            "https://cdn.example/live.m3u8",
        );
        assert.equal(validateRedirectUrl("https://example/live.m3u8", ["*.example"]), null);
        assert.equal(validateRedirectUrl("https://example.evil/live.m3u8", ["*.example"]), null);
    });
    it("returns 404 for unknown paths", async () => {
        const response = await request(baseURL, "/not-found");
        assert.equal(response.statusCode, 404);
        assert.equal(JSON.parse(response.body).error, "Not Found");
    });
});
