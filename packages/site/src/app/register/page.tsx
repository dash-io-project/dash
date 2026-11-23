import { ArrowRight, Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "~/components/auth/register-form";
import { formatUsd, freePlan, priceUnit, usageSummary } from "~/content/plans";
import { pageMetadata } from "~/lib/metadata";

const description =
  "Create a Dash Cloud account for your team. Dash Cloud is the managed Dash, with automatic upgrades and daily backups.";

export const metadata: Metadata = pageMetadata({
  title: "Create your Dash Cloud account",
  description,
  path: "/register/",
  index: false,
});

export default function RegisterPage() {
  return (
    <section className="h-full bg-surface" aria-labelledby="register-title">
      <div className="container-x grid grid-cols-1 gap-10 pt-14 pb-20 sm:pt-20 sm:pb-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:grid-rows-[auto_1fr] lg:gap-x-20 lg:gap-y-10">
        <div className="flex max-w-xl flex-col lg:col-start-1 lg:row-start-1">
          <p className="eyebrow mb-3">Dash Cloud</p>
          <h1
            id="register-title"
            className="text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-foreground sm:text-5xl"
          >
            Create your Dash Cloud account.
          </h1>
          <p className="mt-4 text-[1.0625rem] leading-7 text-muted-foreground text-pretty sm:text-lg">
            Dash Cloud is the managed Dash. Complete the form to create the account for your team.
          </p>
        </div>

        <div className="card bg-background p-6 shadow-xs sm:p-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <RegisterForm />
        </div>

        <aside
          aria-labelledby="cloud-plan-title"
          className="max-w-xl border-t border-border pt-8 lg:col-start-1 lg:row-start-2 lg:self-start"
        >
          <h2 id="cloud-plan-title" className="text-base font-semibold text-foreground">
            Your account starts on {freePlan.name}
          </h2>

          <ul className="mt-5 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {freePlan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-3 text-[0.9375rem] text-foreground">
                <Check className="mt-1 size-4 shrink-0" aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-col gap-x-8 gap-y-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-[-0.03em] text-foreground tabular">
                  {formatUsd(freePlan.monthlyPrice)}
                </span>
                <span className="text-sm text-muted-foreground">{priceUnit}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{usageSummary(freePlan)}</p>
            </div>
            <Link
              href="/pricing/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              Compare each plan
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
