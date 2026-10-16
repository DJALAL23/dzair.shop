# CodFlow Dashboard Design System

The source of truth for every token is `src/styles/globals.css` (colour, radius,
elevation, type scale) and `src/styles/fonts.css` (typefaces). This file says
what they mean and how to use them. When the two disagree, the CSS wins — fix
this file.

## Direction

CodFlow is a merchant workbench for Algerian cash-on-delivery operations. It is
used for long order-processing sessions on desktop and for quick decisions on
a phone, in Arabic first, then French and English.

The interface is quiet: a neutral canvas, white surfaces, one charcoal action
colour, and colour reserved for meaning. No decorative glass, gradients, glow
blobs or oversized rounded compositions.

## Colour

Use the semantic tokens through Tailwind (`bg-card`, `text-muted-foreground`,
`border-border`). Never write a literal hex or a Tailwind palette colour
(`text-amber-600`, `bg-violet-500/10`) in a component: it does not follow dark
mode.

| Token | Light | Role |
|---|---|---|
| `background` | `#f3f3f4` | The canvas behind the content panel |
| `card` | `#ffffff` | Every surface that holds content |
| `foreground` / `primary` | `#303030` | Text and the one action colour |
| `muted-foreground` | `#616161` | Secondary text |
| `border` | `#e8e8ea` | Structural hairlines |
| `input` | `#b5b5b5` | Form control borders |
| `ring` / `link` | `#005bd3` | Focus ring and links |
| `brand` | `#7c3aed` | The CodFlow mark and identity tiles only |
| `destructive` / `success` / `warning` | red / green / amber | Solid semantic colour (icons, stripes, filled buttons) |

### Tones

Meaning is carried by seven tones — `neutral`, `info`, `success`, `warning`,
`attention`, `critical`, `magic` — each with a `bg`, `text` and `border`
variable, exposed as utilities: `bg-tone-warning-bg text-tone-warning-text
border-tone-warning-border`. Badges, alerts, callouts and status chips are all
built from them. Pick the tone by what the thing *means*:

- `success` — done, positive, copied, connected
- `warning` — needs a look, pending
- `attention` — needs action soon
- `critical` — failed, returned, destructive
- `info` — informational, in progress
- `magic` — automation and identity
- `neutral` — everything else

Order stages have their own `--status-*` pairs built on the same tones;
analytics series use `--chart-*`. Use `bg-warning` / `bg-destructive` (solid)
only for thin stripes and icons, never for a block of text.

### Dark mode

Dark mode is the same ladder inverted — each elevation one step lighter:
canvas `#0f0f10`, card `#18181a`, popover `#222225`, border `#2a2a2e`. Primary
inverts to `#f0f0f0`. Tones become translucent tints over the surface (about
14% fill, 30% border) with bright text, never opaque blocks. Because every
component uses tokens, dark mode needs no per-component code; a component that
needs a `dark:` colour override is using the wrong token.

## Typography

- Latin: Geist Variable. Arabic: IBM Plex Sans Arabic (the fallback in the same
  stack, so mixed Arabic/Latin data renders in one run).
- Base size is 15px in Arabic and 14px in English and French
  (`html[lang]` rule in `globals.css`); small text is 12px.
- Page titles are 20px semibold (`PageHeader`). Card titles are 14px semibold.
  Field labels and metadata are 12px medium in `muted-foreground`.
- No negative tracking, no uppercase labels, no all-bold text.

## Geometry and elevation

- Buttons are 32px tall (28px small, 40px large; 40px on touch via `pointer-coarse:`). Control radius
  8px; surfaces 12px (`rounded-xl`); status marks 6px (`rounded-md`), never full
  pills. `rounded-2xl` is reserved for the content panel in the shell.
- Surfaces are separated by a 1px border or a soft shadow (`shadow-card`), never
  both stacked. No card inside a card — page regions are layouts; cards frame
  repeated items, tables and focused tools.
- Spacing follows a 4px base with 8px as the dominant rhythm. Card padding is 16px.

## Shell

- Desktop: a persistent sidebar, a topbar, and the page inside a white content
  panel that floats on the canvas with a 12px radius. The topbar carries search,
  language, appearance and account.
- Mobile: a compact bar plus an accessible navigation drawer.
- Every page renders inside `DashboardChrome` (skip link, error boundary, auth
  gate). Content is `max-w-[1144px]`; focused forms pass `narrow` for 784px.
- Sign-in and recovery use one centred card split into a form column and a brand
  panel, hidden below `lg`.

## Components

Compose pages from `src/components/ui` — do not rebuild these locally.

| Need | Use |
|---|---|
| Page title, back link, actions, status badges | `PageHeader` |
| Grouped content, optional title, help ⓘ and action | `Card` |
| A create/edit form with a sticky save bar | `FormPage` + `StickyFormActions` |
| Label, hint, error around a control | `Field` (a guard test forbids bare labels) |
| Why a setting exists | `InfoTip` / the `help` prop on `Card` — not paragraphs of helper text |
| A status | `Badge` with a tone |
| A message | `Alert` with a tone |
| Lists | `ListToolbar`, `Tabs`, `FilterPill`, `Table*`, `RowActions`, `Pagination`, `TableSkeleton` |
| Numbers at a glance | `StatCard` / `StatGroup` / `StatStrip` |
| Nothing here yet | `EmptyState` |
| Confirm a destructive step | `ConfirmDialogProvider` (never `window.confirm`; a test enforces it) |
| Choose one of many | `Select` (never a native `<select>`; a test enforces it) |
| A boolean setting | `Switch` |

## Data surfaces

- Tables are compact and scroll horizontally only when they must. On mobile they
  become stacked, tappable rows with the primary identifier first.
- The order number is the primary link; customer, stage and COD total are the
  first scanning fields. A stage is shown with its `--status-*` colours.
- Every async surface has loading (`Skeleton`), error, empty and
  filtered-empty states.
- Counts and placeholders go through `t(key, values)` with one plural key per
  CLDR form; relative times through `@/lib/relative-time`.

## Interaction

- Primary actions are text, with a Lucide icon when it speeds scanning.
- Icon-only controls need an accessible label from the locale files and a tooltip.
- Touch targets are at least 40px. Focus is always visible (`ring`).
- Arabic switches the document to RTL. Use logical utilities (`ms-`, `pe-`,
  `start-`, `end-`) and `rtl:rotate-180` on directional icons; never `left`/`right`.
- Motion is short (160–260ms, `--ease-out-quint`) and carries state, not decoration.

## Migration rules

- New pages use `DashboardChrome`; do not create a parallel shell.
- Every string lives in `locales/{ar,en,fr}` and is read with `useT`. That
  includes `placeholder`, `title`, `aria-label` and `alt`. The parity test fails
  a missing key in any language.
- New routes must exist before they appear in navigation.
- Data goes through `src/lib/api.ts`; authorization stays in cod-server.
- Desktop and mobile must offer the same core task.
