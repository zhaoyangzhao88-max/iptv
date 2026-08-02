/** Readiness and production loopback binding tests. */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
    createProductionServer,
    startServer,
    isLoopbackAddress,
    isReady,
} = require("../src/redirect_api.js");

function requestHealth(server) {
    const address = server.address();
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${address.port}/health`, (response) => {
            let body = "";
            response.on("data", (chunk) => (body += chunk));
            response.on("end", () => resolve({ response, body }));
        }).on("error", reject);
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

describe("redirect_api", () => {
    it("recognizes loopback addresses and does not report an unbound server ready", () => {
        assert.equal(isLoopbackAddress("127.0.0.1"), true);
        assert.equal(isLoopbackAddress("::1"), true);
        assert.equal(isLoopbackAddress("0.0.0.0"), false);
        assert.equal(isReady(createProductionServer({ port: 0, resolvers: {} })), false);
    });

    it("binds startServer to 127.0.0.1 and exposes health after readiness", async () => {
        const server = startServer({ port: 0, resolvers: {} });
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.once("listening", resolve);
        });

        try {
            assert.equal(server.address().address, "127.0.0.1");
            assert.equal(isReady(server), true);
            const { response, body } = await requestHealth(server);
            assert.equal(response.statusCode, 200);
            assert.equal(JSON.parse(body).port, server.address().port);
        } finally {
            await close(server);
        }
    });

    it("rejects non-loopback production host requests and host objects", () => {
        assert.throws(() => startServer({ port: 0, host: "0.0.0.0", resolvers: {} }), /loopback/);
        assert.throws(() => startServer({
            port: 0,
            host: { address: "127.0.0.1", host: "0.0.0.0" },
            resolvers: {},
        }), /loopback/);
    });
});
