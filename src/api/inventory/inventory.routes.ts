import { Router } from "express";
import {
  createSparePart,
  getAllSpareParts,
  updateSparePart,
  deleteSparePart,
  createConsumable,
  getAllConsumables,
  updateConsumable,
  deleteConsumable
} from "./inventory.controller";

const router = Router();

// ================= SPARE PARTS =================
router.post("/spare-parts", createSparePart);
router.get("/spare-parts", getAllSpareParts);
router.put("/spare-parts/:id", updateSparePart);
router.delete("/spare-parts/:id", deleteSparePart);

// ================= CONSUMABLES =================
router.post("/consumables", createConsumable);
router.get("/consumables", getAllConsumables);
router.put("/consumables/:id", updateConsumable);
router.delete("/consumables/:id", deleteConsumable);

export default router;