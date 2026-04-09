import { describe, expect, it } from "vitest";
import { createExtensionConfig, createExtensionManifest } from "./configuration";

describe("extension configuration", () => {
  it("uses HTTPS-first defaults in production", () => {
    const config = createExtensionConfig({}, "production");

    expect(config.apiBaseUrl).toBe("https://api.example.com");
    expect(config.allowedApiOrigins).toEqual(["https://api.example.com"]);
    expect(config.optionalHostPermissions).toEqual(["https://example.com/*", "https://*.example.com/*"]);
    expect(config.webAccessibleResourceMatches).toEqual(["https://example.com/*", "https://*.example.com/*"]);
  });

  it("allows localhost only during development", () => {
    const config = createExtensionConfig({ VITE_EXTENSION_ENV: "development" }, "development");

    expect(config.apiBaseUrl).toBe("http://localhost:8000");
    expect(config.allowedApiOrigins).toContain("http://localhost:8000");
    expect(config.optionalHostPermissions).toContain("http://localhost/*");
    expect(config.webAccessibleResourceMatches).toContain("http://localhost/*");
  });

  it("rejects broad host permission", () => {
    expect(() => createExtensionConfig({ VITE_OPTIONAL_HOST_PERMISSIONS: "https://*/*" }, "production")).toThrow(/Unsupported broad/);
    expect(() => createExtensionConfig({ VITE_OPTIONAL_HOST_PERMISSIONS: "<all_urls>" }, "production")).toThrow(/Unsupported/);
  });

  it("rejects web accessible resource matches outside controlled hosts", () => {
    expect(() => createExtensionConfig({
      VITE_OPTIONAL_HOST_PERMISSIONS: "https://example.com/*",
      VITE_WEB_ACCESSIBLE_RESOURCE_MATCHES: "https://other.com/*"
    }, "production")).toThrow(/controlled host permissions/);
  });

  it("builds manifest from host permission policy", () => {
    const manifest = createExtensionManifest({
      VITE_EXTENSION_ENV: "development",
      VITE_OPTIONAL_HOST_PERMISSIONS: "https://example.com/*,https://*.example.com/*,http://localhost/*",
      VITE_WEB_ACCESSIBLE_RESOURCE_MATCHES: "https://example.com/*,http://localhost/*",
      VITE_ALLOWED_API_ORIGINS: "https://api.example.com,http://localhost:8000",
      VITE_API_BASE_URL: "http://localhost:8000"
    }, "development");

    expect(manifest.permissions).toContain("scripting");
    expect(manifest.permissions).toContain("permissions");
    expect(manifest.permissions).toContain("activeTab");
    expect(manifest.optional_host_permissions).toEqual(["https://example.com/*", "https://*.example.com/*", "http://localhost/*"]);
    expect(manifest.host_permissions).toContain("https://api.example.com/*");
    expect(manifest.web_accessible_resources).toEqual([
      {
        resources: ["sidepanel.html", "assets/*"],
        matches: ["https://example.com/*", "http://localhost/*"]
      }
    ]);
    expect(manifest.content_scripts).toEqual([
      {
        matches: ["https://example.com/*", "http://localhost/*"],
        js: ["content.js"],
        run_at: "document_idle"
      }
    ]);
  });
});
