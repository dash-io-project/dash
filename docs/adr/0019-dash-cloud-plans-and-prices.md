# ADR 0019: Dash Cloud plans and prices

## Status

Accepted. Changes the Cloud plan and the Enterprise plan that [ADR 0011](0011-public-website.md) put on the website. Changes the plan `cloud` that [ADR 0012](0012-dash-cloud-accounts.md) gave to each new organization.

## Context

Dash Cloud had one plan, Cloud, at a placeholder price of $0.10 for each compute hour. The website also showed Enterprise with a custom price.

The owner decided on three plans: Free, Pro, and Business. Each plan includes some usage. The price of usage is the cost on Cloudflare with a 70% margin.

Dash does not keep or scan the data of a customer. A query runs in the database of the customer, and Dash receives a small result. Cloudflare bills Dash for the time that a container runs. Memory and disk follow the instance type, and CPU follows active use. Each container also has a Durable Object. Worker requests, logs, and egress are small costs.

## Decision

- The meter is the compute hour. A compute hour is one hour that the server of an organization is awake.
- Each Dash Cloud organization has one container. A request from a person or an agent starts it. It sleeps after 15 minutes with no requests.
- Dash Cloud does not bill for data in GB. Dash does not scan the data, and the customer already pays the database for the scan. A customer cannot predict the GB, and the GB does not follow the Cloudflare bill.
- The plans:

  | | Free | Pro | Business |
  | --- | --- | --- | --- |
  | Price each month | $0 | $29 | $199 |
  | Compute hours included | 40 | 300 | Each hour |
  | After the included hours | The workspace pauses until the next month | $0.10 for each hour | No extra charge |
  | Server sleeps | After 15 minutes | After 15 minutes | Never |
  | Instance type | `basic` | `basic` | `standard-1` |
  | Support | GitHub Issues | Email | Priority, with an uptime SLA |

- "A 70% margin" is a gross margin: price = cost ÷ 0.3. It is not a 70% markup. A markup (cost × 1.7) gives a margin of only 41%.
- The margin also pays for Stripe, MongoDB Atlas, email, support, and the Free plan.
- No plan charges for each user. No plan removes a product feature, because the MIT build has each feature.
- Self-host stays free under the MIT license. Enterprise stays a custom plan: a dedicated instance, more than one organization, and invoice billing. The pricing page shows these two below the three plan cards.
- One server cannot be awake for more than 744 hours (31 days). Thus a Pro bill is never more than $29 + (744 − 300) × $0.10 = $73.40. The FAQ gives this limit.
- Sign-up creates an organization on the plan `free`. An organization from before this change has the plan `cloud`. The account page shows it as Free, because no organization pays yet.
- `packages/site/src/content/plans.ts` keeps the numbers of each plan. The plan cards, the comparison table, the FAQ, and the home page make their text from these numbers.
- The Pro button on the pricing page opens sign-up. The Business button opens an email to the team.

## Cost basis

The Cloudflare prices are from the Containers, Durable Objects, and Workers pricing pages, updated November 13, 2026:

- Memory: $0.0000025 for each GiB-second of the instance type.
- CPU: $0.000020 for each vCPU-second of active use.
- Disk: $0.00000007 for each GB-second of the instance type.
- Durable Object duration: $12.50 for each million GB-seconds, at 128 MB.

The cost of one awake hour includes the Durable Object for the full hour. It also has 10% more for requests, logs, and egress:

| Instance type | 25% CPU | 100% CPU | 744 hours |
| --- | --- | --- | --- |
| `basic` (¼ vCPU, 1 GiB, 4 GB) | $0.022 | $0.037 | $17–$28 |
| `standard-1` (½ vCPU, 4 GiB, 8 GB) | $0.058 | $0.088 | $43–$65 |

- The planning cost of a `basic` hour is $0.03. Thus the extra hour costs $0.03 ÷ 0.3 = $0.10.
- The 300 hours of Pro cost $7–$11. The margin is 62% to 77% of $29 when a team uses each hour, before Stripe fees.
- Business costs $43–$65 in a month of 744 hours. The margin is 67% to 78% of $199.
- Free costs at most $1.48 for each organization in a month.

## Consequences

- Dash Cloud does not provision a workspace yet. The provisioning change must use one container for each organization, with the instance types in the table above.
- Free and Pro containers must sleep after 15 minutes. The demo Worker uses `sleepAfter = "1h"`. Business containers must not sleep.
- Dash Cloud has no billing yet. A person cannot buy Pro or Business on the website. A later change adds Stripe, the change of plan, and the pause at the Free limit.
- An agent that sends requests over MCP keeps the server awake. An agent that calls every 10 minutes uses each hour of the month. The account page must show the hours of the month and warn at 80% of the included hours.
- The limit of $73.40 for a Pro bill is true only with one container for each organization. If an organization gets more than one container, change the FAQ.
- If the Cloudflare prices change, calculate the cost again. Each hourly price must be at least the cost ÷ 0.3.
