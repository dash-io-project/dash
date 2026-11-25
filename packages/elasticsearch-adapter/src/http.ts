import type { ElasticsearchSession } from "./connection.ts";

const MAX_BODY = 8_000_000;
const REQUEST_TIMEOUT_MS = 10_000;

const MAX_PATH = 3_500;
/** Path for index and alias names. The caller needs `view_index_metadata`. */
export const RESOLVE_INDEX = "/_resolve/index/*?expand_wildcards=open,hidden";
/** Any authenticated user can call this path. It needs no cluster privilege. */
export const AUTHENTICATE = "/_security/_authenticate";
const MAPPING_BATCH =
  /^\/[a-z][a-z0-9_-]{0,254}(?:,[a-z][a-z0-9_-]{0,254}){0,199}\/_mapping$/;
const SEARCH = /^\/[a-z][a-z0-9_-]{0,254}\/_search$/;

export class ElasticsearchHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ElasticsearchHttpError";
    this.status = status;
  }
}

export async function elasticsearchRequest(
  session: ElasticsearchSession,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<unknown> {
  assertPath(path, init.method);
  // Compare parsed origins. `https://host:443` and `https://host` are the same
  // origin, and the URL serializer omits a default port.
  const url = new URL(path, session.origin);
  if (url.origin !== new URL(session.origin).origin) {
    throw new Error("Elasticsearch request failed");
  }
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (init.fetchImpl ?? fetch)(url, {
      method: init.method,
      redirect: "manual",
      signal,
      headers: {
        Authorization: session.authorization,
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    throw scrubbed(error, session, timeout, init.signal);
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new ElasticsearchHttpError(response.status, "Elasticsearch refused a redirect");
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new ElasticsearchHttpError(
      response.status,
      response.status === 401
        ? "Elasticsearch rejected the credentials"
        : "Elasticsearch denied permission",
    );
  }
  let payload: unknown;
  try {
    payload = await readJson(response);
  } catch (error) {
    throw scrubbed(error, session, timeout, init.signal);
  }
  if (response.status === 401) {
    throw new ElasticsearchHttpError(401, scrub("Elasticsearch rejected the credentials", session.secrets));
  }
  if (!response.ok) {
    throw new ElasticsearchHttpError(response.status, scrub(errorMessage(payload), session.secrets));
  }
  return payload;
}

function assertPath(path: string, method: "GET" | "POST"): void {
  if (path.length > MAX_PATH || path.includes("//") || path.includes("\\") || path.includes("\0")) {
    throw new Error("Elasticsearch request failed");
  }
  if (method === "GET" && (path === "/" || path === AUTHENTICATE || path === RESOLVE_INDEX || MAPPING_BATCH.test(path))) {
    return;
  }
  if (method === "POST" && SEARCH.test(path)) {
    return;
  }
  throw new Error("Elasticsearch request failed");
}

function errorMessage(body: unknown): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.length > 0 && error.length < 300) {
      return error;
    }
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const reason = (error as { reason?: unknown }).reason;
      if (typeof reason === "string" && reason.length > 0 && reason.length < 300) {
        return reason;
      }
    }
  }
  return "Elasticsearch request failed";
}

function scrubbed(
  error: unknown,
  session: ElasticsearchSession,
  timeout: AbortSignal,
  client?: AbortSignal,
): Error {
  if (error instanceof ElasticsearchHttpError) {
    return new ElasticsearchHttpError(error.status, scrub(error.message, session.secrets));
  }
  if (error instanceof Error && /Elasticsearch (response|request|returned)/.test(error.message)) {
    return new Error(scrub(error.message, session.secrets));
  }
  if (client?.aborted) {
    return new Error("Elasticsearch client is closed");
  }
  if (timeout.aborted) {
    return new Error("Elasticsearch request timed out");
  }
  return new Error("Elasticsearch request failed");
}

export function scrub(message: string, secrets: readonly string[]): string {
  const unique = [...new Set(secrets.filter((secret) => secret.length >= 3))];
  unique.sort((left, right) => right.length - left.length);
  let text = message;
  for (const secret of unique) {
    text = text.split(secret).join("[redacted]");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret && encoded.length >= 3) {
      text = text.split(encoded).join("[redacted]");
    }
  }
  return text.slice(0, 500);
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error("Elasticsearch response exceeded the size limit");
    }
    chunks.push(value);
  }
  if (size === 0) {
    return null;
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(quoteUnsafeIntegers(text)) as unknown;
  } catch {
    throw new Error("Elasticsearch returned an unexpected response");
  }
}

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

/** Keep integers past 2^53 as strings. JSON.parse cannot represent them. */
export function quoteUnsafeIntegers(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      out += character;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      out += character;
      continue;
    }
    if (character !== "-" && (character < "0" || character > "9")) {
      out += character;
      continue;
    }
    let end = index;
    if (text[end] === "-") {
      end += 1;
    }
    const digitsAt = end;
    while (end < text.length && text[end]! >= "0" && text[end]! <= "9") {
      end += 1;
    }
    const exponent = end < text.length && (text[end] === "e" || text[end] === "E");
    const fraction = end < text.length && text[end] === ".";
    if (exponent || fraction || end === digitsAt) {
      while (end < text.length && /[0-9eE+.-]/.test(text[end]!)) {
        end += 1;
      }
      out += text.slice(index, end);
      index = end - 1;
      continue;
    }
    const token = text.slice(index, end);
    const digits = text.slice(digitsAt, end);
    const numeric = BigInt(token);
    const absolute = numeric < 0n ? -numeric : numeric;
    if (digits.length > 15 && absolute > MAX_SAFE_INTEGER) {
      out += `"${token}"`;
    } else {
      out += token;
    }
    index = end - 1;
  }
  return out;
}
