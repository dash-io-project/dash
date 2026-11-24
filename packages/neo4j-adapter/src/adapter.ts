import {
  type AdapterQuery,
  type AdapterQueryResult,
  type AdapterSchema,
  type ConnectionTestResult,
  type DataAdapter,
  type Neo4jConnectionConfig,
  QueryValidationError,
} from "@dash/core";
import neo4j, { type Driver } from "neo4j-driver";
import { compileRead } from "./cypher.ts";
import {
  type Neo4jTarget,
  neo4jPublicSummary,
  resolveNeo4jTarget,
  scrubSecrets,
  secretsFrom,
} from "./connection.ts";
import {
  type NodePropertyRow,
  type RelationshipPropertyRow,
  buildSchema,
  graphName,
  labelsForNodeType,
  stringList,
} from "./schema.ts";
import { assignPlain, plainRecord, toPlain } from "./values.ts";

const LABEL_CYPHER = "CALL db.labels() YIELD label RETURN label";
const NODE_CYPHER = `
CALL db.schema.nodeTypeProperties()
YIELD nodeLabels, nodeType, propertyName, propertyTypes, mandatory
RETURN nodeLabels, nodeType, propertyName, propertyTypes, mandatory
`;
const RELATIONSHIP_TYPE_CYPHER =
  "CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType";
const RELATIONSHIP_CYPHER = `
CALL db.schema.relTypeProperties()
YIELD relType, propertyName, propertyTypes, mandatory
RETURN relType, propertyName, propertyTypes, mandatory
`;

interface CypherRecord {
  get(key: string): unknown;
}

interface CypherResult {
  records: readonly CypherRecord[];
}

type ParameterMap = { [key: string]: unknown };

function bindValue(value: unknown): unknown {
  if (typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value)) {
    return neo4j.int(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => bindValue(entry));
  }
  return value;
}

function bindParameters(parameters: Record<string, unknown>): ParameterMap {
  const output: ParameterMap = {};
  for (const [key, value] of Object.entries(parameters)) {
    output[key] = key === "skip" || key === "limit" || /^v\d+$/.test(key) ? bindValue(value) : value;
  }
  return output;
}

function columnsFor(
  rows: Record<string, unknown>[],
  requested: string[] | undefined,
): AdapterQueryResult["columns"] {
  const names =
    requested && requested.length > 0
      ? requested
      : rows.reduce<string[]>((collected, row) => {
          for (const key of Object.keys(row)) {
            if (!collected.includes(key)) {
              collected.push(key);
            }
          }
          return collected;
        }, []);
  return names.map((name) => ({ name, type: "unknown", nullable: true }));
}

function rowFrom(value: unknown, columns: string[] | undefined): Record<string, unknown> {
  const plain = toPlain(value);
  if (columns && columns.length > 0) {
    const values = Array.isArray(plain) ? plain : [];
    const row = plainRecord();
    columns.forEach((name, index) => {
      assignPlain(row, name, values[index] ?? null);
    });
    return row;
  }
  if (plain !== null && typeof plain === "object" && !Array.isArray(plain)) {
    return plain as Record<string, unknown>;
  }
  return plainRecord();
}

function nodeRow(record: CypherRecord): NodePropertyRow {
  const nodeType = toPlain(record.get("nodeType"));
  const propertyName = toPlain(record.get("propertyName"));
  const mandatory = toPlain(record.get("mandatory"));
  return {
    labels: labelsForNodeType(stringList(toPlain(record.get("nodeLabels"))), nodeType),
    propertyName: typeof propertyName === "string" ? propertyName : null,
    propertyTypes: stringList(toPlain(record.get("propertyTypes"))),
    mandatory: mandatory === true,
  };
}

function relationshipRow(record: CypherRecord): RelationshipPropertyRow {
  const relationshipType = toPlain(record.get("relType"));
  const propertyName = toPlain(record.get("propertyName"));
  const mandatory = toPlain(record.get("mandatory"));
  return {
    relationshipType: typeof relationshipType === "string" ? relationshipType : null,
    propertyName: typeof propertyName === "string" ? propertyName : null,
    propertyTypes: stringList(toPlain(record.get("propertyTypes"))),
    mandatory: mandatory === true,
  };
}

function strings(result: CypherResult, key: string): string[] {
  return result.records.flatMap((record) => {
    const value = toPlain(record.get(key));
    return typeof value === "string" ? [value] : [];
  });
}

function cleanNames(values: readonly string[]): string[] {
  return values.flatMap((value) => {
    const name = graphName(value);
    return name ? [name] : [];
  });
}

function createDriver(target: Neo4jTarget): Driver {
  return neo4j.driver(target.uri, neo4j.auth.basic(target.user, target.password), {
    connectionTimeout: 10_000,
    connectionAcquisitionTimeout: 10_000,
    maxTransactionRetryTime: 5_000,
    maxConnectionPoolSize: 5,
    telemetryDisabled: true,
    userAgent: "dash",
    logging: neo4j.logging.console("error"),
  });
}

export class Neo4jAdapter implements DataAdapter {
  readonly kind = "neo4j" as const;
  #driver: Driver;
  #database: string;
  #secrets: readonly string[];
  #closed = false;

  constructor(driver: Driver, database: string, secrets: readonly string[] = []) {
    this.#driver = driver;
    this.#database = database;
    this.#secrets = secrets;
  }

  static fromConfig(config: Neo4jConnectionConfig): Neo4jAdapter {
    const target = resolveNeo4jTarget(config);
    return new Neo4jAdapter(createDriver(target), target.database, secretsFrom(config, target.password));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.#run("RETURN 1 AS ok", {});
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Connected to Neo4j",
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
    try {
      const [labels, nodes, relationshipTypes, relationships] = await Promise.all([
        this.#run(LABEL_CYPHER, {}),
        this.#run(NODE_CYPHER, {}),
        this.#run(RELATIONSHIP_TYPE_CYPHER, {}),
        this.#run(RELATIONSHIP_CYPHER, {}),
      ]);
      return {
        kind: "neo4j",
        resources: buildSchema({
          labels: cleanNames(strings(labels, "label")),
          nodeRows: nodes.records.map((record) => nodeRow(record)),
          relationshipTypes: strings(relationshipTypes, "relationshipType"),
          relationshipRows: relationships.records.map((record) => relationshipRow(record)),
        }),
      };
    } catch (error) {
      throw this.#publicError(error);
    }
  }

  async query(input: AdapterQuery): Promise<AdapterQueryResult> {
    try {
      const compiled = compileRead(input);
      const result = await this.#run(compiled.text, bindParameters(compiled.parameters));
      const columns = input.columns?.filter((column) => column.length > 0);
      const requested = columns && columns.length > 0 ? columns : undefined;
      const rows = result.records.map((record) => rowFrom(record.get("row"), requested));
      const limit = compiled.parameters.limit;
      return {
        columns: columnsFor(rows, requested),
        rows,
        rowCount: rows.length,
        truncated: rows.length === limit,
      };
    } catch (error) {
      throw this.#publicError(error);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#driver.close();
  }

  async #run(text: string, parameters: ParameterMap): Promise<CypherResult> {
    const session = this.#driver.session({
      database: this.#database,
      defaultAccessMode: neo4j.session.READ,
    });
    try {
      return await session.run(text, parameters);
    } finally {
      await session.close();
    }
  }

  #message(error: unknown): string {
    const text = error instanceof Error ? error.message : "Connection failed";
    return scrubSecrets(text.length > 0 ? text : "Connection failed", this.#secrets);
  }

  #publicError(error: unknown): Error {
    if (error instanceof QueryValidationError) {
      return error;
    }
    return new Error(this.#message(error));
  }
}

export function createNeo4jAdapter(config: Neo4jConnectionConfig): Neo4jAdapter {
  return Neo4jAdapter.fromConfig(config);
}

export { neo4jPublicSummary, resolveNeo4jTarget };
