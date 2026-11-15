import { useEffect, useId, useRef, useState } from "react";
import type { PublicUser } from "@dash/core";
import { Link, Navigate, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Boxes,
  Database,
  KeyRound,
  LayoutDashboard,
  Menu,
  Settings,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { fetchMe } from "~/lib/session";
import { cn } from "~/lib/cn";
import { AccountMenu } from "./AccountMenu";
import { BrandMark, FullPageMessage, ICON_STROKE, IconButton } from "./ui";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceProvider";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

interface NavItem {
  to: "/dashboards" | "/data-sources" | "/workspaces" | "/members" | "/tokens" | "/agents" | "/settings";
  label: string;
  icon: LucideIcon;
  /** Only an administrator sees the item. */
  admin?: boolean;
}

// The Profile page has no row here. The account panel has its link.
const NAV_GROUPS: readonly { label: string; items: readonly NavItem[] }[] = [
  {
    label: "Analytics",
    items: [
      { to: "/dashboards", label: "Dashboards", icon: LayoutDashboard },
      { to: "/data-sources", label: "Data sources", icon: Database, admin: true },
    ],
  },
  {
    label: "Organization",
    items: [
      { to: "/workspaces", label: "Workspaces", icon: Boxes },
      { to: "/members", label: "Members", icon: Users },
      { to: "/tokens", label: "API tokens", icon: KeyRound },
      { to: "/agents", label: "Agents", icon: Bot },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const DRAWER_LAYOUT = "(max-width: 900px)";

export function AppShell({ user }: { user: PublicUser }) {
  const { workspaces } = useWorkspace();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // At 900px and below, the sidebar is a drawer. The menu button opens it.
  const [navOpen, setNavOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebarId = useId();

  // A link in the drawer opens a page. The drawer then closes.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Above 900px the page has no drawer. A phone that turns on its side can go above 900px.
  useEffect(() => {
    const drawerLayout = matchMedia(DRAWER_LAYOUT);
    const close = () => setNavOpen(false);
    drawerLayout.addEventListener("change", close);
    return () => drawerLayout.removeEventListener("change", close);
  }, []);

  // The open drawer has the focus, and Escape closes it. When it closes, the focus
  // goes back to the menu button.
  useEffect(() => {
    if (!navOpen) return;
    const button = menuButton.current;
    sidebar.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setNavOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // On a wide window the button does not show, and `focus` does nothing.
      button?.focus();
    };
  }, [navOpen]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {/* The top bar shows at 900px and below. While the drawer is open, the top bar and
          the page are inert: the Tab key stays in the drawer, and the page does not scroll. */}
      <div className="shell-topbar" inert={navOpen}>
        <IconButton
          ref={menuButton}
          label="Open menu"
          aria-expanded={navOpen}
          aria-controls={sidebarId}
          onClick={() => setNavOpen(true)}
        >
          <Menu size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </IconButton>
        <Link to="/dashboards" className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7" />
          <span className="text-[15px] font-semibold">Dash</span>
        </Link>
      </div>
      <aside
        ref={sidebar}
        id={sidebarId}
        tabIndex={-1}
        aria-label="Sidebar"
        className={cn("sidebar outline-none", navOpen && "sidebar-open")}
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          <Link to="/dashboards" className="flex min-w-0 items-center gap-2.5 rounded-md">
            <BrandMark />
            <span className="text-[15px] font-semibold">Dash</span>
          </Link>
          <IconButton label="Close menu" className="sidebar-close" onClick={() => setNavOpen(false)}>
            <X size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </IconButton>
        </div>
        {workspaces.length > 1 ? (
          <div className="px-3 pt-4">
            <WorkspaceSwitcher userId={user.id} />
          </div>
        ) : null}
        <nav aria-label="Main" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.admin || user.role === "admin");
            return (
              <div key={group.label}>
                <div className="nav-heading">{group.label}</div>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                    return (
                      <li key={item.to}>
                        <Link to={item.to} aria-current={active ? "page" : undefined} className="nav-item">
                          <item.icon size={17} strokeWidth={ICON_STROKE} aria-hidden="true" className="shrink-0" />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <AccountMenu user={user} />
        </div>
      </aside>
      <main id="main" tabIndex={-1} className="shell-main" inert={navOpen}>
        <Outlet />
      </main>
      {navOpen ? (
        <button
          type="button"
          className="shell-backdrop"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setNavOpen(false)}
        />
      ) : null}
    </div>
  );
}

export function AuthedGate() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const router = useRouter();
  if (me.isLoading) {
    return <FullPageMessage>Loading workspace…</FullPageMessage>;
  }
  if (me.isError || !me.data) {
    // Return to this page after sign-in, so that a shared dashboard or chart
    // link still works. Read the location once: a subscription re-renders this
    // gate on each navigation, and `Navigate` then navigates again in a loop.
    return <Navigate to="/login" search={{ redirect: router.state.location.href }} />;
  }
  return <WorkspaceProvider key={me.data.id} user={me.data}><AppShell user={me.data} /></WorkspaceProvider>;
}
