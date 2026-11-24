import { QueryValidationError } from "@dash/core";
import { describe, expect, it } from "vitest";
import {
  db2ConnectionString,
  db2PublicSummary,
  db2Session,
  parseDb2ConnectionString,
} from "./connection.ts";

const secret = "super-secret;HOSTNAME=evil.example";

describe("parseDb2ConnectionString", () => {
  it("parses a URI into a session and braces a password that contains a semicolon", () => {
    const session = parseDb2ConnectionString(
      `db2://db2inst1:${encodeURIComponent(secret)}@DB.Example.COM:50010/dash?schema=ANALYTICS&ssl=true`,
    );
    expect(session).toEqual({
      host: "db.example.com",
      port: 50010,
      database: "DASH",
      user: "db2inst1",
      password: secret,
      schema: "ANALYTICS",
      ssl: true,
    });
    const text = db2ConnectionString(session);
    expect(text.startsWith("DATABASE=DASH;HOSTNAME=db.example.com;PORT=50010;")).toBe(true);
    expect(text.split("PWD=")[1]?.split(";Security=")[0]).toBe(`{${secret}}`);
    expect(text).toContain("Security=SSL");
    expect(text).toContain("ConnectTimeout=10");
    expect(text).toContain("QueryTimeout=60");
    expect(text.indexOf("HOSTNAME=")).toBe(text.lastIndexOf("HOSTNAME=db.example.com"));
  });

  it("uses the default port and omits a missing password", () => {
    const session = parseDb2ConnectionString("db2://db2inst1@localhost/SAMPLE");
    expect(session.port).toBe(50000);
    expect(session.ssl).toBe(false);
    expect(session.password).toBeUndefined();
    expect(db2ConnectionString(session)).not.toContain("PWD=");
    expect(db2ConnectionString(session)).not.toContain("Security=");
  });

  it("accepts loopback addresses and a braced brace in the password", () => {
    expect(parseDb2ConnectionString("db2://u:p@[::1]/DASH").host).toBe("::1");
    expect(parseDb2ConnectionString("db2://u:p@127.0.0.1/DASH").host).toBe("127.0.0.1");
    const session = db2Session({
      kind: "db2",
      host: "localhost",
      database: "dash",
      user: "db2inst1",
      password: "a}b",
    });
    expect(db2ConnectionString(session)).toContain("PWD={a}}b}");
  });

  it.each([
    ["", "required"],
    ["   ", "required"],
    ["not a uri", "Invalid Db2 connection string"],
    ["postgres://db2inst1:secret@localhost/DASH", "db2://"],
    ["db2://db2inst1:secret@localhost/DASH#frag", "Invalid Db2 connection string"],
    ["db2:///DASH", "Invalid Db2 host"],
    ["db2://db2inst1@localhost", "Invalid Db2 database"],
    ["db2://localhost/DASH", "user is required"],
    ["db2://db2inst1@localhost/analytics", "Invalid Db2 database"],
    ["db2://db2inst1@localhost/DASH/extra", "Invalid Db2 database"],
    ["db2://db2inst1@localhost:0/DASH", "Invalid Db2 port"],
    ["db2://db2inst1@localhost:65536/DASH", "Invalid Db2 connection string"],
    ["db2://db2inst1@not_a_host/DASH", "Invalid Db2 host"],
    ["db2://db2inst1@127.0.0.01/DASH", "Invalid Db2 host"],
    ["db2://db2inst1@256.0.0.1/DASH", "Invalid Db2 host"],
    ["db2://bad user@localhost/DASH", "Invalid Db2 user"],
    [`db2://db2inst1@localhost/DASH?ssl=true&ssl=false`, "repeated"],
    ["db2://db2inst1@localhost/DASH?ssl=maybe", "Invalid Db2 ssl parameter"],
    ["db2://db2inst1@localhost/DASH?schema=1bad", "Invalid Db2 schema"],
    [`db2://db2inst1:${"a".repeat(4097)}@localhost/DASH`, "Invalid Db2 password"],
    ["db2://db2inst1:secret@localhost/DASH?debug=1", "Unsupported Db2 connection parameter"],
    [`db2://${"a".repeat(9000)}`, "too long"],
    ["db2://db2inst1:a%ZZb@localhost/DASH", "Invalid Db2 connection string"],
  ])("rejects %j", (value, message) => {
    expect(() => parseDb2ConnectionString(value)).toThrow(QueryValidationError);
    try {
      parseDb2ConnectionString(value);
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      expect(text).toMatch(new RegExp(message, "i"));
      expect(text).not.toContain("secret");
      expect(text).not.toContain("debug");
    }
  });
});

describe("db2Session", () => {
  it("lets explicit fields override the URI", () => {
    const session = db2Session({
      kind: "db2",
      connectionString: "db2://db2inst1:from-uri@uri.example:50000/DASH?schema=OLD&ssl=true",
      host: "override.example",
      port: 50011,
      database: "sample",
      user: "reader",
      password: "from-field",
      schema: "NEW",
      ssl: false,
    });
    expect(session).toMatchObject({
      host: "override.example",
      port: 50011,
      database: "SAMPLE",
      user: "reader",
      password: "from-field",
      schema: "NEW",
      ssl: false,
    });
  });

  it("keeps the URI password when the field password is empty", () => {
    const session = db2Session({
      kind: "db2",
      connectionString: "db2://db2inst1:from-uri@localhost/DASH?ssl=1",
      password: "  ",
    });
    expect(session.password).toBe("from-uri");
    expect(session.ssl).toBe(true);
  });

  it("accepts ssl=false and ssl=0", () => {
    expect(parseDb2ConnectionString("db2://u:p@localhost/DASH?ssl=false").ssl).toBe(false);
    expect(parseDb2ConnectionString("db2://u:p@localhost/DASH?ssl=0").ssl).toBe(false);
  });

  it("rejects a missing host, a bad port, and a password with a newline", () => {
    expect(() => db2Session({ kind: "db2", database: "DASH", user: "db2inst1" })).toThrow(
      "Invalid Db2 host",
    );
    expect(() =>
      db2Session({ kind: "db2", host: "localhost", port: 0, database: "DASH", user: "db2inst1" }),
    ).toThrow("Invalid Db2 port");
    expect(() =>
      db2Session({
        kind: "db2",
        host: "localhost",
        database: "DASH",
        user: "db2inst1",
        password: "line\nbreak",
      }),
    ).toThrow("Invalid Db2 password");
  });
});

describe("db2PublicSummary", () => {
  it("omits the password", () => {
    const summary = db2PublicSummary({
      kind: "db2",
      host: "db.example",
      database: "dash",
      user: "db2inst1",
      password: secret,
      schema: "ANALYTICS",
      ssl: true,
    });
    expect(summary).toEqual({
      host: "db.example",
      port: 50000,
      database: "DASH",
      user: "db2inst1",
      schema: "ANALYTICS",
      ssl: true,
    });
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });

  it("uses an empty schema when the session has none", () => {
    expect(
      db2PublicSummary({
        kind: "db2",
        host: "db.example",
        database: "DASH",
        user: "db2inst1",
      }),
    ).toMatchObject({ schema: "", port: 50000 });
  });

  it("rejects a session that has no database or user", () => {
    expect(() => db2Session({ kind: "db2", host: "localhost", user: "db2inst1" })).toThrow(
      "Invalid Db2 database",
    );
    expect(() => db2Session({ kind: "db2", host: "localhost", database: "DASH" })).toThrow(
      "Invalid Db2 user",
    );
  });

  it("returns empty fields for a malformed URI", () => {
    const summary = db2PublicSummary({
      kind: "db2",
      connectionString: "db2://db2inst1:super-secret@localhost/DASH?debug=1",
    });
    expect(summary).toEqual({
      host: "",
      port: "",
      database: "",
      user: "",
      schema: "",
      ssl: false,
    });
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });
});
