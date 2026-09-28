const Joi = require("joi");

const sessionFilters = {
    organizationId: Joi.alternatives().try(
        Joi.number().integer().positive(),
        Joi.string().valid("personal"),
    ).optional(),
    accountId: Joi.number().integer().positive().optional(),
    entryId: Joi.number().integer().positive().optional(),
    status: Joi.string().valid("live", "ended", "unknown").optional(),
    from: Joi.date().iso().optional(),
    to: Joi.date().iso().min(Joi.ref("from")).optional(),
};

module.exports.usageSessionsValidation = Joi.object({
    ...sessionFilters,
    limit: Joi.number().integer().min(1).max(500).default(50),
    offset: Joi.number().integer().min(0).default(0),
});

module.exports.usageExportValidation = Joi.object(sessionFilters);

module.exports.usageSessionIdValidation = Joi.object({
    sessionId: Joi.string().uuid().required(),
});
