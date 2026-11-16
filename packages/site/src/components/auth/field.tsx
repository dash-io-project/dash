import type { ComponentPropsWithoutRef } from "react";

type InputType = "text" | "email" | "password";

type FieldProps = {
  /** Name of the form field. The server action reads the value by this name. */
  name: string;
  label: string;
  type: InputType;
  autoComplete: string;
  /** Short help text under the input. */
  hint?: string;
} & Omit<
  ComponentPropsWithoutRef<"input">,
  "name" | "type" | "autoComplete" | "id" | "aria-describedby" | "className" | "children"
>;

/** A labeled input with an optional hint. The id comes from the field name. */
export function Field({ name, label, type, autoComplete, hint, ...inputProps }: FieldProps) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        aria-describedby={hintId}
        className="input"
        {...inputProps}
      />
      {hint ? (
        <p id={hintId} className="mt-1.5 text-[0.8125rem] leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
