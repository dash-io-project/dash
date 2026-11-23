"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { NavLink } from "~/content/nav";
import { cta } from "~/lib/site";

type MobileMenuProps = {
  links: readonly NavLink[];
};

const linkClasses =
  "flex min-h-11 items-center rounded-md px-3 text-base font-medium text-foreground hover:bg-hover";

/** The header menu for narrow screens. It opens below the header bar. */
export function MobileMenu({ links }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Close the menu on Escape.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
        className="icon-btn -mr-2"
      >
        {open ? (
          <X className="size-5" aria-hidden="true" />
        ) : (
          <Menu className="size-5" aria-hidden="true" />
        )}
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-border bg-background px-5 pt-2 pb-5 shadow-menu sm:px-8"
      >
        <nav aria-label="Mobile">
          <ul className="-mx-3 flex flex-col">
            {links.map((link) => (
              <li key={link.href}>
                {link.external ? (
                  <a href={link.href} className={linkClasses}>
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href} onClick={() => setOpen(false)} className={linkClasses}>
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-4">
          <Link href={cta.signIn.href} onClick={() => setOpen(false)} className="btn btn-lg">
            {cta.signIn.label}
          </Link>
          <Link
            href={cta.cloud.href}
            onClick={() => setOpen(false)}
            className="btn btn-primary btn-lg"
          >
            {cta.cloud.label}
          </Link>
        </div>
      </div>
    </>
  );
}
