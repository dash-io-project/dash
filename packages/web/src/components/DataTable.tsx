import { useMemo, useState } from "react";
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { cn } from "~/lib/cn";
import { ICON_STROKE } from "./ui";

const features = tableFeatures({
  rowSortingFeature,
  globalFilteringFeature,
  columnFilteringFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: { alphanumeric: sortFn_alphanumeric },
});

type Row = Record<string, unknown>;

/** A number, or text that is a plain decimal number. Text such as "007" is an identifier. */
function isNumeric(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "bigint") return true;
  return typeof value === "string" && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value);
}

/** The columns in which each value is a number. The table aligns them to the right. */
function numericColumns(rows: Row[]): Set<string> {
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  return new Set(
    keys.filter((key) => {
      const values = rows.map((row) => row[key]).filter((value) => value != null);
      return values.length > 0 && values.every(isNumeric);
    }),
  );
}

export function DataTable({
  rows,
}: {
  rows: Row[];
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const columns = useMemo<ColumnDef<typeof features, Row>[]>(() => {
    const keys = rows[0] ? Object.keys(rows[0]) : [];
    return keys.map((key) => ({
      accessorKey: key,
      header: key,
      cell: (context) => {
        const value = context.getValue();
        return value == null ? "—" : String(value);
      },
    }));
  }, [rows]);

  const table = useTable({
    features,
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
  });

  const numeric = useMemo(() => numericColumns(rows), [rows]);

  return (
    // The table fills its widget card. Rows scroll inside the card, and the header stays in view.
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative mb-3 shrink-0">
        <Search
          size={15}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder="Filter rows"
          aria-label="Filter rows"
          className="input pl-9"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="min-w-full border-separate border-spacing-0 text-left">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className={cn(
                        "sticky top-0 z-10 h-9 border-b border-border bg-surface px-3 text-xs font-medium whitespace-nowrap text-muted-foreground",
                        numeric.has(header.column.id) && "text-right",
                      )}
                    >
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm hover:text-foreground",
                            sorted && "text-foreground",
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === "asc" ? (
                            <ArrowUp size={12} aria-hidden="true" />
                          ) : sorted === "desc" ? (
                            <ArrowDown size={12} aria-hidden="true" />
                          ) : (
                            <ArrowUpDown size={12} aria-hidden="true" className="opacity-50" />
                          )}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="group">
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      "h-10 border-b border-border px-3 whitespace-nowrap group-last:border-b-0 group-hover:bg-row-hover",
                      numeric.has(cell.column.id) && "tabular text-right",
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-muted-foreground">No rows to display.</div>
        ) : null}
      </div>
    </div>
  );
}
