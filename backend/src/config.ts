import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ALLOWED_ORIGINS: z.string().optional().default(""),
  API_KEY: z.string().optional().default(""),
  ANALYSIS_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  MOCK_PROVIDER_DELAY_MS: z.coerce.number().int().min(0).default(300)
});

const parsedEnv = envSchema.parse(process.env);

const DEFAULT_PRODUCTION_ALLOWED_ORIGINS = ["https://example.com", "https://app.example.com"];
const DEFAULT_DEVELOPMENT_ALLOWED_ORIGINS = ["http://localhost:5173", "chrome-extension://dev-extension-id"];

function parseOrigins(input: string) {
  return input.split(",").map((item) => item.trim()).filter(Boolean);
}

function isLocalOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function validateAllowedOrigin(origin: string, envName: string) {
  const url = new URL(origin);

  if (url.protocol === "https:" || url.protocol === "chrome-extension:") {
    return url.origin;
  }

  if ((envName === "development" || envName === "test") && isLocalOrigin(origin)) {
    return url.origin;
  }

  throw new Error(`ALLOWED_ORIGINS must be HTTPS/chrome-extension origins, or localhost during development: ${origin}`);
}

const allowedOrigins = (parsedEnv.ALLOWED_ORIGINS
  ? parseOrigins(parsedEnv.ALLOWED_ORIGINS)
  : parsedEnv.NODE_ENV === "production"
    ? DEFAULT_PRODUCTION_ALLOWED_ORIGINS
    : DEFAULT_DEVELOPMENT_ALLOWED_ORIGINS).map((origin) => validateAllowedOrigin(origin, parsedEnv.NODE_ENV));

export const env = {
  ...parsedEnv,
  ALLOWED_ORIGINS: Array.from(new Set(allowedOrigins))
};

export type BackendEnv = typeof env;
