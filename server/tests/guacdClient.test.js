const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const calls = [];
const quiet = () => {};
require.cache[require.resolve("../utils/logger")] = { exports: { debug: quiet, info: quiet, warn: quiet, error: quiet } };
require.cache[require.resolve("../lib/SessionManager")] = {
    exports: {
        updateConnectionId: (sessionId, connectionId) => calls.push(["ready", connectionId]),
        onMasterConnectionClosed: (sessionId, reason) => calls.push(["closed", reason]),
    },
};
const GuacdClient = require("../lib/GuacdClient");

const HANDSHAKE = "4.args,13.VERSION_1_5_0,8.hostname,4.port;";
const READY = "5.ready,37.$11111111-2222-3333-4444-555555555555;";
const FRAME = "3.img,1.1,2.14,1.0,9.image/png,1.0,1.0;4.blob,1.1,8.AAAAAAAA;3.end,1.1;4.sync,3.123,1.0;";
const ERROR = "5.error,21.Aborted. See logs.,3.519;";

const fakeSocket = () => Object.assign(new EventEmitter(), { written: [], write(d) { this.written.push(d); }, end() {}, destroy() {} });

const clients = [];
const start = (options = {}) => {
    const socket = fakeSocket();
    const client = new GuacdClient({ sessionId: "s1", existingSocket: socket, connectionSettings: { connection: { type: "rdp" } }, ...options });
    client.connect();
    clients.push(client);
    const feed = (...chunks) => chunks.forEach((c) => socket.emit("data", Buffer.from(c)));
    return { client, socket, feed };
};

beforeEach(() => { calls.length = 0; });
afterEach(() => { clients.splice(0).forEach((c) => c.close()); });

test("master: handshake split over chunks, then ready", () => {
    const { client, socket, feed } = start();
    feed(HANDSHAKE.slice(0, 10), HANDSHAKE.slice(10));
    assert.ok(socket.written.some((w) => w.startsWith("7.connect,")));
    feed(READY);
    assert.equal(client.connectionId, "$11111111-2222-3333-4444-555555555555");
    assert.deepEqual(calls, [["ready", "$11111111-2222-3333-4444-555555555555"]]);
    client.close();
});

test("master: display updates after ready are dropped without buffering", () => {
    const { client, feed } = start();
    feed(HANDSHAKE, READY, FRAME);
    for (let i = 0; i < 50; i++) feed(FRAME.repeat(20), FRAME.slice(0, 17));
    assert.equal(client.discardOutput, true);
    assert.equal(client.receivedBuffer.length, 0);
    assert.equal(client.state, "open");
    client.close();
});

test("master: error after ready closes with the message, also when split across chunks", () => {
    for (const cut of [0, 3, 4, 7, 12]) {
        calls.length = 0;
        const { client, feed } = start();
        feed(HANDSHAKE, READY, FRAME);
        const data = FRAME + ERROR;
        const at = FRAME.length + cut;
        feed(data.slice(0, at), data.slice(at));
        assert.equal(client.state, "closed", `cut ${cut}`);
        assert.deepEqual(calls.at(-1), ["closed", "error: Aborted. See logs."], `cut ${cut}`);
    }
});

test("master: '.error,' inside normal data does not close and dropping resumes", () => {
    const { client, feed } = start();
    feed(HANDSHAKE, READY, FRAME);
    feed("9.clipboard,1.2,10.text/plain;4.blob,1.2,12.x.error,y.zz;");
    assert.equal(client.state, "open");
    assert.equal(client.discardOutput, true);
    client.close();
});

test("viewer: receives complete instructions, split input is joined", () => {
    const received = [];
    const { client, feed } = start({ joinConnectionId: "$abc", onData: (d) => received.push(Buffer.from(d).toString()) });
    feed(HANDSHAKE, READY + FRAME.slice(0, 25), FRAME.slice(25) + "4.sync,3.124");
    assert.equal(received.join(""), READY + FRAME);
    feed(",1.0;");
    assert.equal(received.join(""), READY + FRAME + "4.sync,3.124,1.0;");
    assert.equal(client.discardOutput, false);
    client.close();
});

test("viewer: multi-byte text stays intact when a chunk splits a character", () => {
    const received = [];
    const { client, feed } = start({ joinConnectionId: "$abc", onData: (d) => received.push(d) });
    feed(HANDSHAKE);
    const text = "4.name,5.héllo;";
    const bytes = Buffer.from(text);
    client.connection.emit("data", bytes.subarray(0, 10));
    client.connection.emit("data", bytes.subarray(10));
    assert.equal(received.join(""), text);
    client.close();
});

test("viewer: error is forwarded before closing", () => {
    const received = [];
    const { client, feed } = start({ joinConnectionId: "$abc", onData: (d) => received.push(Buffer.from(d).toString()) });
    feed(HANDSHAKE, READY, ERROR);
    assert.equal(client.state, "closed");
    assert.ok(received.join("").includes("5.error,"));
});
