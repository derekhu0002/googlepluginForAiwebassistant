import { describe, expect, it } from "vitest";
import { captureFields, createDefaultFieldTemplates, createDefaultRule, findMatchingRule, getStoredRules, removeRule, saveRules, upsertRule } from "./rules";

describe("configurable page rules", () => {
  it("matches wildcard hostname and path rules", () => {
    const rule = {
      ...createDefaultRule(),
      hostnamePattern: "*.example.com",
      pathPattern: "/products/*"
    };

    expect(findMatchingRule("https://shop.example.com/products/123", [rule])?.id).toBe(rule.id);
    expect(findMatchingRule("https://shop.example.com/blog/123", [rule])).toBeNull();
  });

  it("collects fields from configured field rules", () => {
    document.head.innerHTML = `<meta name="description" content="Demo description">`;
    document.body.innerHTML = `<div data-software-version>v9.9.9</div><div data-selected-sr>SR-42</div><div data-price="188">Price</div>`;
    document.title = "Demo Title";

    Object.defineProperty(window, "location", {
      value: new URL("https://example.com/page"),
      configurable: true
    });

    window.getSelection = (() => ({ toString: () => "selected demo text" })) as typeof window.getSelection;

    const fields = createDefaultFieldTemplates();
    fields.push({
      id: "custom-price",
      key: "price",
      label: "价格",
      source: "selectorAttribute",
      selector: "div[data-price]",
      attribute: "data-price",
      enabled: true
    });

    expect(captureFields(document, window, fields)).toEqual({
      pageTitle: "Demo Title",
      pageUrl: "https://example.com/page",
      software_version: "v9.9.9",
      selected_sr: "SR-42",
      selectedText: "selected demo text",
      price: "188"
    });
  });

  it("persists rule changes via storage helpers", async () => {
    const storage = {
      data: {} as Record<string, unknown>,
      async get(key: string) {
        return { [key]: this.data[key] };
      },
      async set(payload: Record<string, unknown>) {
        Object.assign(this.data, payload);
      }
    };

    const baseRule = createDefaultRule();
    const updated = { ...baseRule, name: "Updated Rule" };
    const next = upsertRule([baseRule], updated);
    await saveRules(next, storage);

    expect((await getStoredRules(storage))[0].name).toBe("Updated Rule");
    expect(removeRule(next, updated.id)).toEqual([]);
  });
});
