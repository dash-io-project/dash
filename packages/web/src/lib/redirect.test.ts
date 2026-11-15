import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect.ts";

const origin = "https://demo.dash.io";

describe("safeRedirectPath", () => {
  it("keeps a same-origin path with its query", () => {
    expect(safeRedirectPath("/oauth/authorize?client_id=a&state=1", origin)).toBe(
      "/oauth/authorize?client_id=a&state=1",
    );
  });

  it.each(["https://evil.example/x", "//evil.example/x", "/\\evil.example/x", "/\t/evil.example/x", "javascript:alert(1)", ""])(
    "refuses %j",
    (value) => {
      expect(safeRedirectPath(value, origin)).toBeUndefined();
    },
  );
});
