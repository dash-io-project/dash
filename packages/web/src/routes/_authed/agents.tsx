import { createFileRoute } from "@tanstack/react-router";
import { AgentManager } from "~/components/agent-manager";

export const Route = createFileRoute("/_authed/agents")({
  component: AgentManager,
});
