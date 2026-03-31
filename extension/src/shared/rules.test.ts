import { describe, expect, it } from "vitest";
import { captureFields } from "./rules";

describe("captureFields", () => {
  it("collects default fields from document and window", () => {
    document.title = "Demo Title";
    document.body.innerHTML = `
      <meta name="description" content="Demo description" />
      <h1>Main Heading</h1>
    `;

    Object.defineProperty(window, "location", {
      value: new URL("https://example.com/page"),
      configurable: true
    });

    window.getSelection = (() => ({ toString: () => "selected demo text" })) as typeof window.getSelection;

    const result = captureFields(document, window);

    expect(result).toEqual({
      pageTitle: "Demo Title",
      pageUrl: "https://example.com/page",
      metaDescription: "Demo description",
      h1: "Main Heading",
      selectedText: "selected demo text"
    });
  });
});
