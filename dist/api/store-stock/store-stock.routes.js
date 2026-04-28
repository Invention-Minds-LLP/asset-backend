"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const store_stock_controller_1 = require("./store-stock.controller");
const router = (0, express_1.Router)();
// Static routes must come before parameterized routes
router.get("/summary/all", authMiddleware_1.authenticateToken, store_stock_controller_1.getStockSummary);
router.get("/alerts/low-stock", authMiddleware_1.authenticateToken, store_stock_controller_1.getLowStockAlerts);
router.get("/:storeId", authMiddleware_1.authenticateToken, store_stock_controller_1.getStockByStore);
router.post("/:storeId/adjust", authMiddleware_1.authenticateToken, store_stock_controller_1.adjustStock);
router.get("/:storeId/movements", authMiddleware_1.authenticateToken, store_stock_controller_1.getStockMovements);
exports.default = router;
