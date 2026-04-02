"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const multer_1 = __importDefault(require("multer"));
const storage = multer_1.default.diskStorage({
    destination: "uploads/insurance",
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});
exports.upload = (0, multer_1.default)({ storage });
const router = express_1.default.Router();
const insurance_controller_1 = require("./insurance.controller");
// Standalone insurance management pages
router.get("/all", authMiddleware_1.authenticateToken, insurance_controller_1.getAllInsurancePolicies);
router.get("/claims/all", authMiddleware_1.authenticateToken, insurance_controller_1.getAllInsuranceClaims);
router.get("/stats", authMiddleware_1.authenticateToken, insurance_controller_1.getInsuranceStats);
router.post("/", authMiddleware_1.authenticateToken, insurance_controller_1.addInsurancePolicy);
router.put("/:id", authMiddleware_1.authenticateToken, insurance_controller_1.updateInsurancePolicy);
router.get("/asset/:id", authMiddleware_1.authenticateToken, insurance_controller_1.getInsuranceHistory);
router.post("/expire-check", authMiddleware_1.authenticateToken, insurance_controller_1.markInsuranceExpired);
// RENEWAL
router.post("/renew", authMiddleware_1.authenticateToken, insurance_controller_1.renewInsurancePolicy);
// CLAIM
router.post("/claim", authMiddleware_1.authenticateToken, insurance_controller_1.createInsuranceClaim);
router.put("/claim/:id", authMiddleware_1.authenticateToken, insurance_controller_1.updateClaimStatus);
router.get("/claims/:assetId", authMiddleware_1.authenticateToken, insurance_controller_1.getClaimsByAsset);
router.post("/:id/upload", authMiddleware_1.authenticateToken, exports.upload.single("document"), insurance_controller_1.uploadInsuranceDocument);
exports.default = router;
