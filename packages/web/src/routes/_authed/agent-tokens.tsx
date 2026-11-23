import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Agent tokens page is now the Agents page. Keep old links working. */
export const Route = createFileRoute("/_authed/agent-tokens")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/agents", search, replace: true });
  },
});
