import cron from "node-cron";
import { runAllChecksInternal } from "./api/cron-jobs/cron-jobs.controller";

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
}
