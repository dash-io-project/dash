import { describe, expect, it } from "vitest";
import { seedRunFailed } from "./dev-seed.ts";

describe("seedRunFailed", () => {
  it("does not let a finished domain hide a failure after its database drops", () => {
    const assignments = [
      { domain: "app", sourceId: "pg" },
      { domain: "billing", sourceId: "pg" },
      { domain: "finance", sourceId: "bq" },
    ];
    const unavailable = new Set(["pg"]);
    const done = new Set(["app"]);
    expect(seedRunFailed(assignments, unavailable, done, new Set())).toBe(true);
  });

  it("keeps a write failure after that source later becomes unavailable", () => {
    const assignments = [
      { domain: "app", sourceId: "pg" },
      { domain: "finance", sourceId: "bq" },
      { domain: "product", sourceId: "bq" },
    ];
    const unavailable = new Set(["bq"]);
    const done = new Set(["app"]);
    expect(seedRunFailed(assignments, unavailable, done, new Set(["finance"]))).toBe(true);
  });

  it("succeeds when the remaining sources finish and the missing database is skipped", () => {
    const assignments = [
      { domain: "app", sourceId: "pg" },
      { domain: "finance", sourceId: "bq" },
    ];
    expect(seedRunFailed(assignments, new Set(["bq"]), new Set(["app"]), new Set())).toBe(false);
  });
});
