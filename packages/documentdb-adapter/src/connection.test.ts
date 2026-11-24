import { Decimal128, Double, Int32, Long, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { scrubSecrets, toPlain } from "./adapter.ts";
import {
  documentDbCaCertificates,
  documentDbPublicSummary,
  documentDbSecrets,
  parseDocumentDbConnectionString,
  resolveDocumentDbTarget,
} from "./connection.ts";

const CUSTOM_CA = "-----BEGIN CERTIFICATE-----\nTESTCERT\n-----END CERTIFICATE-----\n";
const AWS_MARKER = "MIID/jCCAuagAwIBAgIQdOCSuA9psBpQd8EI368/0DANBgkqhkiG";

function caText(target: ReturnType<typeof resolveDocumentDbTarget>): string {
  const ca = target.options.ca;
  return Array.isArray(ca) ? ca.join("\n") : String(ca ?? "");
}

describe("resolveDocumentDbTarget", () => {
  it("keeps discrete credentials out of the URI and forces TLS", () => {
    const target = resolveDocumentDbTarget({
      kind: "documentdb",
      host: "cluster.us-east-1.docdb.amazonaws.com",
      port: 27017,
      database: "analytics",
      user: "reader",
      password: "s3cret",
      authSource: "admin",
      replicaSet: "rs0",
      readPreference: "secondaryPreferred",
    });
    expect(target.uri).toBe("mongodb://cluster.us-east-1.docdb.amazonaws.com:27017");
    expect(target.uri).not.toContain("s3cret");
    expect(target.database).toBe("analytics");
    expect(target.options.auth).toEqual({ username: "reader", password: "s3cret" });
    expect(target.options.authSource).toBe("admin");
    expect(target.options.tls).toBe(true);
    expect(target.options.retryWrites).toBe(false);
    expect(target.options.replicaSet).toBe("rs0");
    expect(target.options.readPreference).toBe("secondaryPreferred");
    expect(caText(target)).toContain(AWS_MARKER);
    expect(target.options.serverSelectionTimeoutMS).toBe(10_000);
    expect(target.summary).toMatchObject({
      host: "cluster.us-east-1.docdb.amazonaws.com",
      port: 27017,
      database: "analytics",
      user: "reader",
      tls: true,
      replicaSet: "rs0",
      readPreference: "secondaryPreferred",
    });
  });

  it("uses a custom CA bundle in place of the Amazon RDS bundle", () => {
    const target = resolveDocumentDbTarget({
      kind: "documentdb",
      host: "127.0.0.1",
      database: "dash",
      user: "dash",
      password: "dash",
      caBundle: `note\n${CUSTOM_CA}`,
    });
    expect(caText(target)).toBe(CUSTOM_CA.trim());
    expect(caText(target)).not.toContain(AWS_MARKER);
    expect(target.uri).toBe("mongodb://127.0.0.1:27017");
    expect(target.options.authSource).toBe("admin");
  });

  it("reads a connection string and rejects unsafe parameters", () => {
    const target = resolveDocumentDbTarget({
      kind: "documentdb",
      connectionString:
        "mongodb://reader:s3cret@cluster.us-east-1.docdb.amazonaws.com:27017/analytics?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&authSource=admin",
    });
    expect(target.database).toBe("analytics");
    expect(target.options.auth).toBeUndefined();
    expect(target.options.authSource).toBeUndefined();
    expect(target.options.tls).toBe(true);
    expect(target.options.retryWrites).toBe(false);
    expect(target.summary.user).toBe("reader");
    expect(target.summary.replicaSet).toBe("rs0");
    expect(parseDocumentDbConnectionString(target.uri).database).toBe("analytics");

    const replica = resolveDocumentDbTarget({
      kind: "documentdb",
      connectionString:
        "mongodb://reader:s3cret@h1:27017,h2:27017/analytics?tls=true&replicaSet=rs0&retryWrites=false",
    });
    expect(replica.database).toBe("analytics");
    expect(replica.summary.host).toBe("h1:27017,h2:27017");
    expect(replica.summary.port).toBeUndefined();
    expect(replica.options.authSource).toBe("admin");

    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: "mongodb+srv://reader:s3cret@cluster.example.net/analytics",
      }),
    ).toThrow(/mongodb:\/\//);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: "http://127.0.0.1/analytics",
      }),
    ).toThrow(/mongodb:\/\//);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString:
          "mongodb://reader:s3cret@127.0.0.1:27017/analytics?tls=false&retryWrites=false",
      }),
    ).toThrow(/cannot disable TLS/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString:
          "mongodb://reader:s3cret@127.0.0.1:27017/analytics?tlsAllowInvalidCertificates=true",
      }),
    ).toThrow(/TLS verification/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: "mongodb://reader:s3cret@127.0.0.1:27017/analytics?tlsCAFile=/tmp/ca.pem",
      }),
    ).toThrow(/certificate file path/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: "mongodb://reader:s3cret@127.0.0.1:27017/analytics?retryWrites=true",
      }),
    ).toThrow(/retryable writes/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: "mongodb://reader:s3cret@127.0.0.1:27017/analytics?loadBalanced=true",
      }),
    ).toThrow(/unsupported parameter/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString:
          "mongodb://reader:s3cret@127.0.0.1:27017/analytics?authMechanism=MONGODB-AWS",
      }),
    ).toThrow(/auth mechanism/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString:
          "mongodb://reader:s3cret@127.0.0.1:27017/analytics?directConnection=true&replicaSet=rs0",
      }),
    ).toThrow(/directConnection/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        host: "bad host",
        database: "dash",
      }),
    ).toThrow(/host/i);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        host: "127.0.0.1",
        port: 0,
        database: "dash",
      }),
    ).toThrow(/port/i);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        host: "127.0.0.1",
      }),
    ).toThrow(/database name is required/i);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: "mongodb://127.0.0.1:27017",
      }),
    ).toThrow(/database name is required/i);
  });

  it("rejects a CA bundle that contains a private key", () => {
    expect(() =>
      documentDbCaCertificates(
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n-----BEGIN CERTIFICATE-----\nA\n-----END CERTIFICATE-----",
      ),
    ).toThrow(/private key/i);
    expect(() => documentDbCaCertificates("not a certificate")).toThrow(/no certificate/i);
    expect(() => documentDbCaCertificates(`${"a".repeat(512 * 1024 + 1)}`)).toThrow(/invalid/i);
  });

  it("does not put the password or the CA bundle in the public summary", () => {
    const summary = documentDbPublicSummary({
      kind: "documentdb",
      host: "cluster.example.com",
      database: "analytics",
      user: "reader",
      password: "super-secret",
      caBundle: CUSTOM_CA,
    });
    expect(summary.tls).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("super-secret");
    expect(JSON.stringify(summary)).not.toContain("TESTCERT");
    expect(JSON.stringify(summary)).not.toContain("BEGIN CERTIFICATE");

    const fromUri = documentDbPublicSummary({
      kind: "documentdb",
      connectionString: "mongodb://reader:super-secret@h1:27017/events?tls=true&retryWrites=false",
    });
    expect(fromUri).toMatchObject({
      host: "h1",
      port: 27017,
      database: "events",
      user: "reader",
      tls: true,
    });
    expect(JSON.stringify(fromUri)).not.toContain("super-secret");

    const malformed = documentDbPublicSummary({
      kind: "documentdb",
      connectionString: "mongodb://reader:super-secret@h1/events?tlsCAFile=/tmp/ca.pem",
      caBundle: CUSTOM_CA,
    });
    expect(malformed.host).toBe("(connection string)");
    expect(JSON.stringify(malformed)).not.toContain("super-secret");
    expect(JSON.stringify(malformed)).not.toContain("TESTCERT");
    expect(JSON.stringify(malformed)).not.toContain("tlsCAFile");
  });

  it("collects secrets from the password and the connection string", () => {
    const secrets = documentDbSecrets({
      kind: "documentdb",
      connectionString: "mongodb://reader:s3cret@127.0.0.1:27017/analytics?tls=true",
      password: "other-secret",
    });
    expect(secrets).toContain("s3cret");
    expect(secrets).toContain("other-secret");
    expect(secrets.some((secret) => secret.includes("mongodb://"))).toBe(true);
  });

  it("rejects disagreeing settings and invalid names", () => {
    const base =
      "mongodb://reader:s3cret@127.0.0.1:27017/analytics?tls=true&replicaSet=rs0&readPreference=primary&authSource=admin&authMechanism=SCRAM-SHA-1&retryReads=true";
    expect(resolveDocumentDbTarget({ kind: "documentdb", connectionString: base }).options.tls).toBe(
      true,
    );
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: base,
        replicaSet: "rs1",
      }),
    ).toThrow(/replica set settings disagree/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: base,
        readPreference: "secondary",
      }),
    ).toThrow(/read preference settings disagree/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: base,
        authSource: "dash",
      }),
    ).toThrow(/auth source settings disagree/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        host: "127.0.0.1",
        database: "dash",
        replicaSet: "bad set",
      }),
    ).toThrow(/replica set name/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        host: "127.0.0.1",
        database: "dash",
        readPreference: "nearestest" as "nearest",
      }),
    ).toThrow(/read preference/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: "mongodb://reader:s3cret@127.0.0.1:27017/analytics?tls=true&tls=false",
      }),
    ).toThrow(/repeats a parameter/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: "mongodb://reader:s3cret@127.0.0.1:27017/analytics?ssl=false",
      }),
    ).toThrow(/cannot disable TLS/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: "mongodb://reader:s3cret@127.0.0.1:27017/analytics?retryWrites=yes",
      }),
    ).toThrow(/invalid boolean/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: "mongodb://:s3cret@127.0.0.1:27017/analytics",
      }),
    ).toThrow(/connection string is invalid/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        host: "127.0.0.1",
        database: "dash",
        password: "s3cret",
      }),
    ).toThrow(/user is required/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        host: "127.0.0.1",
        database: "bad/name",
      }),
    ).toThrow(/database name is invalid/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        host: "127.0.0.1",
        database: "dash",
        user: "reader",
        password: "bad\u0000secret",
      }),
    ).toThrow(/password is invalid/);
    expect(() => resolveDocumentDbTarget({ kind: "documentdb" })).toThrow(/host is required/);
    expect(() =>
      resolveDocumentDbTarget({
        kind: "documentdb",
        connectionString: `mongodb://127.0.0.1/${"a".repeat(2100)}`,
      }),
    ).toThrow(/too long/);
    expect(() =>
      documentDbCaCertificates(`-----BEGIN CERTIFICATE-----\nA\u0000B\n-----END CERTIFICATE-----`),
    ).toThrow(/invalid/i);

    const overridden = resolveDocumentDbTarget({
      kind: "documentdb",
      connectionString: "mongodb://127.0.0.1:27018/events?directConnection=true&retryWrites=false",
      database: "analytics",
      readPreference: "nearest",
    });
    expect(overridden.database).toBe("analytics");
    expect(overridden.options.readPreference).toBe("nearest");
    expect(overridden.options.directConnection).toBeUndefined();
  });
});

describe("scrubSecrets", () => {
  it("removes the password and the raw connection string", () => {
    const message = scrubSecrets(
      "connect failed for mongodb://dash:s3cret@127.0.0.1/dash using s3cret",
      ["s3cret", "mongodb://dash:s3cret@127.0.0.1/dash"],
    );
    expect(message).not.toContain("s3cret");
    expect(message).toContain("[redacted]");
    const encoded = scrubSecrets("failed for p%40ss", ["p@ss"]);
    expect(encoded).not.toContain("p%40ss");
    expect(encoded).toContain("[redacted]");
  });
});

describe("toPlain", () => {
  it("turns BSON values into JSON values", () => {
    const id = new ObjectId("656e6f5f6e6f5f6e6f5f6e6f");
    const plain = toPlain({
      _id: id,
      when: new Date("2026-01-02T03:04:05.000Z"),
      nested: { amount: { _bsontype: "Int32", toString: () => "10" } },
      tags: [id],
      flag: true,
      missing: undefined,
      empty: null,
    }) as {
      _id: string;
      when: string;
      nested: { amount: number };
      tags: string[];
      flag: boolean;
      missing: null;
      empty: null;
    };
    expect(plain._id).toBe("656e6f5f6e6f5f6e6f5f6e6f");
    expect(plain.when).toBe("2026-01-02T03:04:05.000Z");
    expect(plain.nested.amount).toBe(10);
    expect(plain.tags).toEqual(["656e6f5f6e6f5f6e6f5f6e6f"]);
    expect(plain.flag).toBe(true);
    expect(plain.missing).toBeNull();
    expect(plain.empty).toBeNull();
  });

  it("keeps integers that do not fit in a safe number, and decimal scale", () => {
    expect(toPlain(Long.fromString("9007199254740993"))).toBe("9007199254740993");
    expect(toPlain(Long.fromString("10"))).toBe(10);
    expect(toPlain(new Int32(7))).toBe(7);
    expect(toPlain(new Double(1.5))).toBe(1.5);
    expect(toPlain(new Double(Number.NaN))).toBe("NaN");
    expect(toPlain(Decimal128.fromString("9007199254740993.5"))).toBe("9007199254740993.5");
    expect(toPlain(Decimal128.fromString("10.50"))).toBe("10.50");
    expect(toPlain(Decimal128.fromString("10"))).toBe(10);
    expect(toPlain(10n)).toBe(10);
    expect(toPlain(9007199254740993n)).toBe("9007199254740993");
    expect(toPlain(Symbol("x"))).toBe("Symbol(x)");
    expect(toPlain({ _bsontype: "MinKey", toString: () => "MinKey" })).toBe("MinKey");
  });
});
