"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const store_controller_1 = require("./store.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/hierarchy/tree", authMiddleware_1.authenticateToken, store_controller_1.getStoreHierarchy);
router.get("/", authMiddleware_1.authenticateToken, store_controller_1.getAllStores);
router.get("/:id", authMiddleware_1.authenticateToken, store_controller_1.getStoreById);
router.post("/", authMiddleware_1.authenticateToken, store_controller_1.createStore);
router.put("/:id", authMiddleware_1.authenticateToken, store_controller_1.updateStore);
router.delete("/:id", authMiddleware_1.authenticateToken, store_controller_1.deleteStore);
router.get("/:id/locations", authMiddleware_1.authenticateToken, store_controller_1.getStoreLocations);
router.post("/:id/locations", authMiddleware_1.authenticateToken, store_controller_1.createStoreLocation);
exports.default = router;
