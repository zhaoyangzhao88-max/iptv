/**
 * resolvers/kuaishou.js — Kuaishou live room resolver with real API.
 *
 * Validates Kuaishou room IDs and scrapes the web page for live stream URLs.
 * Falls back to identity object on any error.
 */

const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const WEB_URL = "https://live.kuaishou.com";
const API_TIMEOUT_MS = 3000;

/**
 * Fetch the real stream URL from Kuaishou live page.
 * @param {string} roomId — Verified room ID (username or room ID)
 * @returns {Promise<string|null>} — Real stream URL or null on failure
 */
async function fetchRealStreamUrl(roomId, { fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const url = `${WEB_URL}/u/${roomId}`;

        const resp = await fetchImpl(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
                "Referer": "https://live.kuaishou.com/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9",
            },
        });

        if (!resp.ok) return null;

        const html = await resp.text();

        // Try to find initial state JSON in the HTML
        const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
        if (!stateMatch) return null;

        const stateData = JSON.parse(stateMatch[1]);

        // Try various possible paths for the stream URL
        const liveStream = stateData?.liveStream;
        if (liveStream) {
            const playUrls = liveStream.playUrls || liveStream.play_urls || [];
            if (Array.isArray(playUrls) && playUrls.length > 0) {
                const streamUrl = playUrls[0]?.url || playUrls[0]?.adapter;
                if (typeof streamUrl === "string" && streamUrl.startsWith("http")) {
                    return streamUrl;
                }
            }
        }

        return null;
    } catch (err) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Validate and resolve a Kuaishou room/user ID, fetching real stream URL if possible.
 * @param {string} roomId — Raw room/user ID from URL path
 * @returns {Promise<{roomId: string, platform: string, realUrl?: string, fallback: boolean} | null>}
 */
async function resolve(roomId, options = {}) {
    if (!roomId || typeof roomId !== "string") return null;

    const trimmed = roomId.trim();
    if (!trimmed) return null;
    if (!ROOM_ID_PATTERN.test(trimmed)) return null;

    try {
        const realUrl = await fetchRealStreamUrl(trimmed, options);
        if (realUrl) {
            return { roomId: trimmed, platform: "kuaishou", realUrl, fallback: false };
        }
    } catch (err) {
        // Fall through
    }

    return { roomId: trimmed, platform: "kuaishou", fallback: true };
}

module.exports = { resolve };
