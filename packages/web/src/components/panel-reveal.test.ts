import { describe, expect, it } from "vitest";
import {
  PANEL_SETTLE_BUFFER_MS,
  PANEL_SLIDE_MS,
  PANEL_STAGGER_CAP,
  PANEL_STAGGER_MS,
  panelRevealPlan,
  panelSettleMs,
} from "./panel-reveal.ts";

describe("panel reveal plan", () => {
  it("starts the stagger when the panel is ready and caps the wait", () => {
    expect(panelRevealPlan(0)).toEqual({ waitMs: 0, settleImmediately: false });
    expect(panelRevealPlan(1).waitMs).toBe(PANEL_STAGGER_MS);
    expect(panelRevealPlan(PANEL_STAGGER_CAP).waitMs).toBe(PANEL_STAGGER_CAP * PANEL_STAGGER_MS);
    expect(panelRevealPlan(PANEL_STAGGER_CAP + 12).waitMs).toBe(PANEL_STAGGER_CAP * PANEL_STAGGER_MS);
    expect(panelRevealPlan(-3).waitMs).toBe(0);
  });

  it("opens a failure or reduced-motion panel immediately", () => {
    expect(panelRevealPlan(8, { failed: true })).toEqual({
      waitMs: 0,
      settleImmediately: true,
    });
    expect(panelRevealPlan(8, { reduceMotion: true })).toEqual({
      waitMs: 0,
      settleImmediately: true,
    });
  });

  it("keeps the cover up through the slide after the stagger", () => {
    const waitMs = panelRevealPlan(2).waitMs;
    expect(panelSettleMs(waitMs)).toBe(waitMs + PANEL_SLIDE_MS + PANEL_SETTLE_BUFFER_MS);
  });
});
