import { describe, expect, it } from "vitest";
import { evaluatePageAccess, isRestrictedUrl, matchesChromePattern, toOriginPermissionPattern } from "./pageAccess";

describe("page access guard", () => {
  it("detects restricted browser pages", () => {
    expect(isRestrictedUrl("chrome://extensions")).toBe(true);
    expect(isRestrictedUrl("https://example.com")).toBe(false);
  });

  it("matches exact and wildcard host patterns", () => {
    expect(matchesChromePattern("https://example.com/path", "https://example.com/*")).toBe(true);
    expect(matchesChromePattern("https://docs.example.com/path", "https://*.example.com/*")).toBe(true);
    expect(matchesChromePattern("https://evil.com/path", "https://*.example.com/*")).toBe(false);
  });

  it("returns restricted page error for chrome pages", () => {
    expect(evaluatePageAccess("chrome://settings", ["https://example.com/*"])).toEqual({
      allowed: false,
      code: "RESTRICTED_PAGE_ERROR",
      message: "当前页面属于浏览器受限页面，Chrome 不允许注入内容脚本。"
    });
  });

  it("returns permission error for non-whitelisted pages", () => {
    expect(evaluatePageAccess("https://other.com", ["https://example.com/*"])).toEqual({
      allowed: false,
      code: "PERMISSION_ERROR",
      message: "当前页面域名不在受控授权清单内。请先在扩展配置中登记该域名，再由用户在 Side Panel 中申请当前域名权限。"
    });
  });

  it("builds origin permission pattern from page url", () => {
    expect(toOriginPermissionPattern("https://docs.example.com/path?q=1")).toBe("https://docs.example.com/*");
  });
});
