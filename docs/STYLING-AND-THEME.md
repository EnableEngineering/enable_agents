# Styling & Theme

Single reference for how Enable's UI is styled — written in the same spirit
as Reflection's own `STYLING-AND-THEME.md` (the app this pass aligned
Enable's theme toward; see `docs/todo.md`'s "Theme consistency" section for
the full history and the side-by-side preview the accent-color decision was
made from). Read this before adding a new color, radius, shadow, or
component pattern — if it's not here, it probably shouldn't exist yet.

Everything below is backed by CSS custom properties in
`frontend/src/styles/tokens.css`. **Never hardcode a color, radius, shadow,
or font — reference the token.** If you must set a fallback (e.g.
`var(--color-text, #181C23)`), keep the fallback in sync with the token by
hand; grep for the token's hex value across the codebase if you ever change
it, since a stale fallback is invisible until the token itself is missing.

## Color

One accent hue, used for both primary actions and highlights — not a
primary/accent two-hue split.

| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#181C23` (near-black) | Sidebar background, dark surfaces |
| `--color-accent` | `#2563EB` (royal blue) | Primary buttons, active states, links, focus rings — the one brand color |
| `--color-text` | `#181C23` | Body/heading text |
| `--color-text-muted` | `#6B7280` | Secondary text, descriptions |
| `--color-background` | `#F9FAFB` | Page background |
| `--color-surface` | `#FFFFFF` | Cards, panels, inputs |
| `--color-border` | `#E5E7EB` | Default border |

Status/semantic colors (`--color-success`, `--color-warning`,
`--color-error`) are a **separate system from the accent** — see
"Status & priority colors" below. Never reuse the accent hue to mean
"success" or vice versa.

Team role badges (`--role-owner`, `--role-admin`, `--role-member`,
`--role-viewer`) and the categorical chart palette
(`--color-chart-blue/purple/pink/indigo/gray`) are their own small,
deliberately-separate systems — not brand UI chrome, don't reuse them for
buttons/highlights.

## Typography

One typeface: **IBM Plex Sans**, both `--font-display` and `--font-body`.
There is no second display face — a two-font system (a serif/display pair)
was tried and reverted; IBM Plex Mono exists only as `--font-mono` for
code/data.

Four font sizes only — `--text-brand` (28px, the wordmark), `--text-page-title`
(20px), `--text-heading` (16px, card titles/section headers/input labels),
`--text-body` (14px, the default), `--text-caption` (12px, badges/captions).
Don't introduce a fifth; a handful of legacy aliases (`--text-sm`,
`--text-lg`, etc.) exist for old call sites and map onto these four — use
the named ones (`--text-body`, not `--text-sm`) in new code.

## Border radius

Sharper than a typical rounded-corner SaaS default, on purpose:

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 4px | Small chips, tags |
| `--radius-md` | 6px | **Buttons** (`.btn` references this directly) |
| `--radius-lg` | 8px | Cards, panels, inputs |
| `--radius-xl` | 10px | Modals |
| `--radius-2xl` | 12px | Large feature panels (rare) |
| `--radius-full` | 9999px | Pills, avatars, badges |

## Shadows

All shadows are tinted near-black (`rgba(15, 23, 42, …)`), not the old
navy tint. `--shadow-md` and `--shadow-xl` are the two tiers most worth
knowing: `--shadow-md` for a resting card, `--shadow-xl` for the highest
elevation (a modal, a popover). `--shadow-accent-*` exist for buttons/cards
that want a colored glow on hover — tinted with the accent blue.

## Buttons

`<Button>` (`frontend/src/components/Button.js`) is a thin wrapper around
`.btn`/`.btn-*` in `tokens.css` — use it instead of hand-rolling button
markup/CSS.

**Variants:** `primary` (solid accent), `secondary` (outlined), `ghost`
(text-only), `outline`, `danger`.

**Destructive actions, two tiers** — both already existed in the codebase,
just hadn't been written down as a deliberate pair until this pass:
- **Low-emphasis** (inline "Remove" in a list/row): `<Button variant="danger">`
  — light red background, red text (`.btn-danger`).
- **High-emphasis** (confirm-delete dialogs only, where a misclick is
  costliest): `ConfirmDialog`/`showConfirm`'s `variant="danger"` — solid
  red gradient, white text (`.confirm-dialog-btn--danger`).

Don't cross the two: a low-emphasis tier inside a confirm dialog undersells
the stakes, a high-emphasis tier inline overstates them.

**Height, two tiers:**
- Default (no `size` prop, ~44px): standalone forms, page-level primary
  actions ("+ New Project", "Save Changes").
- `size="sm"` (~33px): toolbars, table/list rows, anywhere several buttons
  sit close together. If a button looks oversized next to its neighbors in
  a toolbar/row, it's almost always a missing `size="sm"`, not a reason to
  invent a third tier.

## Status & priority colors

`frontend/src/utils/statusColors.js` is the canonical status/priority →
color mapping — `getStatusColor(status)` / `getPriorityColor(priority)`,
five semantic tiers (`neutral`/`info`/`warning`/`success`/`error`), each
backed by tokens and with a matching `.status-tier-*` CSS class in
`tokens.css`. New status/priority UI should read from here.

This exists because at least four different, partly-inconsistent
status-color systems had grown independently across the app (a local
`statusConfig` in `WorkflowsPage.js`, and four separate class sets in
`ExecutiveAssistantPage.css` alone: `.priority-pill`, `.priority-dot`,
`.status-pill`, `.status-badge`) — one of which colored a **pending**
(not-started) item in the same error-red as a **failed/cancelled** one, and
conflated status values with priority values in one CSS selector set
(implying "pending" and "high priority" were the same thing). That specific
case is fixed; the module exists so it doesn't happen again, but a full
migration of every remaining status surface (Sales Helper, Supply Chain
audit pass/fail, notification read/unread, etc.) onto this module is still
open — check `docs/todo.md` before assuming it's finished everywhere.

## Section headers

Use `PageLayout.js`'s `<PageSection title="…">` rather than hand-rolling a
section header. Its `.page-section-title` style is the canonical
treatment: bold weight + a thin accent-colored underline.

This deliberately does **not** color the header text itself in the accent
hue, unlike Reflection's own literal spec (their header text is
accent-colored) — in Enable's system the accent is reserved for
interactive/actionable elements, so coloring static heading text the same
blue as a button would blur that distinction. The underline carries the
same "this is a branded heading" signal without the ambiguity. This is the
one deliberate divergence from a literal port in this whole pass — everything
else above matches Reflection's actual values.

## Required/optional form fields

`FormField.js` is the canonical wrapper for labeled inputs. `required`
already renders a red asterisk; any field with a `label` that isn't
`required` automatically gets `(Optional)` appended — pass
`hideOptionalLabel` to opt a specific field out (checkboxes, or where
"optional" is already obvious from context). Most of the app still
hand-rolls its own `<label>` elements rather than using `FormField` — when
you touch a form, prefer migrating it to `FormField` over adding another
one-off label pattern; if that's not practical, at least match the
convention by hand (see `Projects.js`'s `.field-optional-label` for the
pattern to copy).

## Toasts

One system: `frontend/src/core/toast.js`'s `showToast(message, type,
duration)` — vanilla DOM injection into `#ea-toast-root`, top-right,
3000ms default duration. A second, unrelated `Toast.js` React component
and `useToast.js` hook existed as dead code (zero real imports) and were
deleted in this pass — if you're tempted to build a toast component,
`core/toast.js` already does this, use it.

## What's still open

Tracked in `docs/todo.md`'s "Theme consistency with Reflection" section:
full app-wide migration onto `statusColors.js`, a broader required/optional
field audit beyond the one example fixed here, and confirming every
agent/workflow detail page puts its status chip in the header next to the
title (spot-checked `WorkflowRunner.js` — already correct there).
