const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const stub = (path, exports) => { require.cache[require.resolve(path)] = { exports }; };
const quiet = () => {};
stub("../utils/logger", { debug: quiet, info: quiet, warn: quiet, error: quiet });
stub("../models/Integration", {});
stub("../controllers/identity", { getIdentityCredentials: async () => ({ password: "pw" }) });
stub("../controllers/integration", { getIntegrationCredentials: async () => ({}) });
stub("../controllers/pve", { createTicket: quiet, getNodeForServer: quiet, openVNCConsole: quiet });
stub("../lib/SessionManager", { updateConnectionId: quiet, onMasterConnectionClosed: quiet });

const { buildRdpParams } = require("../lib/guacParamBuilders");
const GuacdClient = require("../lib/GuacdClient");

test("RDP sound is off unless the machine's switch is on", async () => {
    assert.equal((await buildRdpParams({ ip: "10.0.0.1" }))["disable-audio"], "true");
    assert.equal((await buildRdpParams({ ip: "10.0.0.1", enableAudio: false }))["disable-audio"], "true");
    assert.equal((await buildRdpParams({ ip: "10.0.0.1", enableAudio: true }))["disable-audio"], undefined);
});

test("guacd handshake only offers audio formats when sound is switched on", () => {
    const audioLine = (settings) => {
        const socket = Object.assign(new EventEmitter(), { written: [], write(d) { this.written.push(String(d)); }, end() {}, destroy() {} });
        const client = new GuacdClient({ sessionId: "s1", existingSocket: socket, connectionSettings: { connection: { type: "rdp" }, ...settings } });
        client.connect();
        socket.emit("data", Buffer.from("4.args,13.VERSION_1_5_0,8.hostname,4.port;"));
        client.close?.();
        return socket.written.join("").match(/5\.audio[^;]*;/)?.[0];
    };
    assert.equal(audioLine({}), "5.audio;");
    assert.equal(audioLine({ enableAudio: false }), "5.audio;");
    assert.equal(audioLine({ enableAudio: true }), "5.audio,8.audio/L8,9.audio/L16;");
});
