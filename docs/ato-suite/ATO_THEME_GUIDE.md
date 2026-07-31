# Ato Suite Shared Theme Guide

**Status:** Organato-derived baseline, audited 31 July 2026  
**Scope:** Organato, Emailato, Calandato, and Ato Centre  
**Purpose:** Keep the four applications recognisably related without erasing the needs of email, calendar, planning, and suite-level surfaces.

## 1. Evidence and authority

This guide distinguishes implemented evidence from proposed suite standards:

- **Current** means the behaviour or token exists in Organato now.
- **Specified** means it appears in Organato's product documentation, even if implementation differs slightly.
- **Proposed standard** means the rule should be adopted by all four apps but is not yet established in all repositories.

At audit time, Organato is the only app with interface code. Emailato, Calandato, and `ato centre` are empty Git repositories with no commits; the supplied `Command Centre` path does not exist on disk. Consequently, no visual convention or fixed accent colour is claimed for those three apps. Their identities should be built as controlled extensions of the Organato baseline below.

Primary evidence:

- `apps/web/src/styles.css`: base theme variants, accessibility attributes, focus, and component foundations.
- `apps/web/src/polish.css`: later-loaded effective dark tokens, chrome, spacing, typography, controls, and responsive rules.
- `apps/web/src/main.tsx`: confirms `styles.css` loads before `polish.css`; where selectors have equal specificity, `polish.css` is the effective runtime value.
- `apps/web/src/components/AppShell.tsx`: shared navigation structure, Lucide icon treatment, sync state, bottom navigation, and landmarks.
- `apps/web/src/components/BrandMark.tsx` and `BrandMark.css`: orbit-and-point mark, accent/monochrome modes, and accessibility behaviour.
- `apps/web/src/pages/calendar/calendar.css`: dense calendar-specific surfaces, state treatments, and mobile adaptation.
- `apps/web/public/boot.css` and `privacy.css`: standalone dark/light fallbacks and reduced-motion treatment.
- `docs/02-experience-and-interface.md`: the intended quiet, exact, dependable product personality; responsive shell; themes; typography; icons; and motion.
- `docs/01-product-specification.md` and `docs/07-settings-catalogue.md`: WCAG AA, keyboard access, non-colour signals, theme/density/accessibility settings.
- `design/concepts/home-desktop.png`, `home-mobile.png`, and `assignments-desktop.png`: visual evidence for restrained dividers, dense rows, sparse accent colour, desktop rail, mobile bar, and side inspector.

When documentation and current CSS differ, use the effective runtime tokens in section 4 as the compatibility baseline, then consolidate them as recommended in section 12.

## 2. Shared character

**Current and specified:** The suite should feel calm before impressive: quiet, exact, dependable, compact, and work-oriented. The visual reference is Obsidian-like restraint rather than imitation of any branded interface.

All apps should therefore use:

- A near-black or quiet neutral canvas with low-contrast structural separation.
- Typography, alignment, and thin rules as the main hierarchy; not piles of cards.
- Colour only for focus, selection, app identity, subjects/categories, and semantic state.
- Controls that become more visible on hover, focus, selection, or when action is required.
- Compact information density on desktop with complete, readable phone layouts.
- Direct, practical copy and status labels instead of decorative empty states.

Avoid gradient-heavy panels, glassmorphism as a default surface, large marketing headings inside the product, bright full-row state fills, cards inside cards, decorative motion, and mixed icon styles. The slight translucent blur on Organato's phone bottom navigation is a navigation treatment, not permission for suite-wide glass effects.

## 3. Theme architecture

### Shared semantic token contract — proposed standard

Each app should consume semantic variables rather than hard-coded component colours:

```css
:root {
  color-scheme: dark;
  --ato-bg: #0b0b0c;
  --ato-sidebar: #151517;
  --ato-surface: #151517;
  --ato-surface-hover: #1b1b1e;
  --ato-surface-active: #202024;
  --ato-text: #f2f2f3;
  --ato-text-secondary: #aaaab1;
  --ato-text-muted: #77777f;
  --ato-border: rgb(255 255 255 / 8.5%);
  --ato-border-strong: rgb(255 255 255 / 14.5%);
  --ato-accent: #9a86ff;
  --ato-accent-soft: rgb(154 134 255 / 11%);
  --ato-danger: #ef7777;
  --ato-success: #77bd84;
  --ato-warning: #d2aa66;
}
```

During migration, an app may alias its existing variables (`--bg`, `--text`, `--focus`, and so on) to these names. New suite components should use the `--ato-*` contract directly. Token names express purpose, never a literal colour such as `--purple` or `--dark-grey`.

### Modes

**Current:** Organato exposes Obsidian Dark (default), Pure Black, Soft Dark, Light, and System. Theme choice changes surfaces and text, not semantic meaning.

**Proposed standard:** Every app must implement the same mode identifiers and persist them consistently:

| Mode          | Canvas                                                         | Sidebar / primary chrome | Raised surface | Hover     | Active    |
| ------------- | -------------------------------------------------------------- | ------------------------ | -------------- | --------- | --------- |
| Obsidian Dark | `#0b0b0c`                                                      | `#151517`                | `#151517`      | `#1b1b1e` | `#202024` |
| Pure Black    | `#000000`                                                      | `#101011`                | `#121214`      | `#19191b` | `#1e1e21` |
| Soft Dark     | `#141416`                                                      | `#1b1b1e`                | `#1f1f22`      | `#252529` | `#2b2b30` |
| Light         | `#ffffff`                                                      | `#f5f5f6`                | `#f7f7f8`      | `#efeff1` | `#e8e8eb` |
| System        | Resolves to Obsidian Dark or Light from `prefers-color-scheme` |                          |                |           |           |

Light-mode text and structure currently use `#202024` primary text, `#5f5f67` secondary text, `#7b7b85` muted text, 10% black borders, 17% strong black borders, and `#7455c7` focus. The standalone boot/privacy pages use an off-white `#fbfbfa`; this is acceptable for public/boot content but should not become a second in-app light canvas.

Dark mode is the default, not the only supported mode. No app-specific identity may depend on a colour that disappears or changes meaning between modes.

## 4. Palette and colour usage

### Neutral hierarchy — current baseline

| Role              | Dark value  | Use                                                    |
| ----------------- | ----------- | ------------------------------------------------------ |
| Canvas            | `#0b0b0c`   | Root page background                                   |
| Sidebar / surface | `#151517`   | Floating rail, popovers, quiet raised regions          |
| Hover             | `#1b1b1e`   | Pointer/keyboard affordance                            |
| Active            | `#202024`   | Selected navigation, update notices, stronger surfaces |
| Primary text      | `#f2f2f3`   | Titles, values, primary actions                        |
| Secondary text    | `#aaaab1`   | Labels, metadata, idle controls                        |
| Muted text        | `#77777f`   | Tertiary metadata only                                 |
| Border            | 8.5% white  | Dividers and low-emphasis structure                    |
| Strong border     | 14.5% white | Controls, panel boundaries, selected structure         |

Use one surface and dividers before introducing another card layer. Full-width rows are normally separated by thin borders and a quiet hover fill.

### Accent and semantic colours

**Current:** Lavender is the Organato focus/selection colour. The effective dark focus is `#9a86ff`; the mark's point and subject-colour default use `#a78bfa`. Success is `#77bd84`, warning `#d2aa66`, and danger `#ef7777`. These hues appear as dots, fine edges, outlines, text, or small tinted fields rather than large blocks.

Rules for every app:

- Accent means current location, focus, selection, active tab, or branded highlight. It does not mean success.
- Semantic colours retain the same meaning across all four apps.
- Pair status colour with an icon, label, shape, pattern, or position. Organato already pairs sync dots with labels such as “Up to date” and “Action needed.”
- Category colours (subjects, calendars, labels, accounts) are user/data colours. Keep them out of global navigation and never infer semantic state from them.
- Use `color-mix()` for subtle accent tints while maintaining a neutral base.
- Destructive actions use danger text/border and clear wording; do not turn the entire panel red.

### App-specific accents — proposed extension, not existing evidence

The suite may assign one `--ato-app-accent` per app, but only as a small identity layer. Organato's established lavender (`#9a86ff` dark; `#7455c7` light) remains its accent. Emailato, Calandato, and Ato Centre have no evidenced palette yet, so their accent values are deliberately **TBD** until chosen and contrast-tested in both modes.

Permitted app-accent locations:

- The point in the shared orbit mark or an equally small mark detail.
- Active navigation indicator and active tab underline.
- Focus ring if the chosen value meets contrast requirements.
- Small selection highlights, badges, and account avatars.

Do not recolour the canvas, primary text, semantic states, whole sidebars, or standard controls by app. Ato Centre should show child-app accents only when identifying a destination or source; its own chrome remains neutral.

## 5. Typography and icons

**Current:** `polish.css` uses the native system stack: `-apple-system`, BlinkMacSystemFont, `SF Pro Text`, `SF Pro Display`, `Segoe UI`, `ui-sans-serif`, `system-ui`, `sans-serif`. This is the suite standard. The older stylesheet and standalone pages name Inter first, but no bundled webfont is evidenced; avoid a network font dependency.

Typography baseline:

- Root: `15px × --font-scale`, line-height `1.45`, with settings allowing 90–120%.
- Body/control text: approximately `0.8125rem–0.875rem` (12.2–13.1 px at the default root).
- Page title: `clamp(1.55rem, 2vw, 1.85rem)`, weight 650, tracking `-0.04em`.
- Section heading: approximately `0.9375rem`, weight 600.
- Settings/page subsection: `1.15–1.25rem`, weight 650.
- Uppercase eyebrow/group label: about `0.6875rem`, weight 600, tracking `0.08em`; use sparingly.
- Metadata may be smaller only when nonessential and still passes accessibility requirements.
- Optional tabular/monospace numerals are appropriate for times, countdowns, and compact metadata.

Use stronger weight and tighter tracking for headings, not oversized type. Use primary text for value, secondary for label, muted for tertiary detail.

**Current:** Organato uses Lucide with 1.7 stroke in the shell. **Proposed standard:** use Lucide throughout the suite at roughly 18 px navigation / 20–22 px primary mobile navigation, with consistent stroke width. Icon-only buttons need an accessible name and visible tooltip where meaning is not obvious. Do not mix filled, outlined, and platform icon families in one context.

## 6. Spacing, shape, and elevation

**Current baseline:** Organato does not expose a formal spacing scale, but repeatedly uses 4, 6, 8, 12, 16, 24, 32, and larger 40–72 px section gaps.

**Proposed standard:** use a 4 px base scale:

| Token           | Value | Typical use                         |
| --------------- | ----- | ----------------------------------- |
| `--ato-space-1` | 4 px  | Icon/text micro-gap                 |
| `--ato-space-2` | 8 px  | Compact control/group gap           |
| `--ato-space-3` | 12 px | Row/control padding                 |
| `--ato-space-4` | 16 px | Panel inset, rail inset             |
| `--ato-space-5` | 24 px | Content gutter / section separation |
| `--ato-space-6` | 32 px | Major section gap                   |
| `--ato-space-8` | 48 px | Strong page rhythm only             |

Effective structural dimensions:

- Desktop sidebar: 224 px wide, 16 px viewport inset, 18 px radius.
- Collapsed tablet rail: 70 px wide with 14 px inset.
- Header: 72 px desktop; about 62–64 px phone.
- Standard control: 36 px high, 7 px radius.
- Standard panel/popover: 12 px radius; smaller inline surfaces commonly 4–8 px.
- Main content: fluid up to 1480–1500 px.
- Inspector: up to 390 px wide; phone-safe at `100vw`.

The sidebar is intentionally the strongest rounded form. Reserve pills (`999px`) for toggles, chips, scrollbar thumbs, and truly pill-shaped controls. Shadows belong to floating rails, popovers, dialogs, inspectors, toasts, and overlays—not ordinary list rows. Organato uses broad, low-opacity black shadows such as `0 18px 42px rgb(0 0 0 / 14%)` for the rail and stronger shadows for overlays.

## 7. Components and interaction states

### Shell and navigation

- Desktop: floating left rail with wordmark, primary destinations, flexible space, sync state, and account/settings.
- Tablet: collapsed icon rail; labels may hide but accessible names remain.
- Phone: fixed bottom navigation with safe-area padding; content receives matching bottom clearance.
- Active destination: quiet active surface plus a slim accent indicator. Hover alone is not the active state.
- Ato Centre may add app switching, but child apps should retain the same shell geometry and navigation behaviour.

### Buttons and controls

- Standard action: transparent/neutral with secondary text; hover adds `surface-hover` and primary text.
- Primary action: high-contrast inverse (`text` background, `bg` foreground), as Organato's New/Create controls do.
- Selected/active option: accent underline, fine inset ring, or soft accent tint.
- Destructive action: danger text and/or border with explicit wording.
- Disabled: not-allowed cursor and approximately 48% opacity; do not use Organato's older `cursor: wait` rule.
- Loading: preserve button width, communicate busy state, and prevent duplicate activation.
- Input: transparent or surface background, 1 px border, 36–42 px minimum height, visible placeholder distinction.

### Overlays and feedback

Use a darkened backdrop with minimal blur for modal overlays. Popovers and dialogs use the raised surface, strong border, 10–12 px radius, and shadow. Side inspectors remain visually attached to the viewport edge. Toasts and update notices must not cover phone navigation and should include text, not colour alone.

### Motion

**Current:** `150ms cubic-bezier(0.2, 0, 0, 1)` for colour/border/opacity transitions. **Specified range:** 100–180 ms.

- Use motion to clarify hover, selection, inspector opening, sidebar expansion, and direct manipulation.
- Do not animate every row on entrance or use decorative bounce.
- Honour both `prefers-reduced-motion: reduce` and the in-app reduced-motion setting by reducing transitions/animations to effectively zero.

## 8. Responsiveness

**Current breakpoint pattern:** 1180 px collapses the sidebar; 900–761 px allows headers/actions to wrap; 760 px and below switches to the phone shell. Some feature components use 1100, 980, 680, or 640 px for local layout pressure.

Suite rules:

- Treat approximately 1024 px and above as desktop-first, but let content—not a device list—drive local breakpoints.
- Collapse rail labels around 1180 px when the main workflow needs width.
- At 760 px or below, use the bottom navigation, safe-area insets, compact headers, and overflow menus for secondary commands.
- Convert dense tables into structured multi-row records or provide a linear alternative; do not merely shrink text.
- Calendar views may replace segmented controls with a select and move popovers to viewport-fixed placement on phone.
- Preserve essential actions and state; hide labels or secondary metadata before removing capability.
- Minimum mobile interactive target should be 44 × 44 px where practical. Organato already uses 44 px list actions and 48 px phone navigation, but several 29–38 px desktop controls should gain larger hit areas on touch layouts.
- Test at narrow phone widths, 760 px, the tablet rail transition, and a wide 1500 px desktop canvas.

## 9. Accessibility baseline

All four apps must meet WCAG 2.2 AA for applicable UI and retain Organato's documented requirements:

- Full keyboard access for navigation, tables/lists, dialogs, calendar controls, settings, and app switching.
- A 2 px visible focus ring with 2 px offset; Organato uses `--focus` and a small radius.
- A skip link to the main landmark, semantic headings/landmarks, and focus management for dialogs/inspectors.
- Accessible names for icon-only controls; decorative icons are hidden from assistive technology.
- Status announcements for saves, sync, errors, and other asynchronous changes where appropriate.
- Colour is never the only signal for status, priority, category, sync health, or app identity.
- Reduced-motion, increased-contrast, font scaling, and optional underlined external links.
- Readable local date/time labels, including full machine-readable/assistive labels where visible text is abbreviated.
- Charts require adjacent textual summaries and accessible data tables.

Measured against the effective dark canvas `#0b0b0c`, primary text is approximately 17.59:1, secondary 8.52:1, accent 6.77:1, danger 7.10:1, success 8.80:1, and warning 9.07:1. Dark muted text `#77777f` is approximately 4.43:1, narrowly below 4.5:1 for normal text. In light mode, `#7b7b85` is approximately 4.19:1 on white. Therefore:

- Do not use the current muted tokens for essential normal-sized text.
- Before extracting the suite token package, raise muted contrast or restrict it to large/nonessential text and non-text decoration.
- Contrast-test app accents, subject/category palettes, and all semantic foreground/background pairs in every mode.
- Borders alone need not meet text contrast, but interactive component boundaries and focus indicators must remain perceivable.

## 10. Brand treatment within the theme

**Current:** Organato's mark is an open circular orbit with a small accent point. It supports accent and monochrome variants; its SVG receives an accessible title only when used as meaningful imagery and is otherwise hidden. The PWA icon uses the near-black canvas, white orbit, and lavender point.

**Proposed standard:** retain the orbit geometry as the family cue if the suite chooses a shared family mark. Change only the small point/accent for child-app identity; do not distort the orbit, add gradients, or create unrelated icon styles. Product names use the system typeface and the same compact lockup spacing. Detailed logo governance belongs in the suite's general brand document; this section defines only its relationship to theme tokens.

## 11. App-specific application

These are workflow adaptations, not new themes:

| App        | Shared foundation                                  | Legitimate local expression                                                                                                             |
| ---------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Organato   | Full baseline                                      | Established lavender accent; subject dots/edges; dense work tables and classification states                                            |
| Emailato   | Same shell, surfaces, typography, controls, states | TBD tested app accent; account/label colours as data; unread state through weight + marker, not a bright full-row fill                  |
| Calandato  | Same shell, surfaces, typography, controls, states | TBD tested app accent; calendar colours as data; today/selection through outline, label, and position as well as colour                 |
| Ato Centre | Neutral suite shell and semantic state language    | Child-app accent only on app tiles/source markers; its own accent is TBD; cross-app status keeps shared success/warning/danger meanings |

An app may introduce a layout or component required by its workflow, but it should first compose the shared primitives: page header, command group, control, row, panel, popover, dialog, inspector, status indicator, empty state, and responsive navigation.

## 12. Implementation guidance and governance

### Immediate proposed standardisation

1. Extract one versioned shared token file/package and import it before app-specific component CSS.
2. Keep mode values and accessibility overrides in that package; expose `--ato-app-accent` as the only ordinary app-level palette override.
3. Build shared primitives for `AppShell`, `PageHeader`, buttons, fields, popovers/dialogs, toasts, status indicators, and `BrandMark` only after token consolidation.
4. Add visual regression fixtures for dark, light, pure black, soft dark, high contrast, 120% font scale, reduced motion, desktop rail, tablet rail, and phone bottom navigation.
5. Require contrast checks and keyboard/focus checks in each app before release.

### Known Organato drift to resolve, not replicate

- `styles.css` and later-loaded `polish.css` both define core tokens with different values. The table in section 3 records the effective current values; new apps should have one source of truth.
- The specification's suggested sidebar `#252527` differs from current effective `#151517`. Follow the current effective UI for suite consistency unless a deliberate suite-wide redesign is approved.
- The mark point (`#a78bfa`) and focus accent (`#9a86ff`) are close but distinct. Either document them as `accent-mark` and `accent-interactive`, or consolidate after contrast/visual review.
- Standalone boot/privacy files use slightly different font stacks, surfaces, and lavender values. Map them to suite tokens where their loading constraints allow.
- High-contrast overrides currently strengthen borders and neutral text; verify app-accent and semantic colours under the same mode.

### Change rule

A change to a shared neutral, semantic colour, typography scale, radius, shell breakpoint, focus treatment, or motion token is a **suite change** and must be reviewed in all four apps. A workflow layout or data/category colour is an **app change** provided it still satisfies this contract. Record proposed app accents only after testing them in every mode and documenting their exact token values.

## 13. Definition of theme consistency

An app is consistent with the Ato suite when a user can move between apps without relearning visual hierarchy, navigation behaviour, control states, semantic colours, focus treatment, or responsive behaviour. Consistency does not mean identical screens: Emailato should still feel like email, Calandato like a calendar, Organato like planning/work management, and Ato Centre like a cross-app home. Their shared character comes from the neutral canvas, restrained accent use, system typography, compact rhythm, thin structure, state language, and accessible interactions.
