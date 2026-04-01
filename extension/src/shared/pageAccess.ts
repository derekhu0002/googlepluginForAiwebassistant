import type { ErrorCode } from "./errors";

export interface PageAccessResult {
  allowed: boolean;
  code?: Extract<ErrorCode, "PERMISSION_ERROR" | "RESTRICTED_PAGE_ERROR" | "RULE_NOT_MATCHED_ERROR">;
  message?: string;
}

const RESTRICTED_PROTOCOLS = new Set([
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "edge:",
  "about:",
  "view-source:"
]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isRestrictedUrl(url: string) {
  try {
    const parsed = new URL(url);
    return RESTRICTED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function matchesChromePattern(url: string, pattern: string) {
  try {
    const parsedUrl = new URL(url);
    const scheme = pattern.startsWith("https://") ? "https:" : pattern.startsWith("http://") ? "http:" : "";
    if (!scheme || parsedUrl.protocol !== scheme) {
      return false;
    }

    const [, hostPart] = pattern.split("://");
    const hostnamePattern = hostPart.replace(/\/\*$/, "");
    const hostRegex = hostnamePattern === "*"
      ? /^.+$/
      : hostnamePattern.startsWith("*.")
      ? new RegExp(`^(?:[^./]+\\.)*${escapeRegExp(hostnamePattern.slice(2))}$`)
      : new RegExp(`^${escapeRegExp(hostnamePattern)}$`);

    if (!hostRegex.test(parsedUrl.hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function evaluatePageAccess(url: string | undefined, allowedPageMatches: string[]): PageAccessResult {
  if (!url) {
    return {
      allowed: false,
      code: "PERMISSION_ERROR",
      message: "当前标签页缺少可用地址"
    };
  }

  if (isRestrictedUrl(url)) {
    return {
      allowed: false,
      code: "RESTRICTED_PAGE_ERROR",
      message: "当前页面属于浏览器受限页面，Chrome 不允许注入内容脚本。"
    };
  }

  if (!allowedPageMatches.some((pattern) => matchesChromePattern(url, pattern))) {
    return {
      allowed: false,
      code: "PERMISSION_ERROR",
      message: "当前页面域名不在受控授权清单内。请先在扩展配置中登记该域名，再由用户在 Side Panel 中申请当前域名权限。"
    };
  }

  return { allowed: true };
}

export function toOriginPermissionPattern(url: string) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}
