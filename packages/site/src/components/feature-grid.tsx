import { Braces, Database, KeyRound, Layers3, LayoutDashboard, Users } from "lucide-react";
import Image from "next/image";
import type { ComponentType, SVGProps } from "react";
import { type Feature, type FeatureIcon, features } from "~/content/features";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const icons: Record<FeatureIcon, IconComponent> = {
  dashboards: LayoutDashboard,
  "data-sources": Database,
  workspaces: Layers3,
  members: Users,
  tokens: KeyRound,
  api: Braces,
};

function FeatureIconTile({ icon }: { icon: FeatureIcon }) {
  const Icon = icons[icon];
  return (
    <span className="icon-tile">
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
  );
}

function LargeCard({ feature }: { feature: Feature }) {
  const shot = feature.screenshot;
  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="p-6 sm:p-8">
        <FeatureIconTile icon={feature.icon} />
        <h3 className="mt-5 text-lg font-semibold text-foreground">{feature.title}</h3>
        <p className="mt-2 max-w-md text-[0.9375rem] leading-7 text-muted-foreground">
          {feature.description}
        </p>
      </div>
      {shot ? (
        <div className="mt-auto border-t border-border bg-surface pt-6 pl-6 sm:pt-8 sm:pl-8">
          <div className="relative aspect-[16/10] w-full overflow-hidden rounded-tl-lg border-t border-l border-border">
            <Image
              src={shot.src}
              alt={shot.alt}
              width={shot.width}
              height={shot.height}
              sizes="(min-width: 1024px) 540px, 100vw"
              className="absolute inset-0 h-full w-full object-cover object-left-top"
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SmallCard({ feature }: { feature: Feature }) {
  return (
    <article className="bg-card p-6 sm:p-7">
      <FeatureIconTile icon={feature.icon} />
      <h3 className="mt-5 text-base font-semibold text-foreground">{feature.title}</h3>
      <p className="mt-2 text-[0.9375rem] leading-6 text-muted-foreground">{feature.description}</p>
    </article>
  );
}

/**
 * Two large cards with screenshots, then one row of four smaller cells.
 * The gap of the row shows the border color, so the cells have thin lines between them.
 */
export function FeatureGrid() {
  const large = features.filter((feature) => feature.screenshot);
  const small = features.filter((feature) => !feature.screenshot);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {large.map((feature) => (
          <LargeCard key={feature.id} feature={feature} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {small.map((feature) => (
          <SmallCard key={feature.id} feature={feature} />
        ))}
      </div>
    </div>
  );
}
