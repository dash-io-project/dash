import type { Metadata } from "next";
import { ComparisonTable } from "~/components/comparison-table";
import { CtaBand } from "~/components/cta-band";
import { Faq } from "~/components/faq";
import { PlanCard } from "~/components/plan-card";
import { SectionHeading } from "~/components/section-heading";
import { pricingFaq } from "~/content/faq";
import { plans } from "~/content/plans";
import { pageMetadata } from "~/lib/metadata";
import { site } from "~/lib/site";

const description =
  "Self-host Dash for free under the MIT license, or pay for compute hours on Dash Cloud. Each plan has all product features.";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description,
  path: "/pricing/",
});

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
            description="Self-host Dash for free, or pay only for the compute hours that you use on Dash Cloud. Each plan has all product features."
            align="center"
          />

          <div className="mt-12 grid grid-cols-1 gap-5 sm:mt-14 lg:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Prices are in USD. Need more than one organization? Write to{" "}
            <a href={`mailto:${site.contactEmail}`} className="link">
              {site.contactEmail}
            </a>
            .
          </p>
        </div>
      </section>

      <section className="section-y border-t border-border" aria-labelledby="compare-title">
        <div className="container-x">
          <SectionHeading
            eyebrow="Compare plans"
            id="compare-title"
            title="The product is the same. The operations differ."
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
