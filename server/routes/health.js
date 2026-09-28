const { Router } = require("express");
const healthController = require("../controllers/health");
const { requirePermission } = require("../middlewares/permission");
const { Permission } = require("../permissions/registry");
const {
    healthHistoryValidation, healthCapacityValidation, healthAlertsValidation, healthAlertIdValidation,
    healthSettingsValidation, healthWebhookTestValidation,
} = require("../validations/health");

const app = Router();

const parse = (res, schema, input) => {
    const { error, value } = schema.validate(input, { errors: { wrap: { label: "" } } });
    if (!error) return value;
    res.status(400).json({ message: error.details[0].message });
    return null;
};

const send = (res, result) => result?.code ? res.status(result.code).json({ message: result.message }) : res.json(result);

/**
 * GET /health/live
 * @summary Live Server Health
 * @description Latest load of the machine running Nexterm (CPU, memory, disk, network, Nexterm processes, event-loop delay), live sessions with their traffic, the capacity estimate and active alerts.
 * @tags Server Health
 * @produces application/json
 * @security BearerAuth
 * @return {object} 200 - Live health
 */
app.get("/live", async (req, res) => {
    send(res, await healthController.getLive());
});

/**
 * GET /health/history
 * @summary Server Health History
 * @description Load over time: 15-second points for 1h, minute samples bucketed for longer ranges.
 * @tags Server Health
 * @produces application/json
 * @security BearerAuth
 * @param {string} range.query - 1h, 6h, 24h, 7d or 30d (default 1h)
 * @return {object} 200 - Points
 */
app.get("/history", async (req, res) => {
    const query = parse(res, healthHistoryValidation, req.query);
    if (query) send(res, await healthController.getHistory(query));
});

/**
 * GET /health/capacity
 * @summary Capacity Planning
 * @description Estimated remote desktop capacity, daily peaks for 30 days and a weekday/hour usage heatmap.
 * @tags Server Health
 * @produces application/json
 * @security BearerAuth
 * @param {number} tzOffset.query - Viewer time zone offset in minutes (Date.getTimezoneOffset)
 * @return {object} 200 - Capacity data
 */
app.get("/capacity", async (req, res) => {
    const query = parse(res, healthCapacityValidation, req.query);
    if (query) send(res, await healthController.getCapacity(query));
});

/**
 * GET /health/alerts
 * @summary List Server Health Alerts
 * @tags Server Health
 * @produces application/json
 * @security BearerAuth
 * @param {string} status.query - active or resolved
 * @param {number} limit.query - Page size (default 50)
 * @param {number} offset.query - Page offset
 * @return {object} 200 - Alerts and total
 */
app.get("/alerts", async (req, res) => {
    const query = parse(res, healthAlertsValidation, req.query);
    if (query) send(res, await healthController.listAlerts(query));
});

/**
 * POST /health/alerts/{id}/acknowledge
 * @summary Acknowledge Alert
 * @tags Server Health
 * @produces application/json
 * @security BearerAuth
 * @param {number} id.path.required - Alert ID
 * @return {object} 200 - Acknowledged
 */
app.post("/alerts/:id/acknowledge", async (req, res) => {
    const params = parse(res, healthAlertIdValidation, req.params);
    if (params) send(res, await healthController.acknowledgeAlert(req.user.id, params.id));
});

/**
 * GET /health/settings
 * @summary Server Health Settings
 * @description Alert thresholds, link speed and webhook configuration (the webhook URL itself is never returned).
 * @tags Server Health
 * @produces application/json
 * @security BearerAuth
 * @return {object} 200 - Settings
 */
app.get("/settings", async (req, res) => {
    send(res, await healthController.getSettings());
});

/**
 * PATCH /health/settings
 * @summary Update Server Health Settings
 * @tags Server Health
 * @produces application/json
 * @security BearerAuth
 * @return {object} 200 - Updated settings
 */
app.patch("/settings", requirePermission(Permission.SETTINGS_SERVER_HEALTH), async (req, res) => {
    const body = parse(res, healthSettingsValidation, req.body);
    if (body) send(res, await healthController.updateSettings(body));
});

/**
 * POST /health/settings/test-webhook
 * @summary Send Test Notification
 * @description Sends a test message to the given webhook URL, or to the saved one.
 * @tags Server Health
 * @produces application/json
 * @security BearerAuth
 * @return {object} 200 - Sent
 */
app.post("/settings/test-webhook", requirePermission(Permission.SETTINGS_SERVER_HEALTH), async (req, res) => {
    const body = parse(res, healthWebhookTestValidation, req.body || {});
    if (body) send(res, await healthController.testWebhook(body));
});

module.exports = app;
