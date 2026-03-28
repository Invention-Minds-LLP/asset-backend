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
exports.getClaimsByAsset = exports.updateClaimStatus = exports.createInsuranceClaim = exports.renewInsurancePolicy = exports.uploadInsuranceDocument = exports.markInsuranceExpired = exports.getInsuranceHistory = exports.updateInsurancePolicy = exports.addInsurancePolicy = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const addInsurancePolicy = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
        //    res.status(403).json({ message: "Not allowed" });
        //    return;
        // }
        const { assetId, provider, policyNumber, coverageAmount, premiumAmount, startDate, endDate, notes, policyType, renewalReminderDays } = req.body;
        const today = new Date();
        const policyStatus = endDate && new Date(endDate) < today ? "EXPIRED" : "ACTIVE";
        const insurance = yield prismaClient_1.default.assetInsurance.create({
            data: {
                assetId: Number(assetId),
                provider,
                policyNumber,
                coverageAmount: coverageAmount ? parseFloat(coverageAmount) : null,
                premiumAmount: premiumAmount ? parseFloat(premiumAmount) : null,
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null,
                isActive: true,
                policyStatus,
                notes,
                policyType: policyType,
                renewalReminderDays: renewalReminderDays
            }
        });
        res.status(201).json(insurance);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to add insurance policy" });
        return;
    }
});
exports.addInsurancePolicy = addInsurancePolicy;
const updateInsurancePolicy = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        // if (req.user.role !== "superadmin") {
        //    res.status(403).json({ message: "Admins only" });
        //    return
        // }
        const id = Number(req.params.id);
        const data = req.body;
        const today = new Date();
        const policyStatus = data.endDate && new Date(data.endDate) < today ? "EXPIRED" : "ACTIVE";
        const updated = yield prismaClient_1.default.assetInsurance.update({
            where: { id },
            data: {
                provider: data.provider,
                policyNumber: data.policyNumber,
                coverageAmount: data.coverageAmount ? parseFloat(data.coverageAmount) : null,
                premiumAmount: data.premiumAmount ? parseFloat(data.premiumAmount) : null,
                startDate: data.startDate ? new Date(data.startDate) : null,
                endDate: data.endDate ? new Date(data.endDate) : null,
                policyStatus,
                isActive: (_a = data.isActive) !== null && _a !== void 0 ? _a : true,
                notes: data.notes,
                policyType: data.policyType,
                renewalReminderDays: data.renewalReminderDays
            }
        });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update insurance" });
    }
});
exports.updateInsurancePolicy = updateInsurancePolicy;
const getInsuranceHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = Number(req.params.id);
        // const asset = await prisma.asset.findUnique({
        //   where: { id: assetId }
        // })
        // if (!asset) {
        //   res.status(400).json({ message: "Asset is not found" });
        //   return
        // }
        const history = yield prismaClient_1.default.assetInsurance.findMany({
            where: { assetId },
            orderBy: { id: "desc" }
        });
        res.json(history);
        return;
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching insurance history" });
    }
});
exports.getInsuranceHistory = getInsuranceHistory;
const markInsuranceExpired = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const today = new Date();
        const expiredPolicies = yield prismaClient_1.default.assetInsurance.updateMany({
            where: {
                endDate: { lt: today },
                isActive: true
            },
            data: {
                isActive: false,
                policyStatus: 'EXPIRED'
            }
        });
        res.json({
            message: "Expired policies updated",
            total: expiredPolicies.count
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to expire policies" });
    }
});
exports.markInsuranceExpired = markInsuranceExpired;
const uploadInsuranceDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        if (!req.file) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }
        const filePath = `/uploads/insurance/${req.file.filename}`;
        const updated = yield prismaClient_1.default.assetInsurance.update({
            where: { id },
            data: { document: filePath }
        });
        res.json({
            message: "Insurance document uploaded",
            file: filePath
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Upload failed" });
    }
});
exports.uploadInsuranceDocument = uploadInsuranceDocument;
const renewInsurancePolicy = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId, provider, policyNumber, coverageAmount, premiumAmount, startDate, endDate, notes, policyType, renewalReminderDays } = req.body;
        if (!assetId || !policyNumber || !startDate || !endDate) {
            res.status(400).json({ message: 'Missing required fields' });
            return;
        }
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (end <= start) {
            res.status(400).json({ message: 'End date must be after start date' });
            return;
        }
        // 1️⃣ deactivate current active policy (do NOT force expired)
        yield prismaClient_1.default.assetInsurance.updateMany({
            where: {
                assetId: Number(assetId),
                isActive: true
            },
            data: {
                isActive: false
            }
        });
        // 2️⃣ create new policy
        const today = new Date();
        const policyStatus = end < today ? 'EXPIRED' : 'ACTIVE';
        const newPolicy = yield prismaClient_1.default.assetInsurance.create({
            data: {
                assetId: Number(assetId),
                provider,
                policyNumber,
                coverageAmount: coverageAmount ? parseFloat(coverageAmount) : null,
                premiumAmount: premiumAmount ? parseFloat(premiumAmount) : null,
                startDate: start,
                endDate: end,
                isActive: true,
                policyStatus,
                notes,
                policyType,
                renewalReminderDays: renewalReminderDays !== null && renewalReminderDays !== void 0 ? renewalReminderDays : 30
            }
        });
        res.json({
            message: 'Policy renewed successfully',
            data: newPolicy
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Renewal failed' });
    }
});
exports.renewInsurancePolicy = renewInsurancePolicy;
const createInsuranceClaim = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { assetId, insuranceId, claimNumber, claimDate, claimAmount, reason } = req.body;
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        if (!assetId || !insuranceId || !claimNumber || !claimDate || claimAmount == null) {
            res.status(400).json({ message: "Missing required fields" });
            return;
        }
        const amount = typeof claimAmount === "string" ? parseFloat(claimAmount) : Number(claimAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            res.status(400).json({ message: "Invalid claim amount" });
            return;
        }
        // Ensure insurance belongs to asset
        const policy = yield prismaClient_1.default.assetInsurance.findFirst({
            where: { id: Number(insuranceId), assetId: Number(assetId) }
        });
        if (!policy) {
            res.status(400).json({ message: "Invalid insuranceId for this asset" });
            return;
        }
        const claim = yield prismaClient_1.default.insuranceClaim.create({
            data: {
                assetId: Number(assetId),
                insuranceId: Number(insuranceId),
                claimNumber: String(claimNumber).trim(),
                claimDate: new Date(claimDate),
                claimAmount: amount,
                claimStatus: "SUBMITTED",
                reason,
                claimedBy: (_a = req.user.employeeDbId) === null || _a === void 0 ? void 0 : _a.toString()
            }
        });
        res.status(201).json(claim);
        return;
    }
    catch (err) {
        // Prisma unique constraint for (insuranceId, claimNumber)
        if ((err === null || err === void 0 ? void 0 : err.code) === "P2002") {
            res.status(409).json({ message: "Claim Number already exists for this policy" });
            return;
        }
        console.error(err);
        res.status(500).json({ message: "Claim failed" });
        return;
    }
});
exports.createInsuranceClaim = createInsuranceClaim;
const updateClaimStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    const updated = yield prismaClient_1.default.insuranceClaim.update({
        where: { id },
        data: {
            claimStatus: req.body.status, // APPROVED / REJECTED / SETTLED
            approvedAmount: req.body.approvedAmount,
            settledAt: req.body.settledAt ? new Date(req.body.settledAt) : null
        }
    });
    res.json(updated);
});
exports.updateClaimStatus = updateClaimStatus;
const getClaimsByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = Number(req.params.assetId);
        const claims = yield prismaClient_1.default.insuranceClaim.findMany({
            where: { assetId },
            orderBy: { createdAt: "desc" },
            include: {
                insurance: true // optional (good for UI)
            }
        });
        res.json(claims);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch claims" });
    }
});
exports.getClaimsByAsset = getClaimsByAsset;
