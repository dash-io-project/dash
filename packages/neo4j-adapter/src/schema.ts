import type { AdapterColumn, AdapterResource } from "@dash/core";
import { isSafeKey } from "./values.ts";

const MAX_RESOURCES = 200;

export interface NodePropertyRow {
  labels: readonly string[];
  propertyName: string | null;
  propertyTypes: readonly string[];
  mandatory: boolean;
}

export interface RelationshipPropertyRow {
  relationshipType: string | null;
  propertyName: string | null;
  propertyTypes: readonly string[];
  mandatory: boolean;
}

interface ColumnDraft {
  types: Set<string>;
  nullable: boolean;
}

/** Read one graph name from a procedure value such as `:PLACED` or `` :`Order` ``. */
export function graphName(raw: string): string | undefined {
  const names = namesFromType(raw.startsWith(":") ? raw : `:${raw}`);
  if (names.length !== 1) {
    return undefined;
  }
  return names[0];
}

/**
 * Split a Neo4j type token into safe names.
 * A backtick quotes a name. A colon separates names.
 */
export function namesFromType(raw: string): string[] {
  let text = raw.trim();
  if (text.startsWith(":")) {
    text = text.slice(1);
  }
  const names: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] === ":") {
      index += 1;
      continue;
    }
    if (text[index] === "`") {
      let name = "";
      index += 1;
      while (index < text.length) {
        const char = text[index];
        if (char === "`" && text[index + 1] === "`") {
          name += "`";
          index += 2;
          continue;
        }
        if (char === "`") {
          index += 1;
          break;
        }
        name += char ?? "";
        index += 1;
      }
      const safe = safeGraphName(name);
      if (safe) {
        names.push(safe);
      }
      continue;
    }
    let name = "";
    while (index < text.length && text[index] !== ":") {
      name += text[index] ?? "";
      index += 1;
    }
    const safe = safeGraphName(name);
    if (safe) {
      names.push(safe);
    }
  }
  return names;
}

function safeGraphName(name: string): string | undefined {
  return isSafeKey(name) ? name : undefined;
}

function columnMap(): Map<string, ColumnDraft> {
  return new Map();
}

function addProperty(
  columns: Map<string, ColumnDraft>,
  propertyName: string | null,
  propertyTypes: readonly string[],
  mandatory: boolean,
): void {
  if (propertyName === null || !isSafeKey(propertyName)) {
    return;
  }
  let draft = columns.get(propertyName);
  if (!draft) {
    draft = { types: new Set(), nullable: false };
    columns.set(propertyName, draft);
  }
  for (const type of propertyTypes) {
    if (type.length > 0) {
      draft.types.add(type);
    }
  }
  if (!mandatory) {
    draft.nullable = true;
  }
}

function toColumns(columns: Map<string, ColumnDraft>): AdapterColumn[] {
  return [...columns.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([name, draft]) => ({
      name,
      type: draft.types.size > 0 ? [...draft.types].sort().join("|") : "unknown",
      nullable: draft.nullable,
    }));
}

export function labelsForNodeType(labels: readonly string[], nodeType: unknown): string[] {
  const clean = labels.flatMap((label) => {
    const name = graphName(label);
    return name ? [name] : [];
  });
  if (clean.length > 0 || typeof nodeType !== "string") {
    return clean;
  }
  return namesFromType(nodeType);
}

function resourcesFrom(
  namespace: "node" | "relationship",
  names: readonly string[],
  columnsFor: Map<string, Map<string, ColumnDraft>>,
): AdapterResource[] {
  const resources: AdapterResource[] = [];
  const ordered = [...names].filter((name) => isSafeKey(name)).sort((left, right) => left.localeCompare(right));
  for (const name of ordered) {
    if (resources.length >= MAX_RESOURCES) {
      break;
    }
    resources.push({
      name,
      namespace,
      kind: "collection",
      columns: toColumns(columnsFor.get(name) ?? columnMap()),
    });
  }
  return resources;
}

export function buildSchema(input: {
  labels: readonly string[];
  nodeRows: readonly NodePropertyRow[];
  relationshipTypes: readonly string[];
  relationshipRows: readonly RelationshipPropertyRow[];
}): AdapterResource[] {
  const nodeColumns = new Map<string, Map<string, ColumnDraft>>();
  const nodeNames = new Set<string>();
  for (const label of input.labels) {
    if (isSafeKey(label)) {
      nodeNames.add(label);
    }
  }
  for (const row of input.nodeRows) {
    for (const label of row.labels) {
      if (!isSafeKey(label)) {
        continue;
      }
      nodeNames.add(label);
      let columns = nodeColumns.get(label);
      if (!columns) {
        columns = columnMap();
        nodeColumns.set(label, columns);
      }
      addProperty(columns, row.propertyName, row.propertyTypes, row.mandatory);
    }
  }

  const relationshipColumns = new Map<string, Map<string, ColumnDraft>>();
  const relationshipNames = new Set<string>();
  for (const relationshipType of input.relationshipTypes) {
    const name = graphName(relationshipType);
    if (name) {
      relationshipNames.add(name);
    }
  }
  for (const row of input.relationshipRows) {
    if (row.relationshipType === null) {
      continue;
    }
    const name = graphName(row.relationshipType);
    if (!name) {
      continue;
    }
    relationshipNames.add(name);
    let columns = relationshipColumns.get(name);
    if (!columns) {
      columns = columnMap();
      relationshipColumns.set(name, columns);
    }
    addProperty(columns, row.propertyName, row.propertyTypes, row.mandatory);
  }

  return [
    ...resourcesFrom("node", [...nodeNames], nodeColumns),
    ...resourcesFrom("relationship", [...relationshipNames], relationshipColumns),
  ];
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
