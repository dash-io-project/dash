import Link from "next/link";
import { footerGroups } from "~/content/nav";
import { site } from "~/lib/site";
import { GitHubIcon } from "./icons";
import { Logo } from "./logo";

const linkClasses = "text-sm text-muted-foreground transition-colors hover:text-foreground";

/** The site footer with link groups, the license, and the GitHub link. */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background">
      <div className="container-x pt-14 pb-8 sm:pt-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4 lg:grid-cols-[1.6fr_repeat(4,1fr)] lg:gap-x-8">
          <div className="col-span-2 max-w-xs md:col-span-4 lg:col-span-1">
            <Logo />
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {site.tagline}. Self-host it for free, or run it on Dash Cloud.
            </p>
            <a href={site.github} className="btn btn-sm mt-5">
              <GitHubIcon className="size-4" />
              jaredwray/dash
            </a>
          </div>

          {footerGroups.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a href={link.href} className={linkClasses}>
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className={linkClasses}>
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {site.name}. Released under the{" "}
            <a
              href={site.licenseUrl}
              className="text-foreground underline underline-offset-4 hover:no-underline"
            >
              {site.license} license
            </a>
            .
          </p>
          <p>
            <a href={`mailto:${site.contactEmail}`} className="hover:text-foreground">
              {site.contactEmail}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
