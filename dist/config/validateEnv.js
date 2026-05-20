"use strict";
// Fail-fast environment validation.
// Imported once, early in src/index.ts (right after `dotenv/config`), so the
// server refuses to start if a critical secret is missing instead of running
// with a guessable fallback.
Object.defineProperty(exports, "__esModule", { value: true });
const REQUIRED_ENV = ["JWT_SECRET", "DATABASE_URL"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
    console.error(`[FATAL] Missing required environment variable(s): ${missing.join(", ")}. ` +
        `The server will not start. Set them in .env or the deployment environment.`);
    process.exit(1);
}
