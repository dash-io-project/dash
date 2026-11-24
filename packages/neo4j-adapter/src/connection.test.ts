import { describe, expect, it } from "vitest";
import {
  neo4jPublicSummary,
  readNeo4jUri,
  resolveNeo4jTarget,
  scrubSecrets,
} from "./connection.ts";
import type { Neo4jConnectionConfig } from "@dash/core";

describe("resolveNeo4jTarget", () => {
  it("keeps the password out of the driver URI", () => {
    const target = resolveNeo4jTarget({
      kind: "neo4j",
      connectionString: "bolt://dash:p%40ss%20word@127.0.0.1:7687/neo4j",
    });
    expect(target.uri).toBe("bolt://127.0.0.1:7687");
    expect(target.uri).not.toContain("p%40ss");
    expect(target.password).toBe("p@ss word");
    expect(target.user).toBe("dash");
    expect(target.database).toBe("neo4j");
    expect(target.encrypted).toBe(false);
    expect(target.host).toBe("127.0.0.1");
    expect(target.port).toBe(7687);
  });

  it("accepts an encrypted routing URI and a default port", () => {
    const target = resolveNeo4jTarget({
      kind: "neo4j",
      connectionString: "NEO4J+S://reader:secret@db.example/analytics",
    });
    expect(target.uri).toBe("neo4j+s://db.example:7687");
    expect(target.encrypted).toBe(true);
    expect(target.database).toBe("analytics");
    expect(target.user).toBe("reader");
  });

  it("builds bolt or bolt+s from host fields", () => {
    expect(
      resolveNeo4jTarget({
        kind: "neo4j",
        host: "db.example",
        user: "dash",
        password: "secret",
      }),
    ).toMatchObject({
      uri: "bolt://db.example:7687",
      database: "neo4j",
      encrypted: false,
      port: 7687,
    });
    expect(
      resolveNeo4jTarget({
        kind: "neo4j",
        host: "::1",
        port: 17687,
        database: "analytics",
        user: "dash",
        password: "secret",
        encryption: true,
      }).uri,
    ).toBe("bolt+s://[::1]:17687");
    expect(
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: "bolt://dash:secret@[2001:db8::1]:7687",
      }).uri,
    ).toBe("bolt://[2001:db8::1]:7687");
  });

  it("rejects schemes that skip certificate checks without echoing the secret", () => {
    expect(() => readNeo4jUri("bolt+ssc://dash:super-secret@db.example:7687")).toThrow(
      /cannot disable certificate checks/,
    );
    expect(() => resolveNeo4jTarget({
      kind: "neo4j",
      connectionString: "neo4j+ssc://dash:super-secret@db.example",
    })).toThrow(/cannot disable certificate checks/);
    try {
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: "neo4j+ssc://dash:super-secret@db.example",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("super-secret");
    }
  });

  it("rejects driver parameters without echoing the secret or the parameter", () => {
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: "bolt://dash:super-secret@127.0.0.1:7687?trust=all",
      }),
    ).toThrow(/unsupported neo4j connection parameter/i);
    try {
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: "bolt://dash:super-secret@127.0.0.1:7687?trust=all#fragment",
      });
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret");
      expect((error as Error).message).not.toMatch(/trust/i);
      expect((error as Error).message).not.toContain("fragment");
    }
  });

  it("rejects a plaintext URI when encryption is required", () => {
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: "bolt://dash:secret@127.0.0.1:7687",
        encryption: true,
      }),
    ).toThrow(/encryption settings disagree/);
  });

  it("rejects disagreeing database names and invalid fields", () => {
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: "bolt://dash:secret@127.0.0.1:7687/neo4j",
        database: "other",
      }),
    ).toThrow(/database settings disagree/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: "http://dash:secret@127.0.0.1:7687",
      }),
    ).toThrow(/bolt:\/\//);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        host: "bad host",
        user: "dash",
        password: "secret",
      }),
    ).toThrow(/host is invalid/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        host: "bad..host",
        user: "dash",
        password: "secret",
      }),
    ).toThrow(/host is invalid/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        host: "   ",
        user: "dash",
        password: "secret",
      }),
    ).toThrow(/host is invalid/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        host: "db.example",
        database: "analytics-",
        user: "dash",
        password: "secret",
      }),
    ).toThrow(/database name is invalid/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: "bolt://dash@127.0.0.1:7687",
      }),
    ).toThrow(/password is required/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: `bolt://dash:secret@127.0.0.1/${"a".repeat(2100)}`,
      }),
    ).toThrow(/connection string is invalid/);
    expect(() => readNeo4jUri("bolt://dash:a%zz@127.0.0.1")).toThrow(/user is invalid|password is invalid|connection string is invalid/);
    expect(
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: "bolt+s://dash:secret@db.example/Analytics",
        database: "analytics",
        encryption: true,
      }),
    ).toMatchObject({ encrypted: true, database: "analytics" });
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        host: "db.example",
        port: 0,
        user: "dash",
        password: "secret",
      }),
    ).toThrow(/port is invalid/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        host: "db.example",
        database: "1bad",
        user: "dash",
        password: "secret",
      }),
    ).toThrow(/database name is invalid/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        host: "db.example",
        user: "dash",
      }),
    ).toThrow(/password is required/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        connectionString: "bolt://127.0.0.1:7687",
      }),
    ).toThrow(/user is required/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        host: "db.example",
        user: "bad\nuser",
        password: "secret",
      }),
    ).toThrow(/user is invalid/);
    expect(() =>
      resolveNeo4jTarget({
        kind: "neo4j",
        encryption: "yes",
      } as unknown as Neo4jConnectionConfig),
    ).toThrow(/encryption setting is invalid/);
  });
});

describe("neo4jPublicSummary", () => {
  it("reports the endpoint and omits the password", () => {
    const summary = neo4jPublicSummary({
      kind: "neo4j",
      host: "db.example",
      port: 7687,
      database: "analytics",
      user: "reader",
      password: "super-secret",
      encryption: true,
    });
    expect(summary).toEqual({
      host: "db.example",
      port: 7687,
      database: "analytics",
      user: "reader",
      encryption: true,
    });
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });

  it("returns an empty summary when the URI is invalid", () => {
    const summary = neo4jPublicSummary({
      kind: "neo4j",
      connectionString: "bolt://dash:super-secret@db.example?trust=all",
    });
    expect(summary).toEqual({ host: "", port: "", database: "", user: "", encryption: false });
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });
});

describe("scrubSecrets", () => {
  it("redacts the password and its encoded form", () => {
    const text = scrubSecrets("failed for p@ss and p%40ss in bolt://dash:p@ss@host", [
      "p@ss",
      "short",
    ]);
    expect(text).not.toContain("p@ss");
    expect(text).not.toContain("p%40ss");
    expect(text).toContain("[redacted]");
  });
});
