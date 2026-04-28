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
exports.deleteRca = exports.updateRca = exports.createRca = exports.getRcaById = exports.getRcaByTicket = exports.getAllRca = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const getAllRca = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rcas = yield prismaClient_1.default.rootCauseAnalysis.findMany({
            include: {
                fiveWhys: { orderBy: { whyNumber: "asc" } },
                sixMItems: true,
            },
            orderBy: { createdAt: "desc" },
        });
        res.json({ data: rcas });
    }
    catch (error) {
        console.error("getAllRca error:", error);
        res.status(500).json({ message: "Failed to fetch RCAs" });
    }
});
exports.getAllRca = getAllRca;
const getRcaByTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ticketId = parseInt(req.params.ticketId, 10);
        const rcas = yield prismaClient_1.default.rootCauseAnalysis.findMany({
            where: { ticketId },
            include: {
                fiveWhys: { orderBy: { whyNumber: "asc" } },
                sixMItems: true,
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(rcas);
    }
    catch (error) {
        console.error("getRcaByTicket error:", error);
        res.status(500).json({ message: "Failed to fetch RCAs for ticket" });
    }
});
exports.getRcaByTicket = getRcaByTicket;
const getRcaById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id, 10);
        const rca = yield prismaClient_1.default.rootCauseAnalysis.findUnique({
            where: { id },
            include: {
                fiveWhys: { orderBy: { whyNumber: "asc" } },
                sixMItems: true,
            },
        });
        if (!rca) {
            res.status(404).json({ message: "RCA not found" });
            return;
        }
        res.json(rca);
    }
    catch (error) {
        console.error("getRcaById error:", error);
        res.status(500).json({ message: "Failed to fetch RCA" });
    }
});
exports.getRcaById = getRcaById;
const createRca = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        if (!body.ticketId || !body.framework) {
            res.status(400).json({ message: "Fields 'ticketId' and 'framework' are required" });
            return;
        }
        const validFrameworks = ["FIVE_WHYS", "SIX_M", "COMBINED"];
        if (!validFrameworks.includes(body.framework)) {
            res.status(400).json({ message: `Invalid framework. Must be one of: ${validFrameworks.join(", ")}` });
            return;
        }
        // Validate fiveWhys required for FIVE_WHYS or COMBINED
        if ((body.framework === "FIVE_WHYS" || body.framework === "COMBINED") &&
            (!body.fiveWhys || body.fiveWhys.length === 0)) {
            res.status(400).json({ message: "fiveWhys array is required for FIVE_WHYS or COMBINED framework" });
            return;
        }
        // Validate sixMItems required for SIX_M or COMBINED
        if ((body.framework === "SIX_M" || body.framework === "COMBINED") &&
            (!body.sixMItems || body.sixMItems.length === 0)) {
            res.status(400).json({ message: "sixMItems array is required for SIX_M or COMBINED framework" });
            return;
        }
        const rca = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const created = yield tx.rootCauseAnalysis.create({
                data: {
                    ticketId: body.ticketId,
                    workOrderId: body.workOrderId,
                    framework: body.framework,
                    performedById: body.performedById,
                    status: "DRAFT",
                },
            });
            if (body.fiveWhys && body.fiveWhys.length > 0) {
                yield tx.rcaFiveWhy.createMany({
                    data: body.fiveWhys.map((fw) => ({
                        rcaId: created.id,
                        whyNumber: fw.whyNumber,
                        question: fw.question,
                        answer: fw.answer,
                    })),
                });
            }
            if (body.sixMItems && body.sixMItems.length > 0) {
                yield tx.rcaSixMItem.createMany({
                    data: body.sixMItems.map((item) => {
                        var _a;
                        return ({
                            rcaId: created.id,
                            category: item.category,
                            cause: item.cause,
                            isRoot: (_a = item.isRoot) !== null && _a !== void 0 ? _a : false,
                        });
                    }),
                });
            }
            return tx.rootCauseAnalysis.findUnique({
                where: { id: created.id },
                include: {
                    fiveWhys: { orderBy: { whyNumber: "asc" } },
                    sixMItems: true,
                },
            });
        }));
        res.status(201).json(rca);
    }
    catch (error) {
        console.error("createRca error:", error);
        res.status(500).json({ message: "Failed to create RCA" });
    }
});
exports.createRca = createRca;
const updateRca = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id, 10);
        const body = req.body;
        const existing = yield prismaClient_1.default.rootCauseAnalysis.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "RCA not found" });
            return;
        }
        const rca = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.rootCauseAnalysis.update({
                where: { id },
                data: {
                    status: body.status,
                    summary: body.summary,
                    conclusion: body.conclusion,
                    correctiveAction: body.correctiveAction,
                    preventiveAction: body.preventiveAction,
                    performedAt: body.performedAt ? new Date(body.performedAt) : undefined,
                },
            });
            // Replace fiveWhys if provided
            if (body.fiveWhys) {
                yield tx.rcaFiveWhy.deleteMany({ where: { rcaId: id } });
                if (body.fiveWhys.length > 0) {
                    yield tx.rcaFiveWhy.createMany({
                        data: body.fiveWhys.map((fw) => ({
                            rcaId: id,
                            whyNumber: fw.whyNumber,
                            question: fw.question,
                            answer: fw.answer,
                        })),
                    });
                }
            }
            // Replace sixMItems if provided
            if (body.sixMItems) {
                yield tx.rcaSixMItem.deleteMany({ where: { rcaId: id } });
                if (body.sixMItems.length > 0) {
                    yield tx.rcaSixMItem.createMany({
                        data: body.sixMItems.map((item) => {
                            var _a;
                            return ({
                                rcaId: id,
                                category: item.category,
                                cause: item.cause,
                                isRoot: (_a = item.isRoot) !== null && _a !== void 0 ? _a : false,
                            });
                        }),
                    });
                }
            }
            return tx.rootCauseAnalysis.findUnique({
                where: { id },
                include: {
                    fiveWhys: { orderBy: { whyNumber: "asc" } },
                    sixMItems: true,
                },
            });
        }));
        res.json(rca);
    }
    catch (error) {
        console.error("updateRca error:", error);
        res.status(500).json({ message: "Failed to update RCA" });
    }
});
exports.updateRca = updateRca;
const deleteRca = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id, 10);
        const existing = yield prismaClient_1.default.rootCauseAnalysis.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "RCA not found" });
            return;
        }
        yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.rcaFiveWhy.deleteMany({ where: { rcaId: id } });
            yield tx.rcaSixMItem.deleteMany({ where: { rcaId: id } });
            yield tx.rootCauseAnalysis.delete({ where: { id } });
        }));
        res.json({ message: "RCA deleted successfully" });
    }
    catch (error) {
        console.error("deleteRca error:", error);
        res.status(500).json({ message: "Failed to delete RCA" });
    }
});
exports.deleteRca = deleteRca;
