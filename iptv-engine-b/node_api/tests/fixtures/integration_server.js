const { createServer } = require("../../src/server.js");

const port = Number(process.env.PORT || 0);
const mode = process.env.RESOLVER_MODE || "success";
const allowedRedirectHosts = ["streams.example"];

function resolver(platform) {
    return async (roomId) => {
        if (mode === "failure") return { roomId, platform, fallback: true };
        return {
            roomId,
            platform,
            realUrl: `https://streams.example/${platform}/${roomId}.m3u8`,
        };
    };
}

const server = createServer({
    port,
    allowedRedirectHosts,
    resolvers: {
        bilibili: resolver("bilibili"),
        douyin: resolver("douyin"),
        kuaishou: resolver("kuaishou"),
    },
});

function shutdown() {
    if (!server.listening) {
        process.exit(0);
        return;
    }
    server.close(() => process.exit(0));
}

server.on("error", (error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
    console.log(`[fixture] ready:${server.address().port}`);
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
