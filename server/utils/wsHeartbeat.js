const PING_INTERVAL_MS = 15000;
const PONG_TIMEOUT_MS = 45000;
const TAKEOVER_CLOSE_CODE = 4015;

// Browsers answer WebSocket pings automatically; a sleeping laptop or dead network never does,
// and without this the socket can stay "open" on the server for many minutes.
const startHeartbeat = (ws) => {
    let lastPong = Date.now();
    let stale = false;

    const onPong = () => { lastPong = Date.now(); };
    ws.on("pong", onPong);

    const timer = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return;
        if (Date.now() - lastPong > PONG_TIMEOUT_MS) {
            stale = true;
            ws.terminate();
            return;
        }
        try { ws.ping(); } catch {}
    }, PING_INTERVAL_MS);

    return {
        stop: () => {
            clearInterval(timer);
            ws.removeListener("pong", onPong);
        },
        closeReason: (code) => {
            if (stale) return "stale_timeout";
            if (code === TAKEOVER_CLOSE_CODE) return "replaced";
            if (code === 1001) return "tab_closed";
            if (code === 1006) return "connection_lost";
            return "view_closed";
        },
    };
};

module.exports = { startHeartbeat, TAKEOVER_CLOSE_CODE };
