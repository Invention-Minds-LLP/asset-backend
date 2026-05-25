"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirebaseApp = getFirebaseApp;
exports.isPushDisabled = isPushDisabled;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
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
let initFailed = false;
let appInstance = null;
function init() {
    if (initialized)
        return appInstance;
    initialized = true;
    const cfgPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!cfgPath) {
        console.warn("[firebase] FIREBASE_SERVICE_ACCOUNT_PATH not set — push notifications disabled.");
        initFailed = true;
        return null;
    }
    const absPath = path_1.default.isAbsolute(cfgPath) ? cfgPath : path_1.default.join(process.cwd(), cfgPath);
    if (!fs_1.default.existsSync(absPath)) {
        console.warn(`[firebase] Service account file not found at ${absPath} — push notifications disabled.`);
        initFailed = true;
        return null;
    }
    try {
        const serviceAccount = JSON.parse(fs_1.default.readFileSync(absPath, "utf-8"));
        appInstance = firebase_admin_1.default.initializeApp({
            credential: firebase_admin_1.default.credential.cert(serviceAccount),
        });
        console.log("[firebase] Initialized — push notifications enabled.");
        return appInstance;
    }
    catch (err) {
        console.error("[firebase] Init failed:", err);
        initFailed = true;
        return null;
    }
}
/** Returns the initialized Firebase app, or null if FCM is not configured. */
function getFirebaseApp() {
    return init();
}
/** True if Firebase failed to initialize (missing config, bad JSON, etc.). */
function isPushDisabled() {
    init();
    return initFailed || appInstance === null;
}
exports.default = firebase_admin_1.default;
