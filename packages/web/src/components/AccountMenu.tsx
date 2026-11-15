import { useEffect, useId, useRef, useState } from "react";
import type { PublicUser } from "@dash/core";
import { USER_ROLE_LABELS } from "@dash/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, LogOut, Monitor, Moon, Sun, UserRound, type LucideIcon } from "lucide-react";
import { api } from "~/lib/api";
import { type Appearance, chooseAppearance, useAppearance } from "~/lib/appearance";
import { ICON_STROKE } from "./ui";

const APPEARANCES: readonly { value: Appearance; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** The first letters of the first two words of a name. */
function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");
  return letters.toUpperCase() || "?";
}

/** The account button at the bottom of the sidebar, and its panel: identity, Appearance, Profile and Sign out. */
export function AccountMenu({ user }: { user: PublicUser }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const appearance = useAppearance();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // The panel takes the key. The navigation drawer stays open.
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    queryClient.clear();
    await navigate({ to: "/login", search: { workspace: undefined } });
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        className="nav-item w-full text-left text-foreground"
        aria-label={`Account: ${user.name}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{user.name}</span>
        <ChevronsUpDown size={14} strokeWidth={ICON_STROKE} aria-hidden="true" className="shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div id={panelId} className="menu-panel absolute bottom-full left-0 z-40 mb-2 w-[272px] max-w-[calc(100vw-24px)]">
          <div className="flex items-center gap-2.5 px-2 pb-2.5 pt-1.5">
            <span className="avatar avatar-lg" aria-hidden="true">
              {initials(user.name)}
            </span>
            <div className="min-w-0 leading-snug">
              <div className="truncate font-semibold">{user.name}</div>
              <div className="truncate text-[13px] text-muted-foreground" title={user.email}>
                {user.email}
              </div>
              <div className="text-[13px] text-muted-foreground">{USER_ROLE_LABELS[user.role]}</div>
            </div>
          </div>
          <div className="menu-separator" />
          {/* A choice applies at once. The panel stays open. */}
          <fieldset>
            <legend className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Appearance</legend>
            <div className="appearance-options">
              {APPEARANCES.map((option) => (
                <label key={option.value} className="appearance-option">
                  <input
                    type="radio"
                    name="appearance"
                    value={option.value}
                    checked={appearance === option.value}
                    onChange={() => chooseAppearance(option.value)}
                  />
                  <option.icon size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="menu-separator" />
          <Link to="/profile" className="menu-item" onClick={() => setOpen(false)}>
            <UserRound size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="text-muted-foreground" />
            Profile
          </Link>
          <button type="button" className="menu-item" onClick={() => void logout()}>
            <LogOut size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="text-muted-foreground" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
