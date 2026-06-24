import { Router } from "express";
import { externalAuditorAuth } from "../../middleware/externalAuditorMiddleware";
import { listAuditsForCA, caApprove, caReject } from "./depreciation-audit.controller";

const router = Router();

// All routes require an external auditor (CA) JWT.
router.use(externalAuditorAuth);

router.get("/", listAuditsForCA);
router.post("/:id/approve", caApprove);
router.post("/:id/reject", caReject);

export default router;
