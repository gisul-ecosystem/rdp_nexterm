const Joi = require("joi");
const { RULES, WEBHOOK_FORMATS } = require("../utils/healthAlerts");

const threshold = Joi.number().min(0).max(100000);

const ruleSchema = Joi.object({
    enabled: Joi.boolean(),
    warning: threshold.allow(null),
    critical: threshold,
    minutes: Joi.number().integer().min(0).max(120),
});

module.exports.healthHistoryValidation = Joi.object({
    range: Joi.string().valid("1h", "6h", "24h", "7d", "30d").default("1h"),
});

module.exports.healthCapacityValidation = Joi.object({
    tzOffset: Joi.number().integer().min(-840).max(840).default(0),
});

module.exports.healthAlertsValidation = Joi.object({
    status: Joi.string().valid("active", "resolved").optional(),
    limit: Joi.number().integer().min(1).max(200).default(50),
    offset: Joi.number().integer().min(0).default(0),
});

module.exports.healthAlertIdValidation = Joi.object({
    id: Joi.number().integer().positive().required(),
});

const webhookUrl = Joi.string().uri({ scheme: ["http", "https"] }).max(2048);

module.exports.healthSettingsValidation = Joi.object({
    serverLabel: Joi.string().trim().max(64).allow("", null),
    linkMbps: Joi.number().integer().min(1).max(400000).allow(null),
    primaryInterface: Joi.string().pattern(/^[\w.:-]{1,32}$/).allow("", null),
    rules: Joi.object(Object.fromEntries(Object.keys(RULES).map((key) => [key, ruleSchema]))),
    webhookEnabled: Joi.boolean(),
    webhookFormat: Joi.string().valid(...WEBHOOK_FORMATS),
    webhookUrl: webhookUrl.allow("", null),
    notifyResolved: Joi.boolean(),
    retentionDays: Joi.number().integer().min(7).max(90),
}).min(1);

module.exports.healthWebhookTestValidation = Joi.object({
    webhookUrl: webhookUrl.optional(),
    webhookFormat: Joi.string().valid(...WEBHOOK_FORMATS).optional(),
});
