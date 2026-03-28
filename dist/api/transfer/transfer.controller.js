"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransferHistory = exports.transferAsset = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const transferAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId, transferType, externalType, toBranchId, block, floor, room, temporary, expiresAt, approvedBy } = req.body;
        if (!assetId || !approvedBy || !transferType) {
            res.status(400).json({ message: "Missing required fields" });
        }
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const currentLocation = yield tx.assetLocation.findFirst({
                where: { assetId, isActive: true }
            });
            const fromBranchId = (_a = currentLocation === null || currentLocation === void 0 ? void 0 : currentLocation.branchId) !== null && _a !== void 0 ? _a : null;
            // 1️⃣ Close current location
            yield tx.assetLocation.updateMany({
                where: { assetId, isActive: true },
                data: { isActive: false }
            });
            // 2️⃣ Create new location (only if not DEAD)
            let newLocation = null;
            if (!(transferType === 'EXTERNAL' && externalType === 'DEAD')) {
                newLocation = yield tx.assetLocation.create({
                    data: {
                        assetId,
                        branchId: transferType === 'INTERNAL'
                            ? fromBranchId
                            : Number(toBranchId),
                        block: transferType === 'INTERNAL' ? block : null,
                        floor: transferType === 'INTERNAL' ? floor : null,
                        room: transferType === 'INTERNAL' ? room : null,
                        isActive: true
                    }
                });
            }
            // 3️⃣ Transfer history
            const history = yield tx.assetTransferHistory.create({
                data: {
                    assetId,
                    transferType,
                    externalType,
                    fromBranchId,
                    toBranchId: externalType === 'BRANCH' ? Number(toBranchId) : null,
                    block,
                    floor,
                    room,
                    temporary: temporary !== null && temporary !== void 0 ? temporary : false,
                    expiresAt: temporary ? new Date(expiresAt) : null,
                    approvedBy
                }
            });
            // 4️⃣ Update asset status
            if (externalType === 'DEAD') {
                yield tx.asset.update({
                    where: { id: assetId },
                    data: { status: 'DEAD' }
                });
            }
            return { history, newLocation };
        }));
        res.json(Object.assign({ message: "Asset transferred successfully" }, result));
    }
    catch (err) {
        console.error("Transfer error:", err);
        res.status(500).json({ message: "Transfer failed" });
    }
});
exports.transferAsset = transferAsset;
const getTransferHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = Number(req.params.assetId);
        const history = yield prismaClient_1.default.assetTransferHistory.findMany({
            where: { assetId },
            include: {
                fromBranch: true,
                toBranch: true
            },
            orderBy: { transferDate: "desc" }
        });
        res.json(history);
    }
    catch (err) {
        console.error("Transfer history error:", err);
        res.status(500).json({ message: "Failed to fetch transfer history" });
    }
});
exports.getTransferHistory = getTransferHistory;
// export const autoExpireTransfers = async (req:AuthenticatedRequest, res: Response) => {
//   try {
//     const now = new Date();
//     const expiringTransfers = await prisma.assetTransferHistory.findMany({
//       where: {
//         temporary: true,
//         expiresAt: { lt: now }
//       },
//       orderBy: { id: "desc" },
//       take: 50
//     });
//     const results = [];
//     for (const transfer of expiringTransfers) {
//       const { assetId, fromBranchId, toBranchId } = transfer;
//       // Reverse Transfer → Back to fromBranch
//       if (fromBranchId) {
//         // Close current active location
//         await prisma.assetLocation.updateMany({
//           where: { assetId, isActive: true },
//           data: { isActive: false }
//         });
//         // Create new location entry
//         await prisma.assetLocation.create({
//           data: {
//             assetId,
//             branchId: fromBranchId,
//             isActive: true
//           }
//         });
//         // Log transfer history
//         await prisma.assetTransferHistory.create({
//           data: {
//             assetId,
//             fromBranchId: toBranchId,   // returning from temporary branch
//             toBranchId: fromBranchId,   // going back
//             approvedBy: "SYSTEM-AUTO",
//             temporary: false,
//             expiresAt: null
//           }
//         });
//       }
//       results.push(transfer.id);
//     }
//     res.json({
//       message: "Temporary transfers auto expired and reverted",
//       processed: results
//     });
//   } catch (err) {
//     console.error("Auto-expire error:", err);
//     res.status(500).json({ message: "Auto-expire process failed" });
//   }
// };
