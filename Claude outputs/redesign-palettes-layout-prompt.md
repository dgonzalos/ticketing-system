# Prompt: three-palette redesign + centered grid layout (`packages/web`)

Re-skin the web app with three user-selectable colour palettes (**Beige & walnut**, **Sand & terracotta**, **Cream & olive**) and move every screen onto a CSS-grid shell whose content is centered horizontally (and vertically, for short screens) and responsive down to 390px.

The reference is the published prototype ("Ticketera Redesign" artifact). It shows the target look at desktop, tablet and phone width for every palette, and its token table is the source for the hex values below.

This is a **presentation-only** phase. There are no API, hook, routing or data-shape changes. Visible copy changes only on screens without a test file (see "Copy changes").

**Do not commit.** Stop when the Definition of done is green so the diff can be reviewed.

---

## Verified current state

These were read from the shipped code. Do not re-derive them.

### Token pipeline

- `src/index.tsx` imports `./styles/index.css` once. That file `@import`s, in order: `reset.css`, `primitives/colors.css`, `primitives/spacing.css`, `primitives/typography.css`, `primitives/radius.css`, `semantic.css`.
- `primitives/colors.css` is **only** `@import`s of Radix scales: slate, blue (+ alpha), red, green, amber (each light + dark), `white-alpha`.
- `primitives/radius.css` has just `--radius-sm: 0.375rem; --radius-md: 0.5rem;`.
- `primitives/typography.css` has `--font-size-1…5` (`0.6 / 0.7 / 1.1 / 1.5 / 2rem`) and `--font-weight-semibold: 600`. **There is no font-family token.** `reset.css` sets `body { font-family: system-ui, sans-serif; }`.
- `primitives/spacing.css`: `--space-1…9` = `0.15 / 0.4 / 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 / 2.75rem`.
- `semantic.css` is one bare `:root` block mapping to slate/blue/red/green/amber, plus the seat aliases. Seat **available = success green**, **selected = accent border + `--blue-a5` glow only**, with no background of its own.
- Dark mode is `.dark` on `<html>`. Radix's dark files redefine `--slate-N` etc. under `.dark`, so the semantic tokens follow automatically.
- `styles/theme.ts`: `export function setTheme(theme: 'light' | 'dark')` toggles `.dark`. **It has no callers.**

### The raw-colour check (`scripts/check-no-raw-colors.mjs`)

- Walks **every** `.css` under `src/`, primitives included. There is no allowlist.
- Pattern: `/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/`. Note that `color-mix(` is **not** matched.
- Runs as `pretest` for `pnpm --filter @ticketing/web test`.

### Shell (`src/App.tsx`, `src/App.module.css`)

- `.app` is `display: flex; flex-direction: column; min-height: 100vh`. Its children are `<DemoBanner/>`, `<Header/>`, `<main className={styles.main}>`.
- `.main` is `flex: 1; padding: var(--space-8)`. **No max-width and no centering.**
- `Header` renders `<h1>Ticketing System</h1>`. The user menu (admin "Assistant" link, email, `Log out` button) renders only when `user` is set.
- No test renders `App` or `Header`. Screen tests use `renderWithProviders` from `src/test/test-utils.tsx`, which wraps only the screen.

### Layout facts that matter for responsiveness

- `CheckoutScreen.module.css`: `.layout` is flex, and `.summary` has **`min-width: 280px`**.
- `SeatSelectionScreen.module.css`: `.layout` is flex, and `.summary` has **`min-width: 220px`**.
- These two `min-width`s and the lack of wrapping are why both screens overflow at phone width today. The grid rewrite below removes them.
- `LoginScreen`/`SignupScreen` `.screen` is `max-width: 400px; margin: 0 auto`, which is already centered. Their `<Card as="section">` has **no internal gap**, so inputs sit flush against each other. This is a pre-existing issue, and this phase fixes it.
- `OrderConfirmation` / `Payment` / `PaymentSuccess` `.screen` is `max-width: 480px` **with no auto margin**, so it is left-aligned.
- `AdminAssistantScreen` `.screen` is `max-width: 640px; margin: 0 auto`.
- `EventSelector` and `PerformanceSelector` both use `CardList.module.css`'s `.list` (a flex column) and render `<Card as="button">` containing an `<h3>`.
- `SeatMap`: each row is a flex row with a `.rowLabel` (`width: var(--space-7)`) and a wrapping `.seats` flex. `SeatCard` is `var(--space-9)` square and shows label + `formatCents(price)`. Its `aria-label` already includes status and price.
- `SeatCard` builds its class names with a template string, not `clsx`. **Leave that alone** in this phase.

### Package name

The web package is **`@ticketing/web`** (`packages/web/package.json`). CLAUDE.md's repository-structure block says `@ticketing-system/web`, which is stale. Use `@ticketing/web` in every command.

---

## Decisions and deviations (read before starting)

1. **The three palettes are not Radix scales. They live in one allowlisted primitives file.**
   CLAUDE.md's "Radix only, no hand-picked hex" rule was justified by *"there is no Figma/design file to source from."* This phase now has a design source. Approximating it with Radix doesn't work. `brown-9` (`#ad7f58`) gives only about 3.3:1 against white button text, which fails AA, and no Radix step matches the deep walnut/olive accents. So:
   - Add `src/styles/primitives/palettes.css`, containing raw hex values. This is the **only** file in `src/` allowed to hold raw hex.
   - Update `check-no-raw-colors.mjs` to skip exactly that one path, with a comment explaining why. Everything else stays enforced.
   - Radix stays for slate/blue (the default theme and dark mode) and for red/green/amber feedback. The amber "reserved" seat and the demo banner keep Radix amber.

2. **"Palette", not "theme", in code.**
   In this codebase, "theme" already means light/dark (`setTheme`, `.dark`), and CLAUDE.md explicitly says dark mode is *not* a `data-theme` attribute. To avoid overloading the word:
   - Use a `data-palette` attribute on `<html>`, with values `walnut | terracotta | olive`.
   - The code exports `setPalette`, the type is `PaletteName`, and the storage key is `ticketing-palette`.
   - The UI label shown to users is still "Theme".
   - `setTheme` stays untouched.

3. **Palettes are light-only and don't fight `.dark`.**
   Palette selectors are `:root:not(.dark)[data-palette='…']`. If `.dark` is ever set, the app falls back to the existing slate/blue dark tokens. Dark variants of the three palettes are out of scope.

4. **Fonts are self-hosted, not loaded from the Google Fonts CDN.**
   The app is aimed at Spain/EU users, and hot-linking Google Fonts sends visitor IPs to Google. That is the basis of known EU GDPR complaints. Install the fonts as `@fontsource` packages so Vite bundles them:
   - `@fontsource/libre-caslon-text` (400, 400-italic)
   - `@fontsource/public-sans` (400, 500, 600)
   - `@fontsource/ibm-plex-mono` (400, 500)

   All three exist on npm (v5.3.0 at time of writing). Import the weight files in `src/index.tsx`:

- `@fontsource/libre-caslon-text/400.css` and `@fontsource/libre-caslon-text/400-italic.css`
- `@fontsource/public-sans/400.css`, `/500.css` and `/600.css`
- `@fontsource/ibm-plex-mono/400.css` and `/500.css`

Do not fall back to a CDN link.

5. **`EventSelector` stops sharing `CardList.list`.**
   Events become a responsive card grid, while performances stay a single-column list. `CardList.module.css` keeps `.list` and `.item`. `EventSelector` gets its own `.grid`.

---

## Part 1: tokens

### 1a. `src/styles/primitives/palettes.css` (new)

Steps are ordered lightest to darkest, like Radix. The comment on each step gives its intended semantic role, so the mapping in `semantic.css` is reviewable.

```css
/*
 * Brand palettes for the three user-selectable themes. Source: the redesign
 * prototype. Raw hex is allowed ONLY in this file: see check-no-raw-colors.mjs.
 * Components must never reference these directly; semantic.css maps them.
 *
 * Step roles: 1 surface · 2 canvas · 3 sold-seat bg · 4 subtle bg · 5 border ·
 * 6 strong border · 7 sold-seat text · 8 secondary text · 9 accent solid ·
 * 10 accent hover · 11 primary text. poster-1..3 are decorative card headers.
 */
:root {
  --walnut-1: #fffcf7;  --walnut-2: #f5efe5;  --walnut-3: #ece5db;  --walnut-4: #e9ddcb;
  --walnut-5: #ded2c2;  --walnut-6: #8f7a67;  --walnut-7: #6f665d;  --walnut-8: #6b5d51;
  --walnut-9: #694b38;  --walnut-10: #573d2d; --walnut-11: #382d26;
  --walnut-poster-1: #594334; --walnut-poster-2: #7a5644; --walnut-poster-3: #5f5a45;
  --walnut-poster-text: #f6ebdb;

  --terracotta-1: #fffbf6;  --terracotta-2: #f8f1e9;  --terracotta-3: #eee4da;  --terracotta-4: #efded0;
  --terracotta-5: #e2d0c1;  --terracotta-6: #9a7a6a;  --terracotta-7: #6c6058;  --terracotta-8: #715a4f;
  --terracotta-9: #8a4f3b;  --terracotta-10: #733f2e; --terracotta-11: #422f28;
  --terracotta-poster-1: #7a4534; --terracotta-poster-2: #9a5d45; --terracotta-poster-3: #6a5040;
  --terracotta-poster-text: #fbeee3;

  --olive-1: #fffdf6;  --olive-2: #f5f1e5;  --olive-3: #ebe7da;  --olive-4: #e9e3ce;
  --olive-5: #ded8c4;  --olive-6: #86826a;  --olive-7: #6b685a;  --olive-8: #636049;
  --olive-9: #62603f;  --olive-10: #4f4d31; --olive-11: #383729;
  --olive-poster-1: #55533a; --olive-poster-2: #6e6a48; --olive-poster-3: #7a5b43;
  --olive-poster-text: #f5f0dc;
}
```

Import it in `index.css` right after `primitives/colors.css`.

**Contrast, verified (WCAG):**

| Pair | Walnut | Terracotta | Olive |
|---|---|---|---|
| Primary text (11) on canvas (2) | 11.7 | 11.2 | 10.7 |
| Secondary text (8) on canvas (2) | 5.6 | 5.7 | 5.6 |
| Secondary text (8) on subtle (4) | 4.7 | 4.9 | 5.0 |
| White on accent (9) | 7.9 | 6.4 | 6.4 |
| Accent (9) on subtle (4): available seat | 5.9 | 4.9 | 5.0 |
| Sold text (7) on sold bg (3) | 4.5 | 4.9 | 4.5 |
| Strong border (6) on surface (1): input border, ≥ 3:1 | 4.0 | 3.8 | 3.8 |
| Poster text on the lightest poster tone | 5.5 | 4.6 | 4.8 |

**Do not "tidy" these values**; several were darkened specifically to pass AA.

### 1b. `primitives/radius.css`, `typography.css`, new `sizes.css`

`radius.css`: add steps. Keep `sm` and `md` exactly as they are.

```css
--radius-lg: 0.6875rem;  /* 11px */
--radius-xl: 1rem;       /* 16px */
--radius-2xl: 1.375rem;  /* 22px */
```

`typography.css`: add these tokens. Then change `reset.css`'s `body` to `font-family: var(--font-family-body)` and set `line-height: 1.5`.

```css
--font-family-display: 'Libre Caslon Text', Georgia, 'Times New Roman', serif;
--font-family-body: 'Public Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-family-mono: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Menlo, monospace;
--font-size-6: 2.5rem;
--font-weight-regular: 400;
--font-weight-medium: 500;
```

New `primitives/sizes.css`. Import it after `radius.css`.

```css
:root {
  --size-content-wide: 70rem;    /* 1120px: events grid */
  --size-content-split: 62.5rem; /* 1000px: seat map / checkout + sidebar */
  --size-content-list: 45rem;    /* 720px: performances, order/payment screens */
  --size-content-form: 26.25rem; /* 420px: login / signup */
  --size-sidebar: 18.75rem;      /* 300px */
  --size-seat-width: 3.125rem;   /* 50px */
  --size-seat-height: 2.875rem;  /* 46px */
  --size-seat-compact: 2.25rem;  /* 36px, phone */
}
```

Custom properties can't be used inside `@media` conditions. The two breakpoints are therefore literal and must be used consistently everywhere:

- `@media (max-width: 51.25rem)` = 820px (split layouts stack)
- `@media (max-width: 32.5rem)` = 520px (phone)

Put a one-line comment next to the first use of each.

### 1c. `semantic.css`

**Keep the existing bare `:root` block as-is.** It is the fallback and the dark-mode source. Add the new tokens to that same block, so every token has a definition with no palette attribute and under `.dark`:

```css
  --color-bg-subtle: var(--slate-3);
  --color-border-strong: var(--slate-8);
  --color-seat-selected-bg: var(--color-accent-solid);
  --color-seat-selected-text: var(--color-text-on-accent);
  --color-poster-1: var(--blue-9);
  --color-poster-2: var(--blue-10);
  --color-poster-3: var(--slate-11);
  --color-poster-text: var(--white-a12);
  --color-focus-ring: var(--blue-a5);          /* unchanged, listed for completeness */
  --radius-card: var(--radius-md);
  --radius-control: var(--radius-sm);

  /* palette picker swatches: theme-independent on purpose */
  --color-palette-swatch-walnut: var(--walnut-9);
  --color-palette-swatch-terracotta: var(--terracotta-9);
  --color-palette-swatch-olive: var(--olive-9);
```

Then add one block per palette. Walnut is shown here. Terracotta and olive are identical with the scale name swapped, and with `--radius-card` / `--radius-control` set to `2xl`/`lg` (terracotta) and `md`/`sm` (olive).

```css
:root:not(.dark)[data-palette='walnut'] {
  --color-bg-canvas: var(--walnut-2);
  --color-bg-surface: var(--walnut-1);
  --color-bg-subtle: var(--walnut-4);
  --color-border-default: var(--walnut-5);
  --color-border-strong: var(--walnut-6);
  --color-text-primary: var(--walnut-11);
  --color-text-secondary: var(--walnut-8);
  --color-text-disabled: var(--walnut-7);

  --color-accent-solid: var(--walnut-9);
  --color-accent-solid-hover: var(--walnut-10);
  --color-accent-border: var(--walnut-6);
  --color-focus-ring: color-mix(in srgb, var(--walnut-9) 45%, transparent);

  --color-poster-1: var(--walnut-poster-1);
  --color-poster-2: var(--walnut-poster-2);
  --color-poster-3: var(--walnut-poster-3);
  --color-poster-text: var(--walnut-poster-text);

  --color-seat-available-bg: var(--walnut-4);
  --color-seat-available-border: var(--walnut-9);
  --color-seat-available-text: var(--walnut-9);
  --color-seat-sold-bg: var(--walnut-3);
  --color-seat-sold-border: var(--walnut-5);
  --color-seat-sold-text: var(--walnut-7);
  --color-seat-blocked-bg: transparent;
  --color-seat-blocked-border: var(--walnut-5);
  --color-seat-blocked-text: var(--walnut-7);

  --radius-card: var(--radius-xl);
  --radius-control: var(--radius-md);
}
```

`--color-seat-reserved-*`, danger, success and warning are **not** remapped. They stay Radix amber/red/green.

Update the trailing comment in `semantic.css` so it explains both mechanisms: `.dark` swaps Radix primitives underneath, and `[data-palette]` swaps semantic mappings, light mode only.

### 1d. `scripts/check-no-raw-colors.mjs`

Skip exactly `src/styles/primitives/palettes.css`. Compare with `path.relative(srcDir, file)` normalised to forward slashes, **not** a raw string `endsWith` on the absolute path, because this repo is developed on Windows (see CLAUDE.md's `pathToFileURL` gotcha). Add a comment pointing at decision 1.

Sanity-check that the script is still strict. Temporarily put `color: #fff;` in `App.module.css`, confirm the check fails, then revert.

---

## Part 2: palette switching

### 2a. `src/styles/palette.ts` (new)

```ts
export const PALETTES = ['walnut', 'terracotta', 'olive'] as const;
export type PaletteName = (typeof PALETTES)[number];
export const DEFAULT_PALETTE: PaletteName = 'walnut';
const STORAGE_KEY = 'ticketing-palette';

export function isPaletteName(value: unknown): value is PaletteName { … }

/** Stored palette if valid, else DEFAULT_PALETTE. Never throws (private mode / blocked storage). */
export function getStoredPalette(): PaletteName { … }

/** Sets data-palette on <html> and persists it. Storage failures are swallowed. */
export function setPalette(palette: PaletteName): void { … }
```

Both storage accesses must be wrapped in `try/catch`.

### 2b. Apply before first render

- `index.html`: `<html lang="en" data-palette="walnut">`. The default then paints with no flash, even before JS runs.
- `src/index.tsx`: before `createRoot(...)`, call `setPalette(getStoredPalette())`. Also import the `@fontsource` CSS files here, before `./styles/index.css`.

### 2c. `src/components/PaletteSwitcher/` (new, feature-local)

This is palette-specific and not a generic primitive, so it stays out of `components/ui`. Files: `PaletteSwitcher.tsx`, `PaletteSwitcher.module.css`, `PaletteSwitcher.test.tsx`, `index.ts`.

- It holds local `useState<PaletteName>` initialised from `document.documentElement.dataset.palette` (validated with `isPaletteName`, falling back to the default). On click it calls `setPalette` and updates state. No context is needed, because there is exactly one consumer.
- Markup: `<div role="group" aria-label="Colour theme">` containing three `<button type="button" aria-pressed aria-label="Beige & walnut" title="Beige & walnut">`. Each button holds a decorative 16px swatch `<span aria-hidden>`.
- Labels: `Beige & walnut`, `Sand & terracotta`, `Cream & olive`.
- Styles: a pill-shaped container (`--color-bg-canvas` bg, `--color-border-default` border). Buttons are 30px circles. Swatches are `.swatchWalnut { background-color: var(--color-palette-swatch-walnut) }` etc.
- The pressed state uses a `--color-bg-subtle` button background plus a 2px ring in `--color-accent-solid`, offset by `--color-bg-surface`. Focus-visible uses `--color-focus-ring`.

### 2d. `Header` in `App.tsx`

Render `<PaletteSwitcher />` **for everyone**, outside the `user &&` condition, as the first item of the right-hand group. The logged-out header will then show only the switcher on the right.

---

## Part 3: grid shell and centered layout

### 3a. `App.module.css`

```css
.app {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto auto 1fr;   /* banner (or nothing), header, main */
  …existing colours…
}
```

`DemoBanner` returns `null` outside demo mode, so `.app` has either two or three children. With auto-placement, `main` would land in the middle `auto` row when the banner is off and would not fill the screen. Pin it instead:

```css
.main { grid-row: -2 / -1; }   /* always the 1fr row, banner or not */
```

With the banner, rows are banner / header / main. Without it, the header takes row 1, row 2 collapses to 0px, and main is still row 3.

- **Header:** wrap its contents in a new `<div className={styles.headerInner}>`. `.header` keeps the background and border. `.headerInner` is a grid with `grid-template-columns: minmax(0, 1fr) auto`, `max-width: var(--size-content-wide)`, `margin-inline: auto`, and horizontal padding `var(--space-8)`.
  - `h1` uses `--font-family-display`, `--font-weight-regular`, `--font-size-4`.
  - `.userMenu` gets `flex-wrap: wrap; justify-content: end`.
- **Main:**

  ```css
  .main {
    display: grid;
    grid-template-columns: minmax(0, var(--size-content-wide));
    justify-content: center;
    align-content: center;        /* short screens sit in the vertical middle */
    padding: var(--space-9) var(--space-8);
  }
  ```

- **Breakpoints:**
  - ≤ 820px: header and main side padding `var(--space-6)`, main block padding `var(--space-8)`.
  - ≤ 520px: side padding `var(--space-5)`, `.headerInner` becomes one column with the user menu left-aligned, and `.userEmail` is hidden.

### 3b. Per-screen width and centering

Every screen's root `.screen` gets `width: 100%; justify-self: center;` and a `max-width` token. Replace `margin: 0 auto` wherever it exists.

| Screen | `max-width` |
|---|---|
| Events (wrap `EventSelector` in a `.screen` div) | `--size-content-wide` |
| Performances, OrderConfirmation, Payment, PaymentSuccess | `--size-content-list` |
| AdminAssistant | `--size-content-list` (replaces `640px`) |
| SeatSelection, Checkout | `--size-content-split` |
| Login, Signup | `--size-content-form` (replaces `400px`) |

Every `.screen` should use `display: grid; gap: var(--space-7)` rather than a flex column. `BackLink` needs `justify-self: start`, so it stays left-aligned inside the centered column. Put that in `BackLink.module.css`, since `width: fit-content` alone doesn't pin it in a grid.

### 3c. Split layouts: SeatSelection and Checkout

```css
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--size-sidebar);
  gap: var(--space-7);
  align-items: start;
}
@media (max-width: 51.25rem) { .layout { grid-template-columns: minmax(0, 1fr); } }
```

- **Delete** both `.summary { min-width: … }` declarations.
- Both `.summary` cards become `display: grid; gap: var(--space-4)`.
- Their `h2` uses `--font-family-display`, `--font-weight-regular`, `--font-size-4`.
- In SeatSelection, `.summaryButton`'s `margin-top` is replaced by the grid gap.

### 3d. UI primitives restyle

- **`Card.module.css`:** `border-radius: var(--radius-card)`. Change nothing else. Do **not** add `display`/`gap` here, because `Card as="button"` in the selectors relies on block flow.
- **`Button.module.css`:** `border-radius: var(--radius-control)`, `min-height: 2.75rem` for `.md` (44px touch target), `min-height: 2.125rem` for `.sm`. `.secondary:hover` switches to `--color-border-strong`.
- **`Input.module.css`:** `border-color: var(--color-border-strong)` (3:1 non-text contrast), `border-radius: var(--radius-control)`, `min-height: 2.75rem`.
- **Login / Signup:** pass `className={styles.card}` to their `Card`, with `.card { display: grid; gap: var(--space-5); }`. The heading uses `--font-family-display` and `--font-weight-regular`. This fixes the flush-inputs issue.

### 3e. New primitive: `components/ui/PageHeader`

A centered screen heading. It is generic and will be reused, so it belongs in `components/ui` per CLAUDE.md. Export it and its props from `ui/index.ts`.

```ts
interface PageHeaderProps { eyebrow?: string; title: string; description?: string; }
```

- It renders a `<header>` with an optional `<p class="eyebrow">`, an `<h2>` and an optional `<p>`.
- Styles: a grid, `justify-items: center`, `text-align: center`.
- The eyebrow uses `--font-size-2`, `--font-weight-semibold`, `letter-spacing: 0.12em`, uppercase, and `--color-accent-solid`.
- The title uses `--font-family-display`, `--font-weight-regular`, `clamp(var(--font-size-5), 5vw, var(--font-size-6))`, `line-height: 1.1`, and `text-wrap: balance`.
- The description uses `--color-text-secondary` with `max-width: 52ch`.
- Add `PageHeader.test.tsx`: it renders the title, and omits the eyebrow and description when those props are absent.

### 3f. Events grid (`EventSelector`)

- New `.grid` in `EventSelector.module.css`: `display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17.5rem), 1fr)); gap: var(--space-6)`.
- Each card keeps `<Card as="button" className={clsx(cardListStyles.item, styles.card)}>`. `.card` has `padding: 0; overflow: hidden; display: grid; grid-template-rows: auto 1fr`.
- Card contents, in order:
  1. A decorative poster: `<div className={clsx(styles.poster, styles[`poster${(index % 3) + 1}`])} aria-hidden="true">` containing the title's first letter.
     - `.poster` has `min-height: 9.5rem`, `background-color: var(--color-poster-N)` and `color: var(--color-poster-text)`.
     - The letter is set in `--font-family-display`, italic, at `3.4rem`.
     - A `::after` ring (a 1px `currentColor` circle at `opacity: .28`) sits off the top-right edge.
  2. A `.body` div, with padding `var(--space-6)`, holding the existing `h3` and description.
- Hover: `border-color: var(--color-border-strong)` and `transform: translateY(-2px)`. Disable the transform under `prefers-reduced-motion`.
- The `h3`-inside-`button` markup is pre-existing (it's invalid HTML). **Leave it**, and note it in your report as a follow-up.

### 3g. Performances list (`PerformanceSelector`)

It stays on `CardList.list`. Restyle only: the `h3` uses `--font-size-3` and `--font-weight-semibold` (down from `--font-size-4`), and cards get a hover border in `--color-border-strong`. No markup change.

### 3h. Seat map

- **`SeatMap.module.css`:**
  - `.seatMap { display: grid; justify-content: center; gap: var(--space-3); }`
  - `.row { display: grid; grid-template-columns: var(--space-7) minmax(0, 1fr); align-items: center; gap: var(--space-4); }`
  - `.rowLabel` uses `--font-family-mono` and `--color-text-secondary`.
- **`SeatMap.tsx`:** add `<div className={styles.stage} aria-hidden="true">Stage</div>` above the rows.
  - `.stage` is `justify-self: center; width: min(100%, 28rem)`.
  - It has a 4px top border in `--color-border-strong`, `border-radius: 50% 50% 0 0 / 1.4rem 1.4rem 0 0`, and centred uppercase text at `--font-size-2` with `letter-spacing: .3em`, in `--color-text-secondary`.
- **`SeatCard.module.css`:**
  - Size: `width: var(--size-seat-width); height: var(--size-seat-height)`.
  - Shape: `border-radius: 0.5625rem 0.5625rem 0.25rem 0.25rem` (a seat-back shape).
  - Font: `font-family: var(--font-family-mono)`.
  - `.selected` must now set **`background-color: var(--color-seat-selected-bg); color: var(--color-seat-selected-text); border-color: var(--color-seat-selected-border)`** and drop the glow. It stays **after** the status classes: a selected seat has status `reserved` (the user's own lock), so `.selected` has to win over `.reserved`.
  - `.blocked` gets `border-style: dashed`.
  - ≤ 520px: seat is `var(--size-seat-compact)` square and `.price` is hidden with `display: none`. The price is still announced via `aria-label`.
- **Legend:** add a small legend under the map in `SeatSelectionScreen`: Available, Your selection, Reserved, Sold, Unavailable. Each swatch is a `<span aria-hidden>` styled from the matching `--color-seat-*` tokens. Keep it in `SeatSelectionScreen.module.css`, because it is feature-specific.

---

## Copy changes (untested screens only)

Use `PageHeader` on these screens:

- **EventsScreen:** eyebrow `On sale now`, title `What's on`, description `Choose an event to see its performances.`
- **PerformancesScreen:** eyebrow = the event's title if found, title `Pick a performance`.
  - Get the event title from `useEvents()`. It is already cached with a 5-minute `staleTime`: `events.find((e) => e.id === eventId)?.title`.
  - Omit the eyebrow while it's unknown. **Do not add a new API call.**
- **SeatSelectionScreen:** title `Choose your seats`.
- **CheckoutScreen:** eyebrow `Almost there`, title `Review and confirm`.

These four screens have no `*.test.tsx`. **Do not change visible text on Login, Signup, OrderConfirmation, Payment, PaymentSuccess or AdminAssistant.** Their tests assert on it. Also leave button labels untouched everywhere (`Checkout`, `Clear selection`, `Confirm Purchase`), because the Playwright golden path clicks them.

---

## Tests

- **`src/styles/palette.test.ts`:**
  - `setPalette` sets `document.documentElement.dataset.palette` and writes storage.
  - `getStoredPalette` returns the default for a missing value, for an invalid value (`'neon'`), and when `localStorage.getItem` throws (stub it with `vi.spyOn(Storage.prototype, 'getItem')`).
  - `setPalette` doesn't throw when `setItem` throws.
  - Reset the attribute and storage in `afterEach`.
- **`src/components/PaletteSwitcher/PaletteSwitcher.test.tsx`:**
  - Three buttons render inside a group named "Colour theme".
  - The current palette has `aria-pressed="true"`.
  - Clicking "Cream & olive" sets `data-palette="olive"` and moves `aria-pressed`.
  - Use `@testing-library/user-event`, which is already a devDependency.
- **`PageHeader.test.tsx`:** as described in 3e.
- jsdom doesn't apply CSS, so **there are no visual assertions**. Visual verification is manual (below).

---

## Definition of done

- `pnpm --filter @ticketing/web test` passes. This includes the `pretest` raw-colour check with the new allowlist, and every pre-existing suite.
- `pnpm --filter @ticketing/web typecheck` and `pnpm --filter @ticketing/web build` pass.
- `pnpm --filter @ticketing-system/e2e test` still passes.
- `rg -n "#[0-9a-fA-F]{3,8}\b" packages/web/src --glob '*.css'` matches only `primitives/palettes.css`.
- Manual check in `pnpm --filter @ticketing/web dev`, for **each** palette, at 1280px, 768px and 390px widths:
  - Events, Performances, Seats, Checkout, Login and Payment are horizontally centered.
  - Login is also vertically centered.
  - At 390px there is **no horizontal scroll** (`document.documentElement.scrollWidth === 390`).
  - Seat selection and checkout stack at 768px and below.
  - The palette choice survives a reload.
  - The demo-banner build (`VITE_DEMO_MODE=true`) still lays out correctly.
- Report back anything in this prompt that didn't match the code you found.

## Afterwards

- **CLAUDE.md, "Styling and design tokens":**
  - Document `palettes.css` as the single raw-hex exception and why (a design source now exists, and Radix accents fail AA for these colours).
  - Document `data-palette` vs `.dark`.
  - Document `sizes.css` and the two literal breakpoints.
  - Fix the stale `@ticketing-system/web` package name in the repository-structure block.
- **CLAUDE.md, "UI primitives":** add `PageHeader` to the list.
- **Out of scope and worth noting as follow-ups:**
  - dark variants of the three palettes;
  - the `h3`-in-`button` markup in both selectors;
  - converting `SeatCard` to `clsx`.
