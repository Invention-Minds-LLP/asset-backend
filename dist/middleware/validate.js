"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBody = void 0;
// Centralised request-body validation.
// The schema only validates — req.body is left untouched, so fields a schema
// does not cover still reach the controller unchanged. Invalid input is
// rejected with a 400 before any controller logic runs.
const validateBody = (schema) => {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({
                message: "Validation failed",
                errors: result.error.issues.map((i) => ({
                    field: i.path.join(".") || "(body)",
                    message: i.message,
                })),
            });
            return;
        }
        next();
    };
};
exports.validateBody = validateBody;
