const http = require("node:http");

const redirectPort = Number(process.env.PORT || 0);
const mediaPort = Number(process.env.MEDIA_PORT || 0);
let mediaServer;
let redirectServer;

function sendMediaResponse(res, statusCode, headers, body) {
    res.writeHead(statusCode, headers);
    res.end(body);
}

function createMediaServer() {
    return http.createServer((req, res) => {
        const match = /^\/(bilibili|douyin|kuaishou)\/([A-Za-z0-9_-]+)\.m3u8$/.exec(req.url || "");
        if (match) {
            const [, platform, roomId] = match;
            const body = [
                "#EXTM3U",
                "#EXT-X-VERSION:3",
                "#EXTINF:5.0,",
                `http://127.0.0.1:${mediaPort}/ts/${platform}/${roomId}/chunk_0.ts`,
                "",
            ].join("\n");
            sendMediaResponse(res, 200, { "Content-Type": "application/vnd.apple.mpegurl" }, body);
            return;
        }

        if (/^\/ts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/chunk_0\.ts$/.test(req.url || "")) {
            sendMediaResponse(res, 200, { "Content-Type": "video/mp2t" }, Buffer.concat([
                Buffer.from([0x47]),
                Buffer.alloc(287),
            ]));
            return;
        }

        sendMediaResponse(res, 404, { "Content-Type": "text/plain" }, "Not Found");
    });
}

function createRedirectServer() {
    return http.createServer((req, res) => {
        const match = /^\/api\/(bilibili|douyin|kuaishou)\/([A-Za-z0-9_-]+)$/.exec(req.url || "");
        if (!match) {
            sendMediaResponse(res, 404, { "Content-Type": "text/plain" }, "Not Found");
            return;
        }

        const [, platform, roomId] = match;
        res.writeHead(302, {
            Location: `http://127.0.0.1:${mediaPort}/${platform}/${roomId}.m3u8`,
        });
        res.end();
    });
}

function shutdown() {
    let remaining = 0;
    for (const server of [redirectServer, mediaServer]) {
        if (server && server.listening) {
            remaining += 1;
            server.close(() => {
                remaining -= 1;
                if (remaining === 0) process.exit(0);
            });
        }
    }
    if (remaining === 0) process.exit(0);
}

mediaServer = createMediaServer();
redirectServer = createRedirectServer();
for (const server of [mediaServer, redirectServer]) {
    server.on("error", (error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    });
}

mediaServer.listen(mediaPort, "127.0.0.1", () => {
    redirectServer.listen(redirectPort, "127.0.0.1", () => {
        console.log(`[fixture] ready:${redirectServer.address().port}:${mediaServer.address().port}`);
    });
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
