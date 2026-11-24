import { describe, expect, it } from "vitest";
import {
  cassandraPublicSummary,
  cassandraSession,
  parseCassandraConnectionString,
} from "./connection.ts";

describe("parseCassandraConnectionString", () => {
  it("parses a URI and applies the default port and data center", () => {
    expect(parseCassandraConnectionString("cassandra://dash:secret@db.example/analytics")).toEqual({
      host: "db.example",
      keyspace: "analytics",
      user: "dash",
      password: "secret",
    });
    expect(parseCassandraConnectionString("cassandra://dash:secret@127.0.0.1/dash?ssl=0").ssl).toBe(
      false,
    );
    const session = cassandraSession({
      kind: "cassandra",
      connectionString: "cassandra://dash:secret@db.example/analytics?ssl=true",
    });
    expect(session).toMatchObject({
      contactPoints: ["db.example"],
      port: 9042,
      keyspace: "analytics",
      localDataCenter: "datacenter1",
      user: "dash",
      ssl: true,
    });
  });

  it("lets explicit fields override the URI", () => {
    const session = cassandraSession({
      kind: "cassandra",
      connectionString: "cassandra://reader:secret@db.example:9042/analytics?dc=dc1&ssl=true",
      host: "127.0.0.1",
      port: 39042,
      keyspace: "dash",
      localDataCenter: "datacenter1",
      user: "dash",
      password: "dash",
      ssl: false,
    });
    expect(session).toEqual({
      contactPoints: ["127.0.0.1"],
      port: 39042,
      keyspace: "dash",
      localDataCenter: "datacenter1",
      user: "dash",
      password: "dash",
      ssl: false,
    });
  });

  it("rejects unsafe connection strings and does not echo secrets", () => {
    const secret = "super-secret";
    const cases = [
      `postgres://dash:${secret}@db.example/analytics`,
      `cassandra://dash:${secret}@db.example/analytics?options=1`,
      `cassandra://dash:${secret}@db.example/analytics?dc=dc1&dc=dc2`,
      `cassandra://dash:${secret}@not a host/analytics`,
      `cassandra://dash:${secret}@db.example/bad keyspace`,
      `cassandra://:${secret}@db.example/analytics`,
      "cassandra://dash:secret@db.example/analytics?ssl=maybe",
      "",
      `cassandra://dash:${secret}@db.example/analytics#frag`,
      `cassandra://dash:${secret}@db.example/analytics/extra`,
    ];
    for (const value of cases) {
      expect(() => parseCassandraConnectionString(value)).toThrow();
      try {
        parseCassandraConnectionString(value);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(secret);
        expect((error as Error).message).not.toMatch(/options/i);
      }
    }
    expect(() =>
      cassandraSession({
        kind: "cassandra",
        host: "not a host",
        user: "dash",
        password: secret,
      }),
    ).toThrow(/host/i);
    expect(() =>
      cassandraSession({
        kind: "cassandra",
        host: "db.example",
        port: 0,
      }),
    ).toThrow(/port/i);
    expect(() => cassandraSession({ kind: "cassandra" })).toThrow(/host is required/i);
  });
});

describe("cassandraPublicSummary", () => {
  it("omits the password for a valid config and a rejected URI", () => {
    const summary = cassandraPublicSummary({
      kind: "cassandra",
      host: "db.example",
      port: 9042,
      keyspace: "analytics",
      localDataCenter: "dc1",
      user: "reader",
      password: "super-secret",
      ssl: true,
    });
    expect(summary).toEqual({
      host: "db.example",
      port: 9042,
      keyspace: "analytics",
      localDataCenter: "dc1",
      user: "reader",
      ssl: true,
    });
    expect(JSON.stringify(summary)).not.toContain("super-secret");

    const malformed = cassandraPublicSummary({
      kind: "cassandra",
      connectionString: "cassandra://reader:super-secret@db.example/analytics?options=1",
    });
    expect(malformed).toEqual({
      host: "(connection string)",
      port: "",
      keyspace: "",
      localDataCenter: "",
      user: "",
      ssl: false,
    });
    expect(JSON.stringify(malformed)).not.toContain("super-secret");

    const badHost = cassandraPublicSummary({
      kind: "cassandra",
      host: "not a host",
      user: "reader",
      password: "super-secret",
    });
    expect(badHost.host).toBe("");
    expect(JSON.stringify(badHost)).not.toContain("super-secret");
    expect(JSON.stringify(badHost)).not.toContain("not a host");
  });
});
