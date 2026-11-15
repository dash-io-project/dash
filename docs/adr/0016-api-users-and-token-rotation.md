# ADR 0016: API users and token rotation

## Status

Accepted. This ADR amends [ADR 0003](0003-api-tokens.md).

## Context

The API tokens page issued one standalone token at a time. Each token had its own name, scopes, and workspace. No record connected a new token to the token that it replaced. Thus, a service had no clear way to rotate its token.

The page also showed the MCP banner, used "MCP client" as the default name, and offered the `mcp` scope. Agent tokens showed on the API tokens page and on the Agents page.

A `write` token could also call `PATCH /api/users/me` and set a new password without the current password. A leaked `write` token could thus take over the account of its owner.

## Decision

- An API user is a named identity for a script, a service, or an integration. Dash stores it in the `api_users` collection.
- An API user has a name, an owner, one workspace, scopes, and a `deletedAt` value.
- An API user can have only the `read` and `write` scopes. `write` includes `read`. A request for the `mcp` scope gets 400. Agents stay on the Agents page.
- An API user holds one or more tokens. Each token is an `api_tokens` record with `apiUserId`. When Dash issues a token, the token copies the owner, the workspace, and the scopes of the API user.
- To rotate a token, the user creates a new token, updates the app, and then revokes the old token. Both tokens work between these steps.
- An API user can have 10 active tokens. An expired token does not count. Dash counts the tokens before it inserts a token, so the limit is soft.
- A new token expires after 90 days when the request gives no lifetime. The maximum is 365 days. `POST /api/tokens` keeps its old rule: a request with no lifetime gives a token with no expiry.
- An API user acts as its owner. Each request checks the current membership and role of the owner. If the owner loses access, the tokens stop. The API user can use dashboards only in its workspace. Data sources follow the organization access of the owner, as [ADR 0009](0009-organization-workspaces.md) says.
- A workspace viewer can create a `read` API user. A `write` API user needs editor access when Dash creates it.
- A delete sets `deletedAt` and then revokes each token. Token authentication refuses a token when its API user has `deletedAt`. Thus, one write stops all tokens of the API user. A second delete revokes tokens that a stopped delete left.
- Token authentication writes `lastUsedAt` at most once a minute. The last use of an API user includes its revoked tokens, so a rotation does not hide a recent use.
- Only a browser session can list, create, or delete API users and their tokens. An API token cannot.
- `PATCH /api/users/me` and `PATCH /api/settings` need a browser session. A token cannot change the profile, the password, or the organization settings.
- An admin's `write` token can still add, change, and remove data sources. Automation can need this.
- `POST /api/tokens` issues agent tokens only. A request without the `mcp` scope gets 400.
- An older standalone token without `mcp` becomes an API user, also when it is expired. Dash does not adopt a revoked token. `GET /api/api-users` does this for the caller on each request. The new API user has the ID `legacy-<token id>`, so a second or concurrent run adds nothing.
- The adopted token keeps its scopes. If the token has `write`, the API user gets `read` and `write`, so its new tokens can read.
- A token from before workspaces gives an API user with no workspace. That token continues to work, and the user can revoke it. That API user cannot get a new token.
- A static token with the `mcp` scope still works on the REST API. An OAuth agent token works only at `/mcp`, as [ADR 0014](0014-mcp-oauth.md) says. The split between the two pages is for presentation. It is not a security boundary.

## Consequences

A service can rotate its token without downtime. The API tokens page lists API users and their tokens. It does not show the MCP banner.

Token authentication reads the API user for each request that uses an API user token. This is one more indexed read.

The tokens of an API user stop when its owner leaves the workspace or the organization.

Later changes can add these items:

- Rotation with a grace period. Dash issues a new token and sets the old token to expire after a set time.
- Changes to the name and the scopes of an API user. A scope change must apply at once to all tokens of that API user.
- Expiry reminders by email and in the app.
- A request that lets a token revoke itself.
- API users that a workspace owns. These API users do not stop when a person leaves. Workspace managers and organization admins can see and revoke them.
- Organization policies for token lifetime, scopes, and the number of tokens.
- An audit log of token events.
- An IP allow list for each API user.
- A token format with a checksum, and GitHub secret scanning.
- Scopes for each resource, such as dashboards or a data source.
- Agent tokens that become API users with `mcp`, so that agents can also rotate tokens.
