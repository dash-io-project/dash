import {
  Boxes,
  Cloud,
  CreditCard,
  Database,
  Layers,
  Leaf,
  Plus,
  Search,
  Snowflake,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { type Adapter, adapters } from "~/content/adapters";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const icons: Record<string, IconComponent> = {
  postgres: Database,
  mysql: Database,
  mariadb: Database,
  db2: Database,
  snowflake: Snowflake,
  mongodb: Leaf,
  documentdb: Database,
  bigquery: Cloud,
  databricks: Layers,
  redshift: Boxes,
  stripe: CreditCard,
  opensearch: Search,
};

const tileClasses = "flex items-center gap-4 bg-card p-5";

function moreTileClass(count: number): string {
  const smSpan = count % 2 === 0 ? "sm:col-span-2" : "sm:col-span-1";
  const remainder = count % 3;
  const lgSpan =
    remainder === 0 ? "lg:col-span-3" : remainder === 1 ? "lg:col-span-2" : "lg:col-span-1";
  return `flex items-center gap-4 bg-surface p-5 ${smSpan} ${lgSpan}`;
}

function AdapterTile({ adapter }: { adapter: Adapter }) {
  const Icon = icons[adapter.id] ?? Database;
  return (
    <li className={tileClasses}>
      <span className="icon-tile">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{adapter.name}</p>
        <p className="text-sm text-muted-foreground">{adapter.note}</p>
      </div>
    </li>
  );
}

/**
 * Tiles for each supported data source, plus one tile for adapters on the way.
 * The gap of the grid shows the border color, so each tile has a thin line on each side.
 */
export function AdapterGrid() {
  return (
    <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
      {adapters.map((adapter) => (
        <AdapterTile key={adapter.id} adapter={adapter} />
      ))}
      <li className={moreTileClass(adapters.length)}>
        <span className="icon-tile border-dashed text-muted-foreground">
          <Plus className="size-[18px]" aria-hidden="true" />
        </span>
        <div>
          <p className="font-medium text-foreground">More on the way</p>
          <p className="text-sm text-muted-foreground">Each adapter is one package.</p>
        </div>
      </li>
    </ul>
  );
}
