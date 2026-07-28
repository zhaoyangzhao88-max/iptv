/**
 * resolvers/bilibili.js — Bilibili live room ID resolver with real API.
 *
 * Validates Bilibili room IDs and calls the official live API to obtain
 * the real stream URL. Falls back to identity object on any error.
 *
 * API: GET https://api.live.bilibili.com/xlive/web-room/v1/playUrl/playUrl
 *      ?cid={roomId}&platform=web&qn=10000
 */

const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const API_URL = "https://api.live.bilibili.com/xlive/web-room/v1/playUrl/playUrl";
const API_TIMEOUT_MS = 3000;
const FETCH_TIMEOUT_MS = 3000;

/**
 * Fetch the real stream URL from Bilibili live API.
 * @param {string} roomId — Verified room ID
 * @returns {Promise<string|null>} — Real stream URL or null on failure
 */
async function fetchRealStreamUrl(roomId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const params = new URLSearchParams({
            cid: roomId,
            platform: "web",
            qn: "10000",
            https_url_req: "1",
        });

        const resp = await fetch(`${API_URL}?${params}`, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://live.bilibili.com/",
                "Origin": "https://live.bilibili.com",
            },
        });

        if (!resp.ok) return null;

        const body = await resp.json();
        if (body.code !== 0) return null;

        // Try durl format first (common in older API versions)
        const durl = body.data?.durl;
        if (Array.isArray(durl) && durl.length > 0 && durl[0].url) {
            return durl[0].url;
        }

        // Try playurl_info format (newer API version)
        const streams = body.data?.playurl_info?.playurl?.stream;
        if (Array.isArray(streams) && streams.length > 0) {
            const formats = streams[0]?.format || [];
            const bestFormat = formats.find(f => f.format_name === "ts")
                           || formats.find(f => f.format_name === "flv")
                           || formats[0];
            const codecs = bestFormat?.codec || [];
            const urlInfo = codecs[0]?.url_info?.[0];
            if (urlInfo?.host && urlInfo?.base_url) {
                return `${urlInfo.host}${urlInfo.base_url}${urlInfo.extra || ""}`;
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
 * Validate and resolve a Bilibili room ID, fetching real stream URL if possible.
 * @param {string} roomId — Raw room ID from URL path
 * @returns {Promise<{roomId: string, platform: string, realUrl?: string, fallback: boolean} | null>}
 */
async function resolve(roomId) {
    // Reject non-string input
    if (!roomId || typeof roomId !== "string") return null;

    const trimmed = roomId.trim();

    // Reject empty after trim
    if (!trimmed) return null;

    // Reject path traversal and special characters
    if (!ROOM_ID_PATTERN.test(trimmed)) return null;

    // Attempt to fetch real stream URL; fall back to identity on any failure
    try {
        const realUrl = await fetchRealStreamUrl(trimmed);
        if (realUrl) {
            return { roomId: trimmed, platform: "bilibili", realUrl, fallback: false };
        }
    } catch (err) {
        // Fall through to fallback
    }

    return { roomId: trimmed, platform: "bilibili", fallback: true };
}

module.exports = { resolve };
