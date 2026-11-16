import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import {
  API_TOKEN_EXPIRY_DAYS,
  DEFAULT_API_TOKEN_EXPIRY_DAYS,
  MAX_ACTIVE_API_USER_TOKENS,
  type ApiUserScope,
  type PublicApiToken,
  type PublicApiUser,
} from "@dash/core";
import { api } from "~/lib/api";
import { cn } from "~/lib/cn";
import { useWorkspace } from "~/components/WorkspaceProvider";
import { PageBody, PageHeader } from "~/components/PageHeader";
import { Select, type SelectOption } from "~/components/Select";
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  EmptyState,
  Field,
  ICON_STROKE,
  Panel,
  TextInput,
} from "~/components/ui";
import { SecretReveal } from "~/components/secret-reveal";

const DAY_MS = 86_400_000;
const SOON_MS = 7 * DAY_MS;
const CLOCK_INTERVAL_MS = 60_000;

interface IssuedToken {
  apiUserName: string;
  tokenId: string;
  label: string;
  token: string;
}

type TokenState = "active" | "soon" | "expired";

function tokenState(token: PublicApiToken, now: number): TokenState {
  if (!token.expiresAt) return "active";
  const left = Date.parse(token.expiresAt) - now;
  if (left <= 0) return "expired";
  return left <= SOON_MS ? "soon" : "active";
}

function formatDate(value: string | null, empty: string): string {
  return value ? new Date(value).toLocaleDateString() : empty;
}

function expiryLabel(days: number): string {
  return days === 365 ? "1 year" : `${days} days`;
}

const EXPIRY_OPTIONS: SelectOption[] = API_TOKEN_EXPIRY_DAYS.map((days) => ({
  value: String(days),
  label: expiryLabel(days),
}));

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["api-users"] }),
    queryClient.invalidateQueries({ queryKey: ["tokens"] }),
  ]);
}

const STATE_BADGE: Record<TokenState, { tone: BadgeTone; label: string }> = {
  active: { tone: "positive", label: "Active" },
  soon: { tone: "warning", label: "Expires soon" },
  expired: { tone: "negative", label: "Expired" },
};

/** A button that asks for a second click. Escape or Cancel closes the question. */
function ConfirmAction({
  label,
  ariaLabel,
  question,
  confirmLabel,
  pending,
  onConfirm,
  compact = false,
}: {
  label: string;
  ariaLabel: string;
  question: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  /** Smaller buttons for a table row. The question stays as the name of the group. */
  compact?: boolean;
}) {
  const size = compact ? "sm" : undefined;
  const [open, setOpen] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  function cancel() {
    returnFocus.current = true;
    setOpen(false);
  }

  if (!open) {
    return (
      <Button ref={triggerRef} type="button" size={size} aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span
      role="group"
      aria-label={question}
      className="inline-flex items-center justify-end gap-2 whitespace-nowrap"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      {compact ? null : <span className="text-xs text-muted-foreground">{question}</span>}
      <Button variant="destructive" ref={confirmRef} type="button" size={size} disabled={pending} onClick={onConfirm}>
        {pending ? "Please wait…" : confirmLabel}
      </Button>
      <Button type="button" size={size} onClick={cancel}>
        Cancel
      </Button>
    </span>
  );
}

function ExpirySelect({ value, onChange, label }: { value: number; onChange: (days: number) => void; label: string }) {
  return (
    <Field label={label}>
      <Select
        value={String(value)}
        options={EXPIRY_OPTIONS}
        onValueChange={(days) => onChange(Number(days))}
      />
    </Field>
  );
}

function CreateApiUserForm({ onIssued }: { onIssued: (issued: IssuedToken) => void }) {
  const { workspace, workspaceApi } = useWorkspace();
  const queryClient = useQueryClient();
  const canWrite = workspace.role !== "viewer";
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"read" | "write">("read");
  const [expiresInDays, setExpiresInDays] = useState<number>(DEFAULT_API_TOKEN_EXPIRY_DAYS);

  const create = useMutation({
    mutationFn: async () => {
      const scopes: ApiUserScope[] = access === "write" ? ["read", "write"] : ["read"];
      return workspaceApi<{ apiUser: PublicApiUser; token: string; record: PublicApiToken }>("/api/api-users", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), scopes, token: { name: "Initial token", expiresInDays } }),
      });
    },
    gcTime: 0,
    onSuccess: async (payload) => {
      onIssued({
        apiUserName: payload.apiUser.name,
        tokenId: payload.record.id,
        label: payload.record.name,
        token: payload.token,
      });
      setName("");
      setAccess("read");
      await invalidate(queryClient);
    },
  });

  // The reveal panel holds the token. Do not keep a second copy in the mutation state.
  const { isSuccess: created, reset: resetCreate } = create;
  useEffect(() => {
    if (created) resetCreate();
  }, [created, resetCreate]);

  return (
    <Panel
      title={<span id="create-api-user">Create an API user</span>}
      note={
        <>
          The API user acts as you. It can use dashboards only in the{" "}
          <strong className="font-medium text-foreground">{workspace.name}</strong> workspace. Data sources follow
          your organization access.
        </>
      }
    >
    <Card className="p-5">
    <form
      aria-labelledby="create-api-user"
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
          placeholder="Billing sync"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <fieldset>
        <legend className="field-label">Access</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-md border border-input p-3 has-[:checked]:border-ring has-[:checked]:bg-surface">
            <input
              type="radio"
              name="api-user-access"
              className="mt-0.5"
              checked={access === "read"}
              onChange={() => setAccess("read")}
            />
            <span>
              <span className="block font-medium">Read</span>
              <span className="block text-[13px] text-muted-foreground">Read dashboards and query data sources.</span>
            </span>
          </label>
          <label
            className={cn(
              "flex items-start gap-3 rounded-md border border-input p-3 has-[:checked]:border-ring has-[:checked]:bg-surface",
              !canWrite && "opacity-60",
            )}
          >
            <input
              type="radio"
              name="api-user-access"
              className="mt-0.5"
              disabled={!canWrite}
              checked={access === "write"}
              onChange={() => setAccess("write")}
            />
            <span>
              <span className="block font-medium">Read and write</span>
              <span className="block text-[13px] text-muted-foreground">
                {canWrite ? "Also create and change dashboards." : "You have viewer access to this workspace."}
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      <ExpirySelect label="First token expires after" value={expiresInDays} onChange={setExpiresInDays} />
      <Button variant="primary" type="submit" disabled={create.isPending || !name.trim()}>
        {create.isPending ? "Please wait…" : "Create API user"}
      </Button>
      {create.error ? <p role="alert" className="text-negative">{create.error.message}</p> : null}
    </form>
    </Card>
    </Panel>
  );
}

function NewTokenForm({
  apiUser,
  onIssued,
  onCreated,
  onCancel,
}: {
  apiUser: PublicApiUser;
  onIssued: (issued: IssuedToken) => void;
  /** The reveal panel takes the focus after a new token. */
  onCreated: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const labelRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(`Token ${today()}`);
  useEffect(() => {
    labelRef.current?.select();
  }, []);
  const [expiresInDays, setExpiresInDays] = useState<number>(DEFAULT_API_TOKEN_EXPIRY_DAYS);
  const issue = useMutation({
    mutationFn: async () =>
      api<{ token: string; record: PublicApiToken }>(`/api/api-users/${apiUser.id}/tokens`, {
        method: "POST",
        body: JSON.stringify({ name: label.trim(), expiresInDays }),
      }),
    gcTime: 0,
    onSuccess: async (payload) => {
      onIssued({ apiUserName: apiUser.name, tokenId: payload.record.id, label: payload.record.name, token: payload.token });
      onCreated();
      await invalidate(queryClient);
    },
  });

  return (
    <form
      aria-label={`New token for ${apiUser.name}`}
      className="mt-4 grid gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        issue.mutate();
      }}
    >
      <Field label="Token label">
        <TextInput
          ref={labelRef}
          required
          maxLength={80}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <ExpirySelect label="Expires after" value={expiresInDays} onChange={setExpiresInDays} />
      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={issue.isPending || !label.trim()}>
          {issue.isPending ? "Please wait…" : "Create token"}
        </Button>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {issue.error ? <p role="alert" className="text-negative sm:col-span-3">{issue.error.message}</p> : null}
    </form>
  );
}

function ApiUserCard({
  apiUser,
  now,
  onIssued,
  onRevoked,
  onAnnounce,
}: {
  apiUser: PublicApiUser;
  now: number;
  onIssued: (issued: IssuedToken) => void;
  onRevoked: (tokenIds: string[]) => void;
  onAnnounce: (message: string) => void;
}) {
  const { workspaces } = useWorkspace();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const newTokenRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!adding && returnFocus.current) {
      returnFocus.current = false;
      newTokenRef.current?.focus();
    }
  }, [adding]);
  function closeForm(restoreFocus: boolean) {
    returnFocus.current = restoreFocus;
    setAdding(false);
  }
  const workspaceName =
    workspaces.find((item) => item.id === apiUser.workspaceId)?.name ??
    (apiUser.workspaceId ? "No access" : "No workspace");
  const activeCount = apiUser.tokens.filter((token) => tokenState(token, now) !== "expired").length;
  const atLimit = activeCount >= MAX_ACTIVE_API_USER_TOKENS;
  const canAdd = Boolean(apiUser.workspaceId) && !atLimit;

  const revoke = useMutation({
    mutationFn: async (token: PublicApiToken) =>
      api(`/api/api-users/${apiUser.id}/tokens/${token.id}`, { method: "DELETE" }),
    onSuccess: async (_, token) => {
      onRevoked([token.id]);
      onAnnounce(`You revoked token ${token.name} of ${apiUser.name}.`);
      await invalidate(queryClient);
    },
  });

  const remove = useMutation({
    mutationFn: async () => api(`/api/api-users/${apiUser.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      onRevoked(apiUser.tokens.map((token) => token.id));
      onAnnounce(`You deleted API user ${apiUser.name} and revoked its tokens.`);
      await invalidate(queryClient);
    },
  });

  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold">
            <KeyRound size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="text-muted-foreground" />
            <span className="truncate">{apiUser.name}</span>
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge>{apiUser.scopes.includes("write") ? "Read and write" : "Read"}</Badge>
            <Badge>{workspaceName}</Badge>
            <span className="tabular text-xs text-muted-foreground">
              Created {formatDate(apiUser.createdAt, "")} · Last used {formatDate(apiUser.lastUsedAt, "never")} ·
              Acts as you
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!adding ? (
            <Button
              ref={newTokenRef}
              type="button"
              disabled={!canAdd}
              aria-label={`New token for ${apiUser.name}`}
              onClick={() => setAdding(true)}
            >
              <Plus size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
              New token
            </Button>
          ) : null}
          <ConfirmAction
            label="Delete"
            ariaLabel={`Delete API user ${apiUser.name}`}
            question="Delete this API user and revoke all of its tokens?"
            confirmLabel="Delete API user"
            pending={remove.isPending}
            onConfirm={() => remove.mutate()}
          />
        </div>
      </div>

      {adding ? (
        <NewTokenForm
          apiUser={apiUser}
          onIssued={onIssued}
          onCreated={() => closeForm(false)}
          onCancel={() => closeForm(true)}
        />
      ) : null}
      {remove.error ? <p role="alert" className="mt-3 text-negative">{remove.error.message}</p> : null}
      {revoke.error ? <p role="alert" className="mt-3 text-negative">{revoke.error.message}</p> : null}

      {apiUser.tokens.length === 0 ? (
        <p className="mt-4 text-muted-foreground">This API user has no tokens. Create a token to use it.</p>
      ) : (
        <div className="table-scroll relative mt-4 rounded-md border border-border">
          <table className="table">
            <caption className="sr-only">Tokens of {apiUser.name}</caption>
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Token</th>
                <th scope="col">Created</th>
                <th scope="col">Last used</th>
                <th scope="col">Expires</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {apiUser.tokens.map((token) => {
                const state = STATE_BADGE[tokenState(token, now)];
                return (
                  <tr key={token.id} className="align-middle">
                    <td>{token.name}</td>
                    <td className="text-muted-foreground"><code className="text-xs">{token.prefix}…</code></td>
                    <td className="tabular whitespace-nowrap text-muted-foreground">{formatDate(token.createdAt, "")}</td>
                    <td className="tabular whitespace-nowrap text-muted-foreground">{formatDate(token.lastUsedAt, "Never")}</td>
                    <td>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className="tabular text-muted-foreground">{formatDate(token.expiresAt, "Never")}</span>
                        <Badge tone={state.tone}>{state.label}</Badge>
                      </span>
                    </td>
                    <td className="text-right">
                      <ConfirmAction
                        label="Revoke"
                        ariaLabel={`Revoke token ${token.name} of ${apiUser.name}`}
                        question={`Revoke token ${token.name}?`}
                        confirmLabel="Confirm revoke"
                        compact
                        pending={revoke.isPending && revoke.variables?.id === token.id}
                        onConfirm={() => revoke.mutate(token)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="tabular mt-3 text-xs text-muted-foreground">
        {apiUser.workspaceId
          ? `${activeCount} of ${MAX_ACTIVE_API_USER_TOKENS} active tokens.`
          : "This API user has no workspace. Create a new API user to get a new token."}
        {atLimit ? " Revoke an old token to create a new token." : null}
      </p>
    </li>
  );
}

export function TokenManager() {
  const apiUsers = useQuery({
    queryKey: ["api-users"],
    queryFn: async () => (await api<{ apiUsers: PublicApiUser[] }>("/api/api-users")).apiUsers,
  });
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  // A token can expire while the page is open. Update the clock, so the badges and the limit follow.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  function announce(message: string) {
    setAnnouncement(message);
    // Focus goes to a stable element. The button that the person selected is gone.
    requestAnimationFrame(() => statusRef.current?.focus());
  }

  function revoked(tokenIds: string[]) {
    setIssued((current) => (current && tokenIds.includes(current.tokenId) ? null : current));
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <>
      <PageHeader
        title="API tokens"
        description="An API user is an identity for a script, a service, or an integration that calls the Dash REST API."
      />
      <PageBody column="wide">
      <p className="text-muted-foreground">
        Each API user can have more than one token. To rotate a token, create a new token first. Update your app
        with the new token. Then revoke the old token.
      </p>

      {issued ? (
        <SecretReveal
          secret={issued.token}
          title={`New token for ${issued.apiUserName}: ${issued.label}`}
          onDismiss={() => setIssued(null)}
        >
          <div className="mt-3 text-[13px]">Test the token:</div>
          <code className="mt-1 block break-all rounded-md border border-border bg-background px-3 py-2 text-xs select-all">
            curl -H "Authorization: Bearer {issued.token}" {origin}/api/auth/me
          </code>
        </SecretReveal>
      ) : null}

      <CreateApiUserForm onIssued={setIssued} />

      <Panel
        aria-labelledby="api-users-heading"
        title={
          <span id="api-users-heading">
            API users{" "}
            {apiUsers.data ? (
              <span className="tabular ml-1 font-normal text-muted-foreground">{apiUsers.data.length}</span>
            ) : null}
          </span>
        }
      >
        <p ref={statusRef} tabIndex={-1} role="status" className={announcement ? "mb-3 text-muted-foreground outline-none" : "sr-only"}>
          {announcement}
        </p>
        {apiUsers.isPending ? <p role="status" className="text-muted-foreground">Please wait for the API users.</p> : null}
        {apiUsers.error ? <p role="alert" className="text-negative">{apiUsers.error.message}</p> : null}
        {apiUsers.isSuccess && apiUsers.data.length === 0 ? (
          <EmptyState title="No API users yet.">Create an API user to get a token.</EmptyState>
        ) : null}
        {apiUsers.data && apiUsers.data.length > 0 ? (
          <ul className="space-y-4">
            {apiUsers.data.map((apiUser) => (
              <ApiUserCard
                key={apiUser.id}
                apiUser={apiUser}
                now={now}
                onIssued={setIssued}
                onRevoked={revoked}
                onAnnounce={announce}
              />
            ))}
          </ul>
        ) : null}
      </Panel>
      </PageBody>
    </>
  );
}
