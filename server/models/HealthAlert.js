const { INTEGER, FLOAT, STRING, DATE } = require("sequelize");
const db = require("../utils/database");

module.exports = db.define("health_alerts", {
    rule: { type: STRING, allowNull: false },
    severity: { type: STRING, allowNull: false },
    status: { type: STRING, allowNull: false, defaultValue: "active" },
    value: { type: FLOAT, allowNull: true },
    peakValue: { type: FLOAT, allowNull: true },
    threshold: { type: FLOAT, allowNull: true },
    startedAt: { type: DATE, allowNull: false },
    resolvedAt: { type: DATE, allowNull: true },
    acknowledgedAt: { type: DATE, allowNull: true },
    acknowledgedBy: { type: INTEGER, allowNull: true },
}, { freezeTableName: true, timestamps: false });
