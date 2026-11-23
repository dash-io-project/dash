import Image from "next/image";
import { site } from "~/lib/site";

type LogoProps = {
  /** Hide the wordmark and show only the mark. */
  iconOnly?: boolean;
  className?: string;
};

/** The Dash mark is the bar chart in `logo.png`. The wordmark sits next to it. */
export function Logo({ iconOnly = false, className = "" }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Image
        src="/logo.png"
        alt=""
        width={28}
        height={25}
        className="brand-mark"
        priority
        unoptimized
      />
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
