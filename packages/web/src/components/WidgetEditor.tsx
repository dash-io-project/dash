import { useId, useMemo, useState } from "react";
import type { AdapterSchema, ChartType, DashboardWidget, DataSourceRecord } from "@dash/core";
import { CHART_TYPES } from "@dash/core";
import { randomId } from "~/lib/id";
import { Select, type SelectOption } from "./Select";
import { Button, Field, TextInput } from "./ui";

const WIDGET_TYPE_OPTIONS: SelectOption<DashboardWidget["type"]>[] = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
  { value: "kpi", label: "KPI" },
];

const CHART_TYPE_OPTIONS: SelectOption<ChartType>[] = CHART_TYPES.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

export function WidgetEditor({
  dataSources,
  schemas,
  onAdd,
  onClose,
}: {
  dataSources: DataSourceRecord[];
  schemas: Record<string, AdapterSchema>;
  onAdd: (widget: DashboardWidget) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("New chart");
  const [type, setType] = useState<DashboardWidget["type"]>("chart");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [dataSourceId, setDataSourceId] = useState(dataSources[0]?.id ?? "");
  const [resource, setResource] = useState("");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [color, setColor] = useState("");
  const headingId = useId();

  const resources = schemas[dataSourceId]?.resources ?? [];
  const columns = useMemo(
    () => resources.find((item) => item.name === resource)?.columns ?? [],
    [resource, resources],
  );
  const columnOptions: SelectOption[] = columns.map((column) => ({
    value: column.name,
    label: column.name,
    description: column.type,
  }));

  function submit() {
    const widget: DashboardWidget = {
      id: randomId(),
      type,
      title,
      layout: { x: 0, y: 99, w: type === "kpi" ? 3 : 12, h: type === "kpi" ? 2 : 5 },
      dataSourceId,
      query: {
        resource,
        columns: [x, y, color].filter(Boolean),
      },
    };
    if (type === "chart") {
      widget.chart = {
        type: chartType,
        encode: {
          x,
          y,
          color: color || undefined,
          name: chartType === "pie" || chartType === "donut" ? x : undefined,
          value: chartType === "pie" || chartType === "donut" ? y : undefined,
        },
        smooth: chartType === "area" || chartType === "line",
        stacked: chartType === "area",
      };
    }
    if (type === "kpi") {
      widget.kpi = { aggregation: "sum", column: y || x, format: "number" };
    }
    onAdd(widget);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-backdrop p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-dialog"
      >
        <h2 id={headingId} className="text-base font-semibold">
          Add widget
        </h2>
        <div className="mt-4 space-y-3">
          <Field label="Title">
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Widget type">
            <Select value={type} options={WIDGET_TYPE_OPTIONS} onValueChange={setType} />
          </Field>
          {type === "chart" ? (
            <Field label="Chart type">
              <Select value={chartType} options={CHART_TYPE_OPTIONS} onValueChange={setChartType} />
            </Field>
          ) : null}
          <Field label="Data source">
            <Select
              value={dataSourceId}
              placeholder="Select a data source"
              options={dataSources.map((source) => ({ value: source.id, label: source.name }))}
              onValueChange={(id) => {
                setDataSourceId(id);
                setResource("");
              }}
            />
          </Field>
          <Field label="Resource">
            <Select
              value={resource}
              placeholder="Select a table"
              options={resources.map((item) => ({
                value: item.name,
                label:
                  item.namespace && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name)
                    ? `${item.namespace}.${item.name}`
                    : item.name,
              }))}
              onValueChange={setResource}
            />
          </Field>
          {type !== "table" ? (
            <>
              <Field label={type === "chart" ? "X / name" : "Column"}>
                <Select
                  value={x}
                  placeholder="Select a column"
                  options={columnOptions}
                  onValueChange={setX}
                />
              </Field>
              <Field label={type === "chart" ? "Y / value" : "Value"}>
                <Select
                  value={y}
                  placeholder="Select a column"
                  options={columnOptions}
                  onValueChange={setY}
                />
              </Field>
            </>
          ) : null}
          {type === "chart" ? (
            <Field label="Series (optional)">
              <Select
                value={color}
                options={[{ value: "", label: "None" }, ...columnOptions]}
                onValueChange={setColor}
              />
            </Field>
          ) : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={submit} disabled={!dataSourceId || !resource}>
            Add widget
          </Button>
        </div>
      </div>
    </div>
  );
}
