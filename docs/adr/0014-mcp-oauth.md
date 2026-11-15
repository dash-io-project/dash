# ADR 0014: OAuth for MCP agents

## Status

Accepted

## Context

Before this change, an agent connected to Dash MCP only with a static `dash_live_` token. The user issued the token on a page, then copied it into the agent. ChatGPT connectors and other MCP clients expect OAuth. They read the MCP URL, discover the authorization server, register themselves, and open a browser for consent. Dash served no OAuth metadata, so ChatGPT showed "Couldn't discover OAuth settings".

## Decision

- Dash is its own authorization server. It follows the authorization section of the MCP specification.
- `/mcp` answers 401 with `WWW-Authenticate: Bearer resource_metadata="…"`. The value points to the protected resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource/mcp`. Dash also serves that document at `/.well-known/oauth-protected-resource`.
- `/.well-known/oauth-authorization-server` serves the authorization server metadata (RFC 8414). The issuer is the site origin.
- `POST /oauth/register` accepts dynamic client registration (RFC 7591). The endpoint is public, as the MCP specification expects. A redirect URI must use https, http on a loopback host, or a private-use app scheme. A redirect URI with a fragment is refused. A client can be public (`none`) or confidential (`client_secret_post` or `client_secret_basic`). Dash stores the SHA-256 of a client secret.
- `/oauth/authorize` is a page. It uses the browser session of the user. When no session exists, it opens the login page, which returns to the consent page after sign-in. The login page accepts only a path on the same origin. The user sets the agent name, the workspace, and write access, then selects **Create agent**. The page sends `X-Frame-Options: DENY`, so a different site cannot frame it. The page shows the host of the redirect URI, so the user can see where the code goes.
- An unknown client or an unregistered redirect URI is shown on the page. Dash does not redirect in this case (RFC 6749 section 4.1.2.1). A loopback redirect can use a different port (RFC 8252 section 7.3).
- Approval creates the agent at that time. The agent is an `api_tokens` record with `kind: "oauth"`, the client id, and the client name. The current token checks, the revoke route, and the token list work for this record.
- Only the authorization code grant with PKCE S256 is accepted. A code is single-use and expires after 5 minutes. Dash stores the SHA-256 of the code. Dash checks the client, the redirect URI, and the verifier before it marks the code as used. Thus a wrong verifier cannot burn the code of the real client. A second use with the correct verifier revokes the agent, because someone can have the code and its verifier.
- `POST /oauth/token` issues a `dash_live_` access token and a `dash_refresh_` refresh token. The access token expires after one hour. Each refresh replaces both tokens in one conditional update, so each refresh token works once. Each refresh also moves the agent expiry 90 days forward. An agent that does not refresh for 90 days stops.
- An OAuth access token works only at `/mcp`, which is its audience. The REST API refuses it with 403. A `resource` parameter (RFC 8707) must name the Dash MCP URL.
- The public origin comes from `DASH_PUBLIC_URL` when it is set. Otherwise Dash reads `X-Forwarded-Proto` and `X-Forwarded-Host`. Behind a proxy, the Node server sees plain `http`. Without these headers, the advertised URLs do not match the URL in the client. The `demo.dash.io` Worker sets both headers and replaces values that the client sent. A forged header changes only the response to that request. These responses use `Cache-Control: no-store`.
- The **Agent tokens** page is now **Agents**. It shows the MCP URL for OAuth and the form for a static agent token. It lists OAuth agents and API tokens with the `mcp` scope.

## Consequences

ChatGPT, Claude, and other MCP clients that support OAuth can connect with only the MCP URL. Static agent tokens continue to work.

Registration is open, so the `oauth_clients` collection can grow. A later change can delete clients that never completed an authorization. Dash does not support Client ID Metadata Documents, token revocation (RFC 7009), or token introspection yet. A user revokes an agent on the Agents page.
