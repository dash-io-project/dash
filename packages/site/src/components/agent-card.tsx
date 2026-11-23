import { ArrowRight, Sparkles } from "lucide-react";
import { agentTranscript } from "~/content/mcp";

/** An example chat between a person, an agent, and Dash over MCP. */
export function AgentCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card overflow-hidden ${className}`}>
      <div className="flex h-11 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-positive" aria-hidden="true" />
          <span className="font-mono text-xs text-muted-foreground">
            agent · connected to Dash MCP
          </span>
        </div>
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
          ~/dash · main
        </span>
      </div>

      <ol className="space-y-4 p-5 sm:p-6">
        {agentTranscript.map((step) => {
          if (step.kind === "user") {
            return (
              <li key={step.id} className="flex gap-3">
                <span
                  className="font-mono text-sm leading-7 text-muted-foreground"
                  aria-hidden="true"
                >
                  ›
                </span>
                <p className="font-mono text-sm leading-7 font-medium text-foreground">
                  {step.text}
                </p>
              </li>
            );
          }
          if (step.kind === "tool") {
            return (
              <li key={step.id} className="ml-1 border-l border-border pl-5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.8125rem] leading-6">
                  <span className="code-chip text-[1em]">{step.tool}</span>
                  {step.input ? <span className="text-foreground">{step.input}</span> : null}
                  <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">{step.result}</span>
                </div>
              </li>
            );
          }
          return (
            <li key={step.id} className="flex gap-3 pt-1">
              <Sparkles className="mt-1.5 size-4 shrink-0 text-foreground" aria-hidden="true" />
              <p className="text-[0.9375rem] leading-7 text-foreground">{step.text}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
