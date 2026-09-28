const { INTEGER, BIGINT, FLOAT, BOOLEAN, DATE } = require("sequelize");
const db = require("../utils/database");

const num = (type = FLOAT) => ({ type, allowNull: false, defaultValue: 0 });

// One row per minute describing the Nexterm host; kept for HealthSettings.retentionDays.
module.exports = db.define("health_samples", {
    timestamp: { type: DATE, allowNull: false },
    cpu: num(), cpuMax: num(), iowait: num(), steal: num(), load1: num(),
    memUsed: num(BIGINT), memTotal: num(BIGINT), swapUsed: num(BIGINT),
    diskUsed: num(BIGINT), diskTotal: num(BIGINT), diskRead: num(), diskWrite: num(),
    netRx: num(), netTx: num(), primaryMbps: num(), primaryMbpsMax: num(),
    serverCpu: num(), serverRss: num(BIGINT), engineCpu: num(), engineRss: num(BIGINT),
    lagMs: num(), lagP99Ms: num(),
    sessions: num(INTEGER), activeSessions: num(INTEGER), guacSessions: num(INTEGER),
    terminalSessions: num(INTEGER), users: num(INTEGER), viewers: num(INTEGER),
    engineConnected: { type: BOOLEAN, allowNull: false, defaultValue: true },
}, { freezeTableName: true, timestamps: false });
