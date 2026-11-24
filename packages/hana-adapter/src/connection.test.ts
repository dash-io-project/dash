import { QueryValidationError, type HanaConnectionConfig } from "@dash/core";
import { describe, expect, it } from "vitest";
import {
  hanaDriverOptions,
  hanaPublicSummary,
  hanaSession,
  parseHanaConnectionString,
} from "./connection.ts";

const SECRET = "super-secret";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("parseHanaConnectionString", () => {
  it("reads host, port, user, password, database, schema, and TLS flags", () => {
    expect(
      parseHanaConnectionString(
        "hana://reader:s3cret@hana.internal:39041/HXE?schema=ANALYTICS&encrypt=true&sslValidateCertificate=false",
      ),
    ).toEqual({
      host: "hana.internal",
      port: 39041,
      database: "HXE",
      schema: "ANALYTICS",
      user: "reader",
      password: "s3cret",
      encrypt: true,
      validateCertificate: false,
    });
  });

  it("defaults the port to 30015 and encrypts when the URI omits both", () => {
    expect(parseHanaConnectionString("hana://reader@hana.internal/HXE")).toEqual({
      host: "hana.internal",
      port: 30015,
      database: "HXE",
      user: "reader",
      encrypt: true,
      validateCertificate: true,
    });
  });

  it("decodes the password and brackets an IPv6 loopback host", () => {
    const session = parseHanaConnectionString("hana://reader:s%2F3cret@[::1]/HXE?encrypt=false");
    expect(session.password).toBe("s/3cret");
    expect(session.host).toBe("::1");
    expect(session.encrypt).toBe(false);
    expect(session.validateCertificate).toBe(false);
    expect(hanaDriverOptions(session).serverNode).toBe("[::1]:30015");
  });

  it("rejects a non-hana scheme without the password", () => {
    expect(() => parseHanaConnectionString(`postgres://reader:${SECRET}@localhost/HXE`)).toThrow(
      QueryValidationError,
    );
    try {
      parseHanaConnectionString(`postgres://reader:${SECRET}@localhost/HXE`);
    } catch (error) {
      expect(message(error)).toMatch(/hana:\/\//);
      expect(message(error)).not.toContain(SECRET);
    }
  });

  it("rejects an unknown query key and does not echo the key or the password", () => {
    const uri = `hana://reader:${SECRET}@hana.internal/HXE?traceFile=/tmp/hana.log`;
    expect(() => parseHanaConnectionString(uri)).toThrow(/Unsupported SAP HANA connection parameter/);
    try {
      parseHanaConnectionString(uri);
    } catch (error) {
      expect(message(error)).not.toContain("traceFile");
      expect(message(error)).not.toContain(SECRET);
      expect(message(error)).not.toContain("/tmp/hana.log");
    }
  });

  it("rejects an encrypt value that is not true or false", () => {
    expect(() => parseHanaConnectionString("hana://reader@hana.internal/HXE?encrypt=yes")).toThrow(
      /Invalid SAP HANA encrypt/,
    );
    expect(() =>
      parseHanaConnectionString("hana://reader@hana.internal/HXE?sslValidateCertificate=maybe"),
    ).toThrow(/Invalid SAP HANA sslValidateCertificate/);
  });

  it("rejects an empty URI, a URI with no user, and a URI that is too long", () => {
    expect(() => parseHanaConnectionString("   ")).toThrow(/connection string is required/);
    expect(() => parseHanaConnectionString("hana://hana.internal/HXE")).toThrow(/user is required/);
    expect(() => parseHanaConnectionString(`hana://reader@hana.internal/${"A".repeat(9000)}`)).toThrow(
      /too long/,
    );
  });

  it("reads a URI through hanaSession and keeps the password out of the summary", () => {
    const config: HanaConnectionConfig = {
      kind: "hana",
      connectionString: `hana://reader:${SECRET}@hana.internal/HXE?encrypt=false&sslValidateCertificate=true`,
    };
    expect(hanaSession(config)).toMatchObject({
      host: "hana.internal",
      user: "reader",
      password: SECRET,
      encrypt: false,
      validateCertificate: false,
    });
    expect(JSON.stringify(hanaPublicSummary(config))).not.toContain(SECRET);
  });

  it("rejects a repeated encrypt flag", () => {
    expect(() =>
      parseHanaConnectionString("hana://reader@hana.internal/HXE?encrypt=true&encrypt=false"),
    ).toThrow(/encrypt` is repeated/);
  });

  it("rejects a second path segment", () => {
    expect(() => parseHanaConnectionString("hana://reader@hana.internal/HXE/extra")).toThrow(
      /one database/,
    );
  });

  it("rejects a host that is not a DNS name, IPv4 address, or loopback", () => {
    expect(() => parseHanaConnectionString("hana://reader@not_a_host/HXE")).toThrow(
      /Invalid SAP HANA host/,
    );
    try {
      parseHanaConnectionString(`hana://reader:${SECRET}@not_a_host/HXE`);
    } catch (error) {
      expect(message(error)).not.toContain("not_a_host");
      expect(message(error)).not.toContain(SECRET);
    }
  });

  it("rejects a URI with a space and does not echo the password", () => {
    expect(() => parseHanaConnectionString(`hana://reader:${SECRET}@not a host/HXE`)).toThrow(
      /Invalid SAP HANA connection string/,
    );
    try {
      parseHanaConnectionString(`hana://reader:${SECRET}@not a host/HXE`);
    } catch (error) {
      expect(message(error)).not.toContain(SECRET);
    }
  });
});

describe("hanaSession", () => {
  it("requires a host and a user when no URI is set", () => {
    expect(() => hanaSession({ kind: "hana" })).toThrow(/host is required/);
    expect(() => hanaSession({ kind: "hana", host: "localhost" })).toThrow(/user is required/);
  });

  it("lets explicit fields replace URI values", () => {
    const session = hanaSession({
      kind: "hana",
      connectionString: `hana://uri-user:${SECRET}@uri.example:39041/URIDB?schema=URI&encrypt=false`,
      host: "Fields.Example",
      port: 30041,
      database: "FIELDS",
      user: "fields-user",
      password: "fields-secret",
      schema: "FIELD_SCHEMA",
      encrypt: true,
      sslValidateCertificate: false,
    });
    expect(session).toEqual({
      host: "fields.example",
      port: 30041,
      database: "FIELDS",
      schema: "FIELD_SCHEMA",
      user: "fields-user",
      password: "fields-secret",
      encrypt: true,
      validateCertificate: false,
    });
  });

  it("defaults encrypt and certificate checks to on", () => {
    const session = hanaSession({ kind: "hana", host: "localhost", user: "SYSTEM" });
    expect(session).toEqual({
      host: "localhost",
      port: 30015,
      user: "SYSTEM",
      encrypt: true,
      validateCertificate: true,
    });
  });

  it("turns certificate checks off when encrypt is off", () => {
    const session = hanaSession({
      kind: "hana",
      host: "localhost",
      user: "SYSTEM",
      encrypt: false,
      sslValidateCertificate: true,
    });
    expect(session.encrypt).toBe(false);
    expect(session.validateCertificate).toBe(false);
  });

  it("rejects a bad port, name, user, and overlong password without echoing them", () => {
    const cases: HanaConnectionConfig[] = [
      { kind: "hana", host: "localhost", user: "SYSTEM", port: 0 },
      { kind: "hana", host: "localhost", user: "SYSTEM", port: 65536 },
      { kind: "hana", host: "localhost", user: "SYSTEM", port: 3.5 },
      { kind: "hana", host: "localhost", user: "bad user" },
      { kind: "hana", host: "localhost", user: "SYSTEM", schema: "bad schema" },
      { kind: "hana", host: "localhost", user: "SYSTEM", database: "bad/name" },
      { kind: "hana", host: "localhost", user: "SYSTEM", password: "x".repeat(4097) },
    ];
    for (const config of cases) {
      expect(() => hanaSession(config)).toThrow(QueryValidationError);
      try {
        hanaSession(config);
      } catch (error) {
        expect(message(error)).not.toContain("bad user");
        expect(message(error)).not.toContain("bad schema");
        expect(message(error)).not.toContain("bad/name");
        expect(message(error)).not.toContain("x".repeat(20));
      }
    }
  });

  it("rejects a bad URI even when fields are also set", () => {
    expect(() =>
      hanaSession({
        kind: "hana",
        connectionString: `hana://reader:${SECRET}@hana.internal/HXE?traceFile=1`,
        host: "localhost",
        user: "SYSTEM",
      }),
    ).toThrow(/Unsupported SAP HANA connection parameter/);
  });
});

describe("hanaDriverOptions", () => {
  it("passes an allowlist of driver properties and no connection string", () => {
    const options = hanaDriverOptions(
      hanaSession({
        kind: "hana",
        host: "hana.internal",
        port: 30015,
        database: "HXE",
        schema: "ANALYTICS",
        user: "reader",
        password: SECRET,
        encrypt: true,
        sslValidateCertificate: true,
      }),
    );
    expect(options).toEqual({
      serverNode: "hana.internal:30015",
      uid: "reader",
      pwd: SECRET,
      databaseName: "HXE",
      currentSchema: "ANALYTICS",
      encrypt: "true",
      sslValidateCertificate: "true",
      connectTimeout: 10_000,
    });
    expect(Object.keys(options).sort()).toEqual([
      "connectTimeout",
      "currentSchema",
      "databaseName",
      "encrypt",
      "pwd",
      "serverNode",
      "sslValidateCertificate",
      "uid",
    ]);
  });

  it("omits the password, database, and schema when they are absent", () => {
    const options = hanaDriverOptions(
      hanaSession({ kind: "hana", host: "localhost", user: "SYSTEM", encrypt: false }),
    );
    expect(options).toEqual({
      serverNode: "localhost:30015",
      uid: "SYSTEM",
      encrypt: "false",
      sslValidateCertificate: "false",
      connectTimeout: 10_000,
    });
    expect(options).not.toHaveProperty("pwd");
    expect(options).not.toHaveProperty("databaseName");
    expect(options).not.toHaveProperty("currentSchema");
  });
});

describe("hanaPublicSummary", () => {
  it("reports connection facts and omits the password", () => {
    expect(
      hanaPublicSummary({
        kind: "hana",
        host: "hana.internal",
        port: 39041,
        database: "HXE",
        schema: "ANALYTICS",
        user: "reader",
        password: SECRET,
        encrypt: true,
      }),
    ).toEqual({
      host: "hana.internal",
      port: 39041,
      database: "HXE",
      schema: "ANALYTICS",
      user: "reader",
      encrypt: true,
    });
  });

  it("returns an empty summary for a bad URI and keeps the password out", () => {
    const summary = hanaPublicSummary({
      kind: "hana",
      connectionString: `hana://reader:${SECRET}@hana.internal/HXE?traceFile=/tmp/x`,
    });
    expect(summary).toEqual({
      host: "",
      port: "",
      database: "",
      schema: "",
      user: "",
      encrypt: true,
    });
    expect(JSON.stringify(summary)).not.toContain(SECRET);
  });
});
