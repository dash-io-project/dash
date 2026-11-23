import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { Button, ICON_STROKE } from "~/components/ui";

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
      className="rounded-md border border-warning-border bg-warning-soft p-4"
    >
      {title ? <div className="mb-1 font-medium">{title}</div> : null}
      <div className="mb-2 text-[13px]">Copy this token now. You cannot see it again.</div>
      <code className="block break-all rounded-md border border-border bg-background px-3 py-2 select-all">{secret}</code>
      {children}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void copySecret()}>
          <Copy size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Copy token
        </Button>
        {onDismiss ? (
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            Done
          </Button>
        ) : null}
      </div>
      <p role="status" className={copyStatus ? "mt-2 text-[13px] text-muted-foreground" : "sr-only"}>{copyStatus}</p>
    </div>
  );
}
