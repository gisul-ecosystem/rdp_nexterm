module.exports = {
    async up(queryInterface, Sequelize) {
        const { INTEGER, BIGINT, FLOAT, BOOLEAN, STRING, TEXT, DATE, JSON } = Sequelize;
        const tables = await queryInterface.showAllTables();
        const num = (type = FLOAT) => ({ type, allowNull: false, defaultValue: 0 });

        if (!tables.includes("health_samples")) {
            await queryInterface.createTable("health_samples", {
                id: { type: INTEGER, primaryKey: true, autoIncrement: true },
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
            });
            await queryInterface.addIndex("health_samples", ["timestamp"]);
        }

        if (!tables.includes("health_daily")) {
            await queryInterface.createTable("health_daily", {
                day: { type: STRING(10), primaryKey: true },
                peakSessions: num(INTEGER), peakUsers: num(INTEGER),
                avgCpu: num(), peakCpu: num(), peakMemPct: num(), peakNetMbps: num(), peakLagMs: num(),
                minutes: num(INTEGER),
            });
        }

        if (!tables.includes("health_alerts")) {
            await queryInterface.createTable("health_alerts", {
                id: { type: INTEGER, primaryKey: true, autoIncrement: true },
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
            });
            await queryInterface.addIndex("health_alerts", ["status"]);
            await queryInterface.addIndex("health_alerts", ["startedAt"]);
        }

        if (!tables.includes("health_settings")) {
            await queryInterface.createTable("health_settings", {
                id: { type: INTEGER, primaryKey: true, autoIncrement: true },
                serverLabel: { type: STRING, allowNull: true },
                linkMbps: { type: INTEGER, allowNull: true },
                primaryInterface: { type: STRING, allowNull: true },
                rules: { type: JSON, allowNull: true },
                webhookEnabled: { type: BOOLEAN, allowNull: false, defaultValue: false },
                webhookFormat: { type: STRING, allowNull: false, defaultValue: "generic" },
                webhookUrl: { type: TEXT, allowNull: true },
                notifyResolved: { type: BOOLEAN, allowNull: false, defaultValue: true },
                retentionDays: { type: INTEGER, allowNull: false, defaultValue: 30 },
            });
        }
    },
};
