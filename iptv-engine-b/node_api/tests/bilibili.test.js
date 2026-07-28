/**
 * tests/bilibili.test.js
 * Unit tests for the Bilibili room ID resolver.
 * Uses Node.js built-in test runner (node:test).
 */
const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("../src/resolvers/bilibili.js");

describe("bilibili resolver", () => {
    describe("resolve() — validation", () => {
        it("should return identity for valid numeric room ID", async () => {
            const result = await resolve("12345");
            assert.ok(result !== null);
            assert.equal(result.roomId, "12345");
            assert.equal(result.platform, "bilibili");
        });

        it("should return identity for alphanumeric room ID with hyphens", async () => {
            const result = await resolve("test-room_123");
            assert.ok(result !== null);
            assert.equal(result.roomId, "test-room_123");
            assert.equal(result.platform, "bilibili");
        });

        it("should return null for empty string", async () => {
            assert.equal(await resolve(""), null);
        });

        it("should return null for whitespace-only string", async () => {
            assert.equal(await resolve("   "), null);
        });

        it("should return null for string with special characters", async () => {
            assert.equal(await resolve("abc/def"), null);
            assert.equal(await resolve("abc\\def"), null);
            assert.equal(await resolve("abc..def"), null);
            assert.equal(await resolve("<script>"), null);
        });

        it("should return null for non-string input", async () => {
            assert.equal(await resolve(null), null);
            assert.equal(await resolve(undefined), null);
            assert.equal(await resolve(123), null);
        });

        it("should trim whitespace from valid room IDs", async () => {
            const result = await resolve("  12345  ");
            assert.ok(result !== null);
            assert.equal(result.roomId, "12345");
        });
    });

    describe("resolve() — API fallback", () => {
        it("should return fallback=true when API cannot be reached", async () => {
            // Tests with a valid-looking but non-existent room; the API call
            // will fail/404, so resolver should return fallback identity
            const result = await resolve("999999999");
            assert.ok(result !== null);
            assert.equal(result.roomId, "999999999");
            assert.equal(result.fallback, true);
        });
    });
});
