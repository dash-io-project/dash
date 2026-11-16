import { ArrowRight, Check } from "lucide-react";
import { formatPrice, type Plan } from "~/content/plans";
import { ButtonLink } from "./button-link";

/** One pricing plan. The highlighted plan has an ink border, a badge, and the main button. */
export function PlanCard({ plan }: { plan: Plan }) {
  const highlighted = plan.highlighted;

  return (
    <article
      aria-labelledby={`plan-${plan.id}`}
      className={`card flex flex-col p-6 sm:p-8 ${
        highlighted ? "border-foreground shadow-[0_0_0_1px_var(--foreground)]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={`plan-${plan.id}`} className="text-lg font-semibold text-foreground">
          {plan.name}
        </h3>
        {highlighted ? <span className="badge badge-primary">Most popular</span> : null}
      </div>
      <p className="mt-2 min-h-12 text-[0.9375rem] leading-6 text-muted-foreground">
        {plan.description}
      </p>

      <p className="mt-6 flex items-baseline gap-2">
        <span className="text-[2.75rem] leading-none font-semibold tracking-[-0.03em] text-foreground tabular">
          {formatPrice(plan)}
        </span>
        {plan.priceUnit ? (
          <span className="text-sm text-muted-foreground">{plan.priceUnit}</span>
        ) : null}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {plan.price === null ? "Talk to us" : plan.priceLabel}
      </p>

      <div className="mt-7">
        <ButtonLink
          href={plan.cta.href}
          variant={highlighted ? "primary" : "secondary"}
          className="w-full"
          trailingIcon={<ArrowRight />}
        >
          {plan.cta.label}
        </ButtonLink>
      </div>

      <ul className="mt-8 space-y-3 border-t border-border pt-7">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-[0.9375rem] text-foreground">
            <Check className="mt-1 size-4 shrink-0" aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
