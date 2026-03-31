import { describe, expect, it } from "vitest";
import { createExtensionConfig, createExtensionManifest } from "./configuration";

describe("extension configuration", () => {
  it("uses HTTPS-first defaults in production", () => {
    const config = createExtensionConfig({}, "production");

    expect(config.apiBaseUrl).toBe("https://api.example.com");
    expect(config.allowedApiOrigins).toEqual(["https://api.example.com"]);
    expect(config.allowedPageMatches).toEqual(["https://example.com/*", "https://*.example.com/*"]);
  });

  it("allows localhost only during development", () => {
    const config = createExtensionConfig({ VITE_EXTENSION_ENV: "development" }, "development");

    expect(config.apiBaseUrl).toBe("http://localhost:8787");
    expect(config.allowedApiOrigins).toContain("http://localhost:8787");
    expect(config.allowedPageMatches).toContain("http://localhost/*");
  });

  it("rejects overbroad page matches", () => {
    expect(() => createExtensionConfig({ VITE_ALLOWED_PAGE_MATCHES: "https://*/*" }, "production")).toThrow(/Overbroad/);
  });

  it("builds manifest from allowlists", () => {
    const manifest = createExtensionManifest({
      VITE_EXTENSION_ENV: "development",
      VITE_ALLOWED_PAGE_MATCHES: "https://example.com/*,http://localhost/*",
      VITE_ALLOWED_API_ORIGINS: "https://api.example.com,http://localhost:8787",
      VITE_API_BASE_URL: "http://localhost:8787"
    }, "development");

    expect(manifest.content_scripts[0].matches).toEqual(["https://example.com/*", "http://localhost/*"]);
    expect(manifest.host_permissions).toContain("http://localhost/*");
    expect(manifest.host_permissions).toContain("https://api.example.com/*");
    expect(manifest.host_permissions).not.toContain("https://*/*");
  });
});
