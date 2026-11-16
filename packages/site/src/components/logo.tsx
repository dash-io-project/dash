import { site } from "~/lib/site";

type LogoProps = {
  /** Hide the wordmark and show only the mark. */
  iconOnly?: boolean;
  className?: string;
};

/** The Dash mark of the app: a line chart on an ink tile, with the wordmark next to it. */
export function Logo({ iconOnly = false, className = "" }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="brand-mark">
        <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden="true">
          <path
            d="M7 21.5 12.5 14l4 4.5L25 10"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {iconOnly ? (
        <span className="sr-only">{site.name}</span>
      ) : (
        <span className="text-[1.0625rem] font-semibold tracking-tight text-foreground">
          {site.name}
        </span>
      )}
    </span>
  );
}
