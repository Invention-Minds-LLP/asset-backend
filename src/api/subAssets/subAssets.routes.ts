import { Router } from "express";
import {
  getSubAssetsByAssetId,
  linkOrDetachParent,
  getAssetTree,
  getParentOptions,
  createSubAsset,
  getSparePartOptions,
  replaceSubAsset,
  getReplacementHistory,
} from "./subAssets.controller";

const router = Router();

// dropdown options
router.get("/parent-options", getParentOptions);
router.get("/options", getSparePartOptions);

// tree view
router.get("/:assetId/tree", getAssetTree);

// list children
router.get("/:assetId/children", getSubAssetsByAssetId);

// replacement history for a parent asset
router.get("/:parentAssetId/replacement-history", getReplacementHistory);

// create sub-asset under parent
router.post("/:parentAssetId/sub-assets", createSubAsset);

// replace a specific sub-asset
router.post("/:parentAssetId/sub-assets/:oldSubAssetId/replace", replaceSubAsset);

// set / clear parent of a child
router.patch("/:childAssetId/link-parent", linkOrDetachParent);

export default router;