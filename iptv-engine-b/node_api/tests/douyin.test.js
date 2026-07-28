/**
 * tests/douyin.test.js
 * Unit tests for the Douyin room ID resolver.
 * Uses Node.js built-in test runner (node:test).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("../src/resolvers/douyin.js");

describe("douyin resolver", () => {
    describe("resolve() — validation", () => {
        it("should return identity for valid numeric room ID", async () => {
            const result = await resolve("775841227732");
            assert.ok(result !== null);
            assert.equal(result.roomId, "775841227732");
            assert.equal(result.platform, "douyin");
        });

        it("should return identity for alphanumeric room ID", async () => {
            const result = await resolve("testroom_123");
            assert.ok(result !== null);
            assert.equal(result.roomId, "testroom_123");
            assert.equal(result.platform, "douyin");
        });

        it("should return null for empty string", async () => {
            assert.equal(await resolve(""), null);
        });

        it("should return null for whitespace-only string", async () => {
            assert.equal(await resolve("   "), null);
        });

        it("should return null for special characters", async () => {
            assert.equal(await resolve("abc/def"), null);
            assert.equal(await resolve("<script>"), null);
        });

        it("should return null for non-string input", async () => {
            assert.equal(await resolve(null), null);
            assert.equal(await resolve(undefined), null);
        });

        it("should return null for number input", async () => {
            assert.equal(await resolve(123), null);
        });

        it("should trim whitespace", async () => {
            const result = await resolve("  test123  ");
            assert.ok(result !== null);
            assert.equal(result.roomId, "test123");
        });

        it("should return fallback=true when API cannot be reached", async () => {
            const result = await resolve("nonexistent_room_xyz");
            assert.ok(result !== null);
            assert.equal(result.fallback, true);
        });
    });
});
