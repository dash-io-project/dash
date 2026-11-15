import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Team page is now the Members page. Keep old links working. */
export const Route = createFileRoute("/_authed/team")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/members", search, replace: true });
  },
});
