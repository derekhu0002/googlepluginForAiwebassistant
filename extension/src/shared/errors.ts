export const ERROR_CODES = [
  "CAPTURE_ERROR",
  "VALIDATION_ERROR",
  "NETWORK_ERROR",
  "ANALYSIS_ERROR",
  "TIMEOUT_ERROR",
  "PERMISSION_ERROR",
  "RESTRICTED_PAGE_ERROR",
  "AUTH_ERROR"
] as const;

export type ErrorCode =
  | "CAPTURE_ERROR"
  | "VALIDATION_ERROR"
  | "NETWORK_ERROR"
  | "ANALYSIS_ERROR"
  | "TIMEOUT_ERROR"
  | "PERMISSION_ERROR"
  | "RESTRICTED_PAGE_ERROR"
  | "AUTH_ERROR";

export interface DomainError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export class ExtensionError extends Error {
  constructor(public readonly domainError: DomainError) {
    super(domainError.message);
  }
}

export function createDomainError(code: ErrorCode, message: string, details?: unknown): DomainError {
  return {
    code,
    message,
    details
  };
}

export function toDisplayMessage(error: DomainError) {
  switch (error.code) {
    case "PERMISSION_ERROR":
      return `权限受限：${error.message}`;
    case "RESTRICTED_PAGE_ERROR":
      return `受限页面：${error.message}`;
    case "AUTH_ERROR":
      return `鉴权失败：${error.message}`;
    case "TIMEOUT_ERROR":
      return `请求超时：${error.message}`;
    case "NETWORK_ERROR":
      return `网络失败：${error.message}`;
    case "VALIDATION_ERROR":
      return `请求校验失败：${error.message}`;
    case "ANALYSIS_ERROR":
      return `分析失败：${error.message}`;
    default:
      return `采集失败：${error.message}`;
  }
}

export function normalizeDomainError(error: unknown, fallback = createDomainError("CAPTURE_ERROR", "Unknown extension error")): DomainError {
  if (error instanceof ExtensionError) {
    return error.domainError;
  }

  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return error as DomainError;
  }

  if (error instanceof Error) {
    return createDomainError(fallback.code, error.message);
  }

  return fallback;
}
