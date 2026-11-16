import { ArrowRight, Check, GitPullRequest, Scale, ShieldCheck, Unlock } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "~/components/button-link";
import { CodeBlock } from "~/components/code-block";
import { CtaBand } from "~/components/cta-band";
import { GitHubIcon } from "~/components/icons";
import { ProductShot } from "~/components/product-shot";
import { SectionHeading } from "~/components/section-heading";
import { adapters } from "~/content/adapters";
import { mcpTools } from "~/content/mcp";
import { architecture, openSourceReasons, whatYouGet } from "~/content/open-source";
import { healthEndpoints, quickStartCommands, selfHostRequirements } from "~/content/quickstart";
import { pageMetadata } from "~/lib/metadata";
import { cta, site } from "~/lib/site";

const description =
  "Dash is MIT licensed and free to self-host. Read why it is open source, what you get, and how to run it with Node.js 24 and MongoDB.";

export const metadata: Metadata = pageMetadata({
  title: "Open source",
  description,
  path: "/open-source/",
});

const reasonIcons = [Unlock, Scale, ShieldCheck];

const facts = [
  { label: "License", value: site.license },
  { label: "Adapters", value: String(adapters.length) },
  { label: "MCP tools", value: String(mcpTools.length) },
];

export default function OpenSourcePage() {
  return (
    <>
      <section className="border-b border-border bg-surface" aria-labelledby="os-title">
        <div className="container-x py-16 sm:py-24">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <SectionHeading
                as="h1"
                eyebrow={`${site.license} license`}
                id="os-title"
                title="Open source, all the way down."
                description="The code on GitHub is the code that runs Dash Cloud. Clone it, read it, change it, and run it where you want."
              />
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href={cta.selfHost.href} size="lg" icon={<GitHubIcon />}>
                  View on GitHub
                </ButtonLink>
                <ButtonLink
                  href="#quick-start"
                  size="lg"
                  variant="secondary"
                  trailingIcon={<ArrowRight />}
                >
                  Quick start
                </ButtonLink>
              </div>
              <dl className="mt-10 grid grid-cols-3 divide-x divide-border border-t border-border pt-6">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex flex-col px-5 first:pl-0">
                    <dt className="order-2 mt-1 text-sm text-muted-foreground">{fact.label}</dt>
                    <dd className="order-1 text-2xl font-semibold tracking-[-0.02em] text-foreground tabular">
                      {fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="lg:col-span-7">
              <ProductShot
                src="/screenshots/dashboards.webp"
                alt="Dashboards list in a Dash workspace with the MCP connection card above the dashboard cards"
                width={1600}
                height={1000}
                aspectClassName="aspect-[4/3] sm:aspect-[16/10]"
                sizes="(min-width: 1024px) 660px, 100vw"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="section-y" aria-labelledby="why-title">
        <div className="container-x">
          <SectionHeading
            eyebrow="Why open source"
            id="why-title"
            title="Trust is easier to earn in the open."
            description="Analytics software touches your most sensitive data. You can read each line that touches it."
          />
          <ul className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:mt-14 md:grid-cols-3">
            {openSourceReasons.map((reason, index) => {
              const Icon = reasonIcons[index] ?? Unlock;
              return (
                <li key={reason.id} className="bg-card p-6 sm:p-8">
                  <span className="icon-tile">
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-foreground">{reason.title}</h3>
                  <p className="mt-2 text-[0.9375rem] leading-7 text-muted-foreground">
                    {reason.description}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* What you get */}
      <section className="section-y border-t border-border bg-surface" aria-labelledby="get-title">
        <div className="container-x grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="What you get"
              id="get-title"
              title="The full product. Not a community edition."
              description="Each feature of Dash Cloud is in the repository. The MIT license lets you use it, change it, and deploy it for any purpose."
            />
            <div className="mt-8">
              <ButtonLink href={site.licenseUrl} variant="secondary" trailingIcon={<ArrowRight />}>
                Read the license
              </ButtonLink>
            </div>
          </div>
          <ul className="card divide-y divide-border self-start lg:col-span-7">
            {whatYouGet.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 px-5 py-3.5 text-[0.9375rem] text-foreground sm:px-6"
              >
                <Check className="mt-1 size-4 shrink-0" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Self-host */}
      <section
        id="quick-start"
        className="section-y border-t border-border"
        aria-labelledby="self-host-title"
      >
        <div className="container-x">
          <SectionHeading
            eyebrow="Self-host"
            id="self-host-title"
            title="Up in five commands."
            description="Dash needs Node.js 24 and MongoDB. The repository includes a Dockerfile for container deployments."
          />
          <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-7">
              <CodeBlock lines={quickStartCommands} />
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                Open <code className="code-chip">.env</code> and set the MongoDB connection string
                before you start the server.
              </p>
            </div>
            <div className="space-y-5 lg:col-span-5">
              <div className="card p-6">
                <h3 className="text-sm font-semibold text-foreground">Requirements</h3>
                <dl className="mt-3 divide-y divide-border">
                  {selfHostRequirements.map((requirement) => (
                    <div key={requirement.name} className="py-3 last:pb-0">
                      <dt className="text-[0.9375rem] font-medium text-foreground">
                        {requirement.name}
                      </dt>
                      <dd className="text-sm leading-6 text-muted-foreground">
                        {requirement.detail}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="card p-6">
                <h3 className="text-sm font-semibold text-foreground">Health endpoints</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Point your load balancer or uptime monitor at either endpoint.
                </p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {healthEndpoints.map((endpoint) => (
                    <li key={endpoint}>
                      <code className="code-chip inline-block px-2.5 py-1 text-[0.8125rem]">
                        GET {endpoint}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section
        id="architecture"
        className="section-y border-t border-border bg-surface"
        aria-labelledby="arch-title"
      >
        <div className="container-x">
          <SectionHeading
            eyebrow="Architecture"
            id="arch-title"
            title="One monorepo. One package per concern."
            description="The web app serves the UI, the REST API, and the MCP server from one process. Adapters plug in through a shared contract."
          />

          <div className="mt-12 grid grid-cols-1 items-start gap-5 sm:mt-14 lg:grid-cols-12">
            <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:col-span-7">
              {architecture.map((node, index) => (
                <li key={node.id} className="bg-card p-6">
                  <p className="flex items-center justify-between gap-3">
                    <code className="font-mono text-sm font-medium text-foreground">
                      {node.name}
                    </code>
                    <span className="font-mono text-xs text-muted-foreground tabular">
                      0{index + 1}
                    </span>
                  </p>
                  <p className="mt-3 text-[0.9375rem] leading-7 text-muted-foreground">
                    {node.description}
                  </p>
                </li>
              ))}
            </ol>

            <div className="card flex flex-col p-6 lg:col-span-5">
              <h3 className="text-sm font-semibold text-foreground">Adapter packages</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Each data source lives in its own package. To add one, write the package and
                register its kind in the web app.{" "}
                <a href={site.adapterGuide} className="link">
                  Read the adapter guide
                </a>
                .
              </p>
              <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {adapters.map((adapter) => (
                  <li key={adapter.id}>
                    <code className="code-chip block truncate px-2.5 py-1.5 text-xs">
                      @dash/adapter-{adapter.id}
                    </code>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex items-start gap-3 rounded-md border border-border bg-surface p-4">
                <GitPullRequest
                  className="mt-0.5 size-[18px] shrink-0 text-foreground"
                  aria-hidden="true"
                />
                <p className="text-sm leading-6 text-muted-foreground">
                  Want to add one? Read{" "}
                  <a href={site.contributing} className="link">
                    CONTRIBUTING.md
                  </a>{" "}
                  and open a pull request.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CtaBand
        title="Clone it. Run it. Make it yours."
        description="Dash is free to self-host under the MIT license. When you want someone else to run it, Dash Cloud is one click away."
      />
    </>
  );
}
