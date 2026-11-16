import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "~/components/button-link";
import { cta } from "~/lib/site";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-title">
      <div className="container-x flex min-h-[60dvh] flex-col items-center justify-center py-24 text-center">
        <p className="badge tabular">404</p>
        <h1
          id="not-found-title"
          className="mt-5 text-[2.5rem] leading-[1.06] font-semibold tracking-[-0.035em] text-foreground sm:text-[3.5rem]"
        >
          No dashboard here.
        </h1>
        <p className="mt-4 max-w-md text-[1.0625rem] leading-7 text-muted-foreground sm:text-lg">
          The page that you asked for does not exist. Go back to the home page or open the
          repository.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/" trailingIcon={<ArrowRight />}>
            Go to the home page
          </ButtonLink>
          <ButtonLink href={cta.selfHost.href} variant="secondary">
            Open GitHub
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
