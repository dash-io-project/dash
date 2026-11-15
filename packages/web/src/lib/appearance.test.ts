import { describe, expect, it } from "vitest";
import { APPEARANCE_KEY, APPEARANCE_SCRIPT } from "./appearance.ts";

interface Page {
  dark: boolean;
  appearance: string | undefined;
  colorScheme: string | undefined;
}

/** Runs the head script against a page that has `stored` in localStorage. */
function runHeadScript(stored: string | null | Error, deviceIsDark: boolean): Page {
  const classes = new Set<string>();
  const html = {
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    },
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };
  const storage = {
    getItem(key: string) {
      if (stored instanceof Error) throw stored;
      return key === APPEARANCE_KEY ? stored : null;
    },
  };
  const matchMedia = (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && deviceIsDark,
  });
  new Function("localStorage", "matchMedia", "document", APPEARANCE_SCRIPT)(storage, matchMedia, {
    documentElement: html,
  });
  return {
    dark: classes.has("dark"),
    appearance: html.dataset.appearance,
    colorScheme: html.style.colorScheme,
  };
}

describe("appearance head script", () => {
  it.each([
    { stored: "light", device: true, dark: false, appearance: "light" },
    { stored: "dark", device: false, dark: true, appearance: "dark" },
    { stored: "system", device: true, dark: true, appearance: "system" },
    { stored: null, device: true, dark: true, appearance: "system" },
    { stored: null, device: false, dark: false, appearance: "system" },
    { stored: "sepia", device: false, dark: false, appearance: "system" },
    { stored: "sepia", device: true, dark: true, appearance: "system" },
  ])("shows $appearance for the value $stored on a device with dark=$device", (row) => {
    expect(runHeadScript(row.stored, row.device)).toEqual({
      dark: row.dark,
      appearance: row.appearance,
      colorScheme: row.dark ? "dark" : "light",
    });
  });

  it("follows the device when the browser refuses the storage", () => {
    const refused = new Error("SecurityError");
    expect(runHeadScript(refused, true)).toEqual({ dark: true, appearance: "system", colorScheme: "dark" });
    expect(runHeadScript(refused, false)).toEqual({ dark: false, appearance: "system", colorScheme: "light" });
  });
});
