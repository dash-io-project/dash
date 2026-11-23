"use client";

import { Check, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";

type CopyButtonProps = {
  text: string;
  /** Accessible name for the button. */
  label?: string;
};

type CopyState = "idle" | "copied" | "failed";

const stateText: Record<Exclude<CopyState, "idle">, { label: string; aria: string }> = {
  copied: { label: "Copied", aria: "Copied" },
  // An insecure origin or an old browser has no Clipboard API. The text stays selectable.
  failed: { label: "Copy failed", aria: "Copy failed. Select the text to copy it." },
};

/** Copies `text` to the clipboard. It shows the result for two seconds. */
export function CopyButton({ text, label = "Copy to clipboard" }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  const result = state === "idle" ? null : stateText[state];

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={result ? result.aria : label}
      className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 font-sans text-xs font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      {state === "copied" ? (
        <Check className="size-3.5 text-positive" aria-hidden="true" />
      ) : state === "failed" ? (
        <X className="size-3.5 text-negative" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      <span aria-live="polite">{result ? result.label : "Copy"}</span>
    </button>
  );
}
