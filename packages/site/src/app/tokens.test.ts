import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// The website must show the colors of the app. ADR 0018 records the decision.
const siteCss = readFileSync(resolve(import.meta.dirname, "globals.css"), "utf8");
const appCss = readFileSync(
  resolve(import.meta.dirname, "../../../web/src/styles/app.css"),
  "utf8",
);

// Only the website has these tokens.
const siteOnly = new Set(["--header-height"]);

/** Returns the custom properties of each `:root` rule, in the sequence of the file. */
function rootBlocks(css: string): Map<string, string>[] {
  return [...css.matchAll(/:root(?:\.dark)?\s*\{([^}]*)\}/g)].map((block) => {
    const declarations = (block[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g);
    return new Map([...declarations].map((match) => [match[1] ?? "", (match[2] ?? "").trim()]));
  });
}

const [siteLight, siteDark] = rootBlocks(siteCss);
const [appLight, appDark] = rootBlocks(appCss);

test.each([
  ["light", siteLight, appLight],
  ["dark", siteDark, appDark],
])("each %s token of the website has the value of the app", (_mode, siteTokens, appTokens) => {
  const names = [...(siteTokens?.keys() ?? [])].filter((name) => !siteOnly.has(name));
  expect(names.length).toBeGreaterThan(10);
  for (const name of names) {
    expect(siteTokens?.get(name), name).toBe(appTokens?.get(name));
  }
});
