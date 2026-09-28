const { INTEGER, FLOAT, STRING } = require("sequelize");
const db = require("../utils/database");

const num = (type = FLOAT) => ({ type, allowNull: false, defaultValue: 0 });

// Daily peaks (UTC day), kept for a year for capacity trends after minute samples expire.
module.exports = db.define("health_daily", {
    day: { type: STRING(10), primaryKey: true },
    peakSessions: num(INTEGER), peakUsers: num(INTEGER),
    avgCpu: num(), peakCpu: num(), peakMemPct: num(), peakNetMbps: num(), peakLagMs: num(),
    minutes: num(INTEGER),
}, { freezeTableName: true, timestamps: false });
