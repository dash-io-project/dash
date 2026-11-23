import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FullPageMessage } from "~/components/ui";
import { fetchMe } from "~/lib/session";

export const Route = createFileRoute("/")({
  component: HomeRedirect,
});

function HomeRedirect() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  if (me.isPending) {
    return <FullPageMessage>Loading workspace…</FullPageMessage>;
  }

  if (me.data) {
    return <Navigate to="/dashboards" />;
  }

  return <Navigate to="/login" />;
}
