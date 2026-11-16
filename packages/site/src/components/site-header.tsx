import Link from "next/link";
import { navLinks } from "~/content/nav";
import { cta, site } from "~/lib/site";
import { ButtonLink } from "./button-link";
import { GitHubIcon } from "./icons";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";

const navLinkClasses =
  "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground";

/** The sticky site header with the logo, the main nav, and the primary calls to action. */
export function SiteHeader() {
  const textLinks = navLinks.filter((link) => !link.external);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="container-x relative flex h-(--header-height) items-center gap-6">
        <Link href="/" aria-label={`${site.name} home`} className="rounded-md">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {textLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={navLinkClasses}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <a href={site.github} className={navLinkClasses}>
            <GitHubIcon className="size-4" />
            GitHub
          </a>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <ButtonLink href={cta.signIn.href} variant="ghost" size="sm">
            {cta.signIn.label}
          </ButtonLink>
          <ButtonLink href={cta.cloud.href} size="sm">
            {cta.cloud.label}
          </ButtonLink>
        </div>

        <div className="ml-auto md:hidden">
          <MobileMenu links={navLinks} />
        </div>
      </div>
    </header>
  );
}
