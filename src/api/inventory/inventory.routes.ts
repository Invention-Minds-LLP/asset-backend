import { Router } from "express";
import {
  createSparePart,
  getAllSpareParts,
  updateSparePart,
  deleteSparePart,
  createConsumable,
  getAllConsumables,
  updateConsumable,
  deleteConsumable,
  getSparePartTransactions,
  getConsumableTransactions,
  adjustSparePartStock,
  adjustConsumableStock,
  getSparePartStores,
  getConsumableStores,
  getConsumableBatches,
  addConsumableBatch,
  getExpiringBatches,
  requestSparePartReorder,
  requestConsumableReorder
} from "./inventory.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

// All inventory endpoints require a valid login.
router.use(authenticateToken);

// ================= SPARE PARTS =================
router.post("/spare-parts", createSparePart);
router.get("/spare-parts", getAllSpareParts);
router.get("/spare-parts/:id/transactions", getSparePartTransactions);
router.get("/spare-parts/:id/stores", getSparePartStores);
router.post("/spare-parts/:id/adjust", adjustSparePartStock);
router.post("/spare-parts/:id/reorder", requestSparePartReorder);
router.put("/spare-parts/:id", updateSparePart);
router.delete("/spare-parts/:id", deleteSparePart);

// ================= CONSUMABLES =================
router.post("/consumables", createConsumable);
router.get("/consumables", getAllConsumables);
router.get("/consumables/batches/expiring", getExpiringBatches);
router.get("/consumables/:id/transactions", getConsumableTransactions);
router.get("/consumables/:id/stores", getConsumableStores);
router.get("/consumables/:id/batches", getConsumableBatches);
router.post("/consumables/:id/batches", addConsumableBatch);
router.post("/consumables/:id/adjust", adjustConsumableStock);
router.post("/consumables/:id/reorder", requestConsumableReorder);
router.put("/consumables/:id", updateConsumable);
router.delete("/consumables/:id", deleteConsumable);

export default router;