# ADR 0018: The website uses the design tokens of the app

## Status

Accepted. Changes the last line of [ADR 0017](0017-design-tokens-and-appearance.md) and the look that [ADR 0011](0011-public-website.md) gave to the website.

## Context

The public website (`packages/site`) had the old look of the app: a dark navy page, teal and indigo accents, gradient text, glow shadows, and round buttons. It loaded the Outfit and JetBrains Mono fonts from Google Fonts at build time. Its product screenshots showed the old app.

[ADR 0017](0017-design-tokens-and-appearance.md) gave the app semantic tokens, neutral grays, ink for the main action, thin borders, and the system font stack. The website did not use these tokens. A visitor saw one look on the website and a different look in the app.

## Decision

- The website has the token names and the token values of the app. They are CSS custom properties in `packages/site/src/app/globals.css`. The website defines only the tokens that it uses.
- Tailwind reads the tokens through `@theme inline`, and the theme removes the default Tailwind palette. A raw palette class makes no CSS.
- The website follows the device. The light values are on `:root`. The `prefers-color-scheme: dark` media query selects the dark values. The website has no appearance setting, no head script, and no `dash:appearance` key. A visitor reads a few pages and does not sign in to the app there, so a setting gives small value.
- `tokens.test.ts` compares each token value of the website with the value in `packages/web/src/styles/app.css`, for the two modes.
- The website does not import the CSS file of the app. The two packages build separately, and the app file has the rules of the shell, the tables, and the charts, which the website does not need.
- Buttons, text fields, badges, and cards are component classes with the names and the rules of the app (`.btn`, `.btn-primary`, `.input`, `.badge`, `.card`). The website has larger text than the app, so its default button and its text field are 40px high.
- The website uses the system font stack and loads no font file. Code uses the system monospace stack.
- The icons stay lucide-react. One CSS rule gives each icon the stroke width of 1.75.
- The page has almost no shadows. Buttons and fields use `--shadow-xs`. Only the product screenshot at the top of a page and the mobile menu have a larger shadow. The website has no gradient, no glow, and no entry animation.
- Sections change between `--background` and `--surface`, with one `--border` line between them. A group of cells shows thin lines between the cells.
- The product screenshots come from `docs/screenshots/`. They are WebP files in `packages/site/public/screenshots/`. The screenshot on the home page has a dark file, and a `picture` element selects it in dark mode. The other screenshots have only a light file.
- The brand mark, `icon.svg`, and `og.png` use the ink tile of the app.
- The change adds no dependency.

## Consequences

The website and the app look the same. A person who goes from the website to the app sees the same colors, buttons, and fields.

A token change in the app must also go into `globals.css` of the website. `tokens.test.ts` fails until the two files agree.

Each text color has a contrast ratio of 4.5:1 or more on each fill behind it, in the two modes. The lowest ratio is `--link` on `--surface` in light mode (4.85:1) and `--muted-foreground` on `--surface` in dark mode (6.76:1).

In dark mode, four screenshots show the light app on a dark page. To change this, add a dark file for each screenshot and give it to `ProductShot` as `darkSrc`.

A visitor cannot select a mode on the website. If that becomes necessary, use the head script and the `dash:appearance` key of the app.

When the app screenshots in `docs/screenshots/` change, make the website files again. The website does not read that directory at build time.
