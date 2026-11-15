import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/** The header row of a page: the title, one line of description, and controls at the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="min-w-0 flex-1 basis-60">
        <h1 className="text-lg font-semibold leading-snug">{title}</h1>
        {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * The content of a page, below the header. `column` gives the width of a page of
 * panels. `wide` is for a page that has a table.
 */
export function PageBody({
  column,
  className,
  children,
}: {
  column?: "narrow" | "wide";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="page-body">
      <div className={cn(column && "page-column", column === "wide" && "page-column-wide", className)}>
        {children}
      </div>
    </div>
  );
}
