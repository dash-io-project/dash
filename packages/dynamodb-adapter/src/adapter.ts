import {
  QueryValidationError,
  normalizeAdapterQuery,
  type AdapterColumn,
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ConnectionTestResult,
  type DataAdapter,
  type DynamoDbConnectionConfig,
} from "@dash/core";
import { scrubSecrets, dynamoSession, type DynamoDbSession } from "./connection.ts";
import { dynamoCall } from "./http.ts";
import {
  compareRows,
  compileRead,
  evaluatedItemCeiling,
  exceedsUnfilteredWindow,
  requestLimit,
  dynamoTableName,
  matchesResidual,
  projectRow,
  resultColumns,
  type CompiledRead,
  type TableKeys,
} from "./query.ts";
import { rawAttributeType, unmarshallItem } from "./values.ts";

const MAX_TABLES = 200;
const SAMPLE_ITEMS = 50;
const MAX_COLUMNS = 500;
const SCAN_CAP = 10_000;
const QUERY_TIMEOUT_MS = 60_000;

export function accumulateTableNames(
  pages: ReadonlyArray<{ names: readonly string[]; next?: string }>,
  cap: number,
): { names: string[]; truncated: boolean } {
  const names: string[] = [];
  let truncated = false;
  for (const page of pages) {
    for (const name of page.names) {
      if (names.length >= cap) {
        truncated = true;
        break;
      }
      names.push(name);
    }
    if (names.length >= cap && (truncated || page.next)) {
      truncated = true;
      break;
    }
    if (!page.next) {
      break;
    }
  }
  names.sort((left, right) => left.localeCompare(right));
  return { names, truncated };
}

export class DynamoDbAdapter implements DataAdapter {
  readonly kind = "dynamodb" as const;
  #session: DynamoDbSession;
  #secrets: readonly string[];
  #abort = new AbortController();
  #keys = new Map<string, TableKeys>();

  constructor(session: DynamoDbSession) {
    this.#session = session;
    this.#secrets = [session.secretAccessKey, session.sessionToken, session.accessKeyId].filter(
      (value): value is string => typeof value === "string" && value.length >= 8,
    );
  }

  static fromConfig(config: DynamoDbConnectionConfig): DynamoDbAdapter {
    return new DynamoDbAdapter(dynamoSession(config));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#call("ListTables", { Limit: 1 });
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to DynamoDB",
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: this.#message(error),
      };
    }
  }

  async introspectSchema(): Promise<AdapterSchema> {
    const listed = await this.#listTables();
    const resources: AdapterSchema["resources"] = [];
    for (const name of listed.names) {
      const keys = await this.#tableKeys(name);
      const sample = readPage(await this.#call("Scan", { TableName: name, Limit: SAMPLE_ITEMS }));
      resources.push({
        name,
        namespace: this.#session.region,
        kind: "table",
        columns: inferColumns(keys, sample.items),
      });
    }
    return { kind: "dynamodb", resources, ...(listed.truncated ? { truncated: true } : {}) };
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    const table = dynamoTableName(input.resource);
    normalizeAdapterQuery(input);
    const deadline = AbortSignal.timeout(QUERY_TIMEOUT_MS);
    const keys = await this.#tableKeys(table, deadline);
    const compiled = compileRead(input, keys);
    if (compiled.empty) {
      return pageResult([], compiled);
    }
    if (exceedsUnfilteredWindow(compiled, SCAN_CAP)) {
      throw new QueryValidationError(`DynamoDB can return at most ${SCAN_CAP} items for one read`);
    }
    return this.#read(compiled, deadline);
  }

  async close(): Promise<void> {
    this.#abort.abort();
  }

  async #listTables(): Promise<{ names: string[]; truncated: boolean }> {
    const pages: Array<{ names: string[]; next?: string }> = [];
    const seen = new Set<string>();
    let start: string | undefined;
    let count = 0;
    while (count < MAX_TABLES) {
      const body: Record<string, unknown> = { Limit: 100 };
      if (start) {
        body.ExclusiveStartTableName = start;
      }
      const page = readTablePage(await this.#call("ListTables", body));
      pages.push({ names: page.names, ...(page.next ? { next: page.next } : {}) });
      count += page.names.length;
      if (!page.next) {
        break;
      }
      if (seen.has(page.next)) {
        throw new Error("DynamoDB repeated a page");
      }
      seen.add(page.next);
      start = page.next;
    }
    return accumulateTableNames(pages, MAX_TABLES);
  }

  async #tableKeys(table: string, deadline?: AbortSignal): Promise<TableKeys> {
    const cached = this.#keys.get(table);
    if (cached) {
      return cached;
    }
    const keys = readTableKeys(await this.#call("DescribeTable", { TableName: table }, deadline));
    this.#keys.set(table, keys);
    return keys;
  }

  async #read(compiled: CompiledRead, deadline: AbortSignal): Promise<AdapterQueryResult> {
    const needsComplete =
      compiled.residual.length > 0 || (compiled.orderBy.length > 0 && !compiled.nativeOrder);
    const need = compiled.offset + compiled.limit + 1;
    const ceiling = evaluatedItemCeiling(compiled, SCAN_CAP);
    const matches: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let startKey: Record<string, unknown> | undefined;
    let scanned = 0;

    while (true) {
      if (startKey) {
        const mark = JSON.stringify(startKey);
        if (seen.has(mark)) {
          throw new Error("DynamoDB repeated a page");
        }
        seen.add(mark);
      }
      const request: Record<string, unknown> = { ...compiled.body };
      if (startKey) {
        request.ExclusiveStartKey = startKey;
      }
      const pageLimit = requestLimit(compiled, matches.length, scanned, SCAN_CAP);
      if (pageLimit !== undefined) {
        request.Limit = pageLimit;
      }
      const page = readPage(await this.#call(compiled.operation, request, deadline));
      if (page.scannedCount === 0 && page.lastKey && page.items.length === 0) {
        throw new Error("DynamoDB returned an unexpected response");
      }
      scanned += page.scannedCount;
      for (const item of page.items) {
        const row = unmarshallItem(item);
        if (!matchesResidual(row, compiled.residual)) {
          continue;
        }
        matches.push(row);
      }
      if (!needsComplete && matches.length >= need) {
        return pageResult(matches, compiled);
      }
      if (!page.lastKey) {
        break;
      }
      if (scanned >= ceiling) {
        throw new Error(`DynamoDB scan stopped after ${SCAN_CAP} items`);
      }
      startKey = page.lastKey;
    }
    return pageResult(matches, compiled);
  }

  async #call(
    target: string,
    body: Record<string, unknown>,
    deadline?: AbortSignal,
  ): Promise<unknown> {
    try {
      return await dynamoCall(this.#session, target, body, this.#abort.signal, deadline);
    } catch (error) {
      throw new Error(this.#message(error));
    }
  }

  #message(error: unknown): string {
    const raw = error instanceof Error ? error.message : "DynamoDB request failed";
    const scrubbed = scrubSecrets(raw, this.#secrets).trim();
    return scrubbed || "DynamoDB request failed";
  }
}

export function createDynamoDbAdapter(config: DynamoDbConnectionConfig): DynamoDbAdapter {
  return DynamoDbAdapter.fromConfig(config);
}

function pageResult(matches: Record<string, unknown>[], compiled: CompiledRead): AdapterQueryResult {
  const ordered =
    compiled.nativeOrder || compiled.orderBy.length === 0
      ? matches
      : [...matches].sort((left, right) => compareRows(left, right, compiled.orderBy));
  const window = ordered.slice(compiled.offset, compiled.offset + compiled.limit);
  const rows = window.map((row) => projectRow(row, compiled.columns));
  return {
    columns: resultColumns(rows, compiled.columns),
    rows,
    rowCount: rows.length,
    truncated: ordered.length > compiled.offset + compiled.limit,
  };
}

interface TablePage {
  names: string[];
  next?: string;
}

function readTablePage(body: unknown): TablePage {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  const names = (body as { TableNames?: unknown }).TableNames;
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  const next = (body as { LastEvaluatedTableName?: unknown }).LastEvaluatedTableName;
  if (next !== undefined && typeof next !== "string") {
    throw new Error("DynamoDB returned an unexpected response");
  }
  return { names, ...(typeof next === "string" ? { next } : {}) };
}

interface ItemPage {
  items: unknown[];
  scannedCount: number;
  lastKey?: Record<string, unknown>;
}

function readPage(body: unknown): ItemPage {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  const record = body as {
    Items?: unknown;
    ScannedCount?: unknown;
    LastEvaluatedKey?: unknown;
  };
  const items = record.Items === undefined ? [] : record.Items;
  if (!Array.isArray(items)) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  if (typeof record.ScannedCount !== "number" || !Number.isInteger(record.ScannedCount) || record.ScannedCount < 0) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  if (
    record.LastEvaluatedKey !== undefined &&
    (!record.LastEvaluatedKey || typeof record.LastEvaluatedKey !== "object" || Array.isArray(record.LastEvaluatedKey))
  ) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  return {
    items,
    scannedCount: record.ScannedCount,
    ...(record.LastEvaluatedKey ? { lastKey: record.LastEvaluatedKey as Record<string, unknown> } : {}),
  };
}

function readTableKeys(body: unknown): TableKeys {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  const table = (body as { Table?: unknown }).Table;
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  const schema = (table as { KeySchema?: unknown }).KeySchema;
  if (!Array.isArray(schema) || schema.length === 0) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  const definitions = new Map<string, string>();
  const rawDefinitions = (table as { AttributeDefinitions?: unknown }).AttributeDefinitions;
  if (Array.isArray(rawDefinitions)) {
    for (const definition of rawDefinitions) {
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
        throw new Error("DynamoDB returned an unexpected response");
      }
      const name = (definition as { AttributeName?: unknown }).AttributeName;
      const type = (definition as { AttributeType?: unknown }).AttributeType;
      if (typeof name !== "string" || typeof type !== "string") {
        throw new Error("DynamoDB returned an unexpected response");
      }
      definitions.set(name, definitionType(type));
    }
  }
  let hash: string | undefined;
  let range: string | undefined;
  for (const entry of schema) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("DynamoDB returned an unexpected response");
    }
    const name = (entry as { AttributeName?: unknown }).AttributeName;
    const keyType = (entry as { KeyType?: unknown }).KeyType;
    if (typeof name !== "string" || (keyType !== "HASH" && keyType !== "RANGE")) {
      throw new Error("DynamoDB returned an unexpected response");
    }
    if (keyType === "HASH") {
      hash = name;
    } else {
      range = name;
    }
  }
  if (!hash) {
    throw new Error("DynamoDB returned an unexpected response");
  }
  return {
    hash,
    hashType: definitions.get(hash) ?? "unknown",
    ...(range ? { range, rangeType: definitions.get(range) ?? "unknown" } : {}),
  };
}

function definitionType(code: string): string {
  if (code === "S") {
    return "string";
  }
  if (code === "N") {
    return "number";
  }
  if (code === "B") {
    return "binary";
  }
  return "unknown";
}

function inferColumns(keys: TableKeys, items: readonly unknown[]): AdapterColumn[] {
  const keyNames = [keys.hash, ...(keys.range ? [keys.range] : [])];
  const keyTypes = new Map<string, string>([[keys.hash, keys.hashType]]);
  if (keys.range) {
    keyTypes.set(keys.range, keys.rangeType ?? "unknown");
  }
  const types = new Map<string, Set<string>>();
  const present = new Map<string, number>();
  const known = new Set<string>(keyNames);
  let sampled = 0;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("DynamoDB returned an unexpected response");
    }
    sampled += 1;
    for (const [name, attribute] of Object.entries(item as Record<string, unknown>)) {
      known.add(name);
      const type = rawAttributeType(attribute);
      if (type === "null" || type === "unknown") {
        continue;
      }
      const seen = types.get(name) ?? new Set<string>();
      seen.add(type);
      types.set(name, seen);
      present.set(name, (present.get(name) ?? 0) + 1);
    }
  }
  const extras = [...known]
    .filter((name) => !keyNames.includes(name))
    .sort((left, right) => left.localeCompare(right));
  return [...keyNames, ...extras].slice(0, MAX_COLUMNS).map((name) => {
    const seen = [...(types.get(name) ?? [])];
    const type =
      seen.length === 1 ? seen[0]! : seen.length === 0 ? (keyTypes.get(name) ?? "null") : "unknown";
    const nullable = keyNames.includes(name) ? false : sampled === 0 || (present.get(name) ?? 0) < sampled;
    return { name, type, nullable };
  });
}
