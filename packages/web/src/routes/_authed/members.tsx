import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import type { PublicInvitation, PublicUser, UserRole } from "@dash/core";
import { USER_ROLE_LABELS, USER_ROLES } from "@dash/core";
import { api } from "~/lib/api";
import { invitationUrl } from "~/lib/invitation";
import { fetchMe } from "~/lib/session";
import { PageBody, PageHeader } from "~/components/PageHeader";
import { Select, type SelectOption } from "~/components/Select";
import { Badge, Button, Card, Field, ICON_STROKE, Panel, TextInput } from "~/components/ui";

export const Route = createFileRoute("/_authed/members")({
  component: MembersPage,
});

const ROLE_OPTIONS: SelectOption<UserRole>[] = USER_ROLES.map((value) => ({
  value,
  label: USER_ROLE_LABELS[value],
}));

interface IssuedInvitation {
  email: string;
  role: UserRole;
  url: string;
}

function useInvite(onIssued: (issued: IssuedInvitation) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; role: UserRole }) =>
      api<{ token: string; invitation: PublicInvitation }>("/api/invitations", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: async (payload) => {
      onIssued({
        email: payload.invitation.email,
        role: payload.invitation.role,
        url: invitationUrl(window.location.origin, payload.token),
      });
      await queryClient.invalidateQueries({ queryKey: ["invitations"] });
    },
  });
}

function MembersPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const isAdmin = me.data?.role === "admin";
  const members = useQuery({
    queryKey: ["members"],
    queryFn: async () => (await api<{ members: PublicUser[] }>("/api/members")).members,
  });
  const invitations = useQuery({
    queryKey: ["invitations"],
    queryFn: async () =>
      (await api<{ invitations: PublicInvitation[] }>("/api/invitations")).invitations,
    enabled: isAdmin,
  });
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);

  return (
    <>
      <PageHeader title="Members" description="Everyone with access to this organization." />
      <PageBody column="wide">
        <p className="text-muted-foreground">
          Admins can invite people, change roles, and manage data sources and settings. Users can build
          dashboards and issue their own API tokens.
        </p>

        {isAdmin ? <InviteForm onIssued={setIssued} /> : null}
        {issued ? <IssuedLink issued={issued} onDismiss={() => setIssued(null)} /> : null}

        <Panel
          title="Active members"
          actions={
            members.data ? (
              <span className="tabular text-[13px] text-muted-foreground">
                {members.data.length} {members.data.length === 1 ? "person" : "people"}
              </span>
            ) : null
          }
        >
          {members.isError ? (
            <p className="text-negative">
              {members.error instanceof Error ? members.error.message : "Could not load members"}
            </p>
          ) : members.data && me.data ? (
            <MembersTable members={members.data} me={me.data} canManage={isAdmin} />
          ) : (
            <p className="text-muted-foreground">Loading members…</p>
          )}
        </Panel>

        {isAdmin ? (
          <Panel title="Pending invitations">
            {invitations.data && invitations.data.length > 0 ? (
              <InvitationsTable invitations={invitations.data} onIssued={setIssued} />
            ) : invitations.isError ? (
              <p className="text-negative">
                {invitations.error instanceof Error
                  ? invitations.error.message
                  : "Could not load invitations"}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {invitations.isPending ? "Loading invitations…" : "No open invitations."}
              </p>
            )}
          </Panel>
        ) : null}
      </PageBody>
    </>
  );
}

function InviteForm({ onIssued }: { onIssued: (issued: IssuedInvitation) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const invite = useInvite((issued) => {
    setEmail("");
    onIssued(issued);
  });

  return (
    <Panel
      title="Invite someone"
      note="Dash creates a sign-up link for you to share. It works once, even while open registration is off, and expires in 7 days."
    >
    <Card className="p-5">
    <form
      onSubmit={(event) => {
        event.preventDefault();
        invite.mutate({ email, role });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <Field label="Email">
          <TextInput
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            autoComplete="off"
            required
          />
        </Field>
        <Field label="Role">
          <Select value={role} options={ROLE_OPTIONS} onValueChange={setRole} />
        </Field>
        <Button variant="primary" type="submit" disabled={invite.isPending}>
          <UserPlus size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
          {invite.isPending ? "Creating…" : "Create invite link"}
        </Button>
      </div>
      {invite.isError ? (
        <p className="mt-3 text-negative">
          {invite.error instanceof Error ? invite.error.message : "Could not create the invitation"}
        </p>
      ) : null}
    </form>
    </Card>
    </Panel>
  );
}

function IssuedLink({ issued, onDismiss }: { issued: IssuedInvitation; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      role="status"
      className="rounded-md border border-warning-border bg-warning-soft p-4"
    >
      <p>
        Invite link for <span className="font-medium">{issued.email}</span> as{" "}
        {USER_ROLE_LABELS[issued.role]}. Copy it now: it cannot be shown again.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <TextInput
          readOnly
          value={issued.url}
          aria-label="Invite link"
          onFocus={(event) => event.currentTarget.select()}
          className="bg-background font-mono text-xs"
        />
        <div className="flex gap-2">
          <Button type="button" onClick={() => void copy()}>
            {copied ? (
              <Check size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
            ) : (
              <Copy size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button type="button" onClick={onDismiss}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  return <Badge>{USER_ROLE_LABELS[role]}</Badge>;
}

function MembersTable({
  members,
  me,
  canManage,
}: {
  members: PublicUser[];
  me: PublicUser;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const adminCount = members.filter((member) => member.role === "admin").length;
  const changeRole = useMutation({
    mutationFn: async (input: { id: string; role: UserRole }) =>
      api<{ member: PublicUser }>(`/api/members/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: input.role }),
      }),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["members"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
  });

  return (
    <>
      {changeRole.isError ? (
        <p className="mb-3 text-negative">
          {changeRole.error instanceof Error ? changeRole.error.message : "Could not change role"}
        </p>
      ) : null}
      <div className="card table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isLastAdmin = member.role === "admin" && adminCount === 1;
              const pendingRole =
                changeRole.isPending && changeRole.variables.id === member.id
                  ? changeRole.variables.role
                  : undefined;
              return (
                <tr key={member.id}>
                  <td className="whitespace-nowrap">
                    <span className="font-medium">{member.name}</span>
                    {member.id === me.id ? (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground">{member.email}</td>
                  <td>
                    {canManage ? (
                      <Select
                        aria-label={`Role for ${member.name}`}
                        value={pendingRole ?? member.role}
                        disabled={changeRole.isPending || isLastAdmin}
                        title={isLastAdmin ? "The organization needs at least one admin" : undefined}
                        options={ROLE_OPTIONS}
                        onValueChange={(role) => changeRole.mutate({ id: member.id, role })}
                        className="w-28"
                      />
                    ) : (
                      <RoleBadge role={member.role} />
                    )}
                  </td>
                  <td className="tabular whitespace-nowrap text-muted-foreground">
                    {new Date(member.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function InvitationsTable({
  invitations,
  onIssued,
}: {
  invitations: PublicInvitation[];
  onIssued: (issued: IssuedInvitation) => void;
}) {
  const queryClient = useQueryClient();
  const reissue = useInvite(onIssued);
  const revoke = useMutation({
    mutationFn: async (id: string) => api(`/api/invitations/${id}`, { method: "DELETE" }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["invitations"] });
    },
  });
  const failure = reissue.error ?? revoke.error;

  return (
    <>
      {failure ? (
        <p className="mb-3 text-negative">
          {failure instanceof Error ? failure.message : "Could not update the invitation"}
        </p>
      ) : null}
      <div className="card table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Invited by</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>{invitation.email}</td>
                <td>
                  <RoleBadge role={invitation.role} />
                </td>
                <td className="text-muted-foreground">{invitation.invitedBy?.name ?? "—"}</td>
                <td className="whitespace-nowrap">
                  {invitation.status === "expired" ? (
                    <Badge tone="warning">Expired</Badge>
                  ) : (
                    <span className="tabular text-muted-foreground">
                      {new Date(invitation.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={reissue.isPending}
                      onClick={() =>
                        reissue.mutate({ email: invitation.email, role: invitation.role })
                      }
                    >
                      New link
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(invitation.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
