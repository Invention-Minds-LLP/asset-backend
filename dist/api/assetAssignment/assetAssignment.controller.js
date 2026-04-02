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
exports.getAssignmentChecklist = exports.resendAcknowledgement = exports.getAssetAssignmentState = exports.getAssetAssignmentHistory = exports.supervisorAssignEndUser = exports.targetHodAssignEndUser = exports.supervisorAssignTargetDepartment = exports.hodAssignSupervisor = exports.rejectAssignment = exports.acknowledgeAssignment = exports.getMyPendingAcknowledgements = exports.initiateDepartmentAcknowledgement = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const basic_ftp_1 = require("basic-ftp");
const client_1 = require("@prisma/client");
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu", // Your FTP hostname
    user: "u948610439", // Your FTP username
    password: "Bsrenuk@1993", // Your FTP password
    secure: false // Set to true if using FTPS
};
// -----------------------------
// Helpers
// -----------------------------
function createNotificationToEmployees(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        return prismaClient_1.default.notification.create({
            data: {
                type: params.type,
                title: params.title,
                message: params.message,
                assetId: (_a = params.assetId) !== null && _a !== void 0 ? _a : null,
                createdById: (_b = params.createdByEmployeeId) !== null && _b !== void 0 ? _b : null,
                dedupeKey: (_c = params.dedupeKey) !== null && _c !== void 0 ? _c : null,
                recipients: {
                    createMany: {
                        data: params.recipientEmployeeIds.map((eid) => ({
                            employeeId: eid,
                            isRead: false,
                        })),
                    },
                },
            },
            include: { recipients: true },
        });
    });
}
function getDepartmentHodEmployeeId(departmentId) {
    return __awaiter(this, void 0, void 0, function* () {
        const hod = yield prismaClient_1.default.employee.findFirst({
            where: { departmentId, role: "HOD" },
            select: { id: true },
        });
        if (!hod)
            throw new Error(`No HOD found for departmentId=${departmentId}. Assign Employee.role=HOD.`);
        return hod.id;
    });
}
function deactivateOtherActiveAssignments(assetId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield prismaClient_1.default.assetAssignment.updateMany({
            where: { assetId, isActive: true },
            data: { isActive: false },
        });
    });
}
function createAssignment(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        return prismaClient_1.default.assetAssignment.create({
            data: {
                assetId: params.assetId,
                stage: params.stage,
                assignedToId: params.assignedToId,
                assignedById: (_a = params.assignedById) !== null && _a !== void 0 ? _a : null,
                status: client_1.AssignmentStatus.PENDING,
                isActive: true,
                conditionAtHandover: (_b = params.conditionAtHandover) !== null && _b !== void 0 ? _b : null,
                assetAssignmentHistories: {
                    create: {
                        action: client_1.AssignmentAction.CREATED,
                        performedById: (_c = params.assignedById) !== null && _c !== void 0 ? _c : null,
                        notes: (_d = params.note) !== null && _d !== void 0 ? _d : null,
                    },
                },
            },
        });
    });
}
function getLatestActiveAssignment(assetId) {
    return __awaiter(this, void 0, void 0, function* () {
        return prismaClient_1.default.assetAssignment.findFirst({
            where: { assetId, isActive: true },
            orderBy: { assignedAt: "desc" },
        });
    });
}
function stageToPendingRole(stage) {
    if (stage === client_1.AssignmentStage.HOD_SOURCE)
        return "HOD_SOURCE";
    if (stage === client_1.AssignmentStage.SUPERVISOR)
        return "SUPERVISOR";
    if (stage === client_1.AssignmentStage.HOD_TARGET)
        return "HOD_TARGET";
    if (stage === client_1.AssignmentStage.END_USER)
        return "END_USER";
    return null;
}
// -----------------------------
// 1) INIT: Source Department -> HOD ack
// POST /assets/:assetId/initiate-hod-ack
// -----------------------------
const initiateDepartmentAcknowledgement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const assetId = Number(req.params.assetId);
        const { departmentId, conditionAtHandover } = req.body;
        if (!assetId || !departmentId) {
            res.status(400).json({ message: "assetId and departmentId are required" });
            return;
        }
        // set initial (source) department
        yield prismaClient_1.default.asset.update({
            where: { id: assetId },
            data: { departmentId: Number(departmentId) },
        });
        const hodId = yield getDepartmentHodEmployeeId(Number(departmentId));
        yield deactivateOtherActiveAssignments(assetId);
        const assignment = yield createAssignment({
            assetId,
            stage: client_1.AssignmentStage.HOD_SOURCE,
            assignedToId: hodId,
            assignedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
            conditionAtHandover: (_c = conditionAtHandover === null || conditionAtHandover === void 0 ? void 0 : conditionAtHandover.trim()) !== null && _c !== void 0 ? _c : null,
            note: "Asset assigned to Source Department HOD for acknowledgement",
        });
        yield createNotificationToEmployees({
            type: "ASSET_ASSIGNMENT",
            title: "Asset requires acknowledgement (Source HOD)",
            message: `Asset #${assetId} has been assigned to your department. Please acknowledge.`,
            assetId,
            createdByEmployeeId: (_e = (_d = req.user) === null || _d === void 0 ? void 0 : _d.employeeDbId) !== null && _e !== void 0 ? _e : null,
            recipientEmployeeIds: [hodId],
            dedupeKey: `asset:${assetId}:hod_source_ack_${Date.now()}`,
        });
        res.json({ message: "Source HOD acknowledgement initiated", assignmentId: assignment.id });
        return;
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to initiate HOD acknowledgement", error: e.message });
        return;
    }
});
exports.initiateDepartmentAcknowledgement = initiateDepartmentAcknowledgement;
// -----------------------------
// 2) My pending acknowledgements
// GET /assignments/my/pending
// -----------------------------
const getMyPendingAcknowledgements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const assignments = yield prismaClient_1.default.assetAssignment.findMany({
            where: {
                assignedToId: employeeId,
                isActive: true,
                status: client_1.AssignmentStatus.PENDING,
            },
            orderBy: { assignedAt: "desc" },
            select: {
                id: true,
                status: true,
                stage: true,
                assignedAt: true,
                // ✅ Send ONLY what UI needs
                assignedBy: { select: { id: true, name: true, employeeID: true } },
                assignedTo: { select: { id: true, name: true, employeeID: true } },
                asset: {
                    select: {
                        id: true,
                        assetId: true,
                        assetName: true,
                        status: true,
                        department: { select: { id: true, name: true } }, // if you show dept anywhere
                    },
                },
            },
        });
        res.json(assignments);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to fetch pending acknowledgements", error: e.message });
    }
});
exports.getMyPendingAcknowledgements = getMyPendingAcknowledgements;
// -----------------------------
// 3) ACKNOWLEDGE
// POST /assignments/:assignmentId/acknowledge
// -----------------------------
// export const acknowledgeAssignment = async (req: AuthenticatedRequest, res: Response) => {
//     try {
//         const assignmentId = Number(req.params.assignmentId);
//         const acknowledgementNote = req.body.acknowledgementNote;
//         const digitalSignature = req.body.digitalSignature; // base64
//         const photo = req.file?.path; // uploaded file path
//         console.log(req.user)
//         if (!req.user) {
//             res.status(401).json({ message: "Unauthorized" });
//             return;
//         }
//         const employeeId = req.user.employeeDbId;
//         const assignment = await prisma.assetAssignment.findUnique({
//             where: { id: assignmentId },
//             include: { asset: true },
//         });
//         if (!assignment) {
//             res.status(404).json({ message: "Assignment not found" });
//             return;
//         }
//         if (assignment.assignedToId !== employeeId) {
//             res.status(403).json({ message: "Not allowed" });
//             return;
//         }
//         if (assignment.status !== "PENDING") {
//             res.status(400).json({ message: "Not pending" });
//             return;
//         }
//         let photoUrl: string | null = null;
//         if (req.file?.path) {
//             const original = req.file.originalname || `ack-${assignmentId}-${Date.now()}.jpg`;
//             const remotePath = `/public_html/smartassets/assignment_photos/${Date.now()}-${original}`;
//             photoUrl = await uploadToFTP(req.file.path, remotePath);
//             // remove local temp file
//             fs.unlinkSync(req.file.path);
//         }
//         const updated = await prisma.assetAssignment.update({
//             where: { id: assignmentId },
//             data: {
//                 status: "ACKNOWLEDGED",
//                 acknowledgedAt: new Date(),
//                 acknowledgementNote: acknowledgementNote ?? null,
//                 digitalSignature: digitalSignature ?? null,
//                 photoProof: photoUrl ?? null,
//             },
//         });
//         res.json({ message: "Acknowledged", assignment: updated });
//     } catch (e: any) {
//         res.status(500).json({ message: "Failed", error: e.message });
//     }
// };
const acknowledgeAssignment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const assignmentId = Number(req.params.assignmentId);
        const acknowledgementNote = req.body.acknowledgementNote;
        const digitalSignature = req.body.digitalSignature;
        const checklist = req.body.checklist ? JSON.parse(req.body.checklist) : [];
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const assignment = yield prismaClient_1.default.assetAssignment.findUnique({
            where: { id: assignmentId },
            include: {
                asset: {
                    select: {
                        id: true,
                        assetCategoryId: true,
                    },
                },
            },
        });
        if (!assignment) {
            res.status(404).json({ message: "Assignment not found" });
            return;
        }
        if (assignment.assignedToId !== employeeId) {
            res.status(403).json({ message: "Not allowed" });
            return;
        }
        if (assignment.status !== client_1.AssignmentStatus.PENDING) {
            res.status(400).json({ message: "Assignment is not pending" });
            return;
        }
        const template = yield prismaClient_1.default.assetAcknowledgementTemplate.findFirst({
            where: {
                isActive: true,
                purpose: client_1.AcknowledgementPurpose.ASSIGNMENT,
                OR: [
                    { assetId: assignment.assetId },
                    { assetCategoryId: (_a = assignment.asset.assetCategoryId) !== null && _a !== void 0 ? _a : undefined },
                ],
            },
            include: {
                items: {
                    orderBy: { sortOrder: "asc" },
                },
            },
            orderBy: [{ assetId: "desc" }, { id: "desc" }],
        });
        // validate required checklist items
        if (template) {
            const submittedMap = new Map();
            for (const row of checklist) {
                submittedMap.set(Number(row.itemId), {
                    checked: !!row.checked,
                    remarks: (_b = row.remarks) !== null && _b !== void 0 ? _b : null,
                });
            }
            const missingRequired = template.items.filter((item) => { var _a; return item.isRequired && !((_a = submittedMap.get(item.id)) === null || _a === void 0 ? void 0 : _a.checked); });
            if (missingRequired.length > 0) {
                res.status(400).json({
                    message: "Please complete all required checklist items before acknowledging",
                    missingItems: missingRequired.map((x) => ({
                        itemId: x.id,
                        title: x.title,
                    })),
                });
                return;
            }
        }
        let photoUrl = null;
        if ((_c = req.file) === null || _c === void 0 ? void 0 : _c.path) {
            const original = req.file.originalname || `ack-${assignmentId}-${Date.now()}.jpg`;
            const remotePath = `/public_html/smartassets/assignment_photos/${Date.now()}-${original}`;
            photoUrl = yield uploadToFTP(req.file.path, remotePath);
            fs_1.default.unlinkSync(req.file.path);
        }
        // 1. update assignment
        const updatedAssignment = yield prismaClient_1.default.assetAssignment.update({
            where: { id: assignmentId },
            data: {
                status: client_1.AssignmentStatus.ACKNOWLEDGED,
                acknowledgedAt: new Date(),
                acknowledgementNote: acknowledgementNote !== null && acknowledgementNote !== void 0 ? acknowledgementNote : null,
                digitalSignature: digitalSignature !== null && digitalSignature !== void 0 ? digitalSignature : null,
                photoProof: photoUrl !== null && photoUrl !== void 0 ? photoUrl : null,
                stage: assignment.stage,
                assetAssignmentHistories: {
                    create: {
                        action: client_1.AssignmentAction.ACKNOWLEDGED,
                        performedById: employeeId,
                        notes: acknowledgementNote !== null && acknowledgementNote !== void 0 ? acknowledgementNote : "Acknowledged with checklist",
                    },
                },
            },
        });
        // 2. create checklist run
        let acknowledgementRun = null;
        if (template) {
            acknowledgementRun = yield prismaClient_1.default.assetAcknowledgementRun.create({
                data: {
                    assignmentId: updatedAssignment.id,
                    assetId: assignment.assetId,
                    templateId: template.id,
                    assignedToId: employeeId,
                    acknowledgedAt: new Date(),
                    acknowledgedBy: (_d = req.user.employeeID) !== null && _d !== void 0 ? _d : String(employeeId),
                    remarks: acknowledgementNote !== null && acknowledgementNote !== void 0 ? acknowledgementNote : null,
                    digitalSignature: digitalSignature !== null && digitalSignature !== void 0 ? digitalSignature : null,
                    photoProof: photoUrl !== null && photoUrl !== void 0 ? photoUrl : null,
                    rows: {
                        create: checklist.map((row) => {
                            var _a;
                            return ({
                                itemId: Number(row.itemId),
                                checked: !!row.checked,
                                remarks: (_a = row.remarks) !== null && _a !== void 0 ? _a : null,
                            });
                        }),
                    },
                },
            });
        }
        // 3. If this is the HOD of the asset's department acknowledging, issue the real Asset ID
        let issuedAssetId = null;
        const currentAsset = yield prismaClient_1.default.asset.findUnique({
            where: { id: assignment.assetId },
            select: { assetId: true, departmentId: true },
        });
        if ((currentAsset === null || currentAsset === void 0 ? void 0 : currentAsset.assetId.startsWith("TEMP-")) && currentAsset.departmentId) {
            const acknowledger = yield prismaClient_1.default.employee.findUnique({
                where: { id: employeeId },
                select: { role: true, departmentId: true },
            });
            if ((acknowledger === null || acknowledger === void 0 ? void 0 : acknowledger.role) === "HOD" && acknowledger.departmentId === currentAsset.departmentId) {
                const now = new Date();
                const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
                const fyEnd = fyStart + 1;
                const fyStr = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
                const latestAsset = yield prismaClient_1.default.asset.findFirst({
                    where: { assetId: { startsWith: `AST-${fyStr}` }, parentAssetId: null },
                    orderBy: { id: "desc" },
                });
                let nextSeq = 1;
                if (latestAsset) {
                    nextSeq = parseInt(latestAsset.assetId.split("-")[3], 10) + 1;
                }
                issuedAssetId = `AST-${fyStr}-${nextSeq.toString().padStart(3, "0")}`;
                yield prismaClient_1.default.asset.update({
                    where: { id: assignment.assetId },
                    data: { assetId: issuedAssetId },
                });
            }
        }
        res.json(Object.assign({ message: "Acknowledged with checklist", assignment: updatedAssignment, acknowledgementRun }, (issuedAssetId ? { issuedAssetId } : {})));
    }
    catch (e) {
        console.error(e);
        res.status(500).json({
            message: "Failed to acknowledge",
            error: e.message,
        });
    }
});
exports.acknowledgeAssignment = acknowledgeAssignment;
// -----------------------------
// 4) REJECT
// POST /assignments/:assignmentId/reject
// -----------------------------
const rejectAssignment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assignmentId = Number(req.params.assignmentId);
        const { rejectionReason } = req.body;
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const assignment = yield prismaClient_1.default.assetAssignment.findUnique({ where: { id: assignmentId } });
        if (!assignment) {
            res.status(404).json({ message: "Assignment not found" });
            return;
        }
        if (assignment.assignedToId !== employeeId) {
            res.status(403).json({ message: "Not allowed to reject this assignment" });
            return;
        }
        if (assignment.status !== client_1.AssignmentStatus.PENDING || !assignment.isActive) {
            res.status(400).json({ message: "Assignment is not pending/active" });
            return;
        }
        const updated = yield prismaClient_1.default.assetAssignment.update({
            where: { id: assignmentId },
            data: {
                status: client_1.AssignmentStatus.REJECTED,
                rejectedAt: new Date(),
                rejectionReason: rejectionReason !== null && rejectionReason !== void 0 ? rejectionReason : "Rejected",
                isActive: false,
                assetAssignmentHistories: {
                    create: {
                        action: client_1.AssignmentAction.REJECTED,
                        performedById: employeeId,
                        notes: rejectionReason !== null && rejectionReason !== void 0 ? rejectionReason : "Rejected",
                    },
                },
            },
        });
        res.json({ message: "Rejected", assignment: updated });
        return;
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to reject", error: e.message });
        return;
    }
});
exports.rejectAssignment = rejectAssignment;
// -----------------------------
// 5) Source HOD assigns Source Supervisor (Supervisor ack)
// POST /assets/:assetId/assign/supervisor
// Requires active = HOD_SOURCE ACKNOWLEDGED
// -----------------------------
const hodAssignSupervisor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const assetId = Number(req.params.assetId);
        const { supervisorId, conditionAtHandover } = req.body;
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        if (!assetId || !supervisorId) {
            res.status(400).json({ message: "assetId and supervisorId required" });
            return;
        }
        const latest = yield getLatestActiveAssignment(assetId);
        if (!latest) {
            res.status(400).json({ message: "No active assignment found. Initiate flow first." });
            return;
        }
        if (latest.stage !== client_1.AssignmentStage.HOD_SOURCE) {
            res.status(400).json({ message: "Current stage is not Source HOD stage." });
            return;
        }
        if (latest.status !== client_1.AssignmentStatus.ACKNOWLEDGED) {
            res.status(400).json({ message: "Source HOD has not acknowledged yet." });
            return;
        }
        yield prismaClient_1.default.asset.update({
            where: { id: assetId },
            data: { supervisorId: Number(supervisorId) },
        });
        yield deactivateOtherActiveAssignments(assetId);
        const assignment = yield createAssignment({
            assetId,
            stage: client_1.AssignmentStage.SUPERVISOR,
            assignedToId: Number(supervisorId),
            assignedById: req.user.employeeDbId,
            conditionAtHandover: (_a = conditionAtHandover === null || conditionAtHandover === void 0 ? void 0 : conditionAtHandover.trim()) !== null && _a !== void 0 ? _a : null,
            note: "Assigned to Source Supervisor for acknowledgement",
        });
        yield createNotificationToEmployees({
            type: "ASSET_ASSIGNMENT",
            title: "Asset assigned to you (Supervisor acknowledgement)",
            message: `Asset #${assetId} has been assigned to you. Please acknowledge.`,
            assetId,
            createdByEmployeeId: req.user.employeeDbId,
            recipientEmployeeIds: [Number(supervisorId)],
            dedupeKey: `asset:${assetId}:supervisor_ack`,
        });
        res.json({ message: "Supervisor assignment created", assignmentId: assignment.id });
        return;
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to assign supervisor", error: e.message });
        return;
    }
});
exports.hodAssignSupervisor = hodAssignSupervisor;
// -----------------------------
// 6) Source Supervisor assigns Target Department (Target HOD ack)
// POST /assets/:assetId/assign/target-department
// Body: { targetDepartmentId, conditionAtHandover? }
// Requires active = SUPERVISOR ACKNOWLEDGED
// -----------------------------
const supervisorAssignTargetDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const assetId = Number(req.params.assetId);
        const { targetDepartmentId, conditionAtHandover } = req.body;
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        if (!assetId || !targetDepartmentId) {
            res.status(400).json({ message: "assetId and targetDepartmentId required" });
            return;
        }
        const latest = yield getLatestActiveAssignment(assetId);
        if (!latest) {
            res.status(400).json({ message: "No active assignment found." });
            return;
        }
        if (latest.stage !== client_1.AssignmentStage.SUPERVISOR) {
            res.status(400).json({ message: "Current stage is not Supervisor stage." });
            return;
        }
        if (latest.status !== client_1.AssignmentStatus.ACKNOWLEDGED) {
            res.status(400).json({ message: "Supervisor has not acknowledged yet." });
            return;
        }
        const targetHodId = yield getDepartmentHodEmployeeId(Number(targetDepartmentId));
        // Move asset ownership to target department (this is the “handover”)
        // Also clear supervisorId/allottedToId because new dept will decide
        yield prismaClient_1.default.asset.update({
            where: { id: assetId },
            data: {
                targetDepartmentId: targetDepartmentId
            },
        });
        yield deactivateOtherActiveAssignments(assetId);
        const assignment = yield createAssignment({
            assetId,
            stage: client_1.AssignmentStage.HOD_TARGET,
            assignedToId: targetHodId,
            assignedById: req.user.employeeDbId,
            conditionAtHandover: (_a = conditionAtHandover === null || conditionAtHandover === void 0 ? void 0 : conditionAtHandover.trim()) !== null && _a !== void 0 ? _a : null,
            note: "Assigned to Target Department HOD for acknowledgement",
        });
        yield createNotificationToEmployees({
            type: "ASSET_ASSIGNMENT",
            title: "Asset requires acknowledgement (Target HOD)",
            message: `Asset #${assetId} is being transferred to your department. Please acknowledge.`,
            assetId,
            createdByEmployeeId: req.user.employeeDbId,
            recipientEmployeeIds: [targetHodId],
            dedupeKey: `asset:${assetId}:hod_target_ack`,
        });
        res.json({ message: "Target HOD acknowledgement created", assignmentId: assignment.id });
        return;
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to assign target department", error: e.message });
        return;
    }
});
exports.supervisorAssignTargetDepartment = supervisorAssignTargetDepartment;
// -----------------------------
// 7) Target HOD assigns Target End User (End-user ack) OR close if no end user
// POST /assets/:assetId/assign/target-end-user
// Body: { allottedToId?: number, skipEndUser?: boolean, conditionAtHandover?: string }
// Requires active = HOD_TARGET ACKNOWLEDGED
// -----------------------------
const targetHodAssignEndUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const assetId = Number(req.params.assetId);
        const { allottedToId, skipEndUser, conditionAtHandover } = req.body;
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        if (!assetId) {
            res.status(400).json({ message: "assetId required" });
            return;
        }
        const latest = yield getLatestActiveAssignment(assetId);
        if (!latest) {
            res.status(400).json({ message: "No active assignment found." });
            return;
        }
        if (latest.stage !== client_1.AssignmentStage.HOD_TARGET) {
            res.status(400).json({ message: "Current stage is not Target HOD stage." });
            return;
        }
        if (latest.status !== client_1.AssignmentStatus.ACKNOWLEDGED) {
            res.status(400).json({ message: "Target HOD has not acknowledged yet." });
            return;
        }
        // End user not available -> close flow
        if (skipEndUser || !allottedToId) {
            yield prismaClient_1.default.asset.update({
                where: { id: assetId },
                data: { allottedToId: null },
            });
            yield deactivateOtherActiveAssignments(assetId);
            res.json({ message: "Flow closed (Target End User not assigned).", closed: true });
            return;
        }
        yield prismaClient_1.default.asset.update({
            where: { id: assetId },
            data: { allottedToId: Number(allottedToId) },
        });
        yield deactivateOtherActiveAssignments(assetId);
        const assignment = yield createAssignment({
            assetId,
            stage: client_1.AssignmentStage.END_USER,
            assignedToId: Number(allottedToId),
            assignedById: req.user.employeeDbId,
            conditionAtHandover: (_a = conditionAtHandover === null || conditionAtHandover === void 0 ? void 0 : conditionAtHandover.trim()) !== null && _a !== void 0 ? _a : null,
            note: "Assigned to Target End User for acknowledgement",
        });
        yield createNotificationToEmployees({
            type: "ASSET_ASSIGNMENT",
            title: "Asset allocated to you (End User acknowledgement)",
            message: `Asset #${assetId} has been allocated to you. Please acknowledge.`,
            assetId,
            createdByEmployeeId: req.user.employeeDbId,
            recipientEmployeeIds: [Number(allottedToId)],
            dedupeKey: `asset:${assetId}:enduser_ack`,
        });
        res.json({ message: "End user assignment created", assignmentId: assignment.id });
        return;
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to assign target end user", error: e.message });
        return;
    }
});
exports.targetHodAssignEndUser = targetHodAssignEndUser;
// -----------------------------
// 8) (Optional) If NO target department flow: Supervisor assigns End User directly OR close
// POST /assets/:assetId/assign/end-user
// Requires active = SUPERVISOR ACKNOWLEDGED
// -----------------------------
const supervisorAssignEndUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const assetId = Number(req.params.assetId);
        const { allottedToId, skipEndUser, conditionAtHandover } = req.body;
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        if (!assetId) {
            res.status(400).json({ message: "assetId required" });
            return;
        }
        const latest = yield getLatestActiveAssignment(assetId);
        if (!latest) {
            res.status(400).json({ message: "No active assignment found." });
            return;
        }
        if (latest.stage !== client_1.AssignmentStage.SUPERVISOR) {
            res.status(400).json({ message: "Current stage is not Supervisor stage." });
            return;
        }
        if (latest.status !== client_1.AssignmentStatus.ACKNOWLEDGED) {
            res.status(400).json({ message: "Supervisor has not acknowledged yet." });
            return;
        }
        if (skipEndUser || !allottedToId) {
            yield prismaClient_1.default.asset.update({ where: { id: assetId }, data: { allottedToId: null } });
            yield deactivateOtherActiveAssignments(assetId);
            res.json({ message: "Flow closed (End User not assigned).", closed: true });
            return;
        }
        yield prismaClient_1.default.asset.update({
            where: { id: assetId },
            data: { allottedToId: Number(allottedToId) },
        });
        yield deactivateOtherActiveAssignments(assetId);
        const assignment = yield createAssignment({
            assetId,
            stage: client_1.AssignmentStage.END_USER,
            assignedToId: Number(allottedToId),
            assignedById: req.user.employeeDbId,
            conditionAtHandover: (_a = conditionAtHandover === null || conditionAtHandover === void 0 ? void 0 : conditionAtHandover.trim()) !== null && _a !== void 0 ? _a : null,
            note: "Assigned to End User for acknowledgement",
        });
        yield createNotificationToEmployees({
            type: "ASSET_ASSIGNMENT",
            title: "Asset allocated to you (End User acknowledgement)",
            message: `Asset #${assetId} has been allocated to you. Please acknowledge.`,
            assetId,
            createdByEmployeeId: req.user.employeeDbId,
            recipientEmployeeIds: [Number(allottedToId)],
            dedupeKey: `asset:${assetId}:enduser_ack`,
        });
        res.json({ message: "End user assignment created", assignmentId: assignment.id });
        return;
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to assign end user", error: e.message });
        return;
    }
});
exports.supervisorAssignEndUser = supervisorAssignEndUser;
// -----------------------------
// 9) History
// GET /assets/:assetId/assignments/history
// -----------------------------
const getAssetAssignmentHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = Number(req.params.assetId);
        const history = yield prismaClient_1.default.assetAssignment.findMany({
            where: { assetId },
            include: {
                assignedTo: true,
                assignedBy: true,
                assetAssignmentHistories: {
                    include: { performedBy: true },
                    orderBy: { createdAt: "asc" },
                },
            },
            orderBy: { assignedAt: "asc" },
        });
        res.json(history);
        return;
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to fetch assignment history", error: e.message });
        return;
    }
});
exports.getAssetAssignmentHistory = getAssetAssignmentHistory;
// -----------------------------
// 10) State for UI
// GET /assets/:assetId/assignments/state
// Returns:
// { sourceHodStatus, supervisorStatus, targetHodStatus, endUserStatus, currentPendingRole }
// -----------------------------
const getAssetAssignmentState = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const assetId = Number(req.params.assetId);
        const assignments = yield prismaClient_1.default.assetAssignment.findMany({
            where: { assetId },
            orderBy: { assignedAt: "asc" },
            select: { stage: true, status: true, isActive: true, assignedAt: true },
        });
        const latestByStage = (stage) => {
            const list = assignments.filter((a) => a.stage === stage);
            return list.length ? list[list.length - 1] : null;
        };
        const sourceHod = latestByStage(client_1.AssignmentStage.HOD_SOURCE);
        const supervisor = latestByStage(client_1.AssignmentStage.SUPERVISOR);
        const targetHod = latestByStage(client_1.AssignmentStage.HOD_TARGET);
        const endUser = latestByStage(client_1.AssignmentStage.END_USER);
        const activePending = assignments.find((a) => a.isActive && a.status === client_1.AssignmentStatus.PENDING);
        res.json({
            sourceHodStatus: (_a = sourceHod === null || sourceHod === void 0 ? void 0 : sourceHod.status) !== null && _a !== void 0 ? _a : "NONE",
            supervisorStatus: (_b = supervisor === null || supervisor === void 0 ? void 0 : supervisor.status) !== null && _b !== void 0 ? _b : "NONE",
            targetHodStatus: (_c = targetHod === null || targetHod === void 0 ? void 0 : targetHod.status) !== null && _c !== void 0 ? _c : "NONE",
            endUserStatus: (_d = endUser === null || endUser === void 0 ? void 0 : endUser.status) !== null && _d !== void 0 ? _d : "NONE",
            currentPendingRole: activePending ? stageToPendingRole(activePending.stage) : null,
        });
        return;
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to fetch state", error: e.message });
        return;
    }
});
exports.getAssetAssignmentState = getAssetAssignmentState;
const TEMP_FOLDER = path_1.default.join(__dirname, "../../temp");
if (!fs_1.default.existsSync(TEMP_FOLDER)) {
    fs_1.default.mkdirSync(TEMP_FOLDER, { recursive: true });
}
function uploadToFTP(localFilePath, remoteFilePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = true;
        try {
            yield client.access(FTP_CONFIG);
            console.log("Connected to FTP server for asset image upload");
            const remoteDir = path_1.default.dirname(remoteFilePath);
            yield client.ensureDir(remoteDir);
            yield client.uploadFrom(localFilePath, remoteFilePath);
            console.log(`Uploaded asset image to: ${remoteFilePath}`);
            yield client.close();
            const fileName = path_1.default.basename(remoteFilePath);
            return `https://smartassets.inventionminds.com/assets_images/${fileName}`;
        }
        catch (error) {
            console.error("FTP upload error:", error);
            throw new Error("FTP upload failed");
        }
    });
}
const resendAcknowledgement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const assetId = Number(req.params.assetId);
        const latest = yield prismaClient_1.default.assetAssignment.findFirst({
            where: { assetId },
            orderBy: { assignedAt: "desc" },
        });
        if (!latest) {
            res.status(400).json({ message: "No assignment found" });
            return;
        }
        if (latest.status !== client_1.AssignmentStatus.REJECTED) {
            res.status(400).json({ message: "Only rejected requests can be resent" });
            return;
        }
        // deactivate any active
        yield prismaClient_1.default.assetAssignment.updateMany({
            where: { assetId, isActive: true },
            data: { isActive: false },
        });
        const newReq = yield prismaClient_1.default.assetAssignment.create({
            data: {
                assetId,
                stage: latest.stage,
                assignedToId: latest.assignedToId,
                assignedById: req.user.employeeDbId,
                status: client_1.AssignmentStatus.PENDING,
                isActive: true,
                conditionAtHandover: latest.conditionAtHandover,
                assetAssignmentHistories: {
                    create: {
                        action: client_1.AssignmentAction.CREATED,
                        performedById: req.user.employeeDbId,
                        notes: "Resent after rejection",
                    },
                },
            },
        });
        res.json({ message: "Resent", assignmentId: newReq.id });
        return;
    }
    catch (e) {
        res.status(500).json({ message: "Failed", error: e.message });
        return;
    }
});
exports.resendAcknowledgement = resendAcknowledgement;
const getAssignmentChecklist = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const assignmentId = Number(req.params.assignmentId);
        const assignment = yield prismaClient_1.default.assetAssignment.findUnique({
            where: { id: assignmentId },
            include: {
                asset: {
                    select: {
                        id: true,
                        assetCategoryId: true,
                    },
                },
            },
        });
        if (!assignment) {
            res.status(404).json({ message: "Assignment not found" });
            return;
        }
        const template = yield prismaClient_1.default.assetAcknowledgementTemplate.findFirst({
            where: {
                isActive: true,
                purpose: client_1.AcknowledgementPurpose.ASSIGNMENT,
                OR: [
                    { assetId: assignment.assetId },
                    { assetCategoryId: (_a = assignment.asset.assetCategoryId) !== null && _a !== void 0 ? _a : undefined },
                ],
            },
            include: {
                items: {
                    orderBy: { sortOrder: "asc" },
                },
            },
            orderBy: [
                { assetId: "desc" }, // asset-specific first
                { id: "desc" },
            ],
        });
        res.json({
            assignmentId: assignment.id,
            assetId: assignment.assetId,
            template: template !== null && template !== void 0 ? template : null,
            items: (_b = template === null || template === void 0 ? void 0 : template.items) !== null && _b !== void 0 ? _b : [],
        });
    }
    catch (e) {
        res.status(500).json({ message: "Failed to fetch checklist", error: e.message });
    }
});
exports.getAssignmentChecklist = getAssignmentChecklist;
