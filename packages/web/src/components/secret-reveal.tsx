import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { GhostButton } from "~/components/ui";

/**
 * Show a new token one time, with a copy button.
 * Dash keeps only the hash, so the person must copy the token now.
 */
export function SecretReveal({
  secret,
  title,
  children,
  onDismiss,
}: {
  secret: string;
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCopyStatus("");
    region.current?.focus();
  }, [secret]);

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopyStatus("Token copied.");
    } catch {
      setCopyStatus("Could not copy. Select the token and copy it.");
    }
  }

  return (
    <div
      ref={region}
      tabIndex={-1}
      className="rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {title ? <div className="mb-1 font-medium">{title}</div> : null}
      <div className="mb-1 text-mist">Copy this token now. You cannot see it again.</div>
      <code className="block break-all select-all text-accent">{secret}</code>
      {children}
      <div className="mt-3 flex flex-wrap gap-2">
        <GhostButton type="button" className="inline-flex items-center gap-2" onClick={() => void copySecret()}>
          <Copy size={14} aria-hidden="true" />
          Copy token
        </GhostButton>
        {onDismiss ? (
          <GhostButton type="button" onClick={onDismiss}>
            Done
          </GhostButton>
        ) : null}
      </div>
      <p role="status" className={copyStatus ? "mt-2 text-mist" : "sr-only"}>{copyStatus}</p>
    </div>
  );
}
