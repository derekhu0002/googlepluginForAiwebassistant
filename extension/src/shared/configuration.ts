import { z } from "zod";

export type ExtensionEnvironment = "development" | "production" | "test";

export interface ExtensionConfig {
  extensionEnv: ExtensionEnvironment;
  apiBaseUrl: string;
  apiKey: string;
  requestTimeoutMs: number;
  allowedApiOrigins: string[];
  allowedPageMatches: string[];
  apiHostPermissions: string[];
}

type RawEnv = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_PROD_API_BASE_URL = "https://api.example.com";
const DEFAULT_DEV_API_BASE_URL = "http://localhost:8787";
const DEFAULT_PROD_API_ORIGINS = ["https://api.example.com"];
const DEFAULT_DEV_API_ORIGINS = ["http://localhost:8787"];
const DEFAULT_PROD_PAGE_MATCHES = ["https://example.com/*", "https://*.example.com/*"];
const DEFAULT_DEV_PAGE_MATCHES = [
  ...DEFAULT_PROD_PAGE_MATCHES,
  "http://localhost/*",
  "http://127.0.0.1/*"
];

const extensionEnvironmentSchema = z.enum(["development", "production", "test"]);

function parseCsvList(input: string | undefined, fallback: string[]) {
  const value = input?.trim();
  if (!value) {
    return [...fallback];
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getDefaultApiBaseUrl(extensionEnv: ExtensionEnvironment) {
  return extensionEnv === "development" ? DEFAULT_DEV_API_BASE_URL : DEFAULT_PROD_API_BASE_URL;
}

function getDefaultApiOrigins(extensionEnv: ExtensionEnvironment) {
  return extensionEnv === "development" ? DEFAULT_DEV_API_ORIGINS : DEFAULT_PROD_API_ORIGINS;
}

function getDefaultPageMatches(extensionEnv: ExtensionEnvironment) {
  return extensionEnv === "development" ? DEFAULT_DEV_PAGE_MATCHES : DEFAULT_PROD_PAGE_MATCHES;
}

function resolveExtensionEnvironment(rawEnv: RawEnv, mode = "production"): ExtensionEnvironment {
  const requested = rawEnv.VITE_EXTENSION_ENV ?? (mode === "development" ? "development" : mode === "test" ? "test" : "production");
  return extensionEnvironmentSchema.parse(requested);
}

function validatePageMatchPattern(pattern: string) {
  if (["<all_urls>", "http://*/*", "https://*/*"].includes(pattern)) {
    throw new Error(`Overbroad page match pattern is not allowed: ${pattern}`);
  }

  const schema = z.string().regex(/^https?:\/\/(\*\.[^/*]+|[^/*]+)\/\*$/, `Invalid Chrome match pattern: ${pattern}`);
  return schema.parse(pattern);
}

function validateApiOrigin(origin: string, extensionEnv: ExtensionEnvironment) {
  const url = new URL(origin);
  if (url.protocol === "https:") {
    return url.origin;
  }

  if (url.protocol === "http:" && extensionEnv === "development" && isLocalHostname(url.hostname)) {
    return url.origin;
  }

  throw new Error(`API origin must be HTTPS unless running local development: ${origin}`);
}

function validateApiBaseUrl(apiBaseUrl: string, extensionEnv: ExtensionEnvironment, allowedApiOrigins: string[]) {
  const url = new URL(apiBaseUrl);
  const protocolAllowed = url.protocol === "https:" || (url.protocol === "http:" && extensionEnv === "development" && isLocalHostname(url.hostname));

  if (!protocolAllowed) {
    throw new Error(`API base URL must be HTTPS unless running local development: ${apiBaseUrl}`);
  }

  if (!allowedApiOrigins.includes(url.origin)) {
    throw new Error(`API base URL origin is not in the extension allowlist: ${url.origin}`);
  }

  return url.toString().replace(/\/$/, "");
}

function toApiHostPermission(origin: string) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function createExtensionConfig(rawEnv: RawEnv, mode = "production"): ExtensionConfig {
  const extensionEnv = resolveExtensionEnvironment(rawEnv, mode);
  const requestTimeoutMs = z.coerce.number().int().positive().parse(rawEnv.VITE_REQUEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const allowedApiOrigins = parseCsvList(rawEnv.VITE_ALLOWED_API_ORIGINS, getDefaultApiOrigins(extensionEnv)).map((origin) => validateApiOrigin(origin, extensionEnv));
  const apiBaseUrl = validateApiBaseUrl(rawEnv.VITE_API_BASE_URL ?? getDefaultApiBaseUrl(extensionEnv), extensionEnv, allowedApiOrigins);
  const allowedPageMatches = parseCsvList(rawEnv.VITE_ALLOWED_PAGE_MATCHES, getDefaultPageMatches(extensionEnv)).map(validatePageMatchPattern);

  return {
    extensionEnv,
    apiBaseUrl,
    apiKey: (rawEnv.VITE_API_KEY ?? "").trim(),
    requestTimeoutMs,
    allowedApiOrigins: Array.from(new Set(allowedApiOrigins)),
    allowedPageMatches: Array.from(new Set(allowedPageMatches)),
    apiHostPermissions: Array.from(new Set(allowedApiOrigins.map(toApiHostPermission)))
  };
}

export function createExtensionManifest(rawEnv: RawEnv, mode = "production") {
  const config = createExtensionConfig(rawEnv, mode);
  const hostPermissions = Array.from(new Set([...config.allowedPageMatches, ...config.apiHostPermissions]));

  return {
    manifest_version: 3,
    name: "AI Web Assistant MVP",
    version: "0.1.0",
    description: "Collect page fields and analyze them through a mock backend service.",
    permissions: ["storage", "tabs", "sidePanel"],
    host_permissions: hostPermissions,
    background: {
      service_worker: "background.js",
      type: "module"
    },
    action: {
      default_title: "AI Web Assistant"
    },
    side_panel: {
      default_path: "sidepanel.html"
    },
    content_scripts: [
      {
        matches: config.allowedPageMatches,
        js: ["content.js"],
        run_at: "document_idle"
      }
    ],
    web_accessible_resources: [
      {
        resources: ["sidepanel.html", "assets/*"],
        matches: config.allowedPageMatches
      }
    ]
  };
}
