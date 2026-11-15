import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ApiTokenScope, PublicApiToken } from "@dash/core";
import { api } from "~/lib/api";
import { useWorkspace } from "~/components/WorkspaceProvider";
import { Field, GhostButton, PrimaryButton, TextInput } from "~/components/ui";
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
    <div className="max-w-4xl">
      <h1 className="text-3xl font-semibold">Agents</h1>
      <p className="mt-2 text-sm text-mist">
        Agents use Dash through MCP. Connect an agent with OAuth or with a token. Each agent uses one workspace.
      </p>

      <section
        aria-labelledby="agents-oauth"
        className="mt-8 space-y-3 rounded-2xl border border-accent/30 bg-accent/10 p-6"
      >
        <h2 id="agents-oauth" className="text-lg font-semibold">Connect with OAuth</h2>
        <p className="text-sm text-mist">
          Give this URL to your agent, for example as a ChatGPT connector, and select OAuth. The agent opens Dash in
          your browser. Select the workspace and the access, then select <strong>Create agent</strong>.
        </p>
        <McpUrlField />
      </section>

      <form
        aria-labelledby="agents-token"
        className="mt-6 space-y-4 rounded-2xl border border-line bg-panel p-6"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <h2 id="agents-token" className="text-lg font-semibold">Connect with a token</h2>
        <p className="text-sm text-mist">
          Use a token when the agent cannot use OAuth. New tokens use the {workspace.name} workspace and expire
          after 90 days. Dash shows each token once. Send it as <code>Authorization: Bearer dash_live_…</code>.
        </p>
        <Field label="Agent name">
          <TextInput required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} />
          Create dashboards and add charts
        </label>
        <p className="text-sm text-mist">The agent can always read data sources and dashboards.</p>
        <PrimaryButton type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Please wait…" : "Issue agent token"}
        </PrimaryButton>
        {create.error ? <p role="alert" className="text-rose-300">{create.error.message}</p> : null}
        {issued ? (
          <div className="rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm">
            <div className="mb-1 text-mist">Copy this token now. You cannot retrieve it later.</div>
            <code className="block break-all select-all text-accent">{issued.token}</code>
            <GhostButton className="mt-3" type="button" onClick={() => void copyToken()}>
              Copy token
            </GhostButton>
            <p role="status" className={copyStatus ? "mt-2 text-mist" : "sr-only"}>{copyStatus}</p>
          </div>
        ) : null}
      </form>

      {tokens.isPending ? <p role="status" className="mt-8 text-sm text-mist">Please wait for the agents.</p> : null}
      {tokens.error ? <p role="alert" className="mt-8 text-sm text-rose-300">{tokens.error.message}</p> : null}
      {revoke.error ? <p role="alert" className="mt-8 text-sm text-rose-300">{revoke.error.message}</p> : null}
      <div className="mt-8 overflow-x-auto rounded-2xl border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/4 text-mist">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Connection</th>
              <th className="px-4 py-3 font-medium">Workspace</th>
              <th className="px-4 py-3 font-medium">Scopes</th>
              <th className="px-4 py-3 font-medium">Last used</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {tokens.isSuccess && agents.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-mist">
                  No agents yet. Connect an agent with OAuth or issue a token.
                </td>
              </tr>
            ) : null}
            {agents.map((agent) => (
              <tr key={agent.id} className="border-t border-line">
                <td className="px-4 py-3">{agent.name}</td>
                <td className="px-4 py-3">
                  {agent.kind === "oauth" ? (
                    <>OAuth{agent.clientName ? <span className="text-mist"> · {agent.clientName}</span> : null}</>
                  ) : (
                    <>
                      Token <span className="font-mono text-xs text-mist">{agent.prefix}…</span>
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  {workspaces.find((item) => item.id === agent.workspaceId)?.name ?? "No access"}
                </td>
                <td className="px-4 py-3">{agent.scopes.join(", ")}</td>
                <td className="px-4 py-3 text-mist">{formatDate(agent.lastUsedAt, "Never")}</td>
                <td className="px-4 py-3 text-mist">{formatDate(agent.expiresAt, "Never")}</td>
                <td className="px-4 py-3 text-right">
                  <GhostButton type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(agent.id)}>
                    Revoke
                  </GhostButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
