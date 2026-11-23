import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PublicUser, Workspace, WorkspaceMember, WorkspaceMemberRole } from "@dash/core";
import { useWorkspace } from "~/components/WorkspaceProvider";
import { PageBody, PageHeader } from "~/components/PageHeader";
import { Select, type SelectOption } from "~/components/Select";
import { Badge, Button, Card, Field, Panel, TextInput } from "~/components/ui";
import { api } from "~/lib/api";
import { fetchMe } from "~/lib/session";

export const Route = createFileRoute("/_authed/workspaces")({ component: WorkspacesPage });

const ACCESS_OPTIONS: SelectOption<WorkspaceMemberRole>[] = [
  { value: "viewer", label: "Viewer", description: "Can view dashboards" },
  { value: "editor", label: "Editor", description: "Can create, change, and delete dashboards" },
];

function WorkspacesPage() {
  const { workspace, selectWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const [newName, setNewName] = useState("");
  const [name, setName] = useState(workspace.name);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<WorkspaceMemberRole>("viewer");
  const [copyStatus, setCopyStatus] = useState("");
  const members = useQuery({
    queryKey: ["workspace-members", workspace.id],
    enabled: workspace.canManage,
    queryFn: async () =>
      (await api<{ members: WorkspaceMember[] }>(`/api/workspaces/${workspace.id}/members`))
        .members,
  });
  const people = useQuery({
    queryKey: ["members"],
    enabled: workspace.canManage,
    queryFn: async () => (await api<{ members: PublicUser[] }>("/api/members")).members,
  });
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-members", workspace.id] }),
    ]);
  }
  const create = useMutation({
    mutationFn: () =>
      api<{ workspace: Workspace }>("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      }),
    onSuccess: async (payload) => {
      await refresh();
      selectWorkspace(payload.workspace.id);
    },
  });
  const rename = useMutation({
    mutationFn: () =>
      api(`/api/workspaces/${workspace.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: refresh,
  });
  const share = useMutation({
    mutationFn: (input: { userId: string; role: WorkspaceMemberRole | null }) =>
      api(`/api/workspaces/${workspace.id}/members`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      setUserId("");
      await refresh();
    },
  });
  const failure = create.error ?? rename.error ?? share.error ?? members.error ?? people.error;
  const candidates = (people.data ?? []).filter(
    (person) => !members.data?.some((member) => member.id === person.id),
  );

  const access = workspace.role === "owner" ? "Manager" : workspace.role === "editor" ? "Editor" : "Viewer";

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="Each workspace has its own dashboards. Data sources belong to the organization."
      />
      <PageBody column="narrow">
        {failure ? (
          <p role="alert" className="text-negative">
            {failure.message}
          </p>
        ) : null}
        <Panel
          title={workspace.name}
          note={
            <>
              {workspace.kind === "personal"
                ? "The owner controls access to this personal workspace."
                : "Organization admins control access to this shared workspace."}{" "}
              Your access: {access}.
            </>
          }
        >
          {workspace.canManage ? (
            <Card className="p-5">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  rename.mutate();
                }}
              >
                <div className="min-w-48 flex-1">
                  <Field label="Workspace name">
                    <TextInput
                      required
                      maxLength={80}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Field>
                </div>
                <Button disabled={rename.isPending || !name.trim()} type="submit">
                  Save name
                </Button>
              </form>
            </Card>
          ) : (
            <p className="text-muted-foreground">Ask a workspace manager to change access.</p>
          )}
        </Panel>
        {workspace.canManage ? (
          <>
            <Panel
              title="People with access"
              note={workspace.kind === "shared" ? "All organization admins have manager access." : undefined}
              actions={
                <Button
                  type="button"
                  onClick={async () => {
                    try {
                      const url = new URL("/dashboards", window.location.origin);
                      url.searchParams.set("workspace", workspace.id);
                      await navigator.clipboard.writeText(url.href);
                      setCopyStatus("Workspace link copied. Only people with access can open it.");
                    } catch {
                      setCopyStatus("Could not copy the link. Copy the page URL from your browser.");
                    }
                  }}
                >
                  Copy workspace link
                </Button>
              }
            >
              <p role="status" className={copyStatus ? "mb-3 text-[13px] text-muted-foreground" : "sr-only"}>
                {copyStatus}
              </p>
              <Card>
                <ul className="card-list">
                  {(members.data ?? []).map((member) => (
                    <li
                      key={member.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{member.name}</p>
                        <p className="truncate text-[13px] text-muted-foreground">{member.email}</p>
                      </div>
                      {member.role === "owner" ? (
                        <Badge>Manager</Badge>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Select
                            aria-label={`Access for ${member.name}`}
                            className="w-28"
                            value={member.role}
                            disabled={share.isPending}
                            options={ACCESS_OPTIONS}
                            onValueChange={(role) => share.mutate({ userId: member.id, role })}
                          />
                          <Button
                            type="button"
                            disabled={share.isPending}
                            onClick={() => share.mutate({ userId: member.id, role: null })}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </Panel>
            <Panel title="Share this workspace" note="Give an organization member access to the dashboards of this workspace.">
              <Card className="p-5">
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    share.mutate({ userId, role });
                  }}
                >
                  <Field label="Share with an organization member">
                    <Select
                      value={userId}
                      placeholder="Select a person"
                      options={candidates.map((person) => ({
                        value: person.id,
                        label: person.name,
                        description: person.email,
                      }))}
                      onValueChange={setUserId}
                    />
                  </Field>
                  <Field label="Access">
                    <Select value={role} options={ACCESS_OPTIONS} onValueChange={setRole} />
                  </Field>
                  <Button variant="primary" type="submit" disabled={!userId || share.isPending}>
                    Share workspace
                  </Button>
                </form>
              </Card>
            </Panel>
          </>
        ) : null}
        {me.data?.role === "admin" ? (
          <Panel
            title="Create a shared workspace"
            note="Only organization admins have access until you share it."
          >
            <Card className="p-5">
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  create.mutate();
                }}
              >
                <Field label="Name">
                  <TextInput
                    required
                    maxLength={80}
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                </Field>
                <Button variant="primary" type="submit" disabled={!newName.trim() || create.isPending}>
                  Create workspace
                </Button>
              </form>
            </Card>
          </Panel>
        ) : null}
      </PageBody>
    </>
  );
}
