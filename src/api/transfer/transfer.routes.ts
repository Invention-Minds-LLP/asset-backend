import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import multer from "multer";

const upload = multer({ dest: "uploads/" });
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
  completeTransferredAssetReturn
} from "./transfer.controller";

const router = express.Router();

router.post("/assets/transfer/request", authenticateToken, requestAssetTransfer);
router.post("/assets/transfer/:id/approve", authenticateToken, approveAssetTransfer);
router.post("/assets/transfer/:id/reject", authenticateToken, rejectAssetTransfer);
router.post("/assets/transfer/:id/return", authenticateToken, requestTransferredAssetReturn);
router.get("/assets/:assetId/transfer-history", authenticateToken, getTransferHistory);
router.get("/assets/transfer/pending", authenticateToken, getPendingTransferRequests);
router.get("/assets/transfer/my-pending-approvals", authenticateToken, getMyPendingTransferApprovals);
router.post("/assets/transfer/:id/return", authenticateToken, requestTransferredAssetReturn);
router.post("/assets/transfer/:id/approve-return", authenticateToken, approveTransferredAssetReturn);
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