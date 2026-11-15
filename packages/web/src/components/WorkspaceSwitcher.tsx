import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronsUpDown, UserRound, Users } from "lucide-react";
import type { Workspace } from "@dash/core";
import { cn } from "~/lib/cn";
import { ICON_STROKE } from "./ui";
import { useWorkspace } from "./WorkspaceProvider";

function WorkspaceIcon({ workspace }: { workspace: Workspace }) {
  const Icon = workspace.kind === "personal" ? UserRound : Users;
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-border bg-hover text-foreground">
      <Icon size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
    </span>
  );
}

export function WorkspaceSwitcher({ userId }: { userId: string }) {
  const { workspace, workspaces, selectWorkspace } = useWorkspace();
  const [supportsPopover, setSupportsPopover] = useState(false);

  useEffect(() => {
    setSupportsPopover(
      "popover" in HTMLElement.prototype &&
        typeof HTMLElement.prototype.showPopover === "function" &&
        typeof HTMLElement.prototype.hidePopover === "function",
    );
  }, []);

  if (supportsPopover) return <WorkspaceMenu userId={userId} />;

  return (
    <label className="relative block">
      <span className="sr-only">Switch workspace</span>
      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center">
        <WorkspaceIcon workspace={workspace} />
      </span>
      <select
        value={workspace.id}
        onChange={(event) => selectWorkspace(event.target.value)}
        className="input min-h-11 appearance-none truncate bg-control pl-11 pr-9 font-medium"
      >
        {workspaces.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
            {item.ownerId === userId ? " · Your workspace" : ""}
          </option>
        ))}
      </select>
      <ChevronsUpDown
        size={15}
        strokeWidth={ICON_STROKE}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
    </label>
  );
}

function WorkspaceMenu({ userId }: { userId: string }) {
  const { workspace, workspaces, selectWorkspace } = useWorkspace();
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function close(event: Event) {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      menu.current?.hidePopover();
    }
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function positionMenu() {
    if (!trigger.current || !menu.current) return;
    search.current = { text: "", time: 0 };
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 288), window.innerWidth - 24);
    Object.assign(menu.current.style, {
      left: `${Math.min(rect.left, window.innerWidth - width - 12)}px`,
      top: `${rect.bottom + 8}px`,
      width: `${width}px`,
      maxHeight: `${Math.min(360, window.innerHeight - rect.bottom - 20)}px`,
    });
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [],
    );
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = Date.now();
      search.current.text =
        (now - search.current.time < 500 ? search.current.text : "") + event.key.toLowerCase();
      search.current.time = now;
      const match = workspaces.findIndex((item) =>
        item.name.toLowerCase().startsWith(search.current.text),
      );
      if (match !== -1) next = match;
    }
    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    }
    if (event.key === "Tab") {
      menu.current?.hidePopover();
      trigger.current?.focus();
    }
  }

  return (
    <div>
      <button
        ref={trigger}
        type="button"
        popoverTarget={menuId}
        aria-label={`Switch workspace, current workspace: ${workspace.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={positionMenu}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            positionMenu();
            menu.current?.showPopover();
          }
        }}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-md border border-control-border bg-control px-2 py-1.5 text-left shadow-xs hover:bg-control-hover"
      >
        <WorkspaceIcon workspace={workspace} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-xs text-muted-foreground">Workspace</span>
          <span className="block truncate font-medium" title={workspace.name}>
            {workspace.name}
          </span>
        </span>
        <ChevronsUpDown size={15} strokeWidth={ICON_STROKE} aria-hidden="true" className="shrink-0 text-muted-foreground" />
      </button>
      <div
        ref={menu}
        id={menuId}
        popover="auto"
        role="menu"
        aria-label="Switch workspace"
        onToggle={(event) => {
          setOpen(event.newState === "open");
        }}
        onKeyDown={moveFocus}
        className="menu-panel fixed inset-auto m-0 overflow-y-auto overscroll-contain"
      >
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground" role="presentation">
          Switch workspace
        </p>
        {workspaces.map((item) => (
          <button
            key={item.id}
            ref={(button) => {
              // The native attribute gives the popover immediate focus on its selected item.
              if (button) button.autofocus = item.id === workspace.id;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={item.id === workspace.id}
            tabIndex={-1}
            onClick={() => {
              menu.current?.hidePopover();
              trigger.current?.focus();
              if (item.id !== workspace.id) selectWorkspace(item.id);
            }}
            className={cn("menu-item gap-2.5", item.id === workspace.id && "bg-hover")}
          >
            <WorkspaceIcon workspace={item} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" title={item.name}>
                {item.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {item.kind === "personal"
                  ? item.ownerId === userId
                    ? "Your personal workspace"
                    : "Shared personal workspace"
                  : "Shared workspace"}
              </span>
            </span>
            {item.id === workspace.id ? (
              <Check size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="shrink-0" />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
