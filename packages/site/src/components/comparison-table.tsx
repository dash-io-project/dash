import { Check, Minus } from "lucide-react";
import { type ComparisonValue, comparisonGroups, plans } from "~/content/plans";

function Cell({ value }: { value: ComparisonValue }) {
  if (value === true) {
    return (
      <span role="img" aria-label="Included" className="inline-flex text-foreground">
        <Check className="size-4" aria-hidden="true" />
      </span>
    );
  }
  if (value === false) {
    return (
      <span role="img" aria-label="Not included" className="inline-flex text-muted-foreground">
        <Minus className="size-4" aria-hidden="true" />
      </span>
    );
  }
  return <span className="text-foreground">{value}</span>;
}

/** Feature comparison across the three plans. The table scrolls on narrow screens. */
export function ComparisonTable() {
  return (
    <div className="card overflow-hidden">
      <p className="border-b border-border bg-surface px-5 py-2.5 text-xs text-muted-foreground lg:hidden">
        Scroll sideways to compare each plan.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] table-fixed border-separate border-spacing-0 text-left text-[0.9375rem]">
          <caption className="sr-only">Feature comparison across Dash plans</caption>
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-border">
              <th
                scope="col"
                className="sticky left-0 z-10 w-40 border-r sm:w-[34%] border-border bg-card px-5 py-4 text-sm font-medium text-muted-foreground"
              >
                Feature
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.id}
                  scope="col"
                  className="w-[22%] px-5 py-4 font-semibold text-foreground"
                >
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          {comparisonGroups.map((group) => (
            <tbody key={group.title}>
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={plans.length + 1}
                  className="border-b border-border bg-surface px-5 py-2 text-left text-xs font-medium text-muted-foreground"
                >
                  {group.title}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr
                  key={row.label}
                  className="[&>td]:border-b [&>td]:border-border [&>th]:border-b [&>th]:border-border [tbody:last-child>&:last-child>*]:border-b-0"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r border-border bg-card px-5 py-3.5 font-normal text-foreground"
                  >
                    {row.label}
                  </th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="px-5 py-3.5 tabular">
                      <Cell value={row.values[plan.id]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
