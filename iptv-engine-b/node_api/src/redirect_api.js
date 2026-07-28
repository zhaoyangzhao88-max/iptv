/**
 * Node.js 重定向微服务 (redirect_api.js)
 * 为 Python 测速引擎提供 B站/抖音/快手的 302 重定向接口
 *
 * 启动: node redirect_api.js
 * 端口: PORT 环境变量 (默认 3000)
 * M3U8_BASE_URL: 重定向目标基础 URL (默认 https://test-stream.com)
 *
 * 路由:
 *   GET /api/bilibili/:room_id  → 302 → ${M3U8_BASE_URL}/bilibili/:room_id.m3u8
 *   GET /api/douyin/:room_id  → 302 → ${M3U8_BASE_URL}/douyin/:room_id.m3u8
 *   GET /api/kuaishou/:room_id → 302 → ${M3U8_BASE_URL}/kuaishou/:room_id.m3u8
 *   GET /health → 200 { status: "ok", port: PORT }
 *
 * 架构: 薄包装层 → server.js (HTTP工厂) → resolvers/ (平台解析器 + 60s TTL缓存)
 */

const { createServer } = require("./server.js");
const { resolve: _biliResolve } = require("./resolvers/bilibili.js");
const { resolve: _douyinResolve } = require("./resolvers/douyin.js");
const { resolve: _kuaishouResolve } = require("./resolvers/kuaishou.js");
const { withCache } = require("./resolvers/cache.js");

const PORT = process.env.PORT || 3000;
const M3U8_BASE_URL = process.env.M3U8_BASE_URL || "https://test-stream.com";

const server = createServer({
    port: PORT,
    m3u8BaseUrl: M3U8_BASE_URL,
    resolvers: {
        bilibili: withCache(_biliResolve),
        douyin: withCache(_douyinResolve),
        kuaishou: withCache(_kuaishouResolve),
    },
});

server.listen(PORT, () => {
    console.log(`[redirect_api] Server listening on port ${PORT}`);
});
