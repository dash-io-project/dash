import { QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import {
  assertCockroachCa,
  assertCockroachHost,
  cockroachPublicSummary,
  cockroachSession,
  parseCockroachConnectionString,
} from "./connection.ts";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

describe("CockroachDB connection strings", () => {
  it("parses a cockroachdb URI and keeps the cluster option", () => {
    const session = parseCockroachConnectionString(
      "cockroachdb://dash:secret%2B1@DB.Example.com.:26257/analytics?sslmode=require&options=--cluster%3Dapp-cluster",
    );
    expect(session).toEqual({
      host: "db.example.com",
      port: 26257,
      database: "analytics",
      user: "dash",
      password: "secret+1",
      ssl: true,
      tls: "require",
      cluster: "app-cluster",
    });
  });

  it("accepts postgres schemes and defaults the port and TLS", () => {
    const postgres = parseCockroachConnectionString("postgres://dash:secret@127.0.0.1/dash");
    expect(postgres.port).toBe(26257);
    expect(postgres.tls).toBe("verify-full");
    expect(postgres.ssl).toBe(true);
    expect(postgres.password).toBe("secret");
    const postgresql = parseCockroachConnectionString(
      "postgresql://reader@localhost/warehouse?sslmode=verify-ca",
    );
    expect(postgresql.user).toBe("reader");
    expect(postgresql.password).toBeUndefined();
    expect(postgresql.tls).toBe("verify-ca");
    expect(parseCockroachConnectionString("cockroach://dash:secret@[::1]/dash?ssl=1").host).toBe("::1");
  });

  it("lets an explicit ssl flag force encryption on or off", () => {
    const forced = cockroachSession({
      kind: "cockroachdb",
      connectionString: "cockroachdb://dash:secret@127.0.0.1/dash?sslmode=disable",
      ssl: true,
    });
    expect(forced.tls).toBe("verify-full");
    const kept = cockroachSession({
      kind: "cockroachdb",
      connectionString: "cockroachdb://dash:secret@127.0.0.1/dash?sslmode=require",
      ssl: true,
    });
    expect(kept.tls).toBe("require");
    const disabled = cockroachSession({
      kind: "cockroachdb",
      connectionString: "cockroachdb://dash:secret@127.0.0.1/dash?sslmode=verify-full",
      ssl: false,
    });
    expect(disabled.tls).toBe("off");
    expect(disabled.ssl).toBe(false);
  });

  it("lets explicit fields replace the same fields on a connection string", () => {
    const session = cockroachSession({
      kind: "cockroachdb",
      connectionString: "cockroachdb://dash:secret@db.example.com/analytics?sslmode=require&options=--cluster=old-name",
      host: "other.example.com",
      port: 26258,
      database: "warehouse",
      user: "reader",
      password: "next",
      cluster: "new-name",
      sslCa: PEM,
    });
    expect(session).toMatchObject({
      host: "other.example.com",
      port: 26258,
      database: "warehouse",
      user: "reader",
      password: "next",
      cluster: "new-name",
      tls: "require",
      sslCa: PEM,
    });
  });

  it("builds a session from fields and defaults TLS", () => {
    const session = cockroachSession({
      kind: "cockroachdb",
      host: "localhost",
      database: "dash",
      user: "root",
    });
    expect(session.port).toBe(26257);
    expect(session.tls).toBe("verify-full");
    expect(session.password).toBeUndefined();
    expect(session.cluster).toBeUndefined();
  });

  it("rejects driver options and keeps the password out of the error", () => {
    const uri = "cockroachdb://dash:super-secret@db.example.com/analytics?options=-csearch_path";
    expect(() => parseCockroachConnectionString(uri)).toThrow(/Unsupported CockroachDB connection parameter/);
    try {
      parseCockroachConnectionString(uri);
    } catch (error) {
      expect(error).toBeInstanceOf(QueryValidationError);
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain("super-secret");
      expect(message).not.toContain("search_path");
    }
  });

  it("rejects a bad host, port, database, user, cluster, and certificate", () => {
    expect(() => assertCockroachHost("not a host")).toThrow(/Invalid CockroachDB host/);
    expect(() => assertCockroachHost("01.2.3.4")).toThrow(/Invalid CockroachDB host/);
    expect(() => assertCockroachHost("256.1.1.1")).toThrow(/Invalid CockroachDB host/);
    expect(() => assertCockroachHost(`${"a".repeat(254)}`)).toThrow(/Invalid CockroachDB host/);
    expect(assertCockroachHost("127.0.0.1")).toBe("127.0.0.1");
    expect(() =>
      cockroachSession({ kind: "cockroachdb", host: "not a host", database: "dash", user: "dash", password: "super-secret" }),
    ).toThrow(/Invalid CockroachDB host/);
    expect(() => cockroachSession({ kind: "cockroachdb", database: "dash", user: "dash" })).toThrow(
      /Invalid CockroachDB host/,
    );
    expect(() =>
      cockroachSession({ kind: "cockroachdb", host: "db.example.com", port: 0, database: "dash", user: "dash" }),
    ).toThrow(/Invalid CockroachDB port/);
    expect(() =>
      cockroachSession({ kind: "cockroachdb", host: "db.example.com", port: 65536, database: "dash", user: "dash" }),
    ).toThrow(/Invalid CockroachDB port/);
    expect(() =>
      cockroachSession({ kind: "cockroachdb", host: "db.example.com", database: "bad name", user: "dash" }),
    ).toThrow(/Invalid CockroachDB database/);
    expect(() => cockroachSession({ kind: "cockroachdb", host: "db.example.com", user: "dash" })).toThrow(
      /Invalid CockroachDB database/,
    );
    expect(() => cockroachSession({ kind: "cockroachdb", host: "db.example.com", database: "dash" })).toThrow(
      /Invalid CockroachDB user/,
    );
    expect(() =>
      cockroachSession({ kind: "cockroachdb", host: "db.example.com", database: "dash", user: "bad user" }),
    ).toThrow(/Invalid CockroachDB user/);
    expect(() =>
      cockroachSession({
        kind: "cockroachdb",
        host: "db.example.com",
        database: "dash",
        user: "dash",
        cluster: "Bad_Name",
      }),
    ).toThrow(/Invalid CockroachDB cluster/);
    expect(() =>
      cockroachSession({
        kind: "cockroachdb",
        host: "db.example.com",
        database: "dash",
        user: "dash",
        cluster: "a--b",
      }),
    ).toThrow(/Invalid CockroachDB cluster/);
    expect(() => assertCockroachCa("-----BEGIN PRIVATE KEY-----\nabc")).toThrow(/CA certificate/);
    expect(() => assertCockroachCa("   ")).toThrow(/CA certificate/);
    expect(() => assertCockroachCa("-----BEGIN CERTIFICATE-----\nMIIB")).toThrow(/CA certificate/);
    expect(() => assertCockroachCa("not a certificate")).toThrow(/CA certificate/);
    expect(() => assertCockroachCa(`-----BEGIN CERTIFICATE-----\n${"A".repeat(70_000)}\n-----END CERTIFICATE-----`)).toThrow(
      /CA certificate/,
    );
  });

  it("rejects malformed connection strings without echoing secrets", () => {
    const cases = [
      "",
      "   ",
      "not a url",
      "mysql://dash:super-secret@db.example.com/dash",
      "cockroachdb://dash:super-secret@db.example.com/dash#frag",
      "cockroachdb://db.example.com/dash",
      "cockroachdb://dash:super-secret@/dash",
      "cockroachdb:///dash",
      "cockroachdb://dash:secret@db.example.com",
      "cockroachdb://dash:super-secret@db.example.com/dash/extra",
      "cockroachdb://dash:super-secret@db.example.com/bad%20name",
      "cockroachdb://dash:super-secret@db.example.com/dash?sslmode=allow",
      "cockroachdb://dash:super-secret@db.example.com/dash?ssl=maybe",
      "cockroachdb://dash:super-secret@db.example.com/dash?ssl=true&sslmode=disable",
      "cockroachdb://dash:super-secret@db.example.com/dash?sslmode=require&sslmode=disable",
      "cockroachdb://dash:super-secret@db.example.com/dash?debug=1",
      `cockroachdb://dash:${"p".repeat(4097)}@db.example.com/dash`,
      "cockroachdb://dash:super%secret@db.example.com/dash",
      "a".repeat(8193),
    ];
    for (const value of cases) {
      expect(() => parseCockroachConnectionString(value)).toThrow(QueryValidationError);
      try {
        parseCockroachConnectionString(value);
      } catch (error) {
        expect(error instanceof Error ? error.message : "").not.toContain("super-secret");
      }
    }
    expect(() => parseCockroachConnectionString("cockroachdb://dash:secret@db.example.com/dash?ssl=false")).not.toThrow();
    expect(parseCockroachConnectionString("cockroachdb://dash:secret@db.example.com/dash?ssl=0").tls).toBe("off");
    expect(
      parseCockroachConnectionString("cockroachdb://dash:secret@db.example.com/dash?ssl=true&sslmode=verify-full").tls,
    ).toBe("verify-full");
  });

  it("summarizes a source without the password or the CA", () => {
    expect(
      cockroachPublicSummary({
        kind: "cockroachdb",
        connectionString:
          "cockroachdb://reader:super-secret@db.example.com:26257/analytics?sslmode=verify-full&options=--cluster%3Dapp-cluster",
        sslCa: PEM,
      }),
    ).toEqual({
      host: "db.example.com",
      port: 26257,
      database: "analytics",
      user: "reader",
      ssl: true,
      cluster: "app-cluster",
      customCa: true,
    });
    const broken = cockroachPublicSummary({
      kind: "cockroachdb",
      connectionString: "cockroachdb://reader:super-secret@db.example.com/analytics?options=-c",
    });
    expect(broken).toEqual({
      host: "",
      port: "",
      database: "",
      user: "",
      ssl: false,
      cluster: "",
      customCa: false,
    });
    expect(JSON.stringify(broken)).not.toContain("super-secret");
    expect(JSON.stringify(cockroachPublicSummary({ kind: "cockroachdb", sslCa: PEM }))).not.toContain("MIIB");
    expect(
      cockroachPublicSummary({
        kind: "cockroachdb",
        host: "db.example.com",
        database: "dash",
        user: "dash",
        ssl: false,
      }),
    ).toEqual({
      host: "db.example.com",
      port: 26257,
      database: "dash",
      user: "dash",
      ssl: false,
      cluster: "",
      customCa: false,
    });
  });
});
