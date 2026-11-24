import { describe, expect, it } from "vitest";
import { moveIndex, typeaheadIndex } from "./listbox";

const kinds = [
  { label: "PostgreSQL" },
  { label: "MySQL" },
  { label: "Amazon Redshift" },
  { label: "Snowflake", disabled: true },
  { label: "MongoDB" },
  { label: "Google BigQuery" },
  { label: "Databricks SQL" },
  { label: "Stripe" },
];

describe("moveIndex", () => {
  it.each([
    ["the next option", 0, 1, 1],
    ["past a disabled option", 2, 1, 4],
    ["up past a disabled option", 4, -1, 2],
    ["to the first option from -1", -1, 1, 0],
    ["to the last option from the end", kinds.length, -1, 7],
    ["ten enabled options, and stops at the last", 1, 10, 7],
    ["ten enabled options up, and stops at the first", 6, -10, 0],
  ])("moves %s", (_name, from, delta, expected) => {
    expect(moveIndex(kinds, from, delta)).toBe(expected);
  });

  it("stays at the edge of the list", () => {
    expect(moveIndex(kinds, 7, 1)).toBe(7);
    expect(moveIndex(kinds, 0, -1)).toBe(0);
  });

  it("stays when each option in the direction is disabled", () => {
    const items = [{ label: "Admin" }, { label: "User", disabled: true }];
    expect(moveIndex(items, 0, 1)).toBe(0);
    expect(moveIndex([], -1, 1)).toBe(-1);
  });
});

describe("typeaheadIndex", () => {
  it("finds the option that starts with the text, in any case", () => {
    expect(typeaheadIndex(kinds, "mo", 0)).toBe(4);
    expect(typeaheadIndex(kinds, "GOOGLE", 0)).toBe(5);
  });

  it("keeps the current option while the text still matches it", () => {
    expect(typeaheadIndex(kinds, "my", 1)).toBe(1);
  });

  it("goes to the next option with the same letter on each press", () => {
    expect(typeaheadIndex(kinds, "m", -1)).toBe(1);
    expect(typeaheadIndex(kinds, "m", 1)).toBe(4);
    expect(typeaheadIndex(kinds, "mm", 1)).toBe(4);
    expect(typeaheadIndex(kinds, "m", 4)).toBe(1);
  });

  it("matches a label with a space", () => {
    expect(typeaheadIndex(kinds, "amazon r", 0)).toBe(2);
  });

  it("skips a disabled option", () => {
    expect(typeaheadIndex(kinds, "sn", 0)).toBe(-1);
    expect(typeaheadIndex(kinds, "s", 0)).toBe(7);
  });

  it("returns -1 when no option matches", () => {
    expect(typeaheadIndex(kinds, "cassandra", 0)).toBe(-1);
    expect(typeaheadIndex(kinds, "", 0)).toBe(-1);
    expect(typeaheadIndex([], "a", -1)).toBe(-1);
  });
});
