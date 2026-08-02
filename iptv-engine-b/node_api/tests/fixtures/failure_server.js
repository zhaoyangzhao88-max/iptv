const { createServer } = require("../../src/server.js");

const port = Number(process.env.PORT || 0);
const server = createServer({
    port,
    resolvers: {
        bilibili: async () => ({ fallback: true }),
        douyin: async () => ({ fallback: true }),
        kuaishou: async () => ({ fallback: true }),
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
