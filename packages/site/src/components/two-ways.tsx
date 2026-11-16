import { ArrowRight, Check, Cloud, Server } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cloudPlan, formatPrice } from "~/content/plans";
import { cta } from "~/lib/site";
import { ButtonLink } from "./button-link";
import { GitHubIcon } from "./icons";

const selfHostPoints = [
  "All product features. No feature gates.",
  "MIT license. Your infrastructure, your data.",
  "Node.js 24 and MongoDB. A Dockerfile is included.",
  "Community support on GitHub Issues.",
];

const cloudPoints = [
  "We run it. You sign in.",
  "Automatic upgrades and daily backups.",
  "Email support from the team that builds Dash.",
  "The same product as the open source build.",
];

type WayProps = {
  id: string;
  icon: ReactNode;
  label: string;
  title: string;
  price: string;
  priceUnit: string;
  points: readonly string[];
  action: ReactNode;
  more: { label: string; href: string };
};

/** One of the two columns: a heading, a price, a list, and the links. */
function Way({ id, icon, label, title, price, priceUnit, points, action, more }: WayProps) {
  return (
    <article aria-labelledby={id} className="flex flex-col bg-card p-6 sm:p-10">
      <div className="flex items-center gap-3">
        <span className="icon-tile [&>svg]:size-[18px]">{icon}</span>
        <div>
          <p className="text-sm leading-5 text-muted-foreground">{label}</p>
          <h3 id={id} className="text-lg leading-6 font-semibold text-foreground">
            {title}
          </h3>
        </div>
      </div>
      <p className="mt-7 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tracking-[-0.03em] text-foreground tabular">
          {price}
        </span>
        <span className="text-sm text-muted-foreground">{priceUnit}</span>
      </p>
      <ul className="mt-7 space-y-3 border-t border-border pt-7">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-3 text-[0.9375rem] text-foreground">
            <Check className="mt-1 size-4 shrink-0" aria-hidden="true" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-x-5 gap-y-4 pt-9 sm:flex-row sm:items-center">
        {action}
        <Link
          href={more.href}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          {more.label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

/** Self-host and Dash Cloud in two columns of one card, with a thin line between them. */
export function TwoWays() {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-2">
      <Way
        id="way-self-host"
        icon={<Server aria-hidden="true" />}
        label="Self-host"
        title="Open source"
        price="$0"
        priceUnit="forever"
        points={selfHostPoints}
        action={
          <ButtonLink href={cta.selfHost.href} variant="secondary" icon={<GitHubIcon />}>
            {cta.selfHost.label}
          </ButtonLink>
        }
        more={{ label: "Read the quick start", href: "/open-source/" }}
      />
      <Way
        id="way-cloud"
        icon={<Cloud aria-hidden="true" />}
        label="Managed"
        title="Dash Cloud"
        price={formatPrice(cloudPlan)}
        priceUnit={cloudPlan.priceUnit}
        points={cloudPoints}
        action={
          <ButtonLink href={cta.cloud.href} trailingIcon={<ArrowRight />}>
            {cta.cloud.label}
          </ButtonLink>
        }
        more={{ label: "See pricing", href: "/pricing/" }}
      />
    </div>
  );
}
