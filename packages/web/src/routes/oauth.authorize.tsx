import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import type { ApiTokenScope, PublicUser, Workspace } from "@dash/core";
import { api, ApiError } from "~/lib/api";
import { fetchMe } from "~/lib/session";
import { AuthCard, Button, Field, Select, TextInput, FullPageMessage } from "~/components/ui";

interface AuthorizationPreview {
  client?: { name: string; redirectHost: string };
  requestedScopes?: ApiTokenScope[];
  error?: { message: string };
  redirectTo?: string | null;
}

export const Route = createFileRoute("/oauth/authorize")({
  // The consent page must not load in a frame. A frame lets a different site trick a click.
  headers: () => ({
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
  }),
  head: () => ({ meta: [{ title: "Create an agent — Dash" }] }),
  component: AuthorizePage,
});

/**
 * The raw query string of the authorization request. The router parses search
 * values as JSON, which can change a `state` such as "123" into a number.
 * Read the browser location instead. It exists only after mount.
 */
function useAuthorizationQuery(): string | undefined {
  const [query, setQuery] = useState<string>();
  useEffect(() => setQuery(window.location.search), []);
  return query;
}

function AuthorizePage() {
  const navigate = useNavigate();
  const query = useAuthorizationQuery();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  const signedOut = me.error instanceof ApiError && me.error.status === 401;
  const preview = useQuery({
    queryKey: ["oauth-authorize", query],
    queryFn: () => api<AuthorizationPreview>(`/api/oauth/authorize${query ?? ""}`),
    enabled: query !== undefined && me.isSuccess,
    retry: false,
  });
  const workspaces = useQuery({
    queryKey: ["workspaces", me.data?.id],
    queryFn: async () => (await api<{ workspaces: Workspace[] }>("/api/workspaces")).workspaces,
    enabled: me.isSuccess,
  });

  useEffect(() => {
    if (signedOut && query !== undefined) {
      void navigate({
        to: "/login",
        search: { redirect: `${window.location.pathname}${query}` },
        replace: true,
      });
    }
  }, [signedOut, query, navigate]);

  if (me.isError && !signedOut) {
    return <Unavailable message={me.error.message} />;
  }
  if (preview.isError || workspaces.isError) {
    return <Unavailable message={(preview.error ?? workspaces.error)?.message ?? "Could not load the request."} />;
  }
  if (!me.data || !preview.data || !workspaces.data) {
    return <FullPageMessage>Loading…</FullPageMessage>;
  }
  if (!preview.data.client) {
    return (
      <Unavailable
        message={preview.data.error?.message ?? "This connection request is not valid."}
        redirectTo={preview.data.redirectTo ?? undefined}
      />
    );
  }
  return (
    <ConsentForm
      query={query ?? ""}
      user={me.data}
      client={preview.data.client}
      requestedScopes={preview.data.requestedScopes ?? []}
      workspaces={workspaces.data}
    />
  );
}

function Unavailable({ message, redirectTo }: { message: string; redirectTo?: string }) {
  return (
    <AuthCard title="Cannot connect the agent" subtitle={message}>
      {redirectTo ? (
        <Button type="button" className="w-full" onClick={() => window.location.assign(redirectTo)}>
          Return to the agent
        </Button>
      ) : (
        <p className="text-muted-foreground">Start the connection again from your agent.</p>
      )}
    </AuthCard>
  );
}

function ConsentForm({
  query,
  user,
  client,
  requestedScopes,
  workspaces,
}: {
  query: string;
  user: PublicUser;
  client: { name: string; redirectHost: string };
  requestedScopes: ApiTokenScope[];
  workspaces: Workspace[];
}) {
  const personal = workspaces.find((item) => item.ownerId === user.id) ?? workspaces[0];
  const [name, setName] = useState(client.name);
  const [workspaceId, setWorkspaceId] = useState(personal?.id ?? "");
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const canWrite = workspace !== undefined && workspace.role !== "viewer";
  const [write, setWrite] = useState(requestedScopes.includes("write"));
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "deny") {
    setPending(decision);
    setError(null);
    try {
      const payload = await api<{ redirectTo: string }>("/api/oauth/authorize", {
        method: "POST",
        headers: { "x-dash-workspace-id": workspaceId },
        body: JSON.stringify({ query, decision, name: name.trim(), write: write && canWrite }),
      });
      window.location.assign(payload.redirectTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the agent");
      setPending(null);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void decide("approve");
  }

  return (
    <AuthCard
      title="Create an agent"
      subtitle={`${client.name} wants to use Dash through MCP.`}
      onSubmit={onSubmit}
      footer={
        <>
          You are signed in as {user.email}. After you create the agent, Dash sends you back to{" "}
          <span className="font-medium text-foreground">{client.redirectHost}</span>. Revoke the agent at any time on
          the Agents page.
        </>
      }
    >
      <Field label="Agent name">
        <TextInput required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Workspace">
        <Select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
          {workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="space-y-2">
        <legend className="field-label">Access</legend>
        <label className="check-row flex items-center gap-2">
          <input type="checkbox" checked disabled />
          Read data sources and dashboards
        </label>
        <label className="check-row flex items-center gap-2">
          <input
            type="checkbox"
            checked={write && canWrite}
            disabled={!canWrite}
            onChange={(event) => setWrite(event.target.checked)}
          />
          Create dashboards and add charts
        </label>
        {!canWrite ? (
          <p className="text-muted-foreground">You have viewer access to this workspace, so the agent can only read.</p>
        ) : null}
      </fieldset>
      {error ? <p role="alert" className="text-negative">{error}</p> : null}
      <div className="flex gap-3">
        <Button variant="primary" type="submit" className="flex-1" disabled={pending !== null || !name.trim() || !workspaceId}>
          {pending === "approve" ? "Please wait…" : "Create agent"}
        </Button>
        <Button type="button" disabled={pending !== null} onClick={() => void decide("deny")}>
          Cancel
        </Button>
      </div>
    </AuthCard>
  );
}
