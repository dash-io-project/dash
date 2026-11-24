export type AdapterKind = "sql" | "warehouse" | "document" | "saas" | "graph";

export type Adapter = {
  id: string;
  name: string;
  kind: AdapterKind;
  /** One short line that says what the adapter connects to. */
  note: string;
};

/** Data source adapters that ship today. ClickHouse is planned and is not in this list. */
export const adapters: readonly Adapter[] = [
  { id: "postgres", name: "Postgres", kind: "sql", note: "Relational database" },
  { id: "cockroachdb", name: "CockroachDB", kind: "sql", note: "Distributed SQL database" },
  { id: "mysql", name: "MySQL", kind: "sql", note: "Relational database" },
  { id: "mariadb", name: "MariaDB", kind: "sql", note: "Relational database" },
  { id: "db2", name: "IBM Db2", kind: "sql", note: "Relational database" },
  { id: "hana", name: "SAP HANA", kind: "sql", note: "Relational database" },
  {
    id: "snowflake",
    name: "Snowflake",
    kind: "warehouse",
    note: "Cloud warehouse",
  },
  { id: "mongodb", name: "MongoDB", kind: "document", note: "Document database" },
  {
    id: "documentdb",
    name: "Amazon DocumentDB",
    kind: "document",
    note: "Document database",
  },
  {
    id: "bigquery",
    name: "Google BigQuery",
    kind: "warehouse",
    note: "Cloud warehouse",
  },
  {
    id: "databricks",
    name: "Databricks SQL",
    kind: "warehouse",
    note: "Lakehouse SQL",
  },
  {
    id: "redshift",
    name: "Amazon Redshift",
    kind: "warehouse",
    note: "Cloud warehouse",
  },
  { id: "stripe", name: "Stripe", kind: "saas", note: "Payments and billing" },
  { id: "opensearch", name: "Amazon OpenSearch", kind: "document", note: "Search and analytics" },
  { id: "couchbase", name: "Couchbase", kind: "document", note: "Document database" },
  { id: "neo4j", name: "Neo4j", kind: "graph", note: "Graph database" },
];

export const adapterCount = adapters.length;
