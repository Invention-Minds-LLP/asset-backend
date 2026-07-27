import cron from "node-cron";
import { runAllChecksInternal, runAssetStaleLocationCheck } from "./api/cron-jobs/cron-jobs.controller";
import { runManagementAssetAlerts } from "./api/cron-jobs/mgmt-asset-alerts";
import { syncAllToDirectory } from "./utilis/directory";
import { flushSecurityAlerts, securityConfig } from "./lib/securityAlert";
import prisma from "./prismaClient";

// In-process daily scheduler for the alert / expiry checks.
// Runs every day at 08:00 server time. Each individual check is also still
// exposed as a POST endpoint under /api/cron-jobs for manual / external runs.
export function startScheduler() {
  cron.schedule("0 8 * * *", async () => {
    const startedAt = new Date().toISOString();
    console.log(`[scheduler] daily alert checks started at ${startedAt}`);
    try {
      const results = await runAllChecksInternal();
      console.log("[scheduler] daily alert checks complete:", JSON.stringify(results));
    } catch (err) {
      console.error("[scheduler] daily alert checks failed:", err);
    }
  });

  console.log("[scheduler] daily alert checks scheduled for 08:00 server time");

  // Hourly CCTV asset-not-returned check. The 12-hour "hasn't returned" rule
  // needs finer resolution than the 08:00 daily batch, so it runs on its own
  // hourly schedule. Per-day dedupe on the notification prevents repeat alerts.
  cron.schedule("0 * * * *", async () => {
    try {
      const result = await runAssetStaleLocationCheck();
      console.log("[scheduler] asset-not-returned check:", JSON.stringify(result));
    } catch (err) {
      console.error("[scheduler] asset-not-returned check failed:", err);
    }
  });

  console.log("[scheduler] asset-not-returned check scheduled hourly");

  // Daily management alerts: assets past 35% maintenance-to-cost (services need
  // approval) and past 50% of expected life (replacement planning). Deduped per day.
  cron.schedule("15 8 * * *", async () => {
    try {
      const result = await runManagementAssetAlerts();
      console.log("[scheduler] management asset alerts:", JSON.stringify(result));
    } catch (err) {
      console.error("[scheduler] management asset alerts failed:", err);
    }
  });

  console.log("[scheduler] management asset alerts scheduled for 08:15 server time");

  // Nightly push of Employee IDs + external-auditor emails to the tenant
  // directory (multi-tenant routing). No-ops if DIRECTORY_URL isn't configured.
  cron.schedule("30 2 * * *", async () => {
    console.log("[scheduler] directory sync started");
    const result = await syncAllToDirectory();
    console.log("[scheduler] directory sync result:", JSON.stringify(result));
  });

  console.log("[scheduler] directory sync scheduled for 02:30 server time");

  // Security alerts: every 5 min, flush the in-memory buffer of flagged API
  // requests as ONE aggregated email (a burst of bad requests = one alert, not
  // hundreds). No-op when access logging is disabled or nothing was flagged.
  if (securityConfig.enabled) {
    cron.schedule("*/5 * * * *", async () => {
      try {
        const r = await flushSecurityAlerts();
        if (r.events > 0) {
          console.log(`[scheduler] security alerts: ${r.events} flagged request(s), emailed=${r.sent}`);
        }
      } catch (err) {
        console.error("[scheduler] flushSecurityAlerts failed:", err);
      }
    });
    console.log("[scheduler] security alert flush scheduled every 5 minutes");

    // Nightly at 03:30 — purge apiaccesslog rows past the retention window so the
    // (high-volume, log-everything) table doesn't grow without bound.
    cron.schedule("30 3 * * *", async () => {
      try {
        const cutoff = new Date(Date.now() - securityConfig.retentionDays * 24 * 60 * 60 * 1000);
        const { count } = await prisma.apiAccessLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
        console.log(`[scheduler] apiaccesslog purge: removed ${count} row(s) older than ${securityConfig.retentionDays} day(s)`);
      } catch (err) {
        console.error("[scheduler] apiaccesslog purge failed:", err);
      }
    });
    console.log(`[scheduler] apiaccesslog purge scheduled for 03:30 (retention ${securityConfig.retentionDays}d)`);
  }
}
