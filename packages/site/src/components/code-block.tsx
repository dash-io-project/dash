import { CopyButton } from "./copy-button";

type CodeBlockProps = {
  /** One shell command per line. */
  lines: readonly string[];
  /** Label in the title bar, for example "Terminal". */
  title?: string;
  className?: string;
};

/** A block of shell commands with a title bar and a copy button. */
export function CodeBlock({ lines, title = "Terminal", className = "" }: CodeBlockProps) {
  const text = lines.join("\n");

  return (
    <div className={`card min-w-0 overflow-hidden ${className}`}>
      <div className="flex h-11 items-center justify-between border-b border-border bg-surface pr-2 pl-4">
        <span className="font-mono text-xs text-muted-foreground">{title}</span>
        <CopyButton text={text} label="Copy commands" />
      </div>
      <pre className="overflow-x-auto p-5 text-[0.8125rem] leading-7 sm:text-sm sm:leading-7">
        <code>
          {lines.map((line) => (
            <span key={line} className="block whitespace-pre">
              <span className="select-none text-muted-foreground">$ </span>
              <span className="text-foreground">{line}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
