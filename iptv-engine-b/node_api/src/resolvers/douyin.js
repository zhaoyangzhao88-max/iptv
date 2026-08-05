/**
 * resolvers/douyin.js — Douyin (TikTok) live room resolver with real API.
 *
 * Validates Douyin room IDs and scrapes the web page for play_url data.
 * Falls back to identity object on any error.
 */

const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const WEB_URL = "https://live.douyin.com";
const API_TIMEOUT_MS = 3000;

/**
 * Fetch the real stream URL from Douyin live page.
 * Scrapes the __INIT_STATE__ JSON embedded in the HTML.
 * @param {string} roomId — Verified room ID
 * @returns {Promise<string|null>} — Real stream URL or null on failure
 */
async function fetchRealStreamUrl(roomId, { fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resp = await fetchImpl(`${WEB_URL}/${roomId}`, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
                "Referer": "https://live.douyin.com/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9",
            },
        });

        if (!resp.ok) return null;

        const html = await resp.text();

        // Try to find __INIT_STATE__ in the HTML
        const stateMatch = html.match(/window\.__INIT_STATE__\s*=\s*(\{[\s\S]*?\});/);
        if (!stateMatch) return null;

        const stateData = JSON.parse(stateMatch[1]);

        // Try various possible paths for the stream URL
        const roomStore = stateData?.roomStore?.roomInfo?.room;
        const streamUrl = roomStore?.streamUrl
                       || roomStore?.stream_url
                       || roomStore?.flv_pull_url
                       || roomStore?.hls_pull_url_map;

        if (typeof streamUrl === "string" && streamUrl.startsWith("http")) {
            return streamUrl;
        }

        // If it's an object (e.g., flv_pull_url: { FULL_HD1: "..." })
        if (streamUrl && typeof streamUrl === "object") {
            const urls = Object.values(streamUrl)
                .filter(v => typeof v === "string" && v.startsWith("http"));
            if (urls.length > 0) return urls[0];
        }

        return null;
    } catch (err) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Validate and resolve a Douyin room ID, fetching real stream URL if possible.
 * @param {string} roomId — Raw room ID from URL path
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
            return { roomId: trimmed, platform: "douyin", realUrl, fallback: false };
        }
    } catch (err) {
        // Fall through
    }

    return { roomId: trimmed, platform: "douyin", fallback: true };
}

module.exports = { resolve };
