/**
 * tests/server.test.js
 * Tests for the modular HTTP server factory (server.js).
 * Uses Node.js built-in test runner (node:test).
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

// We'll create server.js next. For now, this test defines the contract.
// Import will work once server.js is created.
let createServer;

// Helper: make an HTTP GET request and return { statusCode, headers, body }
function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body,
                });
            });
        }).on("error", reject);
    });
}

describe("server.js", () => {
    let server;
    let baseURL;

    before(async () => {
        // Dynamically require server.js once it exists
        createServer = require("../src/server.js").createServer;
    });

    describe("GET /health", () => {
        before((_, done) => {
            server = createServer({ port: 0 }); // port 0 = random available port
            server.listen(0, () => {
                const addr = server.address();
                baseURL = `http://localhost:${addr.port}`;
                done();
            });
        });

        after(() => {
            if (server) server.close();
        });

        it("should return 200 with { status: ok }", async () => {
            const res = await httpGet(`${baseURL}/health`);
            assert.equal(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.equal(body.status, "ok");
        });

        it("should return JSON content type", async () => {
            const res = await httpGet(`${baseURL}/health`);
            assert.ok(res.headers["content-type"].includes("application/json"));
        });

        it("should include port in response", async () => {
            const res = await httpGet(`${baseURL}/health`);
            const body = JSON.parse(res.body);
            assert.ok(typeof body.port === "number");
            assert.ok(body.port > 0);
        });
    });

    describe("404 for unknown routes", () => {
        before((_, done) => {
            server = createServer({ port: 0 });
            server.listen(0, () => {
                const addr = server.address();
                baseURL = `http://localhost:${addr.port}`;
                done();
            });
        });

        after(() => {
            if (server) server.close();
        });

        it("should return 404 for unknown path", async () => {
            const res = await httpGet(`${baseURL}/nonexistent`);
            assert.equal(res.statusCode, 404);
            const body = JSON.parse(res.body);
            assert.equal(body.error, "Not Found");
        });
    });

    describe("CORS headers", () => {
        before((_, done) => {
            server = createServer({ port: 0 });
            server.listen(0, () => {
                const addr = server.address();
                baseURL = `http://localhost:${addr.port}`;
                done();
            });
        });

        after(() => {
            if (server) server.close();
        });

        it("should include CORS header on health response", async () => {
            const res = await httpGet(`${baseURL}/health`);
            assert.equal(res.headers["access-control-allow-origin"], "*");
        });

        it("should include CORS header on 404 response", async () => {
            const res = await httpGet(`${baseURL}/nonexistent`);
            assert.equal(res.headers["access-control-allow-origin"], "*");
        });
    });

    describe("Resolver delegation (with stub resolvers)", () => {
        before((_, done) => {
            // Create server with stub resolvers for testing route delegation
            server = createServer({
                port: 0,
                resolvers: {
                    bilibili: (roomId) => {
                        if (!roomId || roomId === "invalid") return null;
                        return { roomId, platform: "bilibili" };
                    },
                },
            });
            server.listen(0, () => {
                const addr = server.address();
                baseURL = `http://localhost:${addr.port}`;
                done();
            });
        });

        after(() => {
            if (server) server.close();
        });

        it("should return 302 for valid resolver result", async () => {
            const res = await httpGet(`${baseURL}/api/bilibili/12345`);
            assert.equal(res.statusCode, 302);
            assert.ok(res.headers.location);
            assert.ok(res.headers.location.includes("/bilibili/12345"));
        });

        it("should return 400 for invalid room ID (resolver returns null)", async () => {
            const res = await httpGet(`${baseURL}/api/bilibili/invalid`);
            assert.equal(res.statusCode, 400);
        });
    });

    describe("Async resolver support", () => {
        before((_, done) => {
            server = createServer({
                port: 0,
                resolvers: {
                    bilibili: async (roomId) => {
                        if (!roomId || roomId === "invalid") return null;
                        return { roomId, platform: "bilibili", realUrl: "https://real.stream/playlist.m3u8" };
                    },
                },
            });
            server.listen(0, () => {
                const addr = server.address();
                baseURL = `http://localhost:${addr.port}`;
                done();
            });
        });

        after(() => {
            if (server) server.close();
        });

        it("should handle async resolver returning realUrl", async () => {
            const res = await httpGet(`${baseURL}/api/bilibili/12345`);
            assert.equal(res.statusCode, 302);
            assert.equal(res.headers.location, "https://real.stream/playlist.m3u8");
        });

        it("should return 400 for invalid from async resolver", async () => {
            const res = await httpGet(`${baseURL}/api/bilibili/invalid`);
            assert.equal(res.statusCode, 400);
        });
    });
});
