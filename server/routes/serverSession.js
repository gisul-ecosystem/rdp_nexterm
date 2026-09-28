const { Router } = require("express");
const { createSession, getSessions, getSession, hibernateSession, resumeSession, deleteSession, startSharing, stopSharing, updateSharePermissions, duplicateSession, pasteIdentityPassword } = require("../controllers/serverSession");
const { execCommand } = require("../controllers/execCommand");
const { createSessionValidation, sessionIdValidation, resumeSessionValidation, duplicateSessionValidation } = require("../validations/serverSession");
const { validateSchema } = require("../utils/schema");
const stateBroadcaster = require("../lib/StateBroadcaster");
const SessionAccessRequest = require("../lib/SessionAccessRequest");

const app = Router();

/**
 * POST /connections
 * @summary Create Connection
 * @description Creates a new server connection.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {object} request.body.required - Session creation details
 * @return {object} 201 - Session created
 */
app.post("/", async (req, res) => {
    if (validateSchema(res, createSessionValidation, req.body)) return;
    
    try {
        const { entryId, identityId, connectionReason, type, directIdentity, tabId, browserId, scriptId, startPath, permissionRequestId, takeOver } = req.body;
        const ipAddress = req.ip || req.socket?.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const result = await createSession(req.user.id, entryId, identityId, connectionReason, type, directIdentity, tabId, browserId, scriptId, startPath, ipAddress, userAgent, permissionRequestId, req.session?.id ?? null, takeOver ?? null);
        
        if (result?.code) {
            const { code, message, ...rest } = result;
            return res.status(code).json({ error: message, ...rest });
        }

        res.status(201).json(result);
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /connections/access-requests/{id}
 * @summary Get access request status
 * @description Returns a pending or recently resolved request to take over a busy session.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Access request ID
 */
app.get("/access-requests/:id", (req, res) => {
    const reqObj = SessionAccessRequest.getRequest(req.params.id);
    if (!reqObj) return res.status(404).json({ error: "Access request not found" });
    const accountId = req.user.id;
    if (accountId !== reqObj.requesterAccountId && accountId !== reqObj.holderAccountId) {
        return res.status(403).json({ error: "Access denied" });
    }
    res.json(SessionAccessRequest.serializeRequest(reqObj));
});

/**
 * POST /connections/access-requests/{id}/respond
 * @summary Respond to access request
 * @description The active session owner allows or denies another user's takeover request.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Access request ID
 */
app.post("/access-requests/:id/respond", async (req, res) => {
    const actor = { accountId: req.user.id, loginSessionId: req.session?.id ?? null, browserId: req.body?.browserId ?? null };
    const result = await SessionAccessRequest.resolveRequest(req.params.id, req.body?.decision, actor);
    if (result?.code) {
        const { code, message, ...rest } = result;
        return res.status(code).json({ error: message, ...rest });
    }
    res.json(result);
});

/**
 * DELETE /connections/access-requests/{id}
 * @summary Cancel access request
 * @description The requester stops waiting; the active session owner's prompt is withdrawn.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Access request ID
 */
app.delete("/access-requests/:id", (req, res) => {
    const actor = { accountId: req.user.id, loginSessionId: req.session?.id ?? null, browserId: req.query?.browserId ?? null };
    const result = SessionAccessRequest.cancelRequest(req.params.id, actor);
    if (result?.code) {
        const { code, message, ...rest } = result;
        return res.status(code).json({ error: message, ...rest });
    }
    res.json(result);
});

/**
 * GET /connections
 * @summary Get Connections
 * @description Retrieves all active server connections for the user.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @return {array} 200 - List of sessions
 */
app.get("/", async (req, res) => {
    const { tabId, browserId } = req.query;
    res.json(await getSessions(req.user.id, tabId, browserId));
});

/**
 * GET /connections/{id}
 * @summary Get Connection
 * @description Retrieves a specific server connection.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Session ID
 * @return {object} 200 - Session details
 */
app.get("/:id", async (req, res) => {
    if (validateSchema(res, sessionIdValidation, req.params)) return;
    
    const result = await getSession(req.user.id, req.params.id);
    if (result?.code) {
        return res.status(result.code).json({ error: result.message });
    }
    res.json(result);
});

/**
 * POST /connections/{id}/hibernate
 * @summary Hibernate Connection
 * @description Hibernates a server connection.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Session ID
 * @return {object} 200 - Success message
 */
app.post("/:id/hibernate", async (req, res) => {
    if (validateSchema(res, sessionIdValidation, req.params)) return;
    
    const result = await hibernateSession(req.user.id, req.params.id);
    if (result?.code) {
        return res.status(result.code).json({ error: result.message });
    }
    stateBroadcaster.broadcast("CONNECTIONS", { accountId: req.user.id });
    res.json(result);
});

/**
 * POST /connections/{id}/resume
 * @summary Resume Connection
 * @description Resumes a hibernated server connection.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Session ID
 * @return {object} 200 - Success message
 */
app.post("/:id/resume", async (req, res) => {
    if (validateSchema(res, sessionIdValidation, req.params)) return;
    if (validateSchema(res, resumeSessionValidation, req.body)) return;
    
    const { tabId, browserId } = req.body;
    const result = await resumeSession(req.user.id, req.params.id, tabId, browserId, req.session?.id ?? null);
    if (result?.code) {
        return res.status(result.code).json({ error: result.message });
    }
    stateBroadcaster.broadcast("CONNECTIONS", { accountId: req.user.id });
    res.json(result);
});

/**
 * DELETE /connections/{id}
 * @summary Delete Connection
 * @description Deletes a server connection.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Session ID
 * @return {object} 200 - Success message
 */
app.delete("/:id", async (req, res) => {
    if (validateSchema(res, sessionIdValidation, req.params)) return;
    
    const result = await deleteSession(req.user.id, req.params.id);
    if (result?.code) {
        return res.status(result.code).json({ error: result.message });
    }
    stateBroadcaster.broadcast("CONNECTIONS", { accountId: req.user.id });
    res.json(result);
});

/**
 * POST /connections/{id}/share
 * @summary Start Sharing
 * @description Starts sharing a session.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Session ID
 * @return {object} 200 - Share details
 */
app.post("/:id/share", (req, res) => {
    if (validateSchema(res, sessionIdValidation, req.params)) return;
    const result = startSharing(req.user.id, req.params.id, req.body?.writable === true);
    if (result?.code) return res.status(result.code).json({ error: result.message });
    stateBroadcaster.broadcast("CONNECTIONS", { accountId: req.user.id });
    res.json(result);
});

/**
 * DELETE /connections/{id}/share
 * @summary Stop Sharing
 * @description Stops sharing a session.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Session ID
 * @return {object} 200 - Success message
 */
app.delete("/:id/share", (req, res) => {
    if (validateSchema(res, sessionIdValidation, req.params)) return;
    const result = stopSharing(req.user.id, req.params.id);
    if (result?.code) return res.status(result.code).json({ error: result.message });
    stateBroadcaster.broadcast("CONNECTIONS", { accountId: req.user.id });
    res.json(result);
});

/**
 * PATCH /connections/{id}/share
 * @summary Update Share Permissions
 * @description Updates share permissions for a session.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Session ID
 * @return {object} 200 - Updated permissions
 */
app.patch("/:id/share", (req, res) => {
    if (validateSchema(res, sessionIdValidation, req.params)) return;
    const result = updateSharePermissions(req.user.id, req.params.id, req.body?.writable === true);
    if (result?.code) return res.status(result.code).json({ error: result.message });
    stateBroadcaster.broadcast("CONNECTIONS", { accountId: req.user.id });
    res.json(result);
});

/**
 * POST /connections/{id}/duplicate
 * @summary Duplicate Connection
 * @description Creates a new connection with the same configuration as an existing one.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Session ID
 * @return {object} 201 - New session created
 */
app.post("/:id/duplicate", async (req, res) => {
    if (validateSchema(res, sessionIdValidation, req.params)) return;
    if (validateSchema(res, duplicateSessionValidation, req.body)) return;
    
    const { tabId, browserId } = req.body;
    const ipAddress = req.ip || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    const result = await duplicateSession(req.user.id, req.params.id, tabId, browserId, ipAddress, userAgent, req.session?.id ?? null);
    if (result?.code) {
        return res.status(result.code).json({ error: result.message });
    }
    stateBroadcaster.broadcast("CONNECTIONS", { accountId: req.user.id });
    res.status(201).json(result);
});

/**
 * POST /connections/{id}/paste-password
 * @summary Paste identity password into session
 * @description Inserts the password of an identity attached to the session's server into the active session stream. Defaults to the session's identity; an optional identityId in the body selects another identity attached to the same server.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {string} id.path.required - Session ID
 */
app.post("/:id/paste-password", async (req, res) => {
    if (validateSchema(res, sessionIdValidation, req.params)) return;

    let identityId = null;
    if (req.body?.identityId !== undefined && req.body?.identityId !== null) {
        identityId = Number.parseInt(req.body.identityId, 10);
        if (Number.isNaN(identityId)) return res.status(400).json({ error: "Invalid identity ID" });
    }

    try {
        const result = await pasteIdentityPassword(req.user.id, req.params.id, req.ip, req.headers?.["user-agent"], identityId);
        if (result?.code) return res.status(result.code).json({ error: result.message });
        res.json(result);
    } catch (error) {
        console.error('Error pasting identity password:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /connections/{entryId}/exec
 * @summary Execute Command
 * @description Executes a single command on a server entry and returns the output.
 * @tags Connection
 * @produces application/json
 * @security BearerAuth
 * @param {number} entryId.path.required - Entry ID
 * @param {object} request.body.required - Command to execute
 * @return {object} 200 - Command result with stdout, stderr, exitCode
 */
app.post("/:entryId/exec", async (req, res) => {
    try {
        const entryId = parseInt(req.params.entryId, 10);
        if (isNaN(entryId)) return res.status(400).json({ error: "Invalid entry ID" });

        const { command } = req.body;
        if (!command || typeof command !== "string") {
            return res.status(400).json({ error: "Command is required" });
        }

        const identityId = req.query.identityId ? parseInt(req.query.identityId, 10) : null;
        const result = await execCommand(req.user.id, entryId, identityId, command);

        if (result?.code) {
            return res.status(result.code).json({ error: result.message });
        }

        res.json(result);
    } catch (error) {
        console.error('Error executing command:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = app;
