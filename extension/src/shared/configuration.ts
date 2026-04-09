import { z } from "zod";

export type ExtensionEnvironment = "development" | "production" | "test";

export interface ExtensionConfig {
  extensionEnv: ExtensionEnvironment;
  apiBaseUrl: string;
  apiKey: string;
  requestTimeoutMs: number;
  allowedApiOrigins: string[];
  optionalHostPermissions: string[];
  webAccessibleResourceMatches: string[];
  apiHostPermissions: string[];
}

type RawEnv = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_PROD_API_BASE_URL = "https://api.example.com";
// Extension targets the local python adapter on :8000; that adapter forwards upstream to opencode on :8124.
const DEFAULT_DEV_API_BASE_URL = "http://localhost:8000";
const DEFAULT_PROD_API_ORIGINS = ["https://api.example.com"];
const DEFAULT_DEV_API_ORIGINS = ["http://localhost:8000"];
const DEFAULT_OPTIONAL_HOST_PERMISSIONS = ["https://example.com/*", "https://*.example.com/*"];
const DEFAULT_DEV_OPTIONAL_HOST_PERMISSIONS = [
  ...DEFAULT_OPTIONAL_HOST_PERMISSIONS,
  "http://localhost/*",
  "http://127.0.0.1/*"
];
const DEFAULT_WEB_ACCESSIBLE_RESOURCE_MATCHES = ["https://example.com/*", "https://*.example.com/*"];
const DEFAULT_DEV_WEB_ACCESSIBLE_RESOURCE_MATCHES = [
  ...DEFAULT_WEB_ACCESSIBLE_RESOURCE_MATCHES,
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

function getDefaultOptionalHostPermissions(extensionEnv: ExtensionEnvironment) {
  return extensionEnv === "development" ? DEFAULT_DEV_OPTIONAL_HOST_PERMISSIONS : DEFAULT_OPTIONAL_HOST_PERMISSIONS;
}

function getDefaultWebAccessibleResourceMatches(extensionEnv: ExtensionEnvironment) {
  return extensionEnv === "development" ? DEFAULT_DEV_WEB_ACCESSIBLE_RESOURCE_MATCHES : DEFAULT_WEB_ACCESSIBLE_RESOURCE_MATCHES;
}

function resolveExtensionEnvironment(rawEnv: RawEnv, mode = "production"): ExtensionEnvironment {
  const requested = rawEnv.VITE_EXTENSION_ENV ?? (mode === "development" ? "development" : mode === "test" ? "test" : "production");
  return extensionEnvironmentSchema.parse(requested);
}

function validateHostPermissionPattern(pattern: string) {
  if (pattern === "<all_urls>") {
    throw new Error(`Unsupported host permission pattern: ${pattern}`);
  }

  const schema = z.string().regex(/^https?:\/\/(\*|\*\.[^/*]+|[^/*]+)\/\*$/, `Invalid Chrome match pattern: ${pattern}`);
  return schema.parse(pattern);
}

function validateControlledHostPermissionPattern(pattern: string) {
  const normalized = validateHostPermissionPattern(pattern);
  const hostname = getPatternHostname(normalized);

  if (hostname === "*") {
    throw new Error(`Unsupported broad host permission pattern: ${pattern}`);
  }

  return normalized;
}

function ensureHostPermissionPatterns(patterns: string[]) {
  return Array.from(new Set(patterns.map(validateControlledHostPermissionPattern)));
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

function getPatternHostname(pattern: string) {
  return pattern.split("://")[1]?.replace(/\/\*$/, "") ?? "";
}

function hostPatternCovers(candidateHostname: string, allowedHostname: string) {
  if (allowedHostname === "*") {
    return true;
  }

  if (candidateHostname === allowedHostname) {
    return true;
  }

  if (allowedHostname.startsWith("*.")) {
    const suffix = allowedHostname.slice(2);
    return candidateHostname === suffix || candidateHostname.endsWith(`.${suffix}`);
  }

  return false;
}

function patternCovers(candidatePattern: string, allowedPattern: string) {
  const candidateScheme = candidatePattern.startsWith("https://") ? "https" : candidatePattern.startsWith("http://") ? "http" : "";
  const allowedScheme = allowedPattern.startsWith("https://") ? "https" : allowedPattern.startsWith("http://") ? "http" : "";

  if (!candidateScheme || candidateScheme !== allowedScheme) {
    return false;
  }

  const candidateHostname = getPatternHostname(candidatePattern);
  const allowedHostname = getPatternHostname(allowedPattern);
  return hostPatternCovers(candidateHostname, allowedHostname);
}

function validateWebAccessibleResourceMatches(matches: string[], optionalHostPermissions: string[]) {
  return matches.map(validateControlledHostPermissionPattern).map((pattern) => {
    const covered = optionalHostPermissions.some((allowedPattern) => patternCovers(pattern, allowedPattern));
    if (!covered) {
      throw new Error(`Web accessible resource match must stay within controlled host permissions: ${pattern}`);
    }

    return pattern;
  });
}

export function createExtensionConfig(rawEnv: RawEnv, mode = "production"): ExtensionConfig {
  const extensionEnv = resolveExtensionEnvironment(rawEnv, mode);
  const requestTimeoutMs = z.coerce.number().int().positive().parse(rawEnv.VITE_REQUEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const allowedApiOrigins = parseCsvList(rawEnv.VITE_ALLOWED_API_ORIGINS, getDefaultApiOrigins(extensionEnv)).map((origin) => validateApiOrigin(origin, extensionEnv));
  const apiBaseUrl = validateApiBaseUrl(rawEnv.VITE_API_BASE_URL ?? getDefaultApiBaseUrl(extensionEnv), extensionEnv, allowedApiOrigins);
  const optionalHostPermissions = ensureHostPermissionPatterns(parseCsvList(rawEnv.VITE_OPTIONAL_HOST_PERMISSIONS, getDefaultOptionalHostPermissions(extensionEnv)));
  const webAccessibleResourceMatches = validateWebAccessibleResourceMatches(
    parseCsvList(rawEnv.VITE_WEB_ACCESSIBLE_RESOURCE_MATCHES, getDefaultWebAccessibleResourceMatches(extensionEnv)),
    optionalHostPermissions
  );

  return {
    extensionEnv,
    apiBaseUrl,
    apiKey: (rawEnv.VITE_API_KEY ?? "").trim(),
    requestTimeoutMs,
    allowedApiOrigins: Array.from(new Set(allowedApiOrigins)),
    optionalHostPermissions,
    webAccessibleResourceMatches: Array.from(new Set(webAccessibleResourceMatches)),
    apiHostPermissions: Array.from(new Set(allowedApiOrigins.map(toApiHostPermission)))
  };
}

export function createExtensionManifest(rawEnv: RawEnv, mode = "production") {
  const config = createExtensionConfig(rawEnv, mode);

  return {
    manifest_version: 3,
    name: "AI Web Assistant MVP",
    version: "0.1.0",
    description: "Collect page fields and stream AI runs through a Python adapter.",
    permissions: ["storage", "tabs", "sidePanel", "scripting", "activeTab", "permissions"],
    host_permissions: config.apiHostPermissions,
    optional_host_permissions: config.optionalHostPermissions,
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
        matches: config.webAccessibleResourceMatches,
        js: ["content.js"],
        run_at: "document_idle"
      }
    ],
    web_accessible_resources: [
      {
        resources: ["sidepanel.html", "assets/*"],
        matches: config.webAccessibleResourceMatches
      }
    ]
  };
}
