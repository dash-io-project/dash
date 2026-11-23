import { AlertTriangle } from "lucide-react";

type FormErrorProps = {
  /** The error message for the whole form. No message renders nothing. */
  message?: string;
};

/** A form-level error box. Screen readers announce it when it appears. */
export function FormError({ message }: FormErrorProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-negative-border bg-negative-soft px-4 py-3 text-sm leading-6 text-foreground"
    >
      <AlertTriangle className="mt-1 size-4 shrink-0 text-negative" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
