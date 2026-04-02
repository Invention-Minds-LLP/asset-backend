"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const inventory_controller_1 = require("./inventory.controller");
const router = (0, express_1.Router)();
// ================= SPARE PARTS =================
router.post("/spare-parts", inventory_controller_1.createSparePart);
router.get("/spare-parts", inventory_controller_1.getAllSpareParts);
router.put("/spare-parts/:id", inventory_controller_1.updateSparePart);
router.delete("/spare-parts/:id", inventory_controller_1.deleteSparePart);
// ================= CONSUMABLES =================
router.post("/consumables", inventory_controller_1.createConsumable);
router.get("/consumables", inventory_controller_1.getAllConsumables);
router.put("/consumables/:id", inventory_controller_1.updateConsumable);
router.delete("/consumables/:id", inventory_controller_1.deleteConsumable);
exports.default = router;
