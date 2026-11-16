import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

type ButtonLinkProps = {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
  /** Icon placed before the label. */
  icon?: ReactNode;
  /** Icon placed after the label. */
  trailingIcon?: ReactNode;
};

const variants: Record<Variant, string> = {
  primary: "btn btn-primary",
  secondary: "btn",
  ghost: "btn btn-ghost",
};

const sizes: Record<Size, string> = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
};

function isExternal(href: string): boolean {
  return /^(https?:|mailto:)/.test(href);
}

/** A link with the look of an app button. Use it for calls to action. */
export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
  icon,
  trailingIcon,
}: ButtonLinkProps) {
  const classes = `${variants[variant]} ${sizes[size]} ${className}`;
  const content = (
    <>
      {icon ? <span className="shrink-0 [&>svg]:size-4">{icon}</span> : null}
      <span>{children}</span>
      {trailingIcon ? <span className="shrink-0 [&>svg]:size-4">{trailingIcon}</span> : null}
    </>
  );

  if (isExternal(href)) {
    return (
      <a href={href} className={classes}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}
