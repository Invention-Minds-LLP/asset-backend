import admin from "firebase-admin";
import fs from "fs";
import path from "path";

// ─── Provider-agnostic Firebase init ───────────────────────────────────────
// Loads the service-account JSON from a path supplied via env var
// (FIREBASE_SERVICE_ACCOUNT_PATH). If the file is missing or the env var is
// unset, the module fails open — `getFirebaseApp()` returns null and the push
// helper becomes a no-op. This lets the server boot in environments where FCM
// is not yet configured (dev, demo, CI) without crashing.
//
// To enable:
//   1. Drop your Firebase project's service-account JSON anywhere on the host.
//   2. Set FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/service-account.json
//   3. Restart the server.

let initialized = false;
let initFailed  = false;
let appInstance: admin.app.App | null = null;

function init(): admin.app.App | null {
  if (initialized) return appInstance;
  initialized = true;

  const cfgPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!cfgPath) {
    console.warn("[firebase] FIREBASE_SERVICE_ACCOUNT_PATH not set — push notifications disabled.");
    initFailed = true;
    return null;
  }

  const absPath = path.isAbsolute(cfgPath) ? cfgPath : path.join(process.cwd(), cfgPath);
  if (!fs.existsSync(absPath)) {
    console.warn(`[firebase] Service account file not found at ${absPath} — push notifications disabled.`);
    initFailed = true;
    return null;
  }

  try {
    const serviceAccount = JSON.parse(fs.readFileSync(absPath, "utf-8"));
    appInstance = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    });
    console.log("[firebase] Initialized — push notifications enabled.");
    return appInstance;
  } catch (err) {
    console.error("[firebase] Init failed:", err);
    initFailed = true;
    return null;
  }
}

/** Returns the initialized Firebase app, or null if FCM is not configured. */
export function getFirebaseApp(): admin.app.App | null {
  return init();
}

/** True if Firebase failed to initialize (missing config, bad JSON, etc.). */
export function isPushDisabled(): boolean {
  init();
  return initFailed || appInstance === null;
}

export default admin;
