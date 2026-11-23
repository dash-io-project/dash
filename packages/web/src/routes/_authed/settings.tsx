import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ALLOWED_EMAIL_DOMAIN_MESSAGES,
  parseAllowedEmailDomainText,
  type OrganizationSettings,
} from "@dash/core";
import { api } from "~/lib/api";
import { fetchMe } from "~/lib/session";
import { PageBody, PageHeader } from "~/components/PageHeader";
import { Button, Card, CheckRow, Field, Panel, TextArea, TextInput } from "~/components/ui";
import { McpConnectionBanner } from "~/components/mcp-connection-banner";
import { DevSeedPanel } from "~/components/dev-seed-panel";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const payload = await api<{ settings: OrganizationSettings }>("/api/settings");
      return payload.settings;
    },
  });
  const [name, setName] = useState<string>();
  const [allowRegistration, setAllowRegistration] = useState<boolean>();
  const [domainsText, setDomainsText] = useState<string>();
  const save = useMutation({
    mutationFn: async () => {
      const parsed = parseAllowedEmailDomainText(
        domainsText ?? (settings.data?.allowedEmailDomains ?? []).join("\n"),
      );
      if (!parsed.ok) {
        throw new Error(ALLOWED_EMAIL_DOMAIN_MESSAGES[parsed.reason]);
      }
      return api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          name: name ?? settings.data?.name,
          allowRegistration: allowRegistration ?? settings.data?.allowRegistration,
          allowedEmailDomains: parsed.domains,
        }),
      });
    },
    onSuccess: async () => {
      setName(undefined);
      setAllowRegistration(undefined);
      setDomainsText(undefined);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const current = settings.data;
  const isAdmin = me.data?.role === "admin";

  return (
    <>
      <PageHeader
        title="Settings"
        description="Set your organization preferences here. Use the API tokens page to manage tokens. Use the Agents page to manage agents."
      />
      <PageBody column="narrow">
        <Panel
          title="Organization"
          note={
            isAdmin
              ? "The name of the organization, and who can create an account."
              : "Only administrators can change these settings."
          }
        >
          {current ? (
            <Card className="space-y-4 p-5">
              <Field label="Organization name">
                <TextInput
                  value={name ?? current.name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!isAdmin}
                />
              </Field>
              <CheckRow
                checked={allowRegistration ?? current.allowRegistration}
                onChange={(event) => setAllowRegistration(event.target.checked)}
                disabled={!isAdmin}
              >
                Allow new account registration
              </CheckRow>
              <Field label="Email domains that can create accounts">
                <TextArea
                  value={domainsText ?? current.allowedEmailDomains.join("\n")}
                  onChange={(event) => setDomainsText(event.target.value)}
                  disabled={!isAdmin}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="example.com"
                  rows={4}
                  aria-describedby="allowed-email-domains-hint"
                />
              </Field>
              <p id="allowed-email-domains-hint" className="text-[13px] text-muted-foreground">
                Use one domain on each line, such as example.com. A domain matches only that domain.
                An empty list allows every domain. Invitations use this list too.
              </p>
              {isAdmin ? (
                <>
                  {save.isError ? (
                    <p className="text-negative">
                      {save.error instanceof Error ? save.error.message : "Could not save settings."}
                    </p>
                  ) : null}
                  <Button variant="primary" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
                    {save.isPending ? "Saving…" : "Save settings"}
                  </Button>
                </>
              ) : null}
            </Card>
          ) : (
            <p className="text-muted-foreground">Loading settings…</p>
          )}
        </Panel>
        {isAdmin ? <DevSeedPanel /> : null}
        <McpConnectionBanner />
      </PageBody>
    </>
  );
}
