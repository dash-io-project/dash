# ADR 0017: Design tokens and appearance

## Status

Accepted

## Context

The Dash app had one look: a dark navy page with teal and indigo accents, a gradient glow, and large round cards. The colors were Tailwind theme values such as `ink`, `panel`, and `mist`, and many components also used raw palette classes such as `rose-300` and `white/5`. A person could not select a light page.

The app loaded the Outfit and IBM Plex Sans fonts from Google Fonts. A corporate network or a content security policy can block that request.

The chart renderer had a neon palette and text colors that only a dark page can show. The KPI cards had uppercase labels and much empty space.

Soldock, a sibling product, moved to the look of [Ember](https://github.com/NYLLON-SOFTWARE/ember-cloudflare) (MIT): neutral grays, ink for the main action, thin borders, and almost no shadows. The two products must look the same.

## Decision

- The colors are semantic tokens with the names and the values of Soldock. They are CSS custom properties in `packages/web/src/styles/app.css`. The light values are on `:root`. The dark values are on `:root.dark`.
- Tailwind reads the tokens through `@theme inline`, so a class such as `bg-background` or `text-muted-foreground` follows the mode. The theme removes the default Tailwind palette (`--color-*: initial`). A raw palette class thus makes no CSS.
- A `dark` custom variant follows the `dark` class. Components do not use it, because each token has a dark value.
- Buttons, fields, badges, menus, the shell, and tables are component classes in `app.css`. The primitives in `components/ui.tsx` apply them. Tailwind utilities do the layout.
- The app has a Light, Dark, or System appearance. `src/lib/appearance.ts` keeps the choice in `localStorage` with the key `dash:appearance`. A missing value or an unknown value gives System. If the browser refuses the storage, the app follows the device. The choice is a display setting of one browser, so it has no API.
- The module sets the `dark` class, `data-appearance`, and `color-scheme` on `<html>`.
- The server sends the full page and does not know the choice. An inline script in `<head>` applies the choice before the first paint. Dash sets no `script-src` policy, so the browser runs the script. `appearance.test.ts` runs the script and compares its result with the rules above.
- The app uses the system font stack with 14px text. It loads no font file.
- The shell has one sidebar on `--surface`: the brand mark, the workspace switcher, two navigation groups, and the account button. The account panel has the Appearance choice, the Profile link, and Sign out. At 900px and below, the sidebar is a drawer.
- Each page starts with `PageHeader`. Settings, Profile, Members, Workspaces, API tokens, and Agents use panels: a heading, a muted note, and a card only for a list or a form.
- The chart colors are the tokens `--chart-1` to `--chart-8`, with one value for each mode. The values and their sequence come from the reference palette of the `dataviz` skill. Its validator accepted them on the card color of each mode. The axes, the labels, the grid, and the tooltip use tokens too. TanStack Charts writes a `var()` value to the SVG as it is, so a chart changes mode with no new render.
- `.dash-grid` has rows of 56px in place of 72px. The stored widget layout does not change. A chart measures its card and fills it. A KPI card shows a small label at the top and the value at the bottom.
- The icons stay lucide-react, with a stroke width of 1.75.
- The change adds no dependency.

## Consequences

Dash and Soldock look the same. A person selects the appearance in the account panel, and the page from the server shows the correct colors at once.

A new color must be a token with a light value and a dark value. Each text color must have a contrast ratio of 4.5:1 or more on each fill behind it. The README has the table of tokens.

A dashboard is shorter than before, because a grid row is smaller. A widget keeps its position and its size in rows.

If Dash adds a `script-src` policy later, the policy must allow the head script with a hash or a nonce. Without it, a page from the server shows the light colors until React starts.

The marketing website (`packages/site`) uses the same token names and values. See [ADR 0018](0018-website-design-tokens.md).
