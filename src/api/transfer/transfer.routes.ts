import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import multer from "multer";
import { tempUploadDir } from "../../lib/fileStorage";

// Staging only — the controller moves the photo into permanent storage. "uploads/"
// staged it inside the tree served at /uploads, exposing it before it was named.
const upload = multer({ dest: tempUploadDir() });
import {
  requestAssetTransfer,
  approveAssetTransfer,
  rejectAssetTransfer,
  returnTransferredAsset,
  getTransferHistory,
  getPendingTransferRequests,
  getMyPendingTransferApprovals,
  requestTransferredAssetReturn,
  approveTransferredAssetReturn,
  getTransferredAssetReturnChecklist,
  completeTransferredAssetReturn,
  managementApproveTransfer,
  getPendingMgmtApprovals
} from "./transfer.controller";

const router = express.Router();

router.post("/assets/transfer/request", authenticateToken, requestAssetTransfer);
router.post("/assets/transfer/:id/management-approve", authenticateToken, managementApproveTransfer);
router.post("/assets/transfer/:id/approve", authenticateToken, approveAssetTransfer);
router.post("/assets/transfer/:id/reject", authenticateToken, rejectAssetTransfer);
router.post("/assets/transfer/:id/return", authenticateToken, requestTransferredAssetReturn);
router.get("/assets/:assetId/transfer-history", authenticateToken, getTransferHistory);
router.get("/assets/transfer/pending", authenticateToken, getPendingTransferRequests);
router.get("/assets/transfer/my-pending-approvals", authenticateToken, getMyPendingTransferApprovals);
router.get("/assets/transfer/pending-mgmt-approvals", authenticateToken, getPendingMgmtApprovals);
router.post("/assets/transfer/:id/approve-return", authenticateToken, approveTransferredAssetReturn);
// A return row is an AssetTransferHistory row in REQUESTED state, so the same
// HOD-scoped rejection handler applies — it just closes the return request and
// leaves the parent transfer approved, so the return can be re-raised.
router.post("/assets/transfer/:id/reject-return", authenticateToken, rejectAssetTransfer);
router.get(
  "/assets/transfer/:id/return-checklist",
  authenticateToken,
  getTransferredAssetReturnChecklist
);

router.post(
  "/assets/transfer/:id/complete-return",
  authenticateToken,
  upload.single("photo"),
  completeTransferredAssetReturn
);

export default router;