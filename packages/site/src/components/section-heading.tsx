import type { ReactNode } from "react";

type SectionHeadingProps = {
  /** Id of the heading element, for `aria-labelledby` on the section. */
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Center the heading block. Default is left aligned. */
  align?: "left" | "center";
  /** Heading level. Pages use h2 for sections and h1 for the page title. */
  as?: "h1" | "h2";
  className?: string;
};

/** Eyebrow, heading, and lead paragraph for a section. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "left",
  as: Heading = "h2",
  className = "",
}: SectionHeadingProps) {
  const alignment = align === "center" ? "mx-auto text-center items-center" : "";
  const size =
    Heading === "h1"
      ? "text-[2.5rem] leading-[1.06] tracking-[-0.035em] sm:text-[3.5rem]"
      : "text-[1.75rem] leading-[1.15] tracking-[-0.025em] sm:text-4xl sm:leading-[1.12]";

  return (
    <div className={`flex max-w-2xl flex-col ${alignment} ${className}`}>
      {eyebrow ? <p className="eyebrow mb-3">{eyebrow}</p> : null}
      <Heading id={id} className={`font-semibold text-balance text-foreground ${size}`}>
        {title}
      </Heading>
      {description ? (
        <p className="mt-4 text-[1.0625rem] leading-7 text-muted-foreground text-pretty sm:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}
