import { describe, expect, it } from "vitest";
import { extractUsernameContext } from "./username";

describe("extractUsernameContext", () => {
  it("extracts from data attribute first", () => {
    document.body.innerHTML = '<div data-username="alice"></div>';
    expect(extractUsernameContext({ document, window })).toEqual({
      username: "alice",
      usernameSource: "dom_data_attribute"
    });
  });

  it("falls back to globals then unknown", () => {
    document.body.innerHTML = "<div></div>";
    Object.assign(window as Window & { __CURRENT_USER__?: unknown }, { __CURRENT_USER__: { username: "bob" } });
    expect(extractUsernameContext({ document, window })).toEqual({
      username: "bob",
      usernameSource: "page_global"
    });

    delete (window as Window & { __CURRENT_USER__?: unknown }).__CURRENT_USER__;
    expect(extractUsernameContext({ document, window })).toEqual({
      username: "unknown",
      usernameSource: "unknown_fallback"
    });
  });
});
