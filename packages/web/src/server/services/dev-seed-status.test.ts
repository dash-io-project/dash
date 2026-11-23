import { describe, expect, it } from "vitest";
import { isDatabaseUnavailable, seedRunFailed } from "./dev-seed.ts";

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

describe("isDatabaseUnavailable", () => {
  it("treats a refused connection and a missing database as not there", () => {
    const wrapped = new TypeError("fetch failed");
    wrapped.cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:59991"), { code: "ECONNREFUSED" });
    expect(isDatabaseUnavailable(wrapped)).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:59991"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("getaddrinfo ENOTFOUND warehouse.example"), { code: "ENOTFOUND" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("database \"fernway\" does not exist"), { code: "3D000" }))).toBe(true);
    const project = new Error("BigQuery API: Not found: Project dash");
    project.name = "BigQueryHttpError";
    Object.assign(project, { status: 404 });
    expect(isDatabaseUnavailable(project)).toBe(true);
  });

  it("treats a timeout or a reset on a live source as a failure", () => {
    expect(isDatabaseUnavailable(new Error("BigQuery request timed out after 10000 ms"))).toBe(false);
    expect(isDatabaseUnavailable(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(false);
    expect(isDatabaseUnavailable(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }))).toBe(false);
    const timeout = new Error("The operation timed out");
    timeout.name = "TimeoutError";
    expect(isDatabaseUnavailable(timeout)).toBe(false);
    const unavailable = new Error("BigQuery API: The service is unavailable");
    unavailable.name = "BigQueryHttpError";
    Object.assign(unavailable, { status: 503 });
    expect(isDatabaseUnavailable(unavailable)).toBe(false);
  });
});
