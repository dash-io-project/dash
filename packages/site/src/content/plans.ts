import { adapterCount } from "~/content/adapters";
import { cta } from "~/lib/site";

export type PlanId = "free" | "pro" | "business";

export type Plan = {
  id: PlanId;
  name: string;
  description: string;
  /** Price in USD for each month. */
  monthlyPrice: number;
  /** Compute hours in the monthly price. `null` means that the server never sleeps and each hour is included. */
  includedHours: number | null;
  /**
   * Price in USD for each compute hour after the included hours.
   * `null` means no extra hours: the workspace pauses until the next month starts.
   */
  extraHourPrice: number | null;
  /** Minutes with no request before the server sleeps. `null` means that the server never sleeps. */
  sleepAfterMinutes: number | null;
  /** The size of the server for the organization. */
  server: string;
  support: string;
  features: readonly string[];
  cta: { label: string; href: string };
  /** True for the plan that the pricing page highlights. */
  highlighted: boolean;
};

/** The most hours that one server can be awake in a month: 31 days. */
export const maxHoursInMonth = 31 * 24;

const usd = (fractionDigits: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

/** Formats an amount in USD: "$29" for a whole dollar amount, "$0.10" for a fractional amount. */
export function formatUsd(amount: number): string {
  const cents = Math.round(amount * 100);
  return usd(cents % 100 === 0 ? 0 : 2).format(cents / 100);
}

const freeHours = 40;
const proHours = 300;
const proExtraHourPrice = 0.1;

const basicServer = "¼ vCPU, 1 GiB memory";
const largeServer = "½ vCPU, 4 GiB memory";

/**
 * Dash Cloud plans. ADR 0019 gives the cost of each compute hour and the margin rule.
 * Change prices here and nowhere else.
 */
export const plans: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    description: "Try Dash Cloud with your team. You do not need a card.",
    monthlyPrice: 0,
    includedHours: freeHours,
    extraHourPrice: null,
    sleepAfterMinutes: 15,
    server: basicServer,
    support: "GitHub Issues",
    features: [
      `${freeHours} compute hours each month`,
      "The workspace pauses at the limit until the next month",
      "All product features",
      "No charge for each user",
      "Daily backups",
      "Community support on GitHub Issues",
    ],
    cta: { label: "Start for free", href: cta.cloud.href },
    highlighted: false,
  },
  {
    id: "pro",
    name: "Pro",
    description: "For a team that uses Dash each workday.",
    monthlyPrice: 29,
    includedHours: proHours,
    extraHourPrice: proExtraHourPrice,
    sleepAfterMinutes: 15,
    server: basicServer,
    support: "Email",
    features: [
      `${proHours} compute hours each month`,
      `${formatUsd(proExtraHourPrice)} for each extra hour`,
      "All product features",
      "No charge for each user",
      "Daily backups",
      "Email support",
    ],
    cta: cta.cloud,
    highlighted: true,
  },
  {
    id: "business",
    name: "Business",
    description: "For a team that needs Dash all day, with an uptime SLA.",
    monthlyPrice: 199,
    includedHours: null,
    extraHourPrice: null,
    sleepAfterMinutes: null,
    server: largeServer,
    support: "Priority",
    features: [
      "A server that never sleeps",
      "4 times the memory of Pro",
      "All product features",
      "No charge for each user",
      "Daily backups",
      "Uptime SLA and priority support",
    ],
    cta: cta.contact,
    highlighted: false,
  },
];

function planById(id: PlanId): Plan {
  const plan = plans.find((candidate) => candidate.id === id);
  if (!plan) throw new Error(`No plan has the id "${id}".`);
  return plan;
}

/** The plan of a new organization. */
export const freePlan = planById("free");
/** The paid plan that the website shows next to the free plan. */
export const proPlan = planById("pro");

/** The pricing page shows this unit after each monthly price. */
export const priceUnit = "a month";

/** One line about the compute hours of a plan, for example "300 hours included, then $0.10 an hour". */
export function usageSummary(plan: Plan): string {
  if (plan.includedHours === null) return "Always on. Each hour is included.";
  const included = `${plan.includedHours} hours included`;
  if (plan.extraHourPrice === null) return `${included}. Then the workspace pauses.`;
  return `${included}, then ${formatUsd(plan.extraHourPrice)} an hour`;
}

/** The most that a plan can cost in a month, because one server cannot be awake longer than a month. */
export function maxMonthlyBill(plan: Plan): number {
  if (plan.includedHours === null || plan.extraHourPrice === null) return plan.monthlyPrice;
  return plan.monthlyPrice + (maxHoursInMonth - plan.includedHours) * plan.extraHourPrice;
}

function sleepText(plan: Plan): string {
  return plan.sleepAfterMinutes === null ? "Never" : `After ${plan.sleepAfterMinutes} minutes`;
}

export type ComparisonValue = boolean | string;

export type ComparisonRow = {
  label: string;
  values: Record<PlanId, ComparisonValue>;
};

export type ComparisonGroup = {
  title: string;
  rows: readonly ComparisonRow[];
};

/** Gives each plan the same value. */
function same(value: ComparisonValue): Record<PlanId, ComparisonValue> {
  return { free: value, pro: value, business: value };
}

/** Gives each plan a value from its data. */
function each(value: (plan: Plan) => ComparisonValue): Record<PlanId, ComparisonValue> {
  return { free: value(freePlan), pro: value(proPlan), business: value(planById("business")) };
}

/** Rows of the comparison table on the pricing page. */
export const comparisonGroups: readonly ComparisonGroup[] = [
  {
    title: "Price and compute",
    rows: [
      { label: "Price each month", values: each((plan) => formatUsd(plan.monthlyPrice)) },
      {
        label: "Compute hours included",
        values: each((plan) =>
          plan.includedHours === null ? "Each hour" : String(plan.includedHours),
        ),
      },
      {
        label: "After the included hours",
        values: each((plan) => {
          if (plan.includedHours === null) return "No extra charge";
          if (plan.extraHourPrice === null) return "Pauses until next month";
          return `${formatUsd(plan.extraHourPrice)} an hour`;
        }),
      },
      { label: "Server sleeps with no requests", values: each(sleepText) },
      { label: "Server size", values: each((plan) => plan.server) },
    ],
  },
  {
    title: "Product",
    rows: [
      { label: "Dashboards, charts, KPI cards, and tables", values: same(true) },
      { label: "Data source adapters", values: same(`All ${adapterCount}`) },
      { label: "Built-in MCP server", values: same(true) },
      { label: "REST API and scoped API tokens", values: same(true) },
      { label: "Workspaces, member roles, and invitations", values: same(true) },
      { label: "Users", values: same("No limit") },
    ],
  },
  {
    title: "Operations",
    rows: [
      { label: "Upgrades", values: same("Automatic") },
      { label: "Backups", values: same("Daily") },
      { label: "Uptime SLA", values: { free: false, pro: false, business: true } },
    ],
  },
  {
    title: "Support and billing",
    rows: [
      { label: "Support", values: each((plan) => plan.support) },
      {
        label: "Billing",
        values: each((plan) => (plan.monthlyPrice === 0 ? "None" : "Card, monthly")),
      },
      { label: "License", values: same("MIT") },
    ],
  },
];
