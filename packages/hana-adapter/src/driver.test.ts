import * as hana from "@sap/hana-client";
import { expect, it } from "vitest";

it("loads the installed SAP HANA driver", () => {
  const value = hana as { createPool?: unknown; default?: { createPool?: unknown } };
  const createPool =
    typeof value.createPool === "function" ? value.createPool : value.default?.createPool;
  expect(typeof createPool).toBe("function");
});
