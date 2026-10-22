// Fail-fast environment validation.
// Imported once, early in src/index.ts (right after `dotenv/config`), so the
// server refuses to start if a critical secret is missing instead of running
// with a guessable fallback.

const REQUIRED_ENV = ["JWT_SECRET", "DATABASE_URL"] as const;

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(
    `[FATAL] Missing required environment variable(s): ${missing.join(", ")}. ` +
      `The server will not start. Set them in .env or the deployment environment.`
  );
  process.exit(1);
}

// Not fatal (exempt roles can still sign in), but every Google-Authenticator
// login will fail until it is set.
if (!process.env.MFA_ENC_KEY && process.env.MFA_ENABLED !== "false") {
  console.warn(
    "[WARN] MFA_ENC_KEY is not set — Google Authenticator logins will fail. " +
      "Set a long random value (e.g. `openssl rand -hex 32`) and keep it stable."
  );
}

export {};
