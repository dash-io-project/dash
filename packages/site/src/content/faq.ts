import {
  formatUsd,
  freePlan,
  maxHoursInMonth,
  maxMonthlyBill,
  plans,
  proPlan,
} from "~/content/plans";
import { site } from "~/lib/site";

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

const sleepMinutes = freePlan.sleepAfterMinutes;
const alwaysOnPlans = plans
  .filter((plan) => plan.sleepAfterMinutes === null)
  .map((plan) => plan.name)
  .join(" and ");
const proExtra = formatUsd(proPlan.extraHourPrice ?? 0);

/** Questions on the pricing page. The owner will confirm the answers about billing and migration. */
export const pricingFaq: readonly FaqItem[] = [
  {
    id: "limited",
    question: "Is the open source version limited?",
    answer:
      "No. The open source build and each Dash Cloud plan run the same product with the same features. The MIT license covers the full code base. A self-hosted Dash has no feature gates and no usage caps. The Dash Cloud plans differ only in compute hours, server size, and support.",
  },
  {
    id: "billing",
    question: "What is a compute hour?",
    answer: `Dash Cloud runs your organization on its own server. A compute hour is one hour that this server is awake. The server starts when a person or an agent uses Dash. It sleeps after ${sleepMinutes} minutes with no requests. An agent that sends requests over MCP also keeps the server awake. On ${alwaysOnPlans}, the server never sleeps. There is no charge for each user, so you can invite your full team.`,
  },
  {
    id: "limit",
    question: "What happens when I use all the included hours?",
    answer: `On ${freePlan.name}, the workspace pauses until the next month starts. On ${proPlan.name}, each extra hour costs ${proExtra}. A month has at most ${maxHoursInMonth} hours, so a ${proPlan.name} bill is never more than ${formatUsd(maxMonthlyBill(proPlan))}. On ${alwaysOnPlans}, each hour is included.`,
  },
  {
    id: "move",
    question: "Can I move from self-hosted to Cloud, or back?",
    answer: `Yes. Your dashboards and data sources belong to you in both cases. Write to ${site.contactEmail} and we will help you plan the move.`,
  },
  {
    id: "agents",
    question: "How do agents connect to Dash?",
    answer:
      "Dash includes an MCP server at POST /mcp. Issue an API token with the read and mcp scopes. Add the endpoint to Claude Code or another MCP client. The agent can then read schemas and run queries. To let it create dashboards and add chart widgets, add the write scope. The token owner also needs editor access to the workspace.",
  },
  {
    id: "sources",
    question: "Which data sources does Dash support?",
    answer:
      "Postgres, MySQL, MariaDB, IBM Db2, Snowflake, MongoDB, Amazon DocumentDB, Google BigQuery, Databricks SQL, Amazon Redshift, Stripe, and Amazon OpenSearch. More adapters are on the way.",
  },
  {
    id: "enterprise",
    question: "What does Enterprise add?",
    answer: `Enterprise adds a dedicated instance, more than one organization, and invoice billing. The product is the same. Write to ${site.contactEmail}.`,
  },
  {
    id: "license",
    question: "Which license does Dash use?",
    answer: `Dash uses the ${site.license} license. You can use it, change it, and deploy it for any purpose, in private or in public.`,
  },
];
