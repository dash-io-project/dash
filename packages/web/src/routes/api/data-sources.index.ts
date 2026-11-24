import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isResponse, requireUser } from "~/server/guard";
import { error, isAdmin, json, readJson } from "~/server/http";
import {
  createDataSource,
  listDataSources,
} from "~/server/services/data-sources";
import { testConnectionConfig } from "~/server/services/query";

const configSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("postgres"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("mysql"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("mariadb"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("db2"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    schema: z.string().optional(),
    ssl: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("hana"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    schema: z.string().optional(),
    encrypt: z.boolean().optional(),
    sslValidateCertificate: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("redshift"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("cockroachdb"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
    sslCa: z.string().optional(),
    cluster: z.string().optional(),
  }),
  z.object({
    kind: z.literal("snowflake"),
    connectionString: z.string().optional(),
    account: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    warehouse: z.string().optional(),
    database: z.string().optional(),
    schema: z.string().optional(),
    role: z.string().optional(),
    authenticator: z.string().optional(),
  }),
  z.object({
    kind: z.literal("mongodb"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    authSource: z.string().optional(),
    tls: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("documentdb"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    authSource: z.string().optional(),
    replicaSet: z.string().max(128).optional(),
    readPreference: z
      .enum(["primary", "primaryPreferred", "secondary", "secondaryPreferred", "nearest"])
      .optional(),
    caBundle: z.string().max(512 * 1024).optional(),
  }),
  z.object({
    kind: z.literal("databricks"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    httpPath: z.string().optional(),
    token: z.string().optional(),
    catalog: z.string().optional(),
    schema: z.string().optional(),
    apiEndpoint: z.string().optional(),
  }),
  z.object({
    kind: z.literal("stripe"),
    connectionString: z.string().optional(),
    apiKey: z.string().optional(),
    apiEndpoint: z.string().optional(),
  }),
  z.object({
    kind: z.literal("opensearch"),
    node: z.string().optional(),
    connectionString: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    region: z.string().optional(),
    service: z.enum(["es", "aoss"]).optional(),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    sessionToken: z.string().optional(),
  }),
  z.object({
    kind: z.literal("bigquery"),
    projectId: z.string().min(1),
    dataset: z.string().optional(),
    location: z.string().optional(),
    apiEndpoint: z.string().optional(),
    credentials: z
      .object({
        client_email: z.string().min(1),
        private_key: z.string().min(1),
      })
      .optional(),
  }),
]);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  config: configSchema,
});

export const Route = createFileRoute("/api/data-sources/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request, "read");
        if (isResponse(auth)) {
          return auth;
        }
        return json({ dataSources: await listDataSources() });
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request, "write");
        if (isResponse(auth)) {
          return auth;
        }
        if (!isAdmin(auth.user)) {
          return error(403, "Admin role required", "forbidden");
        }
        const parsed = createSchema.safeParse(await readJson(request));
        if (!parsed.success) {
          return error(400, "Invalid data source payload", "invalid_body");
        }
        const test = await testConnectionConfig(parsed.data.config);
        if (!test.ok) {
          return error(400, test.message, "connection_failed");
        }
        const dataSource = await createDataSource({
          name: parsed.data.name,
          description: parsed.data.description ?? "",
          config: parsed.data.config,
          createdBy: auth.user.id,
        });
        return json({ dataSource }, { status: 201 });
      },
    },
  },
});
