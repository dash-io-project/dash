import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PublicApiToken, PublicApiUser, PublicUser } from "@dash/core";
import { authenticatePassword, createSession, createUser, issueApiToken } from "./auth.ts";
import { generateApiToken, hashSecret } from "./crypto.ts";
import { apiTokens, apiUsers, nowIso } from "./db.ts";
import { destroyAppDatabase, useFreshAppDatabase } from "./test-db.ts";
import { ensurePersonalWorkspace } from "./services/workspaces.ts";
import { Route as ApiUserIndex } from "../routes/api/api-users.index.ts";
import { Route as ApiUserItem } from "../routes/api/api-users.$id.ts";
import { Route as ApiUserTokens } from "../routes/api/api-users.$id.tokens.index.ts";
import { Route as ApiUserToken } from "../routes/api/api-users.$id.tokens.$tokenId.ts";
import { Route as Me } from "../routes/api/auth/me.ts";
import { Route as Profile } from "../routes/api/users/me.ts";
import { Route as Settings } from "../routes/api/settings.ts";
import { Route as DashboardIndex } from "../routes/api/dashboards.index.ts";
import { Route as WorkspaceIndex } from "../routes/api/workspaces.index.ts";
import { Route as WorkspaceMembers } from "../routes/api/workspaces.$id.members.ts";

type Params = { id?: string; tokenId?: string };
type Auth = { session?: string; token?: string };
type Handler = (input: { request: Request; params: Params }) => Promise<Response>;
type RouteHandlers = { options: { server?: { handlers?: unknown } } };

async function call(
  route: RouteHandlers,
  method: string,
  auth: Auth,
  options: Params & { workspaceId?: string; body?: unknown } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth.token) headers.set("authorization", `Bearer ${auth.token}`);
  else if (auth.session) headers.set("cookie", `dash_session=${auth.session}`);
  if (options.workspaceId) headers.set("x-dash-workspace-id", options.workspaceId);
  const request = new Request("http://localhost/api", {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const handlers = route.options.server!.handlers as Record<string, Handler>;
  return handlers[method]!({ request, params: { id: options.id ?? "", tokenId: options.tokenId ?? "" } });
}

type Created = { apiUser: PublicApiUser; token: string; record: PublicApiToken };
type Issued = { token: string; record: PublicApiToken };

describe("API users", () => {
  let ada: PublicUser;
  let session: string;

  beforeEach(async () => {
    await useFreshAppDatabase();
    ada = await createUser({ email: "ada@example.com", name: "Ada", password: "password123", role: "admin" });
    session = await createSession(ada.id);
  });
  afterEach(destroyAppDatabase);

  async function create(body: unknown, auth: Auth = { session }) {
    return call(ApiUserIndex, "POST", auth, { body });
  }

  async function list(auth: Auth = { session }): Promise<PublicApiUser[]> {
    const response = await call(ApiUserIndex, "GET", auth);
    expect(response.status).toBe(200);
    return ((await response.json()) as { apiUsers: PublicApiUser[] }).apiUsers;
  }

  async function issue(apiUserId: string, body: unknown = {}, auth: Auth = { session }) {
    return call(ApiUserTokens, "POST", auth, { id: apiUserId, body });
  }

  async function me(token: string) {
    return (await call(Me, "GET", { token })).status;
  }

  it("rotates tokens: a second token works, the first is revoked, and deletion stops the rest", async () => {
    const response = await create({ name: "Billing sync", scopes: ["write"] });
    expect(response.status).toBe(201);
    const first = (await response.json()) as Created;
    expect(first.apiUser).toMatchObject({ name: "Billing sync", scopes: ["read", "write"] });
    expect(first.record).toMatchObject({ apiUserId: first.apiUser.id, name: "Initial token", kind: "token" });
    const days = (Date.parse(first.record.expiresAt!) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(90);
    expect(await me(first.token)).toBe(200);
    expect((await call(DashboardIndex, "POST", { token: first.token }, { body: { name: "From API" } })).status).toBe(
      201,
    );

    const next = await issue(first.apiUser.id, { name: "Next", expiresInDays: 7 });
    expect(next.status).toBe(201);
    const second = (await next.json()) as Issued;
    expect(Math.round((Date.parse(second.record.expiresAt!) - Date.now()) / 86_400_000)).toBe(7);
    expect((await list())[0]?.tokens.map((token) => token.name)).toEqual(["Next", "Initial token"]);

    const revoke = () =>
      call(ApiUserToken, "DELETE", { session }, { id: first.apiUser.id, tokenId: first.record.id });
    expect((await revoke()).status).toBe(200);
    // Only the revoked token has a use, and the API user still shows it.
    expect((await list())[0]?.lastUsedAt).toEqual(expect.any(String));
    expect(await me(first.token)).toBe(401);
    expect(await me(second.token)).toBe(200);
    expect((await revoke()).status).toBe(404);
    expect((await list())[0]?.tokens.map((token) => token.name)).toEqual(["Next"]);

    expect((await call(ApiUserItem, "DELETE", { session }, { id: first.apiUser.id })).status).toBe(200);
    expect(await me(second.token)).toBe(401);
    expect(await list()).toEqual([]);
    expect((await issue(first.apiUser.id)).status).toBe(404);
  });

  it("stops the tokens of a deleted API user before they are revoked, and a second delete revokes them", async () => {
    const { apiUser, token, record } = (await (await create({ name: "Worker", scopes: ["read"] })).json()) as Created;
    // A delete that stopped after the first write leaves the tokens without revokedAt.
    await (await apiUsers()).updateOne({ _id: apiUser.id }, { $set: { deletedAt: nowIso() } });
    expect(await me(token)).toBe(401);
    expect((await (await apiTokens()).findOne({ _id: record.id }))?.revokedAt).toBeNull();

    expect((await call(ApiUserItem, "DELETE", { session }, { id: apiUser.id })).status).toBe(200);
    expect((await (await apiTokens()).findOne({ _id: record.id }))?.revokedAt).toEqual(expect.any(String));
  });

  it("counts only live tokens toward the soft limit of 10", async () => {
    const { apiUser } = (await (await create({ name: "CI", scopes: ["read"] })).json()) as Created;
    for (let index = 0; index < 9; index += 1) {
      expect((await issue(apiUser.id)).status).toBe(201);
    }
    const full = await issue(apiUser.id);
    expect(full.status).toBe(409);
    expect((await full.json()).error.code).toBe("token_limit");

    const [oldest] = (await list())[0]!.tokens.slice(-1);
    await (await apiTokens()).updateOne(
      { _id: oldest!.id },
      { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } },
    );
    expect((await issue(apiUser.id)).status).toBe(201);
    expect((await list())[0]?.tokens).toHaveLength(11);
  });

  it("keeps API user management to the owner's browser session", async () => {
    const a = (await (await create({ name: "A", scopes: ["write"] })).json()) as Created;
    const b = (await (await create({ name: "B", scopes: ["read"] })).json()) as Created;
    const bearer = { token: a.token };
    expect((await call(ApiUserIndex, "GET", bearer)).status).toBe(403);
    expect((await create({ name: "C", scopes: ["read"] }, bearer)).status).toBe(403);
    expect((await issue(a.apiUser.id, {}, bearer)).status).toBe(403);
    expect((await call(ApiUserToken, "DELETE", bearer, { id: a.apiUser.id, tokenId: a.record.id })).status).toBe(403);
    expect((await call(ApiUserItem, "DELETE", bearer, { id: a.apiUser.id })).status).toBe(403);

    // A token is revoked only through the API user that holds it.
    expect((await call(ApiUserToken, "DELETE", { session }, { id: b.apiUser.id, tokenId: a.record.id })).status).toBe(
      404,
    );

    const grace = await createUser({ email: "grace@example.com", name: "Grace", password: "password123", role: "member" });
    const other = { session: await createSession(grace.id) };
    expect(await list(other)).toEqual([]);
    expect((await issue(a.apiUser.id, {}, other)).status).toBe(404);
    expect((await call(ApiUserToken, "DELETE", other, { id: a.apiUser.id, tokenId: a.record.id })).status).toBe(404);
    expect((await call(ApiUserItem, "DELETE", other, { id: a.apiUser.id })).status).toBe(404);
    expect(await me(a.token)).toBe(200);
  });

  it("lets a workspace viewer create a read API user but not a write API user", async () => {
    const grace = await createUser({ email: "grace@example.com", name: "Grace", password: "password123", role: "member" });
    const viewer = { session: await createSession(grace.id) };
    const team = await call(WorkspaceIndex, "POST", { session }, { body: { name: "Team" } });
    const workspaceId = ((await team.json()) as { workspace: { id: string } }).workspace.id;
    await call(WorkspaceMembers, "PUT", { session }, { id: workspaceId, body: { userId: grace.id, role: "viewer" } });

    const write = await call(ApiUserIndex, "POST", viewer, { workspaceId, body: { name: "W", scopes: ["read", "write"] } });
    expect(write.status).toBe(403);
    const read = await call(ApiUserIndex, "POST", viewer, { workspaceId, body: { name: "R", scopes: ["read"] } });
    expect(read.status).toBe(201);
    const created = (await read.json()) as Created;
    expect(created.apiUser.workspaceId).toBe(workspaceId);

    await call(WorkspaceMembers, "PUT", { session }, { id: workspaceId, body: { userId: grace.id, role: null } });
    const lost = await issue(created.apiUser.id, {}, viewer);
    expect(lost.status).toBe(404);
    expect((await lost.json()).error.code).toBe("workspace_access");
  });

  it("refuses the mcp scope, which belongs to agents, and lifetimes outside 1 to 365 days", async () => {
    const response = await create({ name: "Agent", scopes: ["read", "mcp"] });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_scope");
    expect((await create({ name: "Long", scopes: ["read"], token: { expiresInDays: 366 } })).status).toBe(400);
    expect(await (await apiUsers()).countDocuments()).toBe(0);
    const { apiUser } = (await (await create({ name: "Short", scopes: ["read"] })).json()) as Created;
    expect((await issue(apiUser.id, { expiresInDays: 0 })).status).toBe(400);
    expect((await issue(apiUser.id, { expiresInDays: 365 })).status).toBe(201);
  });

  it("adopts older tokens without the mcp scope, also a token from before workspaces", async () => {
    const workspaceId = await ensurePersonalWorkspace(ada.id);
    const standalone = await issueApiToken({
      userId: ada.id,
      workspaceId,
      name: "Old script",
      scopes: ["read", "write"],
      expiresAt: null,
    });
    const writeOnly = await issueApiToken({ userId: ada.id, workspaceId, name: "Writer", scopes: ["write"], expiresAt: null });
    const agent = await issueApiToken({ userId: ada.id, workspaceId, name: "Agent", scopes: ["read", "mcp"], expiresAt: null });
    const noWorkspace = generateApiToken();
    await (await apiTokens()).insertOne({
      _id: "pre-workspace",
      userId: ada.id,
      name: "Pre-workspace",
      tokenHash: hashSecret(noWorkspace),
      prefix: noWorkspace.slice(0, 18),
      scopes: ["read"],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z",
    } as never);

    const adopted = await list();
    const summary = Object.fromEntries(adopted.map((apiUser) => [apiUser.id, [apiUser.workspaceId, apiUser.scopes]]));
    expect(summary).toEqual({
      [`legacy-${standalone.record.id}`]: [workspaceId, ["read", "write"]],
      [`legacy-${writeOnly.record.id}`]: [workspaceId, ["read", "write"]],
      "legacy-pre-workspace": [null, ["read"]],
    });
    expect(await list()).toEqual(adopted);
    expect(await (await apiUsers()).countDocuments()).toBe(3);
    // The older token keeps its scopes. A new token of that API user can read.
    expect((await (await apiTokens()).findOne({ _id: writeOnly.record.id }))?.scopes).toEqual(["write"]);
    const fresh = (await (await issue(`legacy-${writeOnly.record.id}`)).json()) as Issued;
    expect(fresh.record.scopes).toEqual(["read", "write"]);
    expect(await me(fresh.token)).toBe(200);
    expect((await (await apiTokens()).findOne({ _id: agent.record.id }))?.apiUserId).toBeUndefined();

    expect(await me(standalone.token)).toBe(200);
    expect(await me(noWorkspace)).toBe(200);
    expect((await issue(`legacy-${standalone.record.id}`)).status).toBe(201);
    const blocked = await issue("legacy-pre-workspace");
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("no_workspace");
    expect(
      (await call(ApiUserToken, "DELETE", { session }, { id: "legacy-pre-workspace", tokenId: "pre-workspace" })).status,
    ).toBe(200);
    expect(await me(noWorkspace)).toBe(401);
  });

  it("writes the last use of a token at most once a minute", async () => {
    const { token, record } = (await (await create({ name: "Poller", scopes: ["read"] })).json()) as Created;
    const recent = new Date(Date.now() - 30_000).toISOString();
    await (await apiTokens()).updateOne({ _id: record.id }, { $set: { lastUsedAt: recent } });
    expect(await me(token)).toBe(200);
    expect((await (await apiTokens()).findOne({ _id: record.id }))?.lastUsedAt).toBe(recent);

    const old = new Date(Date.now() - 120_000).toISOString();
    await (await apiTokens()).updateOne({ _id: record.id }, { $set: { lastUsedAt: old } });
    expect(await me(token)).toBe(200);
    const written = (await (await apiTokens()).findOne({ _id: record.id }))?.lastUsedAt;
    expect(Date.parse(written!)).toBeGreaterThan(Date.parse(old));
    expect((await list())[0]?.lastUsedAt).toBe(written);
  });

  it("does not let a write token change the password or the organization settings", async () => {
    const { token } = (await (await create({ name: "Writer", scopes: ["write"] })).json()) as Created;
    const profile = await call(Profile, "PATCH", { token }, { body: { password: "taken-over-1" } });
    expect(profile.status).toBe(403);
    expect(await authenticatePassword("ada@example.com", "password123")).toBeDefined();
    const settings = await call(Settings, "PATCH", { token }, { body: { allowRegistration: false } });
    expect(settings.status).toBe(403);
    expect((await call(Profile, "PATCH", { session }, { body: { name: "Ada L." } })).status).toBe(200);
    expect((await call(Settings, "PATCH", { session }, { body: { allowRegistration: false } })).status).toBe(200);
  });
});
