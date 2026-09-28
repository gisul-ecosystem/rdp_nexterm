const { Router } = require("express");
const usageController = require("../controllers/usage");
const { usageSessionsValidation, usageExportValidation, usageSessionIdValidation } = require("../validations/usage");

const app = Router();

const parse = (res, schema, input) => {
    const { error, value } = schema.validate(input, { errors: { wrap: { label: "" } } });
    if (!error) return value;
    res.status(400).json({ message: error.details[0].message });
    return null;
};

const send = (res, result) => result?.code ? res.status(result.code).json({ message: result.message }) : res.json(result);

/**
 * GET /usage/sessions
 * @summary List VM Usage Sessions
 * @description One row per remote session with login, logout, duration and how it ended, plus totals per user and per machine. System administrators see all users; others see their own sessions and those of organizations they may audit.
 * @tags Usage
 * @produces application/json
 * @security BearerAuth
 * @param {string} from.query - Sessions started at or after this time (ISO 8601)
 * @param {string} to.query - Sessions started at or before this time (ISO 8601)
 * @param {number} accountId.query - Filter by user
 * @param {number} entryId.query - Filter by machine
 * @param {string} organizationId.query - Organization ID or "personal"
 * @param {string} status.query - live, ended or unknown
 * @param {number} limit.query - Page size (default 50)
 * @param {number} offset.query - Page offset
 * @return {object} 200 - Sessions, totals, per-user and per-machine usage
 */
app.get("/sessions", async (req, res) => {
    const filters = parse(res, usageSessionsValidation, req.query);
    if (filters) send(res, await usageController.listSessions(req.user.id, filters));
});

/**
 * GET /usage/sessions.csv
 * @summary Export VM Usage Sessions
 * @description Same filters as GET /usage/sessions, returned as a CSV file with every matching session.
 * @tags Usage
 * @produces text/csv
 * @security BearerAuth
 * @return {file} 200 - CSV file
 */
app.get("/sessions.csv", async (req, res) => {
    const filters = parse(res, usageExportValidation, req.query);
    if (!filters) return;
    const result = await usageController.exportSessionsCsv(req.user.id, filters);
    if (result.code) return send(res, result);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="nexterm-usage-${date}.csv"`);
    res.send("\uFEFF" + result.csv);
});

/**
 * GET /usage/options
 * @summary Usage Filter Options
 * @description Users, machines and organizations that appear in the usage history visible to the caller.
 * @tags Usage
 * @produces application/json
 * @security BearerAuth
 * @return {object} 200 - Filter options
 */
app.get("/options", async (req, res) => {
    send(res, await usageController.listFilterOptions(req.user.id));
});

/**
 * GET /usage/live
 * @summary List Live Sessions
 * @description Sessions currently open on the server, with their state (active, unattended, hibernated, connecting).
 * @tags Usage
 * @produces application/json
 * @security BearerAuth
 * @return {array} 200 - Live sessions
 */
app.get("/live", async (req, res) => {
    send(res, await usageController.listLiveSessions(req.user.id));
});

/**
 * DELETE /usage/live/{sessionId}
 * @summary Disconnect Live Session
 * @description Ends a live session. Users can end their own sessions; system administrators can end anyone's, which is recorded as admin_disconnect.
 * @tags Usage
 * @produces application/json
 * @security BearerAuth
 * @param {string} sessionId.path.required - Session ID
 * @return {object} 200 - Session disconnected
 * @return {object} 403 - Not allowed to disconnect this session
 * @return {object} 404 - Session not found
 */
app.delete("/live/:sessionId", async (req, res) => {
    const params = parse(res, usageSessionIdValidation, req.params);
    if (params) send(res, await usageController.disconnectSession(req.user.id, params.sessionId));
});

module.exports = app;
