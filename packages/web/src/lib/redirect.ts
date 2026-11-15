/**
 * Return the path to open after sign-in, or undefined. Only a path on the
 * same origin is accepted, so the login page cannot send a user to a
 * different site.
 */
export function safeRedirectPath(value: string | undefined, origin: string): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return undefined;
  }
  if (!URL.canParse(value, origin)) {
    return undefined;
  }
  const url = new URL(value, origin);
  return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : undefined;
}
