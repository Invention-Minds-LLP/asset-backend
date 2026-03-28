import { Router } from "express";
import {
  getSubAssetsByAssetId,
  linkOrDetachParent,
  getAssetTree,
  getParentOptions,
  createSubAsset,
  getSparePartOptions,
} from "./subAssets.controller"

const router = Router();


router.post("/:parentAssetId/sub-assets", createSubAsset);
// dropdown options
router.get("/parent-options", getParentOptions);

router.get("/options", getSparePartOptions);

// tree view (optional)
router.get("/:assetId/tree", getAssetTree);

// list children
router.get("/:assetId/children", getSubAssetsByAssetId);

// set / clear parent of a child
router.patch("/:childAssetId/link-parent", linkOrDetachParent);

export default router;