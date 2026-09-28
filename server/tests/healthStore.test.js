// Storage round-trips of the health service against a throwaway SQLite database.
// Needs the server dependencies (sequelize, sqlite3); skipped when they are not installed.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

let hasDeps = true;
try { require.resolve("sequelize"); require.resolve("sqlite3"); } catch { hasDeps = false; }

let db, healthService, HealthDaily, HealthAlert, HealthSettings, health;

before(async () => {
    if (!hasDeps) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexterm-health-"));
    fs.mkdirSync(path.join(dir, "data"));
    process.chdir(dir);
    process.env.ENCRYPTION_KEY ||= "a".repeat(64);
    db = require("../utils/database");
    HealthDaily = require("../models/HealthDaily");
    HealthAlert = require("../models/HealthAlert");
    HealthSettings = require("../models/HealthSettings");
    require("../models/HealthSample");
    await db.sync();
    healthService = require("../utils/healthService");
    health = require("../controllers/health");
});

after(async () => {
    await db?.close();
});

test("settings load, save and reload with rules as an object", { skip: !hasDeps }, async () => {
    const first = await healthService.loadSettings();
    assert.deepEqual(first.rules, {});
    assert.equal(first.retentionDays, 30);

    const saved = await health.updateSettings({ linkMbps: 1000, serverLabel: "Lab", rules: { cpu: { warning: 20, critical: 30, minutes: 0 } } });
    assert.equal(saved.code, undefined, saved.message);
    assert.equal(saved.linkMbps, 1000);
    assert.equal(saved.serverLabel, "Lab");
    assert.equal(saved.rules.cpu.critical, 30);
    assert.equal(saved.rules.memory.critical, 95);

    const reloaded = await healthService.loadSettings();
    assert.equal(typeof reloaded.rules, "object");
    assert.equal(reloaded.rules.cpu.warning, 20);
    assert.equal(await HealthSettings.count(), 1);

    const bad = await health.updateSettings({ rules: { cpu: { warning: 40 } } });
    assert.equal(bad.code, 400);
});

test("webhook URL is stored encrypted and never returned", { skip: !hasDeps }, async () => {
    const saved = await health.updateSettings({ webhookUrl: "https://hooks.example.com/secret-token", webhookEnabled: true });
    assert.equal(saved.webhookConfigured, true);
    assert.equal(saved.webhookHost, "hooks.example.com");
    assert.ok(!JSON.stringify(saved).includes("secret-token"));
    const row = await HealthSettings.findOne();
    assert.ok(!row.webhookUrl.includes("secret-token"));
    assert.equal(healthService.decryptWebhookUrl(row.webhookUrl), "https://hooks.example.com/secret-token");
});

test("daily summary is created, then updated with peaks and a running average", { skip: !hasDeps }, async () => {
    const at = new Date("2026-09-28T10:00:00Z");
    const minute = (over) => ({ timestamp: at, sessions: 2, users: 1, cpu: 10, cpuMax: 20, memUsed: 4e9, memTotal: 16e9, primaryMbpsMax: 5, lagP99Ms: 15, ...over });
    await healthService.updateDaily(minute({}));
    await healthService.updateDaily(minute({ sessions: 5, users: 3, cpu: 30, cpuMax: 60, lagP99Ms: 8 }));
    const row = await HealthDaily.findByPk("2026-09-28");
    assert.equal(row.minutes, 2);
    assert.equal(row.peakSessions, 5);
    assert.equal(row.peakUsers, 3);
    assert.equal(row.avgCpu, 20);
    assert.equal(row.peakCpu, 60);
    assert.equal(row.peakLagMs, 15);
    assert.equal(row.peakMemPct, 25);
});

test("acknowledging an alert stores who and when; resolved alerts are refused", { skip: !hasDeps }, async () => {
    const alert = (await HealthAlert.create({ rule: "cpu", severity: "critical", status: "active", value: 95, peakValue: 97, threshold: 90, startedAt: new Date() })).get({ plain: true });
    const ok = await health.acknowledgeAlert(7, alert.id);
    assert.equal(ok.code, undefined, ok.message);
    const row = await HealthAlert.findByPk(alert.id);
    assert.equal(row.acknowledgedBy, 7);
    assert.ok(row.acknowledgedAt);
    assert.match((await health.acknowledgeAlert(7, alert.id)).message, /already/);

    await HealthAlert.update({ status: "resolved", resolvedAt: new Date() }, { where: { id: alert.id } });
    assert.equal((await health.acknowledgeAlert(7, alert.id)).code, 409);
    assert.equal((await health.acknowledgeAlert(7, 999999)).code, 404);
});
