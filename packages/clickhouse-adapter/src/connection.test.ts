import { QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import {
  clickhouseEndpoint,
  clickhouseSession,
  parseClickHouseConnectionString,
} from "./connection.ts";

describe("ClickHouse connection strings", () => {
  it("parses a clickhouse URI and turns on TLS when ssl is omitted", () => {
    const session = parseClickHouseConnectionString(
      "clickhouse://dash:secret@example.clickhouse.cloud:8443/analytics",
    );
    expect(session).toEqual({
      host: "example.clickhouse.cloud",
      port: 8443,
      database: "analytics",
      user: "dash",
      password: "secret",
      ssl: true,
    });
  });

  it("defaults the HTTPS port when the URI does not mention a port", () => {
    const session = parseClickHouseConnectionString(
      "clickhouse://dash:secret@example.clickhouse.cloud/analytics",
    );
    expect(session.port).toBe(8443);
    expect(session.ssl).toBe(true);
  });

  it("uses plaintext HTTP when ssl is false or the scheme is http", () => {
    const flagged = parseClickHouseConnectionString(
      "clickhouse://dash:secret@127.0.0.1/dash?ssl=false",
    );
    expect(flagged).toMatchObject({ port: 8123, ssl: false, host: "127.0.0.1" });
    const http = parseClickHouseConnectionString("http://dash:secret@127.0.0.1/dash");
    expect(http).toMatchObject({ port: 8123, ssl: false });
    const https = parseClickHouseConnectionString(
      "https://dash:secret@example.clickhouse.cloud/analytics",
    );
    expect(https).toMatchObject({ port: 8443, ssl: true });
  });

  it("lets an explicit ssl flag force encryption on or off", () => {
    const forced = clickhouseSession({
      kind: "clickhouse",
      connectionString: "clickhouse://dash:secret@127.0.0.1/dash?ssl=false",
      ssl: true,
    });
    expect(forced.ssl).toBe(true);
    expect(forced.port).toBe(8443);
    const disabled = clickhouseSession({
      kind: "clickhouse",
      connectionString: "https://dash:secret@example.clickhouse.cloud:8443/analytics",
      ssl: false,
    });
    expect(disabled.ssl).toBe(false);
    expect(disabled.port).toBe(8443);
  });

  it("lets explicit fields replace the same fields on a connection string", () => {
    const session = clickhouseSession({
      kind: "clickhouse",
      connectionString: "clickhouse://dash:secret@example.clickhouse.cloud/analytics",
      host: "other.example.com",
      database: "warehouse",
    });
    expect(session.host).toBe("other.example.com");
    expect(session.database).toBe("warehouse");
    expect(session.user).toBe("dash");
    expect(session.password).toBe("secret");
    expect(session.ssl).toBe(true);
    expect(session.port).toBe(8443);
  });

  it("accepts a hyphenated database and an IPv6 loopback host", () => {
    const session = parseClickHouseConnectionString(
      "clickhouse://reader:secret@[::1]/analytics-db?ssl=0",
    );
    expect(session.user).toBe("reader");
    expect(session.database).toBe("analytics-db");
    expect(session.host).toBe("::1");
    expect(session.ssl).toBe(false);
    expect(session.port).toBe(8123);
    expect(clickhouseEndpoint(session)).toBe("http://[::1]:8123");
    const publicAddress = parseClickHouseConnectionString(
      "clickhouse://reader:secret@[2001:db8::1]/analytics?ssl=0",
    );
    expect(publicAddress.host).toBe("2001:db8::1");
    expect(clickhouseEndpoint(publicAddress)).toBe("http://[2001:db8::1]:8123");
  });

  it("rejects a stray bracket instead of deleting it", () => {
    expect(() =>
      clickhouseSession({ kind: "clickhouse", host: "localhost]", database: "dash", user: "dash" }),
    ).toThrow(/invalid clickhouse host/i);
    expect(() =>
      clickhouseSession({ kind: "clickhouse", host: "[localhost]", database: "dash", user: "dash" }),
    ).toThrow(/invalid clickhouse host/i);
  });

  it("rejects driver settings and keeps the password out of the error", () => {
    expect(() =>
      parseClickHouseConnectionString(
        "clickhouse://dash:super-secret@example.clickhouse.cloud/analytics?readonly=0",
      ),
    ).toThrow(QueryValidationError);
    try {
      parseClickHouseConnectionString(
        "clickhouse://dash:super-secret@example.clickhouse.cloud/analytics?readonly=0",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(QueryValidationError);
      expect(String(error instanceof Error ? error.message : "")).toMatch(
        /unsupported clickhouse connection parameter/i,
      );
      expect(String(error instanceof Error ? error.message : "")).not.toMatch(/readonly/i);
      expect(String(error instanceof Error ? error.message : "")).not.toContain("super-secret");
    }
  });

  it("rejects a scheme and ssl flag that disagree", () => {
    expect(() =>
      parseClickHouseConnectionString("https://dash:secret@example.clickhouse.cloud/analytics?ssl=false"),
    ).toThrow(/disagree/);
    expect(() => parseClickHouseConnectionString("http://dash:secret@127.0.0.1/dash?ssl=true")).toThrow(
      /disagree/,
    );
  });

  it("rejects a host that is not a hostname without echoing it", () => {
    expect(() =>
      clickhouseSession({
        kind: "clickhouse",
        host: "not a host",
        database: "dash",
        user: "dash",
        password: "super-secret",
      }),
    ).toThrow(/invalid clickhouse host/i);
    try {
      clickhouseSession({
        kind: "clickhouse",
        host: "not a host",
        database: "dash",
        user: "dash",
        password: "super-secret",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain("not a host");
      expect(message).not.toContain("super-secret");
    }
  });
});
