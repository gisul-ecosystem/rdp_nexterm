const { INTEGER, BOOLEAN, STRING, TEXT, JSON } = require("sequelize");
const db = require("../utils/database");

const parseJson = (value) => {
    if (typeof value !== "string") return value;
    try { return globalThis.JSON.parse(value); } catch { return null; }
};

module.exports = db.define("health_settings", {
    serverLabel: { type: STRING, allowNull: true },
    linkMbps: { type: INTEGER, allowNull: true },
    primaryInterface: { type: STRING, allowNull: true },
    rules: {
        type: JSON,
        allowNull: true,
        get() { return parseJson(this.getDataValue("rules")); },
    },
    webhookEnabled: { type: BOOLEAN, allowNull: false, defaultValue: false },
    webhookFormat: { type: STRING, allowNull: false, defaultValue: "generic" },
    // Encrypted with ENCRYPTION_KEY: chat webhook URLs carry their own access token.
    webhookUrl: { type: TEXT, allowNull: true },
    notifyResolved: { type: BOOLEAN, allowNull: false, defaultValue: true },
    retentionDays: { type: INTEGER, allowNull: false, defaultValue: 30 },
}, { freezeTableName: true, timestamps: false });
