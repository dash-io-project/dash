import { describe, expect, it } from "vitest";
import { isOracleCloudHost, oracleSession } from "./connection.ts";

const CLOUD = "db.adb.us-ashburn-1.oraclecloud.com";
const SERVICE = "db_high.adb.oraclecloud.com";

describe("oracleSession", () => {
  it("reads an oracle URL", () => {
    const session = oracleSession({
      kind: "oracle",
      connectionString: "oracle://reader:s3cret@db.internal:1521/FREEPDB1",
    });
    expect(session).toMatchObject({
      host: "db.internal",
      port: 1521,
      service: "FREEPDB1",
      user: "reader",
      password: "s3cret",
      ssl: false,
      cloud: false,
      connectString: "db.internal:1521/FREEPDB1",
    });
  });

  it("reads a JDBC service URL and a JDBC SID URL", () => {
    const service = oracleSession({
      kind: "oracle",
      connectionString: "jdbc:oracle:thin:reader/s3cret@//db.internal:1521/FREEPDB1",
    });
    expect(service.connectString).toBe("db.internal:1521/FREEPDB1");
    expect(service.user).toBe("reader");

    const sid = oracleSession({
      kind: "oracle",
      connectionString: "jdbc:oracle:thin:@db.internal:1521:ORCL",
      user: "reader",
      password: "s3cret",
    });
    expect(sid.sid).toBe("ORCL");
    expect(sid.service).toBeUndefined();
    expect(sid.connectString).toBe(
      "(description=(address=(protocol=tcp)(host=db.internal)(port=1521))(connect_data=(sid=ORCL)))",
    );
  });

  it("rebuilds a TLS connect string from a descriptor and forces verification", () => {
    const session = oracleSession({
      kind: "oracle",
      connectionString: `(description=(retry_count=20)(retry_delay=3)(address=(protocol=tcps)(port=1522)(host=${CLOUD}))(connect_data=(service_name=${SERVICE}))(security=(ssl_server_dn_match=yes)))`,
      user: "reader",
      password: "s3cret",
    });
    expect(session).toMatchObject({
      host: CLOUD,
      port: 1522,
      service: SERVICE,
      ssl: true,
      cloud: true,
    });
    expect(session.connectString).toBe(
      `tcps://${CLOUD}:1522/${SERVICE}?ssl_server_dn_match=yes`,
    );
    expect(session.connectString).not.toContain("s3cret");
  });

  it("requires TLS for an Oracle Cloud host", () => {
    const session = oracleSession({
      kind: "oracle",
      host: CLOUD,
      database: SERVICE,
      user: "reader",
      password: "s3cret",
    });
    expect(session.ssl).toBe(true);
    expect(session.port).toBe(1522);
    expect(session.connectString).toBe(
      `tcps://${CLOUD}:1522/${SERVICE}?ssl_server_dn_match=yes`,
    );
    expect(() =>
      oracleSession({
        kind: "oracle",
        host: CLOUD,
        database: SERVICE,
        user: "reader",
        password: "s3cret",
        ssl: false,
      }),
    ).toThrow(/TLS/);
  });

  it("lets explicit fields replace the same parts of a URL", () => {
    const session = oracleSession({
      kind: "oracle",
      connectionString: "oracle://reader:s3cret@db.internal/FREEPDB1?ssl=true",
      host: "10.0.0.8",
      port: 1522,
      database: "APP",
      user: "analyst",
      password: "other-secret",
    });
    expect(session).toMatchObject({
      host: "10.0.0.8",
      port: 1522,
      service: "APP",
      user: "analyst",
      password: "other-secret",
      ssl: true,
      connectString: "tcps://10.0.0.8:1522/APP?ssl_server_dn_match=yes",
    });
  });

  it("turns TLS on when the descriptor asks for server-name verification", () => {
    const session = oracleSession({
      kind: "oracle",
      connectionString:
        "(description=(address=(protocol=tcp)(host=db.internal)(port=1521))(connect_data=(service_name=FREEPDB1))(security=(ssl_server_dn_match=yes)))",
      user: "reader",
      password: "s3cret",
    });
    expect(session.ssl).toBe(true);
    expect(session.connectString).toBe(
      "tcps://db.internal:1521/FREEPDB1?ssl_server_dn_match=yes",
    );
  });

  it("turns TLS on for an Easy Connect string that only sets server-name verification", () => {
    const session = oracleSession({
      kind: "oracle",
      connectionString: "db.internal:1521/FREEPDB1?ssl_server_dn_match=yes",
      user: "reader",
      password: "s3cret",
    });
    expect(session.ssl).toBe(true);
    expect(session.connectString).toBe(
      "tcps://db.internal:1521/FREEPDB1?ssl_server_dn_match=yes",
    );
  });

  it("reads an Easy Connect string", () => {
    const session = oracleSession({
      kind: "oracle",
      connectionString: "tcps://db.internal:2484/FREEPDB1?ssl_server_dn_match=yes",
      user: "reader",
      password: "s3cret",
    });
    expect(session).toMatchObject({
      host: "db.internal",
      port: 2484,
      service: "FREEPDB1",
      ssl: true,
      connectString: "tcps://db.internal:2484/FREEPDB1?ssl_server_dn_match=yes",
    });
  });

  it("rejects a disabled server-name check and an unknown parameter", () => {
    expect(() =>
      oracleSession({
        kind: "oracle",
        connectionString:
          "(description=(address=(protocol=tcps)(host=db.internal)(port=2484))(connect_data=(service_name=FREEPDB1))(security=(ssl_server_dn_match=no)))",
        user: "reader",
        password: "s3cret",
      }),
    ).toThrow(/server name verification/);
    expect(() =>
      oracleSession({
        kind: "oracle",
        connectionString: "oracle://reader:s3cret@db.internal/FREEPDB1?wallet_location=/tmp",
      }),
    ).toThrow(/Unsupported Oracle connection parameter/);
  });

  it("rejects a non-oracle scheme without the password", () => {
    expect(() =>
      oracleSession({
        kind: "oracle",
        connectionString: "postgres://reader:super-secret@localhost/dash",
      }),
    ).toThrow(/oracle:\/\//);
    try {
      oracleSession({
        kind: "oracle",
        connectionString: "postgres://reader:super-secret@localhost/dash",
      });
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret");
    }
  });

  it("rejects a missing service name and an invalid host", () => {
    expect(() =>
      oracleSession({
        kind: "oracle",
        host: "db.internal",
        user: "reader",
        password: "s3cret",
      }),
    ).toThrow(/service name/);
    expect(() =>
      oracleSession({
        kind: "oracle",
        host: "not a host",
        database: "FREEPDB1",
        user: "reader",
        password: "s3cret",
      }),
    ).toThrow(/host/);
  });

  it("recognizes Oracle Cloud hosts", () => {
    expect(isOracleCloudHost(CLOUD)).toBe(true);
    expect(isOracleCloudHost("db.internal")).toBe(false);
  });
});
