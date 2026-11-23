import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AdapterGrid } from "~/components/adapter-grid";
import { AgentCard } from "~/components/agent-card";
import { ButtonLink } from "~/components/button-link";
import { CodeBlock } from "~/components/code-block";
import { CtaBand } from "~/components/cta-band";
import { FeatureGrid } from "~/components/feature-grid";
import { GitHubIcon } from "~/components/icons";
import { ProductShot } from "~/components/product-shot";
import { SectionHeading } from "~/components/section-heading";
import { TwoWays } from "~/components/two-ways";
import { adapterCount } from "~/content/adapters";
import { mcpEndpoint, mcpTools } from "~/content/mcp";
import { formatUsd, freePlan, priceUnit, proPlan } from "~/content/plans";
import { quickStartCommands, selfHostRequirements } from "~/content/quickstart";
import { cta, site } from "~/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const stats = [
  { value: site.license, label: "License" },
  { value: String(adapterCount), label: "Data sources" },
  { value: String(mcpTools.length), label: "MCP tools" },
  { value: "1", label: "REST API for everything" },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-surface" aria-labelledby="hero-title">
        <div className="container-x pt-16 sm:pt-24">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <p className="badge min-h-7 gap-2 bg-card py-0.5 pr-3 pl-1 text-[0.8125rem]">
              <span className="badge badge-primary">{site.license}</span>
              Open source. MCP built in.
            </p>
            <h1
              id="hero-title"
              className="mt-6 text-[2.625rem] leading-[1.04] font-semibold tracking-[-0.04em] text-balance text-foreground sm:text-6xl lg:text-[4.25rem]"
            >
              Analytics for your team and your agents.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground text-pretty sm:text-xl sm:leading-8">
              Dash is an open source, AI-first analytics workspace. Build dashboards from the UI or
              from an agent over MCP. Self-host it for free, or let us run it on Dash Cloud.
            </p>
            <div className="mt-9 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
              <ButtonLink
                href={cta.cloud.href}
                size="lg"
                trailingIcon={<ArrowRight />}
                className="w-full sm:w-auto"
              >
                {cta.cloud.label}
              </ButtonLink>
              <ButtonLink
                href={cta.selfHost.href}
                size="lg"
                variant="secondary"
                icon={<GitHubIcon />}
                className="w-full sm:w-auto"
              >
                {cta.selfHost.label}
              </ButtonLink>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              Free forever when you self-host. Dash Cloud starts free with {freePlan.includedHours}{" "}
              compute hours, and {proPlan.name} is {formatUsd(proPlan.monthlyPrice)} {priceUnit}.
            </p>
          </div>
        </div>

        {/* The lower half of the screenshot is on the page color, above the line of the numbers. */}
        <div className="mt-14 bg-[linear-gradient(to_bottom,transparent_50%,var(--background)_50%)] sm:mt-16">
          <div className="container-x">
            <ProductShot
              src="/screenshots/executive-overview.webp"
              darkSrc="/screenshots/executive-overview-dark.webp"
              alt="Executive overview dashboard in Dash with ARR, net revenue retention, paying customers, and gross margin KPI cards above ARR, new logos, and MRR charts"
              width={2400}
              height={1500}
              aspectClassName="aspect-square sm:aspect-[16/10]"
              priority
            />
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section aria-label="Dash in numbers" className="border-b border-border">
        <div className="container-x py-12 sm:py-16">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col bg-card px-5 py-5 sm:px-6 sm:py-6">
                <dt className="order-2 mt-1 text-sm text-muted-foreground">{stat.label}</dt>
                <dd className="order-1 text-3xl font-semibold tracking-[-0.03em] text-foreground tabular">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* MCP */}
      <section id="mcp" className="section-y" aria-labelledby="mcp-title">
        <div className="container-x">
          <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <SectionHeading
                eyebrow="MCP built in"
                id="mcp-title"
                title="Ask for a chart. Get a dashboard."
                description={
                  <>
                    Dash ships an MCP server at <code className="code-chip">{mcpEndpoint}</code>.
                    Connect Claude Code or another MCP client with a scoped token. The agent reads
                    your schemas, runs structured queries, and adds chart widgets to your
                    dashboards.
                  </>
                }
              />

              <h3 className="mt-10 text-sm font-semibold text-foreground">
                {mcpTools.length} tools
              </h3>
              <dl className="mt-3 divide-y divide-border border-y border-border">
                {mcpTools.map((tool) => (
                  <div
                    key={tool.name}
                    className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4"
                  >
                    <dt className="shrink-0 font-mono text-[0.8125rem] text-foreground sm:w-40">
                      {tool.name}
                    </dt>
                    <dd className="text-sm leading-6 text-muted-foreground">{tool.description}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 text-sm leading-6 text-muted-foreground">
                Issue a token with the <code className="code-chip">read</code> and{" "}
                <code className="code-chip">mcp</code> scopes. Add the{" "}
                <code className="code-chip">write</code> scope and editor access to let the agent
                create dashboards and add chart widgets.
              </p>
            </div>

            <div className="flex flex-col gap-5 lg:col-span-7">
              <AgentCard />
              <figure className="card overflow-hidden">
                <div className="relative aspect-[16/10] w-full">
                  <Image
                    src="/screenshots/claude-code.webp"
                    alt="Claude Code shows a bar chart of revenue by product that it built through the Dash MCP server"
                    width={1680}
                    height={1050}
                    sizes="(min-width: 1024px) 660px, 100vw"
                    className="absolute inset-0 h-full w-full object-cover object-left-top"
                  />
                </div>
                <figcaption className="border-t border-border bg-surface px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  Claude Code · chart built through Dash MCP
                </figcaption>
              </figure>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="product"
        className="section-y border-t border-border bg-surface"
        aria-labelledby="product-title"
      >
        <div className="container-x">
          <SectionHeading
            eyebrow="Product"
            id="product-title"
            title="Everything a modern analytics workspace needs."
            description="Manage dashboards, data sources, workspaces, and access control from the UI or the REST API. Agents query data and build dashboards over MCP."
          />
          <div className="mt-12 sm:mt-14">
            <FeatureGrid />
          </div>
        </div>
      </section>

      {/* Data sources */}
      <section
        id="data-sources"
        className="section-y border-t border-border"
        aria-labelledby="sources-title"
      >
        <div className="container-x">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-4">
              <SectionHeading
                eyebrow="Data sources"
                id="sources-title"
                title="Connect the data you already have."
                description="Paste a connection URI or enter the fields. Dash tests the connection on save and encrypts the credentials at rest."
              />
              <p className="mt-6 text-sm leading-6 text-muted-foreground">
                Each adapter is one package in the monorepo. Read how to{" "}
                <Link href="/open-source/#architecture" className="link">
                  write a new one
                </Link>
                .
              </p>
            </div>
            <div className="lg:col-span-8">
              <AdapterGrid />
            </div>
          </div>
        </div>
      </section>

      {/* Two ways */}
      <section
        id="run"
        className="section-y border-t border-border bg-surface"
        aria-labelledby="run-title"
      >
        <div className="container-x">
          <SectionHeading
            eyebrow="Two ways to run Dash"
            id="run-title"
            title="Self-host it, or let us run it."
            description="The code is the same in both cases. Pick the path that fits your team, and change it later."
          />
          <div className="mt-12 sm:mt-14">
            <TwoWays />
          </div>
        </div>
      </section>

      {/* Quick start */}
      <section
        id="quick-start"
        className="section-y border-t border-border"
        aria-labelledby="quick-start-title"
      >
        <div className="container-x">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <SectionHeading
                eyebrow="Quick start"
                id="quick-start-title"
                title="Run it in five commands."
                description="Clone the repository, install the dependencies, and start the dev server. The app, the API, and the MCP server start together."
              />
              <dl className="mt-8 divide-y divide-border border-y border-border">
                {selfHostRequirements.map((requirement) => (
                  <div
                    key={requirement.name}
                    className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4"
                  >
                    <dt className="shrink-0 text-sm font-medium text-foreground sm:w-28">
                      {requirement.name}
                    </dt>
                    <dd className="text-sm leading-6 text-muted-foreground">
                      {requirement.detail}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-8">
                <ButtonLink href="/open-source/" variant="secondary" trailingIcon={<ArrowRight />}>
                  Read the self-host guide
                </ButtonLink>
              </div>
            </div>
            <div className="lg:col-span-7">
              <CodeBlock lines={quickStartCommands} title="Terminal" />
            </div>
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
