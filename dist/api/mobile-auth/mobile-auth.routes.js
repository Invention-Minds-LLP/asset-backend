"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mobile_auth_controller_1 = require("./mobile-auth.controller");
const mobileAuthMiddleware_1 = require("../../middleware/mobileAuthMiddleware");
const router = express_1.default.Router();
router.post("/login", mobile_auth_controller_1.mobileLogin);
router.get("/dashboard", mobileAuthMiddleware_1.mobileAuth, mobile_auth_controller_1.getMobileDashboard);
router.get("/assets", mobileAuthMiddleware_1.mobileAuth, mobile_auth_controller_1.getMobileAssetList);
router.post("/raise-ticket", mobileAuthMiddleware_1.mobileAuth, mobile_auth_controller_1.mobileRaiseTicket);
router.get("/profile", mobileAuthMiddleware_1.mobileAuth, mobile_auth_controller_1.getMobileProfile);
exports.default = router;
