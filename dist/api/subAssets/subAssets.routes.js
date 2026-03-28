"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const subAssets_controller_1 = require("./subAssets.controller");
const router = (0, express_1.Router)();
router.post("/:parentAssetId/sub-assets", subAssets_controller_1.createSubAsset);
// dropdown options
router.get("/parent-options", subAssets_controller_1.getParentOptions);
router.get("/options", subAssets_controller_1.getSparePartOptions);
// tree view (optional)
router.get("/:assetId/tree", subAssets_controller_1.getAssetTree);
// list children
router.get("/:assetId/children", subAssets_controller_1.getSubAssetsByAssetId);
// set / clear parent of a child
router.patch("/:childAssetId/link-parent", subAssets_controller_1.linkOrDetachParent);
exports.default = router;
