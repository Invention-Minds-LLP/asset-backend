import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { logAction } from "../audit-trail/audit-trail.controller";

interface UpsertConfigBody {
  value: string;
  label?: string;
  group?: string;
}

interface DefaultConfig {
  key: string;
  value: string;
  label?: string;
  group: string;
}

const DEFAULT_CONFIGS: DefaultConfig[] = [
  { key: "ENABLE_BRANCH_FEATURES", value: "true", label: "Show branch-wise filters, tiles and breakdowns across the app (set false for single-branch clients)", group: "GENERAL" },
  // ENABLE_PO_MODULE, ENABLE_GRA_MODULE and ENABLE_EXTERNAL_PROCUREMENT were
  // seeded here but never read by anything. Three switches that looked live,
  // sat in the settings screen, and did nothing when toggled — which cost real
  // time to discover. Procurement is governed by exactly two keys:
  //   ENABLE_PROCUREMENT — the whole module, sidebar and routes
  //   EXTERNAL_PO_MODE   — orders raised on paper, still received here
  // They are deliberately not re-seeded. Existing rows are cleared by
  // POST /api/tenant-config/prune-dead-keys.
  { key: "ENABLE_PROCUREMENT", value: "true", label: "Purchase Orders, Quotations, Goods Receipt and TAT. Switch off for a client that does not procure through this system", group: "PROCUREMENT" },
  { key: "MANDATORY_INDENT_BEFORE_PO", value: "false", group: "PROCUREMENT" },
  { key: "AUTO_CREATE_ASSET_ON_GRA", value: "true", group: "PROCUREMENT" },
  { key: "MANUAL_ASSET_WITHOUT_PROCUREMENT", value: "true", label: "Allow an asset to be created directly, without a goods receipt behind it", group: "PROCUREMENT" },
  { key: "SERIAL_NUMBER_MANDATORY_ON_RECEIPT", value: "false", label: "Every asset line must carry a serial number before the receipt can be accepted", group: "PROCUREMENT" },
  { key: "ENABLE_GOODS_RETURN", value: "false", label: "Send rejected quantity back to the vendor and track the replacement or credit note", group: "PROCUREMENT" },
  { key: "ALLOW_PARTIAL_PO_CANCELLATION", value: "false", label: "Cancel a single order line instead of amending the whole order", group: "PROCUREMENT" },
  { key: "ENABLE_RATE_CONTRACTS", value: "false", label: "Negotiated rate contracts — indent and PO lines pull the agreed price automatically", group: "PROCUREMENT" },
  { key: "RESTRICT_TO_APPROVED_VENDORS", value: "false", label: "Only vendors approved for the category may be quoted or ordered from", group: "PROCUREMENT" },
  { key: "ENABLE_STRUCTURED_SPECS", value: "false", label: "Capture specifications as attributes so negotiated changes can be compared line by line", group: "PROCUREMENT" },
  { key: "ENABLE_WORKORDER_MODULE", value: "true", label: "Work orders and maintenance", group: "WORKORDER" },
  { key: "ENABLE_STORE_MODULE", value: "true", label: "Stores, stock and transfers", group: "STORE" },
  { key: "ENABLE_STOCK_RESERVATION", value: "false", label: "Hold store stock against an indent so a second indent cannot consume it first", group: "STORE" },
  { key: "STOCK_RESERVATION_HOURS", value: "72", label: "Hours a stock reservation is held before it lapses and returns to available", group: "STORE" },
  { key: "STORE_CHECK_MANDATORY_BEFORE_PO", value: "true", label: "Approved indents go to Stores to check existing stock before Purchase raises a PO", group: "STORE" },
  { key: "ASSET_DEPT_VERIFICATION_MANDATORY", value: "false", label: "HOD-approved indents go to the responsible asset department for technical verification before financial approval", group: "PROCUREMENT" },
  { key: "REQUIRE_QUOTATIONS_BEFORE_PO", value: "false", label: "A quotation must be selected before a purchase order can be raised against an indent", group: "PROCUREMENT" },
  { key: "MIN_QUOTATIONS_NEW_EQUIPMENT", value: "3", label: "Quotations required when buying equipment the institution does not already own", group: "PROCUREMENT" },
  { key: "MIN_QUOTATIONS_ADDITIONAL", value: "1", label: "Quotations required when adding more of something already in use — one is enough with a recorded reason", group: "PROCUREMENT" },
  { key: "MIN_QUOTATIONS_REPLACEMENT", value: "1", label: "Quotations required when replacing an existing asset", group: "PROCUREMENT" },
  { key: "RCA_MANDATORY_FOR_MAJOR", value: "true", group: "RCA" },
  { key: "RCA_MANDATORY_COST_THRESHOLD", value: "50000", group: "RCA" },
  { key: "PO_APPROVAL_HOD_MAX", value: "100000", label: "PO up to this amount needs HOD only", group: "PROCUREMENT" },
  { key: "PO_APPROVAL_MGMT_MAX", value: "500000", label: "PO up to this amount needs HOD + Management", group: "PROCUREMENT" },
  { key: "PO_APPROVAL_COO_MAX", value: "2000000", label: "PO up to this amount needs HOD + Mgmt + COO. Above this needs CFO", group: "PROCUREMENT" },
  { key: "INVOICE_VARIANCE_TOLERANCE_PCT", value: "2", label: "Invoice may exceed the approved PO value by this % before payment is held", group: "PROCUREMENT" },
  { key: "INVOICE_VARIANCE_TOLERANCE_ABS", value: "5000", label: "Absolute cap on the same tolerance — the lower of the two limits applies", group: "PROCUREMENT" },
  { key: "EXTERNAL_PO_MODE", value: "false", label: "Client raises POs outside this system (e.g. JMRH) — invoices are matched against a manually recorded PO value", group: "PROCUREMENT" },
  { key: "ADVANCE_PAYMENT_MAX_PCT", value: "30", label: "Largest share of a PO that may be paid to the vendor as an advance", group: "PROCUREMENT" },
  { key: "REQUIRE_COMMISSIONING_BEFORE_BALANCE", value: "true", label: "Hold the vendor's balance payment until delivered assets are signed off as installed and working", group: "PROCUREMENT" },
  { key: "COMMISSIONING_VERIFIER_ROLES", value: "FINANCE,CFO,ADMIN", label: "Roles allowed to sign an asset off as commissioned (comma separated)", group: "PROCUREMENT" },
  { key: "ENFORCE_CAPEX_BUDGET", value: "false", label: "Block approvals that take a department past its CapEx budget unless an override reason is given", group: "PROCUREMENT" },
  { key: "CAPEX_BUDGET_WARN_PCT", value: "80", label: "Warn the approver once this much of the CapEx budget is used", group: "PROCUREMENT" },
  { key: "PROCUREMENT_REMIND_AFTER_HOURS", value: "48", label: "Hours a procurement stage may sit before the responsible person is reminded", group: "PROCUREMENT" },
  { key: "PROCUREMENT_ESCALATE_AFTER_HOURS", value: "96", label: "Hours a procurement stage may sit before it escalates to management", group: "PROCUREMENT" },
  // ── Accounts ──
  { key: "ACCOUNTS_ROLES", value: "FINANCE,CFO,ADMIN", label: "Roles allowed to raise, approve and post vouchers and journal entries (comma separated). Members of an Accounts/Finance department also qualify", group: "ACCOUNTS" },
  { key: "ALLOW_SELF_APPROVAL_VOUCHERS", value: "false", label: "Let the person who raised a voucher also approve it — only for a single-person accounts team", group: "ACCOUNTS" },
  { key: "REQUIRE_JOURNAL_ON_POST", value: "false", label: "Refuse to post a voucher unless the GL accounts below are mapped, so nothing reaches PAID without reaching the ledger", group: "ACCOUNTS" },
  { key: "GL_BANK_ACCOUNT_CODE", value: "", label: "Chart of Accounts code credited when money leaves — e.g. 1100 Bank", group: "ACCOUNTS" },
  { key: "GL_ACCOUNTS_PAYABLE_CODE", value: "", label: "Code for what is owed to vendors — e.g. 2001 Accounts Payable", group: "ACCOUNTS" },
  { key: "GL_ADVANCE_TO_VENDOR_CODE", value: "", label: "Code where vendor advances sit until the goods arrive — e.g. 1401 Advance to Suppliers", group: "ACCOUNTS" },
  { key: "GL_PURCHASE_ACCOUNT_CODE", value: "", label: "Fallback debit account for purchases when the asset category has no GL mapping — e.g. 1500 Fixed Assets", group: "ACCOUNTS" },
  { key: "GL_TDS_PAYABLE_ACCOUNT_CODE", value: "", label: "Code for tax withheld and not yet remitted — e.g. 2110 TDS Payable. Without it the ledger shows the gross as paid from bank", group: "ACCOUNTS" },

  // Governance — both default off so nothing changes for a live tenant until
  // finance is ready for it.
  { key: "ENFORCE_PERIOD_LOCKING", value: "false", label: "Refuse vouchers, journals, depreciation and capitalisation dated into a closed month", group: "ACCOUNTS" },
  { key: "ENABLE_TDS", value: "false", label: "Deduct withholding tax on vendor payments. Set up the sections and vendor PANs before switching this on", group: "ACCOUNTS" },
  { key: "TDS_DEDUCTOR_TAN", value: "", label: "The institution's TAN, shown on the return data export", group: "ACCOUNTS" },

  // Contract lifecycle
  { key: "COVER_RENEWAL_NOTICE_DAYS", value: "60", label: "How far ahead of a warranty or contract expiry the renewal decision is raised", group: "PROCUREMENT" },
  { key: "ENABLE_LIQUIDATED_DAMAGES", value: "false", label: "Compute delay damages on late deliveries from the order's clause, and hold the balance payment until they are settled", group: "PROCUREMENT" },
  { key: "PLANNED_VISIT_EXCLUSION_HOURS", value: "8", label: "Hours a preventive-maintenance visit is assumed to take, excluded from the uptime calculation", group: "PROCUREMENT" },

  // GST. Leave blank to follow the institution profile's registration status.
  { key: "ENABLE_GST", value: "", label: "Record GST on purchases and split it between credit and asset cost. Blank follows the institution profile", group: "ACCOUNTS" },
  { key: "GL_ITC_RECEIVABLE_ACCOUNT_CODE", value: "", label: "Chart of Accounts code where recoverable input tax sits — e.g. 1450 GST Input Credit", group: "ACCOUNTS" },
];

export const getAllConfigs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { group } = req.query;

    const where: { group?: string } = {};
    if (group) {
      where.group = String(group);
    }

    const configs = await prisma.tenantConfig.findMany({
      where,
      orderBy: { key: "asc" },
    });

    res.json(configs);
  } catch (error) {
    console.error("getAllConfigs error:", error);
    res.status(500).json({ message: "Failed to fetch tenant configs" });
  }
};

export const getByKey = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { key } = req.params;

    const config = await prisma.tenantConfig.findUnique({
      where: { key },
    });

    if (!config) {
      res.status(404).json({ message: `Config key '${key}' not found` });
      return;
    }

    res.json(config);
  } catch (error) {
    console.error("getByKey error:", error);
    res.status(500).json({ message: "Failed to fetch config" });
  }
};

export const upsertConfig = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { key } = req.params;
    const { value, label, group } = req.body as UpsertConfigBody;

    if (value === undefined || value === null) {
      res.status(400).json({ message: "Field 'value' is required" });
      return;
    }

    const config = await prisma.tenantConfig.upsert({
      where: { key },
      update: { value, label, group },
      create: { key, value, label, group },
    });

    res.json(config);
  } catch (error) {
    console.error("upsertConfig error:", error);
    res.status(500).json({ message: "Failed to upsert config" });
  }
};

/**
 * Keys that were seeded at some point and are read by nothing.
 *
 * A switch that appears in the settings screen and does nothing when toggled is
 * worse than an absent one — someone sets it, sees no effect, and goes looking
 * for the fault everywhere except the switch itself.
 */
const DEAD_KEYS = [
  { key: "ENABLE_PO_MODULE", insteadUse: "ENABLE_PROCUREMENT" },
  { key: "ENABLE_GRA_MODULE", insteadUse: "ENABLE_PROCUREMENT" },
  { key: "ENABLE_EXTERNAL_PROCUREMENT", insteadUse: "EXTERNAL_PO_MODE" },
  // Seeded with no consumer and no model to hang one on. The other keys found
  // dead in the same sweep were wired up instead of removed, because each
  // named a control worth having.
  { key: "RECEIPT_CHECKLIST_MANDATORY", insteadUse: "SERIAL_NUMBER_MANDATORY_ON_RECEIPT" },
];

// GET /api/tenant-config/dead-keys — report only, changes nothing
export const listDeadKeys = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const present = await prisma.tenantConfig.findMany({
      where: { key: { in: DEAD_KEYS.map((d) => d.key) } },
      select: { key: true, value: true },
    });

    res.json({
      found: present.map((p) => ({
        ...p,
        insteadUse: DEAD_KEYS.find((d) => d.key === p.key)?.insteadUse,
      })),
      count: present.length,
      note:
        present.length === 0
          ? "No dead keys present."
          : "These keys are read by nothing. Toggling them has no effect. " +
            "POST /api/tenant-config/prune-dead-keys removes them.",
    });
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to check" });
  }
};

// POST /api/tenant-config/prune-dead-keys
export const pruneDeadKeys = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    if (!["ADMIN", "CFO", "FINANCE"].includes(user?.role)) {
      res.status(403).json({ message: "Only Finance, CFO or Admin can prune configuration keys" });
      return;
    }

    const present = await prisma.tenantConfig.findMany({
      where: { key: { in: DEAD_KEYS.map((d) => d.key) } },
      select: { key: true, value: true },
    });
    if (present.length === 0) {
      res.json({ removed: [], count: 0, message: "Nothing to remove." });
      return;
    }

    await prisma.tenantConfig.deleteMany({ where: { key: { in: present.map((p) => p.key) } } });

    logAction({
      entityType: "DEPARTMENT",
      entityId: 0,
      action: "DELETE",
      description: `Removed ${present.length} dead configuration key(s): ${present.map((p) => p.key).join(", ")}`,
      performedById: user?.employeeDbId,
    });

    res.json({
      removed: present.map((p) => p.key),
      count: present.length,
      message:
        `${present.length} key(s) removed. Procurement is governed by ENABLE_PROCUREMENT ` +
        `and EXTERNAL_PO_MODE — set those instead.`,
    });
  } catch (e: any) {
    console.error("pruneDeadKeys error:", e);
    res.status(400).json({ message: e.message || "Failed to prune" });
  }
};

export const seedDefaults = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const results: { key: string; action: "created" | "skipped" }[] = [];

    for (const cfg of DEFAULT_CONFIGS) {
      const existing = await prisma.tenantConfig.findUnique({
        where: { key: cfg.key },
      });

      if (existing) {
        results.push({ key: cfg.key, action: "skipped" });
      } else {
        await prisma.tenantConfig.create({
          data: {
            key: cfg.key,
            value: cfg.value,
            label: cfg.label,
            group: cfg.group,
          },
        });
        results.push({ key: cfg.key, action: "created" });
      }
    }

    const created = results.filter((r) => r.action === "created").length;
    const skipped = results.filter((r) => r.action === "skipped").length;

    res.json({
      message: `Seed complete: ${created} created, ${skipped} skipped`,
      details: results,
    });
  } catch (error) {
    console.error("seedDefaults error:", error);
    res.status(500).json({ message: "Failed to seed default configs" });
  }
};
