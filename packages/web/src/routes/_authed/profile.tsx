import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { USER_ROLE_LABELS } from "@dash/core";
import { api } from "~/lib/api";
import { fetchMe } from "~/lib/session";
import { PageBody, PageHeader } from "~/components/PageHeader";
import { Button, Card, Field, Panel, TextInput } from "~/components/ui";

export const Route = createFileRoute("/_authed/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const [name, setName] = useState<string>();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () =>
      api("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          name: name ?? me.data?.name,
          password: password || undefined,
        }),
      }),
    onSuccess: async () => {
      setPassword("");
      setMessage("Profile updated");
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  if (!me.data) {
    return <PageBody className="text-muted-foreground">Loading profile…</PageBody>;
  }

  return (
    <>
      <PageHeader title="Profile" description="Your name and your password in Dash." />
      <PageBody column="narrow">
        <Panel title="Account" note="You cannot change your email address or your role here.">
          <Card className="space-y-4 p-5">
            <Field label="Name">
              <TextInput value={name ?? me.data.name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Email">
              <TextInput value={me.data.email} disabled />
            </Field>
            <Field label="Role">
              <TextInput value={USER_ROLE_LABELS[me.data.role]} disabled />
            </Field>
            <Field label="New password">
              <TextInput
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Leave blank to keep the current password"
              />
            </Field>
            {message ? <p className="text-positive">{message}</p> : null}
            {save.isError ? (
              <p className="text-negative">
                {save.error instanceof Error ? save.error.message : "Update failed"}
              </p>
            ) : null}
            <Button variant="primary" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save profile"}
            </Button>
          </Card>
        </Panel>
      </PageBody>
    </>
  );
}
