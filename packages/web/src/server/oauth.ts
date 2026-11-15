import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { API_TOKEN_SCOPES, type ApiTokenScope, publicTokenPrefix } from "@dash/core";
import { generateApiToken, hashSecret, randomId, safeEqualHex } from "./crypto.ts";
import {
  apiTokens,
  nowIso,
  oauthClients,
  oauthCodes,
  type OAuthClientDoc,
} from "./db.ts";
import { bearerToken } from "./http.ts";

/**
 * OAuth 2.1 authorization server for MCP clients. It follows the MCP
 * authorization spec: protected resource metadata (RFC 9728), authorization
 * server metadata (RFC 8414), dynamic client registration (RFC 7591), and the
 * authorization code grant with PKCE S256. Each approval creates one agent.
 * The agent is an `api_tokens` record with `kind: "oauth"`.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** An agent stops after 90 days without a refresh. */
export const AGENT_TTL_MS = 90 * 86_400_000;
const CODE_TTL_MS = 5 * 60_000;
const REFRESH_TOKEN_PREFIX = "dash_refresh_";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BLOCKED_SCHEMES = new Set([
  "about:",
  "blob:",
  "data:",
  "file:",
  "ftp:",
  "javascript:",
  "vbscript:",
  "ws:",
  "wss:",
]);
const HOST_PATTERN = /^(\[[A-Fa-f0-9:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/;
/** A base64url SHA-256 digest. */
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const MAX_TOKEN_BODY = 16_384;

export type OAuthResult = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

function oauthError(status: number, error: string, description: string): OAuthResult {
  return { status, body: { error, error_description: description } };
}

/**
 * Headers for responses that MCP clients read. A browser-based client needs
 * CORS. These endpoints do not use cookies, so a wildcard origin is safe.
 */
export const OAUTH_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-max-age": "86400",
};

export function oauthResponse(result: OAuthResult): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: {
      ...OAUTH_CORS_HEADERS,
      "cache-control": "no-store",
      pragma: "no-cache",
      ...result.headers,
    },
  });
}

export function oauthPreflight(): Response {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}

function firstValue(header: string | null): string | undefined {
  return header?.split(",")[0]?.trim() || undefined;
}

/**
 * The address that clients use to reach Dash. `DASH_PUBLIC_URL` wins. Without
 * it, Dash reads `X-Forwarded-Proto` and `X-Forwarded-Host` from the reverse
 * proxy. The Cloudflare Worker sets both. Behind a proxy, the Node server
 * sees plain `http`. Without these headers, the advertised URLs do not match
 * the URL that the client used.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.DASH_PUBLIC_URL?.trim();
  if (configured) {
    if (!URL.canParse(configured)) {
      throw new Error("DASH_PUBLIC_URL must be an absolute URL");
    }
    return new URL(configured).origin;
  }
  const url = new URL(request.url);
  const proto = firstValue(request.headers.get("x-forwarded-proto"))?.toLowerCase();
  const host = firstValue(request.headers.get("x-forwarded-host"));
  const protocol = proto === "https" || proto === "http" ? proto : url.protocol.slice(0, -1);
  const authority = host && HOST_PATTERN.test(host) ? host : url.host;
  return new URL(`${protocol}://${authority}`).origin;
}

export function mcpResourceUrl(request: Request): string {
  return `${publicOrigin(request)}/mcp`;
}

/** RFC 8707 resource indicator. Dash has one protected resource: the MCP endpoint. */
function isMcpResource(value: string, request: Request): boolean {
  const origin = publicOrigin(request);
  const normalized = value.replace(/\/+$/, "");
  return normalized === `${origin}/mcp` || normalized === origin;
}

export function protectedResourceMetadata(request: Request) {
  const origin = publicOrigin(request);
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...API_TOKEN_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Dash",
  };
}

export function authorizationServerMetadata(request: Request) {
  const origin = publicOrigin(request);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    scopes_supported: [...API_TOKEN_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
  };
}

/**
 * The `WWW-Authenticate` challenge on a 401 from `/mcp`. The MCP spec uses it
 * to point the client at the protected resource metadata.
 */
export function withMcpChallenge(request: Request, response: Response): Response {
  if (response.status !== 401) {
    return response;
  }
  const metadata = `${publicOrigin(request)}/.well-known/oauth-protected-resource/mcp`;
  const challenge = bearerToken(request)
    ? `Bearer error="invalid_token", resource_metadata="${metadata}"`
    : `Bearer resource_metadata="${metadata}"`;
  const headers = new Headers(response.headers);
  headers.set("www-authenticate", challenge);
  headers.set("access-control-expose-headers", "www-authenticate");
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Accept https, http on a loopback host (RFC 8252 section 7.3), and a
 * private-use scheme for a native app (RFC 8252 section 7.1).
 */
export function parseRedirectUri(value: string): URL | undefined {
  if (value.includes("#") || !URL.canParse(value)) {
    return undefined;
  }
  const url = new URL(value);
  if (url.username || url.password) {
    return undefined;
  }
  if (url.protocol === "https:") {
    return url.host ? url : undefined;
  }
  if (url.protocol === "http:") {
    return LOOPBACK_HOSTS.has(url.hostname) ? url : undefined;
  }
  return BLOCKED_SCHEMES.has(url.protocol) ? undefined : url;
}

/** Exact match. A loopback redirect can use a different port (RFC 8252 section 7.3). */
function redirectMatches(registered: string, requested: string): boolean {
  if (registered === requested) {
    return true;
  }
  const left = parseRedirectUri(registered);
  const right = parseRedirectUri(requested);
  if (!left || !right || left.protocol !== "http:" || right.protocol !== "http:") {
    return false;
  }
  return (
    left.hostname === right.hostname &&
    left.pathname === right.pathname &&
    left.search === right.search
  );
}

const registrationSchema = z.object({
  redirect_uris: z.array(z.string().max(2_000)).min(1).max(10),
  client_name: z.string().trim().max(100).optional(),
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_post", "client_secret_basic"])
    .optional(),
  grant_types: z.array(z.string().max(100)).max(10).optional(),
  response_types: z.array(z.string().max(100)).max(10).optional(),
});

/** RFC 7591 dynamic client registration. The endpoint is public, as the MCP spec expects. */
export async function registerClient(input: unknown): Promise<OAuthResult> {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) {
    return oauthError(400, "invalid_client_metadata", "The client metadata is not valid.");
  }
  const data = parsed.data;
  const invalid = data.redirect_uris.find((uri) => !parseRedirectUri(uri));
  if (invalid !== undefined) {
    return oauthError(
      400,
      "invalid_redirect_uri",
      "Each redirect URI must use https, http on a loopback host, or an app scheme, with no fragment.",
    );
  }
  if (data.response_types && data.response_types.some((type) => type !== "code")) {
    return oauthError(400, "invalid_client_metadata", "Only the code response type is supported.");
  }
  if (
    data.grant_types &&
    !data.grant_types.every((grant) => grant === "authorization_code" || grant === "refresh_token")
  ) {
    return oauthError(
      400,
      "invalid_client_metadata",
      "Only the authorization_code and refresh_token grants are supported.",
    );
  }
  // RFC 7591 section 2: the default method is client_secret_basic.
  const method = data.token_endpoint_auth_method ?? "client_secret_basic";
  const secret = method === "none" ? null : randomBytes(32).toString("base64url");
  const client: OAuthClientDoc = {
    _id: randomId(),
    name: data.client_name || "MCP client",
    redirectUris: data.redirect_uris,
    tokenEndpointAuthMethod: method,
    secretHash: secret ? hashSecret(secret) : null,
    createdAt: nowIso(),
  };
  await (await oauthClients()).insertOne(client);
  return {
    status: 201,
    body: {
      client_id: client._id,
      client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: method,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    },
  };
}

export interface AuthorizationRequest {
  client: OAuthClientDoc;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  /** Known scopes that the client asked for. Unknown scopes are ignored. */
  requestedScopes: ApiTokenScope[];
}

export type AuthorizationCheck =
  | { ok: true; request: AuthorizationRequest }
  | { ok: false; message: string; redirectTo?: string };

function withParams(target: string, params: Record<string, string | null>): string {
  const url = new URL(target);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) {
      url.searchParams.set(key, value);
    }
  }
  return url.href;
}

/**
 * Validate an authorization request. A bad client or redirect URI is shown to
 * the user, and Dash does not redirect (RFC 6749 section 4.1.2.1). Other
 * errors go back to the client.
 */
export async function checkAuthorizationRequest(
  query: URLSearchParams,
  request: Request,
): Promise<AuthorizationCheck> {
  const clientId = query.get("client_id") ?? "";
  const client = clientId ? await (await oauthClients()).findOne({ _id: clientId }) : null;
  if (!client) {
    return { ok: false, message: "Dash does not know this agent. Connect the agent again." };
  }
  const redirectUri = query.get("redirect_uri") ?? "";
  if (!redirectUri || !client.redirectUris.some((uri) => redirectMatches(uri, redirectUri))) {
    return { ok: false, message: "The agent sent a redirect address that it did not register." };
  }
  const state = query.get("state");
  const fail = (error: string, message: string): AuthorizationCheck => ({
    ok: false,
    message,
    redirectTo: withParams(redirectUri, { error, error_description: message, state }),
  });
  if (query.get("response_type") !== "code") {
    return fail("unsupported_response_type", "The response_type must be code.");
  }
  const codeChallenge = query.get("code_challenge") ?? "";
  if (!CODE_CHALLENGE.test(codeChallenge) || query.get("code_challenge_method") !== "S256") {
    return fail("invalid_request", "The request must use PKCE with the S256 method.");
  }
  const resource = query.get("resource");
  if (resource !== null && !isMcpResource(resource, request)) {
    return fail("invalid_target", "The resource must be the Dash MCP URL.");
  }
  const requested = (query.get("scope") ?? "").split(" ");
  return {
    ok: true,
    request: {
      client,
      redirectUri,
      codeChallenge,
      state,
      requestedScopes: API_TOKEN_SCOPES.filter((scope) => requested.includes(scope)),
    },
  };
}

/** Create the agent and a single-use code. Return the client redirect. */
export async function approveAuthorization(input: {
  request: AuthorizationRequest;
  userId: string;
  workspaceId: string;
  name: string;
  write: boolean;
}): Promise<string> {
  const { client, redirectUri, codeChallenge, state } = input.request;
  const now = Date.now();
  const tokenId = randomId();
  await (await apiTokens()).insertOne({
    _id: tokenId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    name: input.name,
    kind: "oauth",
    clientId: client._id,
    clientName: client.name,
    // The unique index needs a value. Nobody holds a token with this hash.
    tokenHash: hashSecret(randomBytes(32).toString("base64url")),
    prefix: "",
    scopes: input.write ? ["read", "write", "mcp"] : ["read", "mcp"],
    expiresAt: new Date(now + AGENT_TTL_MS).toISOString(),
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date(now).toISOString(),
  });
  const code = randomBytes(32).toString("base64url");
  await (await oauthCodes()).insertOne({
    _id: randomId(),
    codeHash: hashSecret(code),
    clientId: client._id,
    tokenId,
    redirectUri,
    codeChallenge,
    expiresAt: new Date(now + CODE_TTL_MS),
    usedAt: null,
    createdAt: new Date(now).toISOString(),
  });
  return withParams(redirectUri, { code, state });
}

export function denyAuthorization(request: AuthorizationRequest): string {
  return withParams(request.redirectUri, {
    error: "access_denied",
    error_description: "The user did not create the agent.",
    state: request.state,
  });
}

async function readTokenParams(request: Request): Promise<URLSearchParams | undefined> {
  const text = await request.text();
  if (text.length > MAX_TOKEN_BODY) {
    return undefined;
  }
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    return new URLSearchParams(text);
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const params = new URLSearchParams();
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") {
        params.set(key, item);
      }
    }
    return params;
  } catch {
    return undefined;
  }
}

function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function basicCredentials(request: Request): { id: string; secret: string } | undefined {
  const match = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization")?.trim() ?? "");
  if (!match?.[1]) {
    return undefined;
  }
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const index = decoded.indexOf(":");
  if (index === -1) {
    return undefined;
  }
  return {
    id: decodeCredential(decoded.slice(0, index)),
    secret: decodeCredential(decoded.slice(index + 1)),
  };
}

async function authenticateClient(
  request: Request,
  params: URLSearchParams,
): Promise<OAuthClientDoc | OAuthResult> {
  const basic = basicCredentials(request);
  const bodyId = params.get("client_id");
  if (basic && bodyId && bodyId !== basic.id) {
    return oauthError(400, "invalid_request", "The client_id values do not match.");
  }
  const clientId = basic?.id ?? bodyId;
  const client = clientId ? await (await oauthClients()).findOne({ _id: clientId }) : null;
  const rejected: OAuthResult = {
    ...oauthError(401, "invalid_client", "Client authentication failed."),
    ...(basic ? { headers: { "www-authenticate": 'Basic realm="dash"' } } : {}),
  };
  if (!client) {
    return rejected;
  }
  if (client.secretHash) {
    const secret = basic?.secret ?? params.get("client_secret");
    if (!secret || !safeEqualHex(hashSecret(secret), client.secretHash)) {
      return rejected;
    }
  }
  return client;
}

/** Give the agent a new access token and refresh token. Return undefined when the agent cannot receive them. */
async function issueAgentTokens(
  filter: Record<string, unknown>,
  clientId: string,
): Promise<OAuthResult | undefined> {
  const accessToken = generateApiToken();
  const refreshToken = `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = Date.now();
  const row = await (await apiTokens()).findOneAndUpdate(
    {
      ...filter,
      kind: "oauth",
      clientId,
      revokedAt: null,
      expiresAt: { $gt: new Date(now).toISOString() },
    },
    {
      $set: {
        tokenHash: hashSecret(accessToken),
        refreshTokenHash: hashSecret(refreshToken),
        prefix: publicTokenPrefix(accessToken),
        accessTokenExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
        expiresAt: new Date(now + AGENT_TTL_MS).toISOString(),
      },
    },
    { returnDocument: "after" },
  );
  if (!row) {
    return undefined;
  }
  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: row.scopes.join(" "),
    },
  };
}

async function revokeAgent(tokenId: string): Promise<void> {
  await (await apiTokens()).updateOne(
    { _id: tokenId, revokedAt: null },
    { $set: { revokedAt: nowIso() } },
  );
}

async function exchangeCode(
  params: URLSearchParams,
  client: OAuthClientDoc,
): Promise<OAuthResult> {
  const code = params.get("code");
  const verifier = params.get("code_verifier");
  if (!code || !verifier) {
    return oauthError(400, "invalid_request", "The code and code_verifier are required.");
  }
  const invalid = oauthError(
    400,
    "invalid_grant",
    "The authorization code is not valid, has expired, or was already used.",
  );
  const codes = await oauthCodes();
  const row = await codes.findOne({ codeHash: hashSecret(code) });
  const redirectUri = params.get("redirect_uri");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  // Check the request before the code is used up. A wrong verifier must not burn the code of the real client.
  if (
    !row ||
    row.expiresAt.getTime() <= Date.now() ||
    row.clientId !== client._id ||
    (redirectUri !== null && redirectUri !== row.redirectUri) ||
    !CODE_VERIFIER.test(verifier) ||
    !safeEqualHex(challenge, row.codeChallenge)
  ) {
    return invalid;
  }
  const claimed = await codes.updateOne({ _id: row._id, usedAt: null }, { $set: { usedAt: nowIso() } });
  if (claimed.modifiedCount !== 1) {
    // A second valid use means that someone has the code and its verifier. Revoke the agent (RFC 6749 section 4.1.2).
    await revokeAgent(row.tokenId);
    return invalid;
  }
  return (await issueAgentTokens({ _id: row.tokenId }, client._id)) ?? invalid;
}

async function refreshTokens(
  params: URLSearchParams,
  client: OAuthClientDoc,
): Promise<OAuthResult> {
  const token = params.get("refresh_token");
  if (!token) {
    return oauthError(400, "invalid_request", "The refresh_token is required.");
  }
  // The filter matches only the current refresh token, so each token works once.
  const issued = await issueAgentTokens({ refreshTokenHash: hashSecret(token) }, client._id);
  return (
    issued ??
    oauthError(400, "invalid_grant", "The refresh token is not valid, has expired, or was revoked.")
  );
}

/** The token endpoint (RFC 6749 section 3.2). */
export async function tokenRequest(request: Request): Promise<OAuthResult> {
  const params = await readTokenParams(request);
  if (!params) {
    return oauthError(400, "invalid_request", "The request body is not valid.");
  }
  const resource = params.get("resource");
  if (resource !== null && !isMcpResource(resource, request)) {
    return oauthError(400, "invalid_target", "The resource must be the Dash MCP URL.");
  }
  const grant = params.get("grant_type");
  if (grant !== "authorization_code" && grant !== "refresh_token") {
    return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  }
  const client = await authenticateClient(request, params);
  if ("status" in client) {
    return client;
  }
  return grant === "authorization_code"
    ? exchangeCode(params, client)
    : refreshTokens(params, client);
}
