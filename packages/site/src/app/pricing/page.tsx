import { ArrowRight, Building2, Server } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ButtonLink } from "~/components/button-link";
import { ComparisonTable } from "~/components/comparison-table";
import { CtaBand } from "~/components/cta-band";
import { Faq } from "~/components/faq";
import { GitHubIcon } from "~/components/icons";
import { PlanCard } from "~/components/plan-card";
import { SectionHeading } from "~/components/section-heading";
import { pricingFaq } from "~/content/faq";
import { freePlan, plans } from "~/content/plans";
import { pageMetadata } from "~/lib/metadata";
import { cta, site } from "~/lib/site";

const description = `Start on Dash Cloud for free with ${freePlan.includedHours} compute hours each month, and move to Pro or Business when your team needs more. Self-host Dash for free under the MIT license.`;

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description,
  path: "/pricing/",
});

type OtherOptionProps = {
  id: string;
  icon: ReactNode;
  title: string;
  price: string;
  description: string;
  action: ReactNode;
};

/** A way to use Dash that is not a Dash Cloud plan: self-host or Enterprise. */
function OtherOption({ id, icon, title, price, description, action }: OtherOptionProps) {
  return (
    <article
      aria-labelledby={id}
      className="flex flex-col gap-5 bg-card p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8"
    >
      <div className="flex gap-4">
        <span className="icon-tile shrink-0 [&>svg]:size-[18px]">{icon}</span>
        <div>
          <h3
            id={id}
            className="flex flex-wrap items-baseline gap-x-3 text-base font-semibold text-foreground"
          >
            {title}
            <span className="text-sm font-normal text-muted-foreground">{price}</span>
          </h3>
          <p className="mt-1.5 text-[0.9375rem] leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="shrink-0 sm:pt-0.5">{action}</div>
    </article>
  );
}

export default function PricingPage() {
  return (
    <>
      <section className="bg-surface" aria-labelledby="pricing-title">
        <div className="container-x pt-16 pb-16 sm:pt-24 sm:pb-20">
          <SectionHeading
            as="h1"
            eyebrow="Pricing"
            id="pricing-title"
            title="Simple pricing. Same product."
            description="Start for free on Dash Cloud. Pay for more compute hours when your team needs them. Each plan has all product features, and no plan charges for each user."
            align="center"
          />

          <div className="mt-12 grid grid-cols-1 gap-5 sm:mt-14 lg:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Prices are in USD. A compute hour is one hour that the server of your organization is
            awake.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
            <OtherOption
              id="option-self-host"
              icon={<Server aria-hidden="true" />}
              title="Self-host"
              price="$0 forever"
              description="Run Dash on your own servers under the MIT license, with all product features."
              action={
                <ButtonLink
                  href={cta.selfHost.href}
                  variant="secondary"
                  size="sm"
                  icon={<GitHubIcon />}
                >
                  {cta.selfHost.label}
                </ButtonLink>
              }
            />
            <OtherOption
              id="option-enterprise"
              icon={<Building2 aria-hidden="true" />}
              title="Enterprise"
              price="Custom"
              description="A dedicated instance, more than one organization, and invoice billing."
              action={
                <ButtonLink
                  href={cta.contact.href}
                  variant="secondary"
                  size="sm"
                  trailingIcon={<ArrowRight />}
                >
                  {cta.contact.label}
                </ButtonLink>
              }
            />
          </div>
        </div>
      </section>

      <section className="section-y border-t border-border" aria-labelledby="compare-title">
        <div className="container-x">
          <SectionHeading
            eyebrow="Compare plans"
            id="compare-title"
            title="The product is the same. The compute differs."
            description="Each plan includes dashboards, all data source adapters, the MCP server, and the REST API."
          />
          <div className="mt-12">
            <ComparisonTable />
          </div>
        </div>
      </section>

      <section className="section-y border-t border-border" aria-labelledby="faq-title">
        <div className="container-x grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <SectionHeading
              eyebrow="FAQ"
              id="faq-title"
              title="Questions and answers"
              description={
                <>
                  Not here? Write to{" "}
                  <a href={`mailto:${site.contactEmail}`} className="link">
                    {site.contactEmail}
                  </a>
                  .
                </>
              }
            />
          </div>
          <div className="lg:col-span-8">
            <Faq items={pricingFaq} />
          </div>
        </div>
      </section>

      <CtaBand
        title="Pick a path. Change it later."
        description="Start on Dash Cloud in a minute, or clone the repository and keep each byte on your own servers."
      />
    </>
  );
}
