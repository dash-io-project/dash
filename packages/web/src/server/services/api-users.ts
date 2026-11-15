import {
  API_USER_SCOPES,
  DEFAULT_API_TOKEN_EXPIRY_DAYS,
  MAX_ACTIVE_API_USER_TOKENS,
  publicTokenPrefix,
  type ApiUserScope,
  type PublicApiToken,
  type PublicApiUser,
  type PublicUser,
} from "@dash/core";
import { MongoServerError } from "mongodb";
import { toPublicToken } from "../auth.ts";
import { generateApiToken, hashSecret, randomId } from "../crypto.ts";
import { apiTokens, apiUsers, nowIso, type ApiTokenDoc, type ApiUserDoc } from "../db.ts";
import { getWorkspace } from "./workspaces.ts";

const DAY_MS = 86_400_000;

export class ApiUserError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "ApiUserError";
  }
}

export interface NewTokenInput {
  name?: string;
  expiresInDays?: number;
}

function isApiUserScope(value: string): value is ApiUserScope {
  return (API_USER_SCOPES as readonly string[]).includes(value);
}

/** `write` includes `read`. The result has a fixed order. */
function normalizeScopes(scopes: readonly ApiUserScope[]): ApiUserScope[] {
  const wanted = new Set<ApiUserScope>(scopes);
  if (wanted.has("write")) wanted.add("read");
  return API_USER_SCOPES.filter((scope) => wanted.has(scope));
}

function toPublicApiUser(row: ApiUserDoc, tokens: ApiTokenDoc[]): PublicApiUser {
  let lastUsedAt: string | null = null;
  for (const token of tokens) {
    if (token.lastUsedAt && (!lastUsedAt || token.lastUsedAt > lastUsedAt)) lastUsedAt = token.lastUsedAt;
  }
  return {
    id: row._id,
    workspaceId: row.workspaceId,
    name: row.name,
    scopes: row.scopes,
    createdAt: row.createdAt,
    lastUsedAt,
    tokens: tokens.map(toPublicToken),
  };
}

async function insertToken(
  apiUser: ApiUserDoc,
  input: NewTokenInput,
): Promise<{ token: string; row: ApiTokenDoc }> {
  if (!apiUser.workspaceId) {
    throw new ApiUserError(
      409,
      "This API user has no workspace. Create a new API user to get a new token.",
      "no_workspace",
    );
  }
  const token = generateApiToken();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const days = input.expiresInDays ?? DEFAULT_API_TOKEN_EXPIRY_DAYS;
  const row: ApiTokenDoc = {
    _id: randomId(),
    kind: "token",
    apiUserId: apiUser._id,
    workspaceId: apiUser.workspaceId,
    userId: apiUser.ownerId,
    name: input.name?.trim() || `Token ${createdAt.slice(0, 10)}`,
    tokenHash: hashSecret(token),
    prefix: publicTokenPrefix(token),
    scopes: [...apiUser.scopes],
    expiresAt: new Date(now + days * DAY_MS).toISOString(),
    lastUsedAt: null,
    revokedAt: null,
    createdAt,
  };
  await (await apiTokens()).insertOne(row);
  return { token, row };
}

/**
 * Before API users, each static token stood alone. Give each live older token
 * without the `mcp` scope its own API user, so the API tokens page lists it.
 * Agent tokens with `mcp` stay on the Agents page. The ID comes from the token,
 * so a second or concurrent run adds nothing.
 */
async function adoptLegacyTokens(ownerId: string): Promise<void> {
  const tokens = await apiTokens();
  const legacy = await tokens
    .find({
      userId: ownerId,
      kind: { $ne: "oauth" },
      apiUserId: { $exists: false },
      revokedAt: null,
      scopes: { $ne: "mcp" },
    })
    .toArray();
  if (legacy.length === 0) return;
  const users = await apiUsers();
  for (const row of legacy) {
    const id = `legacy-${row._id}`;
    try {
      await users.updateOne(
        { _id: id },
        {
          $setOnInsert: {
            // Tokens from before workspaces have no workspace.
            workspaceId: (row.workspaceId as string | undefined) ?? null,
            ownerId,
            name: row.name,
            // Keep the scopes of the token as they are, so its access does not change.
            scopes: row.scopes.filter(isApiUserScope),
            createdAt: row.createdAt,
            updatedAt: nowIso(),
            deletedAt: null,
          },
        },
        { upsert: true },
      );
    } catch (cause) {
      // A concurrent run inserted the same API user first.
      if (!(cause instanceof MongoServerError) || cause.code !== 11000) throw cause;
    }
    await tokens.updateOne({ _id: row._id, apiUserId: { $exists: false } }, { $set: { apiUserId: id } });
  }
}

/** The API users of this person in all workspaces, newest first. */
export async function listApiUsers(ownerId: string): Promise<PublicApiUser[]> {
  await adoptLegacyTokens(ownerId);
  const rows = await (await apiUsers()).find({ ownerId, deletedAt: null }).sort({ createdAt: -1 }).toArray();
  if (rows.length === 0) return [];
  const tokens = await (await apiTokens())
    .find({ userId: ownerId, apiUserId: { $in: rows.map((row) => row._id) }, revokedAt: null })
    .sort({ createdAt: -1 })
    .toArray();
  return rows.map((row) => toPublicApiUser(row, tokens.filter((token) => token.apiUserId === row._id)));
}

/** Create an API user in a workspace that the caller already has access to, with its first token. */
export async function createApiUser(input: {
  ownerId: string;
  workspaceId: string;
  name: string;
  scopes: ApiUserScope[];
  token?: NewTokenInput;
}): Promise<{ apiUser: PublicApiUser; token: string; record: PublicApiToken }> {
  const now = nowIso();
  const row: ApiUserDoc = {
    _id: randomId(),
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    name: input.name.trim(),
    scopes: normalizeScopes(input.scopes),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await (await apiUsers()).insertOne(row);
  const issued = await insertToken(row, { name: "Initial token", ...input.token });
  return {
    apiUser: toPublicApiUser(row, [issued.row]),
    token: issued.token,
    record: toPublicToken(issued.row),
  };
}

/**
 * Give an API user one more token, so a service can move to it before the old token is revoked.
 * The count and the insert are separate steps, so the limit is soft.
 */
export async function issueApiUserToken(
  owner: PublicUser,
  apiUserId: string,
  input: NewTokenInput,
): Promise<{ token: string; record: PublicApiToken }> {
  const apiUser = await (await apiUsers()).findOne({ _id: apiUserId, ownerId: owner.id, deletedAt: null });
  if (!apiUser) throw new ApiUserError(404, "API user not found", "not_found");
  if (apiUser.workspaceId) await getWorkspace(owner, apiUser.workspaceId);
  const active = await (await apiTokens()).countDocuments({
    apiUserId,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: nowIso() } }],
  });
  if (active >= MAX_ACTIVE_API_USER_TOKENS) {
    throw new ApiUserError(
      409,
      `An API user can have ${MAX_ACTIVE_API_USER_TOKENS} active tokens. Revoke an old token first.`,
      "token_limit",
    );
  }
  const issued = await insertToken(apiUser, input);
  return { token: issued.token, record: toPublicToken(issued.row) };
}

/** Revoke one token of an API user. Other tokens of that API user continue to work. */
export async function revokeApiUserToken(ownerId: string, apiUserId: string, tokenId: string): Promise<boolean> {
  const result = await (await apiTokens()).updateOne(
    { _id: tokenId, apiUserId, userId: ownerId, revokedAt: null },
    { $set: { revokedAt: nowIso() } },
  );
  return result.matchedCount === 1;
}

/**
 * Delete an API user and revoke all of its tokens. The `deletedAt` value stops
 * the tokens at once. A second call revokes tokens that a stopped call left.
 */
export async function deleteApiUser(ownerId: string, apiUserId: string): Promise<boolean> {
  const users = await apiUsers();
  const row = await users.findOne({ _id: apiUserId, ownerId });
  if (!row) return false;
  const now = nowIso();
  if (!row.deletedAt) {
    await users.updateOne({ _id: apiUserId, deletedAt: null }, { $set: { deletedAt: now, updatedAt: now } });
  }
  await (await apiTokens()).updateMany({ apiUserId, revokedAt: null }, { $set: { revokedAt: now } });
  return true;
}
