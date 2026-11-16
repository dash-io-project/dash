import { expect, test } from "vitest";
import { formatUsd } from "./plans";

test("formatUsd shows whole dollars with no cents and other amounts with cents", () => {
  expect(formatUsd(0)).toBe("$0");
  expect(formatUsd(29)).toBe("$29");
  expect(formatUsd(0.1)).toBe("$0.10");
  expect(formatUsd(1.5)).toBe("$1.50");
  // A sum of prices can be a little off in floating point. It must show the amount in cents.
  expect(formatUsd(0.1 * 3 * 10)).toBe("$3");
  expect(formatUsd(29 + 444 * 0.1)).toBe("$73.40");
});
