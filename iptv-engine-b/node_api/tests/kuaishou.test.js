/**
 * tests/kuaishou.test.js
 * Unit tests for the Kuaishou room/user ID resolver.
 * Uses Node.js built-in test runner (node:test).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("../src/resolvers/kuaishou.js");

describe("kuaishou resolver", () => {
    describe("resolve() — validation", () => {
        it("should return identity for numeric room ID", async () => {
            const result = await resolve("123456789");
            assert.ok(result !== null);
            assert.equal(result.roomId, "123456789");
            assert.equal(result.platform, "kuaishou");
        });

        it("should return identity for username-style ID with hyphens", async () => {
            const result = await resolve("kpl_live");
            assert.ok(result !== null);
            assert.equal(result.roomId, "kpl_live");
            assert.equal(result.platform, "kuaishou");
        });

        it("should return identity for alphanumeric room ID", async () => {
            const result = await resolve("user_name-123");
            assert.ok(result !== null);
            assert.equal(result.roomId, "user_name-123");
            assert.equal(result.platform, "kuaishou");
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
            assert.equal(await resolve(123), null);
        });

        it("should trim whitespace", async () => {
            const result = await resolve("  test123  ");
            assert.ok(result !== null);
            assert.equal(result.roomId, "test123");
        });

        it("should return fallback=true when API cannot be reached", async () => {
            const result = await resolve("nonexistent_user_xyz");
            assert.ok(result !== null);
            assert.equal(result.fallback, true);
        });
    });
});
