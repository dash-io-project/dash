import { Building2, LogOut, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { signOutAction } from "~/server/actions";

export type AccountOverviewProps = {
  name: string;
  email: string;
  memberSince: Date;
  organization: {
    name: string;
    planName: string;
    /** The formatted price, for example "$29". */
    price: string;
    /** For example "a month". */
    priceUnit: string;
  };
};

type DetailProps = {
  term: string;
  children: ReactNode;
};

/** One row of a details list: a term on the left and a value on the right. */
function Detail({ term, children }: DetailProps) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6 sm:px-6">
      <dt className="shrink-0 text-sm text-muted-foreground sm:w-36">{term}</dt>
      <dd className="min-w-0 text-[0.9375rem] leading-6 break-words text-foreground">{children}</dd>
    </div>
  );
}

type CardProps = {
  id: string;
  label: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
};

/** A card with an icon, a small label, a heading, and a list of details. */
function Card({ id, label, title, icon, children }: CardProps) {
  return (
    <article aria-labelledby={id} className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-5 py-4 sm:px-6">
        <span className="icon-tile bg-card [&>svg]:size-[18px]">{icon}</span>
        <div>
          <p className="text-sm leading-5 text-muted-foreground">{label}</p>
          <h2 id={id} className="text-base leading-6 font-semibold text-foreground">
            {title}
          </h2>
        </div>
      </div>
      <dl className="divide-y divide-border">{children}</dl>
    </article>
  );
}

/** Formats the sign-up date, for example "November 9, 2026". */
function formatMemberSince(date: Date): string {
  return date.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}

/** The signed-in view of a Dash Cloud account. */
export function AccountOverview({ name, email, memberSince, organization }: AccountOverviewProps) {
  return (
    <section aria-labelledby="account-title">
      <div className="container-x pt-12 pb-20 sm:pt-16 sm:pb-28">
        <header className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow mb-3">Dash Cloud account</p>
            <h1
              id="account-title"
              className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance break-words text-foreground sm:text-[2.5rem]"
            >
              {organization.name}
            </h1>
            <p className="mt-3 text-[1.0625rem] leading-7 text-muted-foreground text-pretty">
              Welcome, {name}. You are the owner of this organization on Dash Cloud.
            </p>
          </div>
          <form action={signOutAction} className="shrink-0">
            <button type="submit" className="btn">
              <LogOut className="size-4 shrink-0" aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </form>
        </header>

        <div className="mt-8 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <Card
            id="account-organization"
            label="Organization"
            title="Your team"
            icon={<Building2 aria-hidden="true" />}
          >
            <Detail term="Name">{organization.name}</Detail>
            <Detail term="Plan">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span>{organization.planName}</span>
                <span className="text-sm text-muted-foreground tabular">
                  {organization.price} {organization.priceUnit}
                </span>
              </span>
            </Detail>
            <Detail term="Your role">
              <span className="badge">Owner</span>
            </Detail>
          </Card>

          <Card
            id="account-person"
            label="You"
            title="Your details"
            icon={<UserRound aria-hidden="true" />}
          >
            <Detail term="Name">{name}</Detail>
            <Detail term="Email">{email}</Detail>
            <Detail term="Member since">
              <time dateTime={memberSince.toISOString()}>{formatMemberSince(memberSince)}</time>
            </Detail>
          </Card>
        </div>
      </div>
    </section>
  );
}
