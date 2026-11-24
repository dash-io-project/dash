import net from "node:net";
import tls from "node:tls";
import type { PoolConfig } from "mariadb";

function trustedCertificates(): string[] {
  return tls.getCACertificates("default");
}

/**
 * TLS options for the MariaDB driver.
 * The driver skips chain checks for a self-signed certificate when no CA is set.
 * Pin the default CA list so the chain check stays on.
 */
export function mariadbTls(enabled: boolean, host?: string): PoolConfig["ssl"] {
  if (!enabled) {
    return undefined;
  }
  // The published ssl type omits servername. The driver reads it for the host check.
  // An IP host must not be a TLS server name.
  const servername = host && net.isIP(host) === 0 ? host : undefined;
  return {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    ca: trustedCertificates(),
    ...(servername ? { servername } : {}),
  } as PoolConfig["ssl"];
}
