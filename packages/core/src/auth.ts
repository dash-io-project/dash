export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Display names. `member` is stored for compatibility and shown as "User". */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  member: "User",
};

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

/** A pending invitation as administrators see it. The link token is never listed. */
export interface PublicInvitation {
  id: string;
  email: string;
  role: UserRole;
  invitedBy: { id: string; name: string } | null;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "expired";
}

/** What the person holding an invitation link sees before creating the account. */
export interface InvitationPreview {
  email: string;
  role: UserRole;
  organizationName: string;
  invitedByName: string | null;
  expiresAt: string;
}

export interface OrganizationSettings {
  name: string;
  allowRegistration: boolean;
  /** Host names that can create accounts. An empty list allows every domain. */
  allowedEmailDomains: string[];
}

export const API_TOKEN_SCOPES = ["read", "write", "mcp"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export function isApiTokenScope(value: string): value is ApiTokenScope {
  return (API_TOKEN_SCOPES as readonly string[]).includes(value);
}

export const API_TOKEN_PREFIX = "dash_live_";

/** `token` is a static bearer token. `oauth` is an agent that connected through the MCP OAuth flow. */
export type ApiTokenKind = "token" | "oauth";

/** An API user can hold only these scopes. MCP access belongs on the Agents page. */
export const API_USER_SCOPES = ["read", "write"] as const;
export type ApiUserScope = (typeof API_USER_SCOPES)[number];

/** Token lifetimes that the API tokens page offers. */
export const API_TOKEN_EXPIRY_DAYS = [7, 30, 90, 180, 365] as const;
export const DEFAULT_API_TOKEN_EXPIRY_DAYS = 90;

/** A soft limit. It stops a collection of old tokens during rotation. */
export const MAX_ACTIVE_API_USER_TOKENS = 10;

/** A named identity for a script or service. It holds one or more tokens, so a token can rotate. */
export interface PublicApiUser {
  id: string;
  /** Null for an API user adopted from a token that had no workspace. */
  workspaceId: string | null;
  name: string;
  scopes: ApiUserScope[];
  createdAt: string;
  /** The most recent use of a token of this API user. Revoked tokens count. */
  lastUsedAt: string | null;
  /** Tokens that are not revoked. Expired tokens are included. Newest first. */
  tokens: PublicApiToken[];
}

export interface PublicApiToken {
  workspaceId: string;
  id: string;
  kind: ApiTokenKind;
  /** The API user that holds this token. Null for an agent token or an OAuth agent. */
  apiUserId: string | null;
  /** The name that the OAuth client registered. Null for a static token. */
  clientName: string | null;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}
