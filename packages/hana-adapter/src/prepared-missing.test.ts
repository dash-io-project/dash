import { expect, it, vi } from "vitest";
import { HanaAdapter } from "./adapter.ts";

vi.mock("@sap/hana-client", () => ({}));

it("fails closed when the driver does not export createPool", () => {
  expect(() =>
    HanaAdapter.fromConfig({ kind: "hana", host: "localhost", user: "SYSTEM" }),
  ).toThrow(/did not load/);
});
