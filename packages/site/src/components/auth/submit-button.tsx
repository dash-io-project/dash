"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: ReactNode;
};

/**
 * The primary submit button of an auth form.
 * It uses the same look as the primary `ButtonLink`, but it is a real button.
 * While the server action runs, the button is disabled and shows a spinner.
 */
export function SubmitButton({ children }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="btn btn-primary btn-lg w-full disabled:cursor-wait"
    >
      <span>{children}</span>
      {pending ? (
        <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      ) : (
        <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
      )}
    </button>
  );
}
