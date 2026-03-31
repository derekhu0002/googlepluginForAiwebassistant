import { describe, expect, it } from "vitest";
import { evaluatePageAccess, isRestrictedUrl, matchesChromePattern } from "./pageAccess";

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
      message: "当前页面不在扩展白名单内，请切换到允许的站点或调整配置。"
    });
  });
});
