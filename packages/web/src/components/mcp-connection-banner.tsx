import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { ICON_STROKE, IconButton } from "~/components/ui";

/** The full MCP URL for this site, with a copy button. */
export function McpUrlField() {
  const [url, setUrl] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    setUrl(new URL("/mcp", window.location.origin).href);
  }, []);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("MCP URL copied.");
    } catch {
      setCopyStatus("Could not copy. Select the URL and copy it.");
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <code className="block min-w-0 flex-1 break-all rounded-md border border-border bg-background px-3 py-2 select-all">
          {url || "Please wait for the MCP URL…"}
        </code>
        <IconButton label="Copy MCP URL" disabled={!url} onClick={() => void copyUrl()}>
          <Copy size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </IconButton>
      </div>
      <p role="status" className={copyStatus ? "mt-2 text-[13px] text-muted-foreground" : "sr-only"}>{copyStatus}</p>
    </>
  );
}

export function McpConnectionBanner() {
  return (
    <section
      aria-label="Connect your agent"
      className="card space-y-3 bg-surface p-4"
    >
      <h2 className="panel-title">Connect your agent to Dash MCP</h2>
      <McpUrlField />
      <Link to="/agents" className="link inline-block">
        Agents
      </Link>
    </section>
  );
}
