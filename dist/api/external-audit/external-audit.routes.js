"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const externalAuditorMiddleware_1 = require("../../middleware/externalAuditorMiddleware");
const external_audit_controller_1 = require("./external-audit.controller");
const router = express_1.default.Router();
// All routes under /api/mobile/external/* require an external auditor JWT
// and re-check the master record's ACTIVE status on every request.
router.use(externalAuditorMiddleware_1.externalAuditorAuth);
router.get("/audits", external_audit_controller_1.listMyAudits);
router.get("/audits/:id", external_audit_controller_1.getMyAuditById);
router.get("/audits/:id/floor-map", external_audit_controller_1.getMyAuditFloorMap);
router.get("/audits/:id/next-item", external_audit_controller_1.getMyAuditNextItem);
router.put("/audits/:id/start", external_audit_controller_1.startMyAudit);
router.put("/audits/:id/complete", external_audit_controller_1.completeMyAudit);
router.put("/audit-items/:itemId/verify", external_audit_controller_1.verifyMyAuditItem);
exports.default = router;
