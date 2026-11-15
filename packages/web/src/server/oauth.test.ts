import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, createUser } from "./auth.ts";
import { apiTokens } from "./db.ts";
import { destroyAppDatabase, useFreshAppDatabase } from "./test-db.ts";
import { Route as Mcp } from "../routes/mcp.ts";
import { Route as ResourceMetadata } from "../routes/[.]well-known.oauth-protected-resource.mcp.ts";
import { Route as ServerMetadata } from "../routes/[.]well-known.oauth-authorization-server.ts";
import { Route as Register } from "../routes/oauth.register.ts";
import { Route as Token } from "../routes/oauth.token.ts";
import { Route as Authorize } from "../routes/api/oauth.authorize.ts";
import { Route as Tokens } from "../routes/api/tokens.index.ts";
import { Route as Dashboards } from "../routes/api/dashboards.index.ts";

type Handler = (input: { request: Request; params: Record<string, string> }) => Promise<Response> | Response;
type RouteHandlers = { options: { server?: { handlers?: unknown } } };

const ORIGIN = "http://localhost";
const CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";

function call(route: RouteHandlers, method: string, request: Request): Promise<Response> {
  const handlers = route.options.server!.handlers as Record<string, Handler>;
  return Promise.resolve(handlers[method]!({ request, params: {} }));
}

function mcpInitialize(accessToken?: string): Request {
  return new Request(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    }),
  });
}

async function registerClient(metadata: Record<string, unknown>) {
  const response = await call(
    Register,
    "POST",
    new Request(`${ORIGIN}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(metadata),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

function tokenRequest(params: Record<string, string>): Promise<Response> {
  return call(
    Token,
    "POST",
    new Request(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    }),
  );
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

describe("MCP OAuth", () => {
  let session: string;

  beforeEach(async () => {
    await useFreshAppDatabase();
    const user = await createUser({
      email: "owner@example.com",
      name: "Owner",
      password: "password123",
      role: "admin",
    });
    session = await createSession(user.id);
  });

  afterEach(async () => {
    await destroyAppDatabase();
    delete process.env.DASH_PUBLIC_URL;
  });

  function authorizationQuery(clientId: string, challenge: string, extra: Record<string, string> = {}) {
    return `?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "123",
      scope: "read write mcp",
      resource: `${ORIGIN}/mcp`,
      ...extra,
    }).toString()}`;
  }

  /** Approve as the signed-in user, the way the consent page does. */
  async function approve(query: string, write = true) {
    const response = await call(
      Authorize,
      "POST",
      new Request(`${ORIGIN}/api/oauth/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `dash_session=${session}` },
        body: JSON.stringify({ query, decision: "approve", name: "My ChatGPT", write }),
      }),
    );
    expect(response.status).toBe(200);
    return new URL(((await response.json()) as { redirectTo: string }).redirectTo);
  }

  /** Register a public client, approve it, and exchange the code. */
  async function connectAgent() {
    const client = await registerClient({
      client_name: "ChatGPT",
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "none",
    });
    const { verifier, challenge } = pkce();
    const redirect = await approve(authorizationQuery(client.body.client_id!, challenge));
    const code = redirect.searchParams.get("code")!;
    const exchange = await tokenRequest({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: CALLBACK,
      client_id: client.body.client_id!,
    });
    return { clientId: client.body.client_id!, code, verifier, redirect, exchange };
  }

  it("lets an MCP client discover the authorization server from a 401 at the public origin", async () => {
    const proxied = { "x-forwarded-proto": "https", "x-forwarded-host": "demo.dash.io" };
    const challenge = await call(Mcp, "POST", mcpInitialize());
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );

    const resource = await call(
      ResourceMetadata,
      "GET",
      new Request(`http://demo.dash.io/.well-known/oauth-protected-resource/mcp`, { headers: proxied }),
    );
    const resourceBody = (await resource.json()) as { resource: string; authorization_servers: string[] };
    expect(resourceBody.resource).toBe("https://demo.dash.io/mcp");
    expect(resourceBody.authorization_servers).toEqual(["https://demo.dash.io"]);

    const server = await call(
      ServerMetadata,
      "GET",
      new Request(`http://demo.dash.io/.well-known/oauth-authorization-server`, { headers: proxied }),
    );
    expect(server.headers.get("access-control-allow-origin")).toBe("*");
    expect(await server.json()).toMatchObject({
      issuer: "https://demo.dash.io",
      authorization_endpoint: "https://demo.dash.io/oauth/authorize",
      token_endpoint: "https://demo.dash.io/oauth/token",
      registration_endpoint: "https://demo.dash.io/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });

    process.env.DASH_PUBLIC_URL = "https://dash.example.com/";
    const configured = await call(
      ServerMetadata,
      "GET",
      new Request(`http://10.0.0.5:3000/.well-known/oauth-authorization-server`),
    );
    expect(((await configured.json()) as { issuer: string }).issuer).toBe("https://dash.example.com");
  });

  it("creates the agent at approval and gives it a token that works only at the MCP endpoint", async () => {
    const { redirect, exchange } = await connectAgent();
    expect(`${redirect.origin}${redirect.pathname}`).toBe(CALLBACK);
    expect(redirect.searchParams.get("state")).toBe("123");
    expect(exchange.status).toBe(200);
    const tokens = (await exchange.json()) as Record<string, string | number>;
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read write mcp" });

    const mcp = await call(Mcp, "POST", mcpInitialize(String(tokens.access_token)));
    expect(mcp.status).toBe(200);

    const list = await call(
      Tokens,
      "GET",
      new Request(`${ORIGIN}/api/tokens`, { headers: { cookie: `dash_session=${session}` } }),
    );
    const agents = ((await list.json()) as { tokens: Array<Record<string, unknown>> }).tokens;
    expect(agents).toMatchObject([{ name: "My ChatGPT", kind: "oauth", clientName: "ChatGPT" }]);

    const rest = await call(
      Dashboards,
      "GET",
      new Request(`${ORIGIN}/api/dashboards`, { headers: { authorization: `Bearer ${tokens.access_token}` } }),
    );
    expect(rest.status).toBe(403);
  });

  it("refuses a wrong PKCE verifier and revokes the agent when a code is used twice", async () => {
    const client = await registerClient({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    const { challenge } = pkce();
    const redirect = await approve(authorizationQuery(client.body.client_id!, challenge));
    const wrong = await tokenRequest({
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      code_verifier: pkce().verifier,
      client_id: client.body.client_id!,
    });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_grant");

    const { clientId, code, verifier, exchange } = await connectAgent();
    const { access_token: accessToken } = (await exchange.json()) as { access_token: string };
    const replay = await tokenRequest({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
    });
    expect(replay.status).toBe(400);
    expect((await call(Mcp, "POST", mcpInitialize(accessToken))).status).toBe(401);
  });

  it("rotates the refresh token and expires the access token after one hour", async () => {
    const { clientId, exchange } = await connectAgent();
    const first = (await exchange.json()) as { access_token: string; refresh_token: string };
    const refreshed = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: clientId,
    });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as { access_token: string; refresh_token: string };

    const reuse = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: clientId,
    });
    expect(reuse.status).toBe(400);
    expect((await call(Mcp, "POST", mcpInitialize(first.access_token))).status).toBe(401);
    expect((await call(Mcp, "POST", mcpInitialize(second.access_token))).status).toBe(200);

    await (await apiTokens()).updateMany(
      { kind: "oauth" },
      { $set: { accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString() } },
    );
    expect((await call(Mcp, "POST", mcpInitialize(second.access_token))).status).toBe(401);
  });

  it("requires the secret of a confidential client", async () => {
    const client = await registerClient({
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "client_secret_post",
    });
    expect(client.body.client_secret).toBeTruthy();
    const { verifier, challenge } = pkce();
    const redirect = await approve(authorizationQuery(client.body.client_id!, challenge));
    const params = {
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      code_verifier: verifier,
      client_id: client.body.client_id!,
    };
    const missing = await tokenRequest(params);
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { error: string }).error).toBe("invalid_client");
  });

  it.each([
    ["http on a public host", "http://evil.example/callback"],
    ["a javascript URI", "javascript:alert(1)"],
    ["a fragment", "https://chatgpt.com/callback#x"],
  ])("refuses to register a redirect URI with %s", async (_, uri) => {
    const response = await registerClient({ redirect_uris: [uri] });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_redirect_uri");
  });

  it("does not redirect to an address that the client did not register", async () => {
    const client = await registerClient({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    const query = authorizationQuery(client.body.client_id!, pkce().challenge, {
      redirect_uri: "https://evil.example/callback",
    });
    const preview = await call(
      Authorize,
      "GET",
      new Request(`${ORIGIN}/api/oauth/authorize${query}`, { headers: { cookie: `dash_session=${session}` } }),
    );
    expect(await preview.json()).toMatchObject({ redirectTo: null });
  });
});
