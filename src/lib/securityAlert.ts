// Security alerting for the API access log.
//
// Ported from the HRMINDS pattern, adapted to Smart Assets (env-driven config,
// notificationHelper.sendEmail for delivery). Two responsibilities:
//   1. classifyRequest() — pure rules deciding whether one request is suspicious
//      (used by accessLogger to set `suspicious` + `reason` on each row).
//   2. noteSecurityEvent() + flushSecurityAlerts() — aggregate flagged events in
//      memory and email ONE digest per rule/IP every few minutes, so a burst of
//      bad requests becomes a single alert, not one email each.
//
// The aggregation is per-process and in-memory by design: a debounce buffer, not
// a store of record (the ApiAccessLog table is the store of record). Losing it on
// restart only means an in-flight digest isn't sent.

import { sendEmail } from "../utilis/notificationHelper";

export type SecurityRule =
  | "ANON_SENSITIVE" // anonymous request to a sensitive route
  | "AUTH_FAILURE" // 401 / 403 — token missing/invalid/insufficient
  | "BRUTE_FORCE" // many auth failures from one IP in the window
  | "FILE_PROBE" // request for a backend file path (.env, .git, dumps…)
  | "SUSPICIOUS_PAYLOAD"; // SQLi / XSS / traversal signature in the URL or query

// ── Config (env-driven, read once) ──────────────────────────────────────────

const list = (v: string | undefined, fallback: string[]): string[] =>
  v ? v.split(",").map((s) => s.trim()).filter(Boolean) : fallback;

export const securityConfig = {
  enabled: process.env.ACCESS_LOG_ENABLED !== "false",
  logAllToDb: process.env.ACCESS_LOG_ALL_TO_DB !== "false", // default: log every request
  logToFile: process.env.ACCESS_LOG_TO_FILE === "true", // default off (Cloud Run FS is ephemeral)
  alertEmails: list(process.env.SECURITY_ALERT_EMAILS, []),
  bruteForceThreshold: Number(process.env.SECURITY_BRUTEFORCE_THRESHOLD || 10),
  retentionDays: Number(process.env.SECURITY_RETENTION_DAYS || 30),
  appName: process.env.APP_NAME || process.env.CLIENT_ID || "Smart Assets",
  // Anonymous hits on these path prefixes are flagged. The routes still enforce
  // their own auth — this just alerts on probing of sensitive areas.
  sensitivePrefixes: list(process.env.SENSITIVE_PREFIXES, [
    "/api/users",
    "/api/employees",
    "/api/module-access",
    "/api/finance",
    "/api/accounts",
    "/api/trial",
  ]),
};

// ── File-probe detection ─────────────────────────────────────────────────────

/**
 * Paths an attacker scans for to grab backend secrets/source. The server already
 * 404s these, but a request for one is a strong "someone is probing us" signal.
 * Matched against NON-/api request paths by the accessLogger.
 */
const FILE_PROBE_PATTERNS: RegExp[] = [
  /\.env(\.|$|\/)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.(ssh|aws)(\/|$)/i,
  /(^|\/)id_rsa\b/i,
  /\.(sql|bak|backup|dump|tar|gz|tgz|zip|rar|7z)(\?|$)/i,
  /\.(pem|key|crt|cer|p12|pfx)(\?|$)/i,
  /(^|\/)(config|configuration|secret|secrets|credential|credentials)\.(json|ya?ml|xml|ini|php|js|ts)(\?|$)/i,
  /(^|\/)(wp-admin|wp-login|xmlrpc\.php|phpmyadmin|phpinfo)/i,
  /\.(php|asp|aspx|jsp)(\?|$)/i,
];

export function isFileProbe(path: string): boolean {
  return FILE_PROBE_PATTERNS.some((re) => re.test(path));
}

// ── Injection-signature detection (URL + query string only) ──────────────────

const INJECTION_PATTERNS: RegExp[] = [
  // SQL injection
  /\bunion\b[\s\S]*\bselect\b/i,
  /\bselect\b[\s\S]*\bfrom\b/i,
  /\binsert\b[\s\S]*\binto\b/i,
  /\bdrop\b\s+table\b/i,
  /\b(or|and)\b\s+\d+\s*=\s*\d+/i, // or 1=1
  /'\s*(or|and)\s+'?\d/i,
  /(--|#|\/\*)\s*$/, // trailing SQL comment
  /\b(xp_cmdshell|information_schema|sleep\s*\(|benchmark\s*\()/i,
  // XSS
  /<script\b/i,
  /javascript:/i,
  /\bon(error|load|click|mouseover)\s*=/i,
  /<img[^>]+src\s*=/i,
  // Path traversal / local file access
  /\.\.[\/\\]/,
  /(\/etc\/passwd|\/proc\/self|boot\.ini|win\.ini)/i,
];

/** Decodes percent-encoding (best effort) so encoded payloads still match. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** True if the URL (path + query) carries an injection/XSS/traversal signature. */
export function hasInjectionSignature(rawUrl: string): boolean {
  const decoded = safeDecode(rawUrl);
  return INJECTION_PATTERNS.some((re) => re.test(rawUrl) || re.test(decoded));
}

// ── Per-request classification ───────────────────────────────────────────────

interface ClassifyInput {
  path: string; // path without query
  rawUrl: string; // path + query string
  statusCode: number;
  isAnonymous: boolean;
}

/**
 * Decide whether a single request is suspicious. Pure — no side effects.
 * Returns the list of rules it tripped (empty = not suspicious).
 */
export function classifyRequest({ path, rawUrl, statusCode, isAnonymous }: ClassifyInput): SecurityRule[] {
  const rules: SecurityRule[] = [];

  if (isAnonymous && securityConfig.sensitivePrefixes.some((p) => path.startsWith(p))) {
    rules.push("ANON_SENSITIVE");
  }
  if (statusCode === 401 || statusCode === 403) {
    rules.push("AUTH_FAILURE");
  }
  if (hasInjectionSignature(rawUrl)) {
    rules.push("SUSPICIOUS_PAYLOAD");
  }
  return rules;
}

// ── In-memory aggregation ────────────────────────────────────────────────────

interface Bucket {
  rule: SecurityRule;
  ip: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
  samplePaths: Set<string>;
  sampleUserAgents: Set<string>;
}

const buckets = new Map<string, Bucket>(); // key = `${rule}|${ip}`
const authFailByIp = new Map<string, number>();

function bump(rule: SecurityRule, ip: string, path: string, userAgent: string | undefined, when: Date) {
  const key = `${rule}|${ip}`;
  let b = buckets.get(key);
  if (!b) {
    b = { rule, ip, count: 0, firstAt: when, lastAt: when, samplePaths: new Set(), sampleUserAgents: new Set() };
    buckets.set(key, b);
  }
  b.count++;
  b.lastAt = when;
  if (b.samplePaths.size < 8) b.samplePaths.add(path);
  if (userAgent && b.sampleUserAgents.size < 4) b.sampleUserAgents.add(userAgent);
}

/**
 * Record a flagged request into the alert buffer. Called by the middleware only
 * when classifyRequest() returned at least one rule.
 */
export function noteSecurityEvent(args: {
  rules: SecurityRule[];
  ip: string;
  path: string;
  userAgent?: string;
  when: Date;
}) {
  const ip = args.ip || "unknown";

  for (const rule of args.rules) {
    bump(rule, ip, args.path, args.userAgent, args.when);

    if (rule === "AUTH_FAILURE") {
      const next = (authFailByIp.get(ip) ?? 0) + 1;
      authFailByIp.set(ip, next);
      if (next === securityConfig.bruteForceThreshold) {
        bump("BRUTE_FORCE", ip, args.path, args.userAgent, args.when);
      } else if (next > securityConfig.bruteForceThreshold) {
        const bf = buckets.get(`BRUTE_FORCE|${ip}`);
        if (bf) {
          bf.count++;
          bf.lastAt = args.when;
        }
      }
    }
  }
}

const RULE_LABEL: Record<SecurityRule, string> = {
  ANON_SENSITIVE: "Anonymous access to sensitive endpoint",
  AUTH_FAILURE: "Authentication/authorization failure (401/403)",
  BRUTE_FORCE: "Repeated auth failures from one IP (possible brute force)",
  FILE_PROBE: "⚠ Probe for backend file / secret (.env, .git, dump, …)",
  SUSPICIOUS_PAYLOAD: "⚠ Injection signature in URL (SQLi / XSS / path traversal)",
};

/**
 * Flush the buffer: if anything accumulated, send ONE aggregated alert email and
 * clear the buffer. Safe to call on an empty buffer (no-op). Invoked by cron.
 */
export async function flushSecurityAlerts(): Promise<{ sent: boolean; events: number }> {
  if (buckets.size === 0) {
    authFailByIp.clear();
    return { sent: false, events: 0 };
  }

  const rows = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  const totalEvents = rows.reduce((n, r) => n + r.count, 0);

  const htmlRows = rows
    .map(
      (r) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #ddd">${RULE_LABEL[r.rule]}</td>
      <td style="padding:6px 10px;border:1px solid #ddd"><code>${r.ip}</code></td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${r.count}</td>
      <td style="padding:6px 10px;border:1px solid #ddd">${Array.from(r.samplePaths).join("<br/>")}</td>
    </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif">
      <h2 style="color:#b00020">🔒 API Security Alert — ${securityConfig.appName}</h2>
      <p><b>${totalEvents}</b> flagged request(s) across <b>${rows.length}</b> IP/rule group(s) in the last window.</p>
      <table style="border-collapse:collapse;font-size:13px">
        <tr style="background:#f3f3f3">
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Rule</th>
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">IP</th>
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:right">Count</th>
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Sample paths</th>
        </tr>
        ${htmlRows}
      </table>
      <p style="color:#666;font-size:12px">Aggregated alert. Full detail is in the <code>apiaccesslog</code> table.</p>
    </div>`;

  // Clear the buffer now — even if the email fails, we must not re-send the same
  // accumulated events every window forever.
  buckets.clear();
  authFailByIp.clear();

  if (securityConfig.alertEmails.length === 0) {
    console.warn(
      `[security] ${totalEvents} flagged request(s) but SECURITY_ALERT_EMAILS is empty — not emailing.`
    );
    return { sent: false, events: totalEvents };
  }

  try {
    // notificationHelper.sendEmail is fire-and-forget (swallows its own errors),
    // so wrap for our own return signal.
    await sendEmail({
      to: securityConfig.alertEmails,
      subject: `🔒 [${securityConfig.appName}] API security alert — ${totalEvents} flagged request(s)`,
      html,
    });
    return { sent: true, events: totalEvents };
  } catch (e) {
    console.error("[security] failed to send alert email:", e);
    return { sent: false, events: totalEvents };
  }
}
