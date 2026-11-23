import { ArrowRight } from "lucide-react";
import { cta } from "~/lib/site";
import { ButtonLink } from "./button-link";
import { GitHubIcon } from "./icons";

type CtaBandProps = {
  title?: string;
  description?: string;
};

/** The closing call to action with both paths. */
export function CtaBand({
  title = "Start with Dash today.",
  description = "Clone the repository and run it on your own machine, or create a Dash Cloud account and sign in.",
}: CtaBandProps) {
  return (
    <section aria-labelledby="cta-title" className="border-t border-border bg-surface">
      <div className="container-x flex flex-col gap-8 py-16 sm:py-20 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
        <div className="max-w-2xl">
          <h2
            id="cta-title"
            className="text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.025em] text-balance text-foreground sm:text-4xl"
          >
            {title}
          </h2>
          <p className="mt-4 text-[1.0625rem] leading-7 text-muted-foreground text-pretty sm:text-lg">
            {description}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
          <ButtonLink href={cta.cloud.href} size="lg" trailingIcon={<ArrowRight />}>
            {cta.cloud.label}
          </ButtonLink>
          <ButtonLink href={cta.selfHost.href} size="lg" variant="secondary" icon={<GitHubIcon />}>
            {cta.selfHost.label}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
