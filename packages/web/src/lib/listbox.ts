/** The part of an option that the keyboard of a list box reads. */
export type ListboxItem = {
  label: string;
  disabled?: boolean;
};

/**
 * Moves the active option by `delta` enabled options. A negative `delta` moves up. The move
 * stops at the last enabled option in that direction. Use `from = -1` with `delta = 1` for the
 * first enabled option, and `from = items.length` with `delta = -1` for the last.
 * The result is `from` when no enabled option is in that direction.
 */
export function moveIndex(items: readonly ListboxItem[], from: number, delta: number): number {
  const step = Math.sign(delta);
  let index = from;
  let remaining = Math.abs(delta);
  for (let i = from + step; remaining > 0 && i >= 0 && i < items.length; i += step) {
    if (!items[i]?.disabled) {
      index = i;
      remaining -= 1;
    }
  }
  return index;
}

/**
 * Finds the enabled option whose label starts with `query`. The search starts at `from`
 * and continues from the top. A query of one repeated letter, such as "aa", starts after
 * `from`, so each key press goes to the next option with that letter.
 * The result is -1 when no option matches.
 */
export function typeaheadIndex(items: readonly ListboxItem[], query: string, from: number): number {
  const text = query.toLowerCase();
  if (!text || items.length === 0) return -1;
  const repeated = Array.from(text).every((char) => char === text[0]);
  const needle = repeated ? text[0]! : text;
  const start = Math.max(0, repeated ? from + 1 : from);
  for (let n = 0; n < items.length; n += 1) {
    const index = (start + n) % items.length;
    const item = items[index]!;
    if (!item.disabled && item.label.toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}
