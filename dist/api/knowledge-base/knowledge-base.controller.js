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
exports.getKnowledgeBaseStats = exports.suggestSimilarIssues = exports.searchKnowledgeBase = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Search Knowledge Base (resolved tickets with root cause + resolution) ───
const searchKnowledgeBase = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { search, issueType, assetCategoryId, page = "1", limit = "25" } = req.query;
        const where = {
            status: { in: ["RESOLVED", "CLOSED"] },
            rootCause: { not: null },
            resolutionSummary: { not: null },
        };
        if (search) {
            where.OR = [
                { rootCause: { contains: String(search) } },
                { resolutionSummary: { contains: String(search) } },
                { detailedDesc: { contains: String(search) } },
                { issueType: { contains: String(search) } },
            ];
        }
        if (issueType)
            where.issueType = String(issueType);
        if (assetCategoryId)
            where.asset = { assetCategoryId: Number(assetCategoryId) };
        const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const take = parseInt(String(limit));
        const [total, articles] = yield Promise.all([
            prismaClient_1.default.ticket.count({ where }),
            prismaClient_1.default.ticket.findMany({
                where,
                select: {
                    id: true,
                    ticketId: true,
                    issueType: true,
                    detailedDesc: true,
                    rootCause: true,
                    resolutionSummary: true,
                    customerSatisfaction: true,
                    priority: true,
                    createdAt: true,
                    slaResolvedAt: true,
                    asset: {
                        select: {
                            assetId: true,
                            assetName: true,
                            assetCategory: { select: { name: true } },
                        },
                    },
                    assignedTo: { select: { name: true } },
                },
                orderBy: { slaResolvedAt: "desc" },
                skip,
                take,
            }),
        ]);
        res.json({ data: articles, total, page: parseInt(String(page)), limit: take });
    }
    catch (error) {
        console.error("searchKnowledgeBase error:", error);
        res.status(500).json({ message: "Failed to search knowledge base" });
    }
});
exports.searchKnowledgeBase = searchKnowledgeBase;
// ─── Suggest Similar Resolved Issues (when raising a new ticket) ─────────────
const suggestSimilarIssues = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { issueType, description, assetId } = req.query;
        if (!issueType && !description) {
            res.json([]);
            return;
        }
        const where = {
            status: { in: ["RESOLVED", "CLOSED"] },
            rootCause: { not: null },
            resolutionSummary: { not: null },
        };
        const orConditions = [];
        if (issueType)
            orConditions.push({ issueType: String(issueType) });
        if (description) {
            // Simple keyword matching - split description into words and search
            const words = String(description).split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
            for (const word of words) {
                orConditions.push({ detailedDesc: { contains: word } });
                orConditions.push({ rootCause: { contains: word } });
            }
        }
        if (orConditions.length > 0)
            where.OR = orConditions;
        // If asset provided, prefer same asset's issues
        if (assetId) {
            const asset = yield prismaClient_1.default.asset.findUnique({ where: { assetId: String(assetId) } });
            if (asset) {
                where.assetId = asset.id;
            }
        }
        const suggestions = yield prismaClient_1.default.ticket.findMany({
            where,
            select: {
                id: true,
                ticketId: true,
                issueType: true,
                detailedDesc: true,
                rootCause: true,
                resolutionSummary: true,
                asset: { select: { assetId: true, assetName: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 5,
        });
        res.json(suggestions);
    }
    catch (error) {
        console.error("suggestSimilarIssues error:", error);
        res.status(500).json({ message: "Failed to suggest similar issues" });
    }
});
exports.suggestSimilarIssues = suggestSimilarIssues;
// ─── Knowledge Base Stats ────────────────────────────────────────────────────
const getKnowledgeBaseStats = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [totalArticles, byIssueType] = yield Promise.all([
            prismaClient_1.default.ticket.count({
                where: { status: { in: ["RESOLVED", "CLOSED"] }, rootCause: { not: null }, resolutionSummary: { not: null } },
            }),
            prismaClient_1.default.ticket.groupBy({
                by: ["issueType"],
                where: { status: { in: ["RESOLVED", "CLOSED"] }, rootCause: { not: null }, resolutionSummary: { not: null } },
                _count: { id: true },
                orderBy: { _count: { id: "desc" } },
                take: 20,
            }),
        ]);
        res.json({
            totalArticles,
            byIssueType: byIssueType.map((g) => ({ issueType: g.issueType, count: g._count.id })),
        });
    }
    catch (error) {
        console.error("getKnowledgeBaseStats error:", error);
        res.status(500).json({ message: "Failed to fetch knowledge base stats" });
    }
});
exports.getKnowledgeBaseStats = getKnowledgeBaseStats;
