import { Plus } from "lucide-react";
import type { FaqItem } from "~/content/faq";

/** A list of questions. Each answer opens with a native details element. */
export function Faq({ items }: { items: readonly FaqItem[] }) {
  return (
    <div className="divide-y divide-border border-y border-border">
      {items.map((item) => (
        <details key={item.id} className="group">
          <summary className="flex items-center justify-between gap-6 py-5 text-left text-base font-medium text-foreground">
            <span>{item.question}</span>
            <Plus
              className="size-5 shrink-0 text-muted-foreground duration-200 group-open:rotate-45 motion-safe:transition-transform"
              aria-hidden="true"
            />
          </summary>
          <p className="max-w-3xl pr-10 pb-6 text-[0.9375rem] leading-7 text-muted-foreground">
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
