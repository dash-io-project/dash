import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { DangerButton, Field, GhostButton, PrimaryButton, Select, TextInput } from "~/components/ui";
import { SecretReveal } from "~/components/secret-reveal";

const DAY_MS = 86_400_000;
const SOON_MS = 7 * DAY_MS;

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["api-users"] }),
    queryClient.invalidateQueries({ queryKey: ["tokens"] }),
  ]);
}

function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "warn" | "danger"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
        tone === "neutral" && "border-line text-mist",
        tone === "accent" && "border-accent/40 text-accent",
        tone === "warn" && "border-amber-400/40 text-amber-200",
        tone === "danger" && "border-rose-400/40 text-rose-200",
      )}
    >
      {children}
    </span>
  );
}

const STATE_BADGE: Record<TokenState, { tone: "accent" | "warn" | "danger"; label: string }> = {
  active: { tone: "accent", label: "Active" },
  soon: { tone: "warn", label: "Expires soon" },
  expired: { tone: "danger", label: "Expired" },
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
  const size = compact ? "px-3 py-1.5" : undefined;
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
      <GhostButton ref={triggerRef} type="button" className={size} aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {label}
      </GhostButton>
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
      {compact ? null : <span className="text-xs text-mist">{question}</span>}
      <DangerButton ref={confirmRef} type="button" className={size} disabled={pending} onClick={onConfirm}>
        {pending ? "Please wait…" : confirmLabel}
      </DangerButton>
      <GhostButton type="button" className={size} onClick={cancel}>
        Cancel
      </GhostButton>
    </span>
  );
}

function ExpirySelect({ value, onChange, label }: { value: number; onChange: (days: number) => void; label: string }) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {API_TOKEN_EXPIRY_DAYS.map((days) => (
          <option key={days} value={days}>
            {expiryLabel(days)}
          </option>
        ))}
      </Select>
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
    <form
      aria-labelledby="create-api-user"
      className="mt-8 space-y-4 rounded-2xl border border-line bg-panel p-6"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h2 id="create-api-user" className="text-lg font-semibold">Create an API user</h2>
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
        <legend className="mb-2 text-sm text-mist">Access</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm has-[:checked]:border-accent/60">
            <input
              type="radio"
              name="api-user-access"
              className="mt-0.5"
              checked={access === "read"}
              onChange={() => setAccess("read")}
            />
            <span>
              <span className="block font-medium">Read</span>
              <span className="block text-mist">Read dashboards and query data sources.</span>
            </span>
          </label>
          <label
            className={cn(
              "flex items-start gap-3 rounded-xl border border-line p-3 text-sm has-[:checked]:border-accent/60",
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
              <span className="block text-mist">
                {canWrite ? "Also create and change dashboards." : "You have viewer access to this workspace."}
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      <ExpirySelect label="First token expires after" value={expiresInDays} onChange={setExpiresInDays} />
      <p className="text-sm text-mist">
        The API user acts as you. It can use dashboards only in the <strong>{workspace.name}</strong> workspace. Data
        sources follow your organization access.
      </p>
      <PrimaryButton type="submit" disabled={create.isPending || !name.trim()}>
        {create.isPending ? "Please wait…" : "Create API user"}
      </PrimaryButton>
      {create.error ? <p role="alert" className="text-sm text-rose-300">{create.error.message}</p> : null}
    </form>
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
      className="mt-4 grid gap-3 rounded-xl border border-line bg-ink/40 p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
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
        <PrimaryButton type="submit" disabled={issue.isPending || !label.trim()}>
          {issue.isPending ? "Please wait…" : "Create token"}
        </PrimaryButton>
        <GhostButton type="button" onClick={onCancel}>
          Cancel
        </GhostButton>
      </div>
      {issue.error ? <p role="alert" className="text-sm text-rose-300 sm:col-span-3">{issue.error.message}</p> : null}
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
    <li className="rounded-2xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <KeyRound size={16} aria-hidden="true" className="text-accent" />
            <span className="truncate">{apiUser.name}</span>
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{apiUser.scopes.includes("write") ? "Read and write" : "Read"}</Badge>
            <Badge>{workspaceName}</Badge>
            <span className="text-xs text-mist">
              Created {formatDate(apiUser.createdAt, "")} · Last used {formatDate(apiUser.lastUsedAt, "never")} ·
              Acts as you
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!adding ? (
            <GhostButton
              ref={newTokenRef}
              type="button"
              className="inline-flex items-center gap-1.5"
              disabled={!canAdd}
              aria-label={`New token for ${apiUser.name}`}
              onClick={() => setAdding(true)}
            >
              <Plus size={14} aria-hidden="true" />
              New token
            </GhostButton>
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
      {remove.error ? <p role="alert" className="mt-3 text-sm text-rose-300">{remove.error.message}</p> : null}
      {revoke.error ? <p role="alert" className="mt-3 text-sm text-rose-300">{revoke.error.message}</p> : null}

      {apiUser.tokens.length === 0 ? (
        <p className="mt-4 text-sm text-mist">This API user has no tokens. Create a token to use it.</p>
      ) : (
        <div className="relative mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Tokens of {apiUser.name}</caption>
            <thead className="bg-white/4 text-mist">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Label</th>
                <th scope="col" className="px-3 py-2 font-medium">Token</th>
                <th scope="col" className="px-3 py-2 font-medium">Created</th>
                <th scope="col" className="px-3 py-2 font-medium">Last used</th>
                <th scope="col" className="px-3 py-2 font-medium">Expires</th>
                <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {apiUser.tokens.map((token) => {
                const state = STATE_BADGE[tokenState(token, now)];
                return (
                  <tr key={token.id} className="border-t border-line align-middle">
                    <td className="px-3 py-2">{token.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-mist">{token.prefix}…</td>
                    <td className="px-3 py-2 text-mist">{formatDate(token.createdAt, "")}</td>
                    <td className="px-3 py-2 text-mist">{formatDate(token.lastUsedAt, "Never")}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className="text-mist">{formatDate(token.expiresAt, "Never")}</span>
                        <Badge tone={state.tone}>{state.label}</Badge>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
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
      <p className="mt-3 text-xs text-mist">
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
  const now = Date.now();

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
    <div className="max-w-5xl">
      <h1 className="text-3xl font-semibold">API tokens</h1>
      <p className="mt-2 text-sm text-mist">
        An API user is an identity for a script, a service, or an integration that calls the Dash REST API. Each API
        user can have more than one token. To rotate a token, create a new token, update your app, and then revoke the
        old token.
      </p>

      {issued ? (
        <div className="mt-6">
          <SecretReveal
            secret={issued.token}
            title={`New token for ${issued.apiUserName}: ${issued.label}`}
            onDismiss={() => setIssued(null)}
          >
            <div className="mt-3 text-mist">Test the token:</div>
            <code className="mt-1 block break-all rounded-lg bg-ink px-3 py-2 font-mono text-xs select-all">
              curl -H "Authorization: Bearer {issued.token}" {origin}/api/auth/me
            </code>
          </SecretReveal>
        </div>
      ) : null}

      <CreateApiUserForm onIssued={setIssued} />

      <section aria-labelledby="api-users-heading" className="mt-10">
        <h2 id="api-users-heading" className="text-lg font-semibold">
          API users{" "}
          {apiUsers.data ? <span className="ml-1 text-sm font-normal text-mist">{apiUsers.data.length}</span> : null}
        </h2>
        <p ref={statusRef} tabIndex={-1} role="status" className={announcement ? "mt-2 text-sm text-mist outline-none" : "sr-only"}>
          {announcement}
        </p>
        {apiUsers.isPending ? <p role="status" className="mt-4 text-sm text-mist">Please wait for the API users.</p> : null}
        {apiUsers.error ? <p role="alert" className="mt-4 text-sm text-rose-300">{apiUsers.error.message}</p> : null}
        {apiUsers.isSuccess && apiUsers.data.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-mist">
            No API users yet. Create an API user to get a token.
          </p>
        ) : null}
        {apiUsers.data && apiUsers.data.length > 0 ? (
          <ul className="mt-4 space-y-4">
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
      </section>
    </div>
  );
}
