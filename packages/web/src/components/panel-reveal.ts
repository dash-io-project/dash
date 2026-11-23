export const PANEL_SLIDE_MS = 720;
export const PANEL_SETTLE_BUFFER_MS = 40;
export const PANEL_STAGGER_MS = 80;
export const PANEL_STAGGER_CAP = 6;

export function panelRevealPlan(
  index: number,
  options: { reduceMotion?: boolean; failed?: boolean } = {},
): { waitMs: number; settleImmediately: boolean } {
  if (options.reduceMotion || options.failed) {
    return { waitMs: 0, settleImmediately: true };
  }
  const slot = Math.min(Math.max(0, index), PANEL_STAGGER_CAP);
  return { waitMs: slot * PANEL_STAGGER_MS, settleImmediately: false };
}

export function panelSettleMs(waitMs: number): number {
  return waitMs + PANEL_SLIDE_MS + PANEL_SETTLE_BUFFER_MS;
}
