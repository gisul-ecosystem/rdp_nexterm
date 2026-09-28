const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const hostMetrics = require("../utils/hostMetrics");
const { estimateCapacity, fitCost } = require("../utils/healthCapacity");
const { AlertEvaluator, RECOVER_MS, levelOf, RULES, alertText, webhookPayload } = require("../utils/healthAlerts");
const { toPoint, aggregate, bucketRows, buildHeatmap } = require("../utils/healthSeries");

describe("hostMetrics parsers", () => {
    test("cpu percentages include steal and iowait", () => {
        const a = hostMetrics.parseCpuTimes("cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 2 3");
        const b = hostMetrics.parseCpuTimes("cpu  200 0 150 900 30 0 0 20 0 0\n");
        const pct = hostMetrics.cpuPercentages(a, b);
        assert.equal(Math.round(pct.cpu), 57); // of 300 ticks, 130 idle (incl. iowait); steal counts as busy
        assert.equal(Math.round(pct.steal), 7);
        assert.equal(Math.round(pct.iowait), 10);
        assert.equal(hostMetrics.cpuPercentages(null, b), null);
        assert.equal(hostMetrics.cpuPercentages(b, b), null);
    });

    test("meminfo uses MemAvailable", () => {
        const m = hostMetrics.parseMeminfo("MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 600 kB\nSwapTotal: 200 kB\nSwapFree: 150 kB\n");
        assert.deepEqual(m, { memTotal: 1024000, memUsed: 409600, swapTotal: 204800, swapUsed: 51200 });
    });

    test("net/dev skips virtual interfaces", () => {
        const text = "Inter-| Receive\n face |bytes\n    lo: 500 1 0 0 0 0 0 0 500 1 0 0 0 0 0 0\n  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0\ndocker0: 9 0 0 0 0 0 0 0 9 0 0 0 0 0 0 0\nveth12: 9 0 0 0 0 0 0 0 9 0 0 0 0 0 0 0\n  eth1: 5 0 0 0 0 0 0 0 7 0 0 0 0 0 0 0";
        assert.deepEqual(hostMetrics.parseNetDev(text), { eth0: { rx: 1000, tx: 2000 }, eth1: { rx: 5, tx: 7 } });
    });

    test("diskstats counts whole disks only", () => {
        const text = "   8       0 sda 10 0 100 0 5 0 50 0 0 0 0\n   8       1 sda1 10 0 999 0 5 0 999 0 0 0 0\n 253 0 vda 1 0 2 0 1 0 4 0 0 0 0\n   7 0 loop0 1 0 50 0 0 0 0 0 0 0 0";
        assert.deepEqual(hostMetrics.parseDiskstats(text), { readBytes: 102 * 512, writeBytes: 54 * 512 });
    });

    test("default interface from route table", () => {
        const route = "Iface\tDestination\tGateway\neth1\t0A6E0000\t00000000\neth0\t00000000\t016E0A0A\n";
        assert.equal(hostMetrics.parseDefaultInterface(route), "eth0");
        assert.equal(hostMetrics.parseDefaultInterface(""), null);
    });

    test("pid stat with spaces in the command name", () => {
        const s = hostMetrics.parsePidStat("25 (nexterm engine) S 1 25 25 0 -1 4194560 100 0 0 0 150 50 0 0 20 0 8 0");
        assert.deepEqual(s, { comm: "nexterm engine", ppid: 1, cpuTicks: 200 });
        assert.equal(hostMetrics.parseRss("Name:\tnode\nVmRSS:\t  2048 kB\n"), 2097152);
    });

    test("engine group includes spawned workers, server is separate", () => {
        const procs = [
            { pid: 1, comm: "sh", ppid: 0, cpuTicks: 1, rss: 1 },
            { pid: 12, comm: "node", ppid: 1, cpuTicks: 500, rss: 100 },
            { pid: 25, comm: "nexterm-engine", ppid: 1, cpuTicks: 300, rss: 50 },
            { pid: 40, comm: "guacd", ppid: 25, cpuTicks: 200, rss: 30 },
            { pid: 41, comm: "freerdp", ppid: 40, cpuTicks: 100, rss: 20 },
        ];
        assert.deepEqual(hostMetrics.groupProcesses(procs, 12), {
            server: { cpuTicks: 500, rss: 100 },
            engine: { cpuTicks: 600, rss: 100, processes: 3 },
        });
    });
});

describe("capacity estimate", () => {
    const sample = (guacSessions, cpu, memGb, mbps = 0) => ({ guacSessions, cpu, memUsed: memGb * 2 ** 30, memTotal: 16 * 2 ** 30, primaryMbps: mbps, engineConnected: 1 });

    test("linear fit finds baseline and per-session cost", () => {
        const points = [];
        for (let i = 0; i < 40; i++) points.push({ x: i % 5, y: 5 + (i % 5) * 4 });
        const cost = fitCost(points);
        assert.ok(Math.abs(cost.baseline - 5) < 1e-9);
        assert.ok(Math.abs(cost.perSession - 4) < 1e-9);
    });

    test("no busy samples means no estimate", () => {
        const est = estimateCapacity([sample(0, 3, 1), sample(0, 4, 1)], null, 0);
        assert.equal(est.confidence, "none");
        assert.equal(est.maxSessions, null);
    });

    test("cpu-bound host", () => {
        const samples = [];
        for (let i = 0; i < 60; i++) { const n = i % 6; samples.push(sample(n, 5 + n * 8, 1 + n * 0.2)); }
        const est = estimateCapacity(samples, null, 4);
        assert.equal(est.bottleneck, "cpu");
        assert.equal(est.maxSessions, 10); // (85 - 5) / 8
        assert.equal(est.headroom, 6);
        assert.equal(est.confidence, "medium");
    });

    test("bandwidth becomes the limit when the link is slow", () => {
        const samples = [];
        for (let i = 0; i < 60; i++) { const n = i % 6; samples.push(sample(n, 2 + n, 1 + n * 0.1, n * 5)); }
        const est = estimateCapacity(samples, 50, 1);
        assert.equal(est.bottleneck, "bandwidth");
        assert.equal(est.maxSessions, 8); // 40 Mbps usable / 5
        assert.ok(est.perResource.memory.maxSessions > 8);
    });

    test("single session level falls back to ratio over idle baseline", () => {
        const samples = [...Array(20).fill(sample(0, 4, 1)), ...Array(20).fill(sample(2, 14, 1.6))];
        const est = estimateCapacity(samples, null, 2);
        assert.equal(Math.round(est.perResource.cpu.perSession), 5);
        assert.equal(est.confidence, "low");
    });

    test("samples while the engine was offline are ignored", () => {
        const samples = [...Array(30).fill(sample(1, 10, 1)), ...Array(30).fill({ ...sample(1, 90, 1), engineConnected: 0 })];
        const est = estimateCapacity(samples, null, 1);
        assert.ok(est.perResource.cpu.perSession < 20);
    });
});

describe("alert evaluator", () => {
    const makeEvaluator = () => {
        let clock = 0;
        const rows = new Map();
        const events = [];
        let nextId = 1;
        const evaluator = new AlertEvaluator({
            now: () => clock,
            store: {
                create: async (data) => { const row = { id: nextId++, ...data }; rows.set(row.id, row); return { ...row }; },
                update: async (id, changes) => Object.assign(rows.get(id), changes),
            },
            notify: async (event, alert) => events.push({ event, severity: alert.severity, rule: alert.rule, value: alert.value }),
        });
        const base = { cpu: 10, memUsed: 1, memTotal: 10, diskUsed: 1, diskTotal: 10, primaryMbps: 1, steal: 0, lagP99Ms: 5 };
        const step = async (changes, ctx = {}, rules = {}, seconds = 15) => {
            clock += seconds * 1000;
            await evaluator.evaluate({ ...base, ...changes }, { linkMbps: null, capacity: null, engineDownSeconds: 0, ...ctx }, rules);
        };
        return { evaluator, rows, events, step, advance: (ms) => { clock += ms; } };
    };

    test("fires only after the condition holds for the configured minutes", async () => {
        const { events, step } = makeEvaluator();
        for (let i = 0; i < 19; i++) await step({ cpu: 85 });
        assert.equal(events.length, 0);
        await step({ cpu: 85 });
        await step({ cpu: 85 });
        assert.deepEqual(events.map((e) => [e.event, e.severity, e.rule]), [["fired", "warning", "cpu"]]);
    });

    test("a short spike does not fire", async () => {
        const { events, step } = makeEvaluator();
        for (let i = 0; i < 10; i++) await step({ cpu: 99 });
        await step({ cpu: 20 });
        for (let i = 0; i < 15; i++) await step({ cpu: 99 });
        assert.equal(events.length, 0);
    });

    test("escalates to critical, then resolves after a minute of normal values", async () => {
        const { events, rows, step } = makeEvaluator();
        for (let i = 0; i < 21; i++) await step({ cpu: 85 });
        for (let i = 0; i < 21; i++) await step({ cpu: 96 });
        assert.deepEqual(events.map((e) => `${e.event}:${e.severity}`), ["fired:warning", "escalated:critical"]);
        for (let i = 0; i < 3; i++) await step({ cpu: 30 });
        assert.equal(events.length, 2);
        for (let i = 0; i < 2; i++) await step({ cpu: 30 });
        assert.equal(events.at(-1).event, "resolved");
        const row = rows.get(1);
        assert.equal(row.status, "resolved");
        assert.equal(row.severity, "critical");
        assert.equal(row.peakValue, 96);
        assert.ok(row.resolvedAt instanceof Date);
    });

    test("does not resolve while it flaps back above the threshold", async () => {
        const { events, step } = makeEvaluator();
        for (let i = 0; i < 21; i++) await step({ cpu: 85 });
        for (let i = 0; i < 10; i++) await step({ cpu: i % 3 === 0 ? 85 : 30 });
        assert.deepEqual(events.map((e) => e.event), ["fired"]);
    });

    test("disabled rule never fires and resolves an open alert", async () => {
        const { events, step } = makeEvaluator();
        for (let i = 0; i < 21; i++) await step({ cpu: 85 });
        await step({ cpu: 85 }, {}, { cpu: { enabled: false } });
        assert.deepEqual(events.map((e) => e.event), ["fired", "resolved"]);
        for (let i = 0; i < 30; i++) await step({ cpu: 99 }, {}, { cpu: { enabled: false } });
        assert.equal(events.length, 2);
    });

    test("custom thresholds and minutes", async () => {
        const { events, step } = makeEvaluator();
        await step({ cpu: 55 }, {}, { cpu: { warning: 50, critical: 70, minutes: 0 } });
        assert.deepEqual(events.map((e) => `${e.event}:${e.severity}`), ["fired:warning"]);
    });

    test("bandwidth needs a link speed", async () => {
        const { events, step } = makeEvaluator();
        for (let i = 0; i < 25; i++) await step({ primaryMbps: 95 });
        assert.equal(events.length, 0);
        for (let i = 0; i < 22; i++) await step({ primaryMbps: 95 }, { linkMbps: 100 });
        assert.deepEqual(events.map((e) => `${e.rule}:${e.severity}`), ["bandwidth:critical"]);
    });

    test("capacity is lower-is-worse and needs medium confidence", async () => {
        const { events, step } = makeEvaluator();
        for (let i = 0; i < 25; i++) await step({}, { capacity: { confidence: "low", headroom: 0 } });
        assert.equal(events.length, 0);
        for (let i = 0; i < 22; i++) await step({}, { capacity: { confidence: "high", headroom: 2 } });
        assert.deepEqual(events.map((e) => `${e.rule}:${e.severity}`), ["capacity:warning"]);
    });

    test("engine offline is critical-only after 30 s", async () => {
        const { events, step } = makeEvaluator();
        await step({}, { engineDownSeconds: 15 });
        assert.equal(events.length, 0);
        await step({}, { engineDownSeconds: 30 });
        assert.deepEqual(events.map((e) => `${e.rule}:${e.severity}`), ["engine:critical"]);
    });

    test("alerts loaded at startup resolve normally", async () => {
        const { evaluator, events, rows, step } = makeEvaluator();
        rows.set(7, { id: 7, rule: "memory", severity: "warning", status: "active", value: 90, peakValue: 92 });
        evaluator.load([{ ...rows.get(7) }]);
        for (let i = 0; i < 5; i++) await step({});
        assert.deepEqual(events.map((e) => `${e.event}:${e.rule}`), ["resolved:memory"]);
        assert.equal(rows.get(7).status, "resolved");
    });

    test("levelOf honours direction", () => {
        assert.equal(levelOf(RULES.cpu, { warning: 80, critical: 90 }, 90), "critical");
        assert.equal(levelOf(RULES.cpu, { warning: 80, critical: 90 }, null), "ok");
        assert.equal(levelOf(RULES.capacity, { warning: 3, critical: 1 }, 2), "warning");
        assert.equal(levelOf(RULES.engine, { critical: 30 }, 29), "ok");
    });
});

describe("alert messages", () => {
    const alert = { id: 3, rule: "cpu", severity: "critical", status: "active", value: 94.4, peakValue: 97, threshold: 90, startedAt: "2026-09-28T10:05:00Z" };

    test("readable text", () => {
        assert.equal(alertText("fired", alert, "Lab"), "[CRITICAL] Lab: CPU usage is 94% (at or above 90% since 10:05 UTC).");
        const resolved = alertText("resolved", { ...alert, value: 30, resolvedAt: "2026-09-28T10:17:00Z" }, "Lab");
        assert.equal(resolved, "[RESOLVED] Lab: CPU usage is back to normal (now 30%, worst 97%, lasted 12 min).");
        assert.match(alertText("fired", { ...alert, rule: "capacity", value: 1, threshold: 1 }), /at or below 1 sessions/);
    });

    test("payload formats", () => {
        assert.deepEqual(Object.keys(webhookPayload("slack", "fired", alert, "Lab")), ["text"]);
        assert.deepEqual(Object.keys(webhookPayload("googlechat", "fired", alert, "Lab")), ["text"]);
        const teams = webhookPayload("teams", "fired", alert, "Lab");
        assert.equal(teams.attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
        assert.equal(teams.attachments[0].content.body[0].color, "Attention");
        const generic = webhookPayload("generic", "resolved", { ...alert, status: "resolved" }, "Lab");
        assert.equal(generic.event, "resolved");
        assert.equal(generic.alert.label, "CPU usage");
        assert.equal(webhookPayload("generic", "test", null, "Lab").alert, null);
    });
});

describe("series helpers", () => {
    test("live points fall back for max fields", () => {
        const p = toPoint({ timestamp: 0, cpu: 12.345, primaryMbps: 3, sessions: 2, engineConnected: true });
        assert.equal(p.cpu, 12.35);
        assert.equal(p.cpuMax, 12.35);
        assert.equal(p.primaryMbpsMax, 3);
        assert.equal(p.t, "1970-01-01T00:00:00.000Z");
    });

    test("aggregate averages load and keeps peaks", () => {
        const a = aggregate([{ cpu: 10, sessions: 1, lagP99Ms: 5, engineConnected: true }, { cpu: 30, sessions: 3, lagP99Ms: 50, engineConnected: false }], 60000);
        assert.equal(a.cpu, 20);
        assert.equal(a.cpuMax, 30);
        assert.equal(a.sessions, 3);
        assert.equal(a.lagP99Ms, 50);
        assert.equal(a.engineConnected, false);
    });

    test("bucketing", () => {
        const rows = Array.from({ length: 8 }, (_, i) => ({ timestamp: new Date(i * 60000), cpu: i, cpuMax: i + 1, sessions: i, engineConnected: 1 }));
        const points = bucketRows(rows, 4);
        assert.equal(points.length, 2);
        assert.equal(points[0].cpu, 1.5);
        assert.equal(points[0].cpuMax, 4);
        assert.equal(points[1].sessions, 7);
        assert.equal(bucketRows(rows, 1).length, 8);
    });

    test("heatmap uses the viewer's time zone", () => {
        // 2026-09-28 is a Monday; 23:30 UTC is Tuesday 05:00 in UTC+5:30 (tzOffset -330).
        const rows = [{ timestamp: "2026-09-28T23:30:00Z", sessions: 4 }, { timestamp: "2026-09-28T23:45:00Z", sessions: 2 }];
        const map = buildHeatmap(rows, -330);
        assert.deepEqual(map[2][5], { avg: 3, peak: 4 });
        assert.deepEqual(map[1][23], { avg: null, peak: 0 });
        assert.deepEqual(buildHeatmap(rows, 0)[1][23], { avg: 3, peak: 4 });
    });
});
