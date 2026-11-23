import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ApiTokenScope, PublicApiToken } from "@dash/core";
import { api } from "~/lib/api";
import { useWorkspace } from "~/components/WorkspaceProvider";
import { PageBody, PageHeader } from "~/components/PageHeader";
import { Button, Card, CheckRow, Field, Panel, TextInput } from "~/components/ui";
import { McpUrlField } from "~/components/mcp-connection-banner";

function formatDate(value: string | null, empty: string): string {
  return value ? new Date(value).toLocaleDateString() : empty;
}

/** An agent connected through OAuth, or a static token with MCP access. */
function isAgent(token: PublicApiToken): boolean {
  return token.kind === "oauth" || token.scopes.includes("mcp");
}

export function AgentManager() {
  const { workspace, workspaces, workspaceApi } = useWorkspace();
  const queryClient = useQueryClient();
  const tokens = useQuery({
    queryKey: ["tokens"],
    queryFn: async () => (await api<{ tokens: PublicApiToken[] }>("/api/tokens")).tokens,
  });
  const [name, setName] = useState("MCP agent");
  const [write, setWrite] = useState(false);
  const [issued, setIssued] = useState<{ id: string; token: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const scopes: ApiTokenScope[] = write ? ["read", "write", "mcp"] : ["read", "mcp"];
      return workspaceApi<{ token: string; record: PublicApiToken }>("/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), scopes, expiresInDays: 90 }),
      });
    },
    onMutate: () => {
      setIssued(null);
      setCopyStatus("");
    },
    onSuccess: async (payload) => {
      setIssued({ id: payload.record.id, token: payload.token });
      await queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => api(`/api/tokens/${id}`, { method: "DELETE" }),
    onSuccess: async (_, id) => {
      setIssued((current) => (current?.id === id ? null : current));
      setCopyStatus("");
      await queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  async function copyToken() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopyStatus("Token copied.");
    } catch {
      setCopyStatus("Could not copy. Select the token and copy it.");
    }
  }

  const agents = (tokens.data ?? []).filter(isAgent);

  return (
    <>
      <PageHeader
        title="Agents"
        description="Agents use Dash through MCP. Connect an agent with OAuth or with a token. Each agent uses one workspace."
      />
      <PageBody column="wide">
      <Panel
        aria-labelledby="agents-oauth"
        title={<span id="agents-oauth">Connect with OAuth</span>}
        note={
          <>
            Give this URL to your agent, for example as a ChatGPT connector, and select OAuth. The agent opens Dash in
            your browser. Select the workspace and the access, then select{" "}
            <strong className="font-medium text-foreground">Create agent</strong>.
          </>
        }
      >
        <Card className="p-5">
          <McpUrlField />
        </Card>
      </Panel>

      <Panel
        title={<span id="agents-token">Connect with a token</span>}
        note={
          <>
            Use a token when the agent cannot use OAuth. New tokens use the {workspace.name} workspace and expire
            after 90 days. Dash shows each token once. Send it as <code>Authorization: Bearer dash_live_…</code>.
          </>
        }
      >
        <Card className="p-5">
          <form
            aria-labelledby="agents-token"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Agent name">
              <TextInput required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <div>
              <CheckRow checked={write} onChange={(event) => setWrite(event.target.checked)}>
                Create dashboards and add charts
              </CheckRow>
              <p className="text-[13px] text-muted-foreground">The agent can always read data sources and dashboards.</p>
            </div>
            <Button variant="primary" type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? "Please wait…" : "Issue agent token"}
            </Button>
            {create.error ? <p role="alert" className="text-negative">{create.error.message}</p> : null}
            {issued ? (
              <div className="rounded-md border border-warning-border bg-warning-soft p-4">
                <div className="mb-2 text-[13px]">Copy this token now. You cannot retrieve it later.</div>
                <code className="block break-all rounded-md border border-border bg-background px-3 py-2 select-all">
                  {issued.token}
                </code>
                <Button className="mt-3" size="sm" type="button" onClick={() => void copyToken()}>
                  Copy token
                </Button>
                <p role="status" className={copyStatus ? "mt-2 text-[13px] text-muted-foreground" : "sr-only"}>{copyStatus}</p>
              </div>
            ) : null}
          </form>
        </Card>
      </Panel>

      <Panel title="Agents" note="The agents that can use Dash now.">
      {tokens.isPending ? <p role="status" className="mb-3 text-muted-foreground">Please wait for the agents.</p> : null}
      {tokens.error ? <p role="alert" className="mb-3 text-negative">{tokens.error.message}</p> : null}
      {revoke.error ? <p role="alert" className="mb-3 text-negative">{revoke.error.message}</p> : null}
      <div className="card table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Connection</th>
              <th>Workspace</th>
              <th>Scopes</th>
              <th>Last used</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.isSuccess && agents.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-muted-foreground">
                  No agents yet. Connect an agent with OAuth or issue a token.
                </td>
              </tr>
            ) : null}
            {agents.map((agent) => (
              <tr key={agent.id}>
                <td>{agent.name}</td>
                <td>
                  {agent.kind === "oauth" ? (
                    <>OAuth{agent.clientName ? <span className="text-muted-foreground"> · {agent.clientName}</span> : null}</>
                  ) : (
                    <>
                      Token <code className="text-xs text-muted-foreground">{agent.prefix}…</code>
                    </>
                  )}
                </td>
                <td>
                  {workspaces.find((item) => item.id === agent.workspaceId)?.name ?? "No access"}
                </td>
                <td>{agent.scopes.join(", ")}</td>
                <td className="tabular whitespace-nowrap text-muted-foreground">{formatDate(agent.lastUsedAt, "Never")}</td>
                <td className="tabular whitespace-nowrap text-muted-foreground">{formatDate(agent.expiresAt, "Never")}</td>
                <td className="text-right">
                  <Button size="sm" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(agent.id)}>
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </Panel>
      </PageBody>
    </>
  );
}
