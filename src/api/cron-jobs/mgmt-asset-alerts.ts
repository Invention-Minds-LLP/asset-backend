import prisma from "../../prismaClient";
import { notify, getEmployeeIdsByRole } from "../../utilis/notificationHelper";

/**
 * Daily management alerts (run by the scheduler):
 *  1. Assets whose lifetime maintenance spend crossed 35% of purchase cost —
 *     further services on them need management approval.
 *  2. Assets that have used more than 50% of their expected useful life —
 *     early replacement-planning signal.
 *
 * One summary notification per category per day (dedupeKey = date), sent to
 * management-role employees (CEO_COO, CFO, FINANCE, OPERATIONS).
 */
export async function runManagementAssetAlerts() {
  const today = new Date().toISOString().split("T")[0];
  const recipients = await getEmployeeIdsByRole(["CEO_COO", "CFO", "FINANCE", "OPERATIONS"]);
  if (!recipients.length) return { skipped: "no management recipients" };

  const [maint35, life50] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT a.assetId, a.assetName,
             COALESCE(mh.spend, 0) + COALESCE(tk.spend, 0) AS maintSpend, a.purchaseCost
      FROM asset a
      LEFT JOIN (SELECT assetId, SUM(totalCost) spend FROM maintenancehistory GROUP BY assetId) mh ON mh.assetId = a.id
      LEFT JOIN (SELECT assetId, SUM(totalCost) spend FROM ticket GROUP BY assetId) tk ON tk.assetId = a.id
      WHERE a.status NOT IN ('DISPOSED','SCRAPPED','CONDEMNED') AND a.purchaseCost > 0
      HAVING maintSpend >= a.purchaseCost * 0.35
      ORDER BY maintSpend / a.purchaseCost DESC
      LIMIT 200`,
    prisma.$queryRaw<any[]>`
      SELECT a.assetId,
             DATEDIFF(NOW(), COALESCE(ad.depreciationStart, a.purchaseDate)) / 365.25 AS ageYears,
             COALESCE(ad.expectedLifeYears, a.expectedLifetime) AS lifeYears
      FROM asset a
      LEFT JOIN assetdepreciation ad ON ad.assetId = a.id
      WHERE a.status NOT IN ('DISPOSED','SCRAPPED','CONDEMNED','RETIRED')
        AND COALESCE(ad.depreciationStart, a.purchaseDate) IS NOT NULL
        AND COALESCE(ad.expectedLifeYears, a.expectedLifetime) > 0
      HAVING ageYears >= lifeYears * 0.5
      LIMIT 500`,
  ]);

  const results: any = { maint35: maint35.length, life50: life50.length, notified: false };

  if (maint35.length > 0) {
    const top = maint35.slice(0, 3).map((r) => r.assetId).join(", ");
    await notify({
      type: "MGMT_MAINT_APPROVAL",
      title: `Approval needed: ${maint35.length} asset${maint35.length > 1 ? "s" : ""} crossed 35% maintenance-to-cost`,
      message:
        `${maint35.length} asset${maint35.length > 1 ? "s have" : " has"} lifetime maintenance spend of 35% or more of purchase cost ` +
        `(worst: ${top}). As per policy, further services on these assets require management approval. ` +
        `Full list: Head Office dashboard → "Needs management approval".`,
      priority: "HIGH",
      recipientIds: recipients,
      dedupeKey: `mgmt-maint35-${today}`,
    });
    results.notified = true;
  }

  if (life50.length > 0) {
    await notify({
      type: "MGMT_LIFETIME_ALERT",
      title: `${life50.length} asset${life50.length > 1 ? "s have" : " has"} used over 50% of expected life`,
      message:
        `${life50.length} asset${life50.length > 1 ? "s are" : " is"} past the halfway point of expected useful life — ` +
        `start replacement/budget planning. Full list: Head Office dashboard → "Needs management approval".`,
      priority: "MEDIUM",
      recipientIds: recipients,
      dedupeKey: `mgmt-life50-${today}`,
    });
    results.notified = true;
  }

  return results;
}
