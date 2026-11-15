import type { ComponentProps, FormEvent, ReactNode } from "react";
import { cn } from "~/lib/cn";

/** The stroke width of each lucide icon in the app. */
export const ICON_STROKE = 1.75;

/** The mark of Dash: the chart line of `public/favicon.svg`, in the text color of its tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("brand-mark", className)}>
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M7 21.5 12.5 14l4 4.5L25 10"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

/** The classes of a button. Use them for a link that looks like a button. */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return cn(
    "btn",
    variant === "primary" && "btn-primary",
    variant === "ghost" && "btn-ghost",
    variant === "destructive" && "btn-destructive",
    size === "sm" && "btn-sm",
    size === "lg" && "btn-lg",
  );
}

/** A button. The default is the secondary button: an outline on the control fill. */
export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button {...props} className={cn(buttonClass(variant, size), className)} />;
}

/** A button that shows only an icon. The label is the accessible name and the tooltip. */
export function IconButton({
  label,
  size,
  className,
  ...props
}: Omit<ComponentProps<"button">, "aria-label"> & { label: string; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      title={label}
      {...props}
      aria-label={label}
      className={cn("icon-btn", size === "sm" && "icon-btn-sm", className)}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** A muted line below the control. */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[13px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: ComponentProps<"input">) {
  return <input {...props} className={cn("input", props.className)} />;
}

export function TextArea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn("input", props.className)} />;
}

/** A checkbox with its label. The label is the pointer target. */
export function CheckRow({
  children,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { children: ReactNode }) {
  return (
    <label className={cn("check-row flex items-center gap-2", className)}>
      <input type="checkbox" {...props} />
      <span>{children}</span>
    </label>
  );
}

/** A surface with a border: a list, a form or a widget. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("card", className)} />;
}

export type BadgeTone = "neutral" | "positive" | "negative" | "warning";

/** A short status label. */
export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={cn(
        "badge",
        tone === "positive" && "badge-positive",
        tone === "negative" && "badge-negative",
        tone === "warning" && "badge-warning",
        className,
      )}
    />
  );
}

/** The text of a page or a card that has no items. */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  /** One or two lines that tell the person what to do. */
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 max-w-md text-[13px] text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * A section of a page: a heading, a muted note, and the content. Put the content in a
 * `Card` only when it is a list or a form.
 */
export function Panel({
  title,
  note,
  actions,
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title: ReactNode;
  note?: ReactNode;
  /** The controls at the right of the heading. */
  actions?: ReactNode;
}) {
  return (
    <section {...props} className={cn("min-w-0", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="panel-title">{title}</h2>
          {note ? <p className="panel-note">{note}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One line of text in the middle of the window, for a page that is not ready. */
export function FullPageMessage({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <p
      className={cn(
        "mx-auto grid min-h-dvh max-w-lg place-items-center px-6 text-center",
        tone === "error" ? "text-negative" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

/** The pages with one card on the surface: sign-in, register, invite and OAuth approval. */
export function AuthCard({
  title,
  subtitle,
  children,
  onSubmit,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  onSubmit?: (event: FormEvent) => void;
  footer?: ReactNode;
}) {
  // The fields and the buttons of the card are 40px high.
  const className =
    "w-full max-w-[420px] rounded-lg border border-border bg-background p-6 sm:p-8 [&_.btn]:min-h-10 [&_.input]:min-h-10 [&_.select-trigger]:min-h-10";
  const body = (
    <>
      <div className="mb-6">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-[15px] font-semibold">Dash</span>
        </div>
        <h1 className="mt-6 text-xl font-semibold text-balance">{title}</h1>
        <p className="mt-1.5 text-muted-foreground">{subtitle}</p>
      </div>
      <div className="space-y-4">{children}</div>
      {footer ? <div className="mt-6 text-muted-foreground">{footer}</div> : null}
    </>
  );
  return (
    <div className="grid min-h-dvh place-items-center bg-surface px-4 py-8">
      {onSubmit ? (
        <form onSubmit={onSubmit} className={className}>
          {body}
        </form>
      ) : (
        <div className={className}>{body}</div>
      )}
    </div>
  );
}
