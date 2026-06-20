# Design optimization — session brief (prep 2026-06-20)

> **Goal (Aaron):** "the brand is too busy." Declutter the UI/UX while keeping the
> **"Survey Table, Warmed"** identity (civic-warm, sourced-data honesty, BAND/BOX).
> This is the NEXT session's focus. Billing rework (the new **$2/mo · $20/yr** launch
> pricing + the owner/admin "comp to free" capability — see [[bandbox-stripe-m8]])
> waits until AFTER design.

## Diagnosis — where the busyness lives (from live screenshots, 2026-06-20)

Grounded in two captured surfaces: the **Market Scan homepage** (the busy one) and the
**parcel deep-dive** (already calmer — the "right amount" reference).

1. **Four type voices on screen at once** — Tanker (display), Zodiak (serif), Satoshi
   (UI), Space Mono (mono). Four "accents" competing. → Consolidate to **2–3** with
   clear, non-overlapping roles.
2. **Uppercase + mono as the DEFAULT label treatment** — FILTERS, DISTRESS SIGNALS,
   every card title + list row is uppercase Space Mono with wide tracking. A wall of
   all-caps mono = shouty texture, hard to scan. → Reserve mono/uppercase for true
   *data* + small labels; sentence-case UI font for most headings/labels.
3. **Heavy brutalist device on EVERY element** — 3–4px ink borders + 6–10px hard
   offset drop-shadows on cards, chips, buttons, the score block. Everything shouts
   equally → no hierarchy. → Reserve the heavy treatment for **1–2 hero elements per
   screen**; lighten the rest to hairlines / subtle-or-no shadow.
4. **Red over-deployed** — the wordmark, the DISTRESS lens, the DISTRESS SCORE 100
   block, four pills, the distress bar, and the signal squares are red *simultaneously*.
   "Red = signal only" is the stated intent, but it's everywhere → it stops signaling.
   → Pull red back to genuine distress signal; **navy + neutrals carry structure.**
5. **Market Scan runs two MAXIMAL data rails** flanking the map (left Filters + right
   Neighborhood), both fully packed, so the eye has no primary anchor. → Make the
   **map the hero**; let rails recede (lighter, less dense, collapsible).
6. **Relentless density** — every filter + rail row carries a count/percent. →
   Progressive disclosure: headline first, detail on demand.

## Approach + skills (suggested order)
1. **/critique** + **/audit** — baseline each surface (UX score + a11y/perf).
2. **/quieter** — tone down the aggressive/overstimulating devices (matches "too busy").
3. **/distill** — strip each surface to its essence; remove redundant chrome.
4. **/typeset** — fix the type system (4 → 2–3 voices; label treatment; hierarchy).
5. **/layout** — hierarchy + spacing rhythm, esp. the Market Scan 3-column.
6. **/polish** — final consistency pass.

(`/impeccable teach` can hold the project design context across these steps.)

## Preserve — don't lose the brand
Keep: the **BAND/BOX** wordmark, navy structure, warm-paper ground, square corners,
and the data-honesty (every figure sourced + decomposable). The brutalist bones ARE
the identity — the goal is to make them **breathe** (restraint + hierarchy), not erase
them. The parcel deep-dive shows the target balance already exists in the system.

## Design system facts (for reference)
- Tokens: `TOKENS.css` (62 vars) · rationale `design/DESIGN.md`. App CSS:
  `components.css` (497 lines), `globals.css` (268), `account.css` (241), `leads.css` (221).
- Fonts self-hosted in `apps/web/public/fonts/`: tanker400, satoshi 400/500/700,
  spacemono 400/700, zodiak 400/700.
- Palette: 7 neutral background shades + 4 blues + 2 reds + 4 lens hues (light + dark).

## Direction — DECIDED (2026-06-20)
- **Intensity: MODERATE restraint** (keep the brutalist character; make it breathe).
- **Scope: design-system FIRST** (token + shared-component changes that cascade).
- Type: keep the 4-font *delegation* (Tanker display / Zodiak voice / Satoshi UI /
  Space Mono data) — the fix is the *label treatment*, not dropping a family.

## Implementation plan — analysis complete, NOT yet implemented

A 5-lens analysis (typography · color-red · border-shadow · density · brand-guardian)
+ synthesis produced this de-conflicted, DESIGN.md-grounded MODERATE change-set. The
prior session ended right after the token layer was started, then **reverted clean** —
so the working tree has none of it. Execute as ONE coherent pass on a fresh
`design-restraint` branch, then **verify visually** (light + dark · homepage + parcel +
leads) with before/after screenshots before opening a PR.

**Three levers:** (1) re-cast UI labels uppercase-mono → sentence-case Satoshi (data
stays mono); (2) tier the brutalist device (secondaries → hairline, heroes keep the
shadow); (3) re-concentrate red to its sanctioned jobs.

### A. Token layer — edit BOTH `TOKENS.css` (spec) + `apps/web/src/app/globals.css` (runtime), identical values
- Add `--pb-border-w-tier1: 1px;` and `--pb-shadow-tier1: 2px 2px 0 var(--pb-shadow-ink);` (in TOKENS.css the shadow uses `var(--pb-ink)` per its convention).
- `--pb-space-6: 22px → 20px`; `--pb-space-7: 34px → 30px`.
- `--pb-red` comment → narrow the scope (cap 2–3/screen; never wordmark/pills/trend/bg/body).
- **REJECTED** (over-reach): `--pb-text-xs: 11 → 10` — shrinks data stamps + AA risk; the case/family change is the higher-leverage lever.

### B. `components.css` — label re-cast (UI labels → sentence-case Satoshi; data stays mono)
- `.pb-card-head`: weight 900→700, letter-spacing 0.06em→0, text-transform uppercase→none; margin →`space-3`, padding-bottom →`space-2` (keep font-ui + the 3px ink bottom border).
- `.pb-mlabel`: font mono→`--pb-font-ui`, add weight 500, ls→0, transform→none.
- `.pb-flabel`: font mono→`--pb-font-ui`, weight 700→600, ls→0, transform→none.
- `.pb-seg-detail h4`: weight 900→700, ls 0.06em→0, transform→none.
- `.pb-lensswitch button`: font mono→`--pb-font-ui`, ls 0.06em→0, transform→none (keep weight 700).

### C. `components.css` — tier the device (recede secondaries; heroes stay loud)
- `.pb-cardbox` (default only): border `3px ink` → `1px gravel` (`--pb-border-w-tier1`); box-shadow → none. **KEEP `--frame` + `--mass`.**
- `.pb-btn--secondary` + `.pb-btn--ghost`: box-shadow → none (`--ghost` border → tier1 gravel). **KEEP `.pb-btn--primary` (red + `--pb-shadow-lg`).**
- Control chrome → hairline + no shadow: `.pb-lensswitch`, `.pb-legend`, `.pb-timestrip`, `.pb-trendcard`, `.pb-community--rail`. **NOT** `.pb-rail` / `.pb-mapframe` / `.pb-distressblock` / `.pb-distress-score` (heroes keep the device).
- `.pb-pill` base border: `2px ink` → `1px gravel`.

### D. `components.css` — re-concentrate red
- `.pb-wordmark .pb-l2` (light mode): color red → brick (aligns with DESIGN.md §32; dark already brick).
- `.pb-pill--danger`: bg + border red → brick. **ADD** `.pb-pill--urgent { background: var(--pb-red); color: var(--pb-on-red); border-color: var(--pb-red); }` for genuine crises only.
- `.pb-trend .pb-bar--hi`: bg red → brick.
- `.pb-lensswitch button[aria-pressed='true']::after`: bg red → blue.

### E. `leads.css` — same cascade locally (verify the exact selectors first)
- leads table `th`: font mono→`--pb-font-ui`, ls→0, transform→none (keep weight 700).
- `.pb-leads-total`: font mono→`--pb-font-ui`, ls→0, transform→none.
- `.pb-leads-exportmsg`: color red → blue.

### PRESERVE (brand guardian — DO NOT touch)
radius 0; navy header mass + 4px border; `--pb-border-w` 3px / `-lg` 4px on PRIMARY
regions (header/map/rails/distress blocks); the hero device on `.pb-btn--primary` /
`.pb-distress-score` / `.pb-distressblock` / `.pb-mapframe` / `.pb-rail`; the
distress-bar **DOMINANT** segment stays true red (DESIGN.md §67); the red holding-mark
square `.pb-mark-square`; the Distress-lens choropleth red; **Space Mono for ALL data**
(values, source stamps, codes, primary-button text); the 4-font delegation; the Zodiak
warmth voice; the warm-umber dark theme + light/dark AA parity; `account.css` left isolated.

### DEFER to later layout/IA work (NOT this pass)
Market Scan rail density / progressive disclosure on zoom; leads redundant columns;
mobile shadow-fallback tuning after tier tokens land; metric-cell micro-padding;
a `.pb-metric--red` single-per-card lint gate.

> Full reasoning (per-lens proposals + the conflict resolutions vs DESIGN.md) is in the
> `design-restraint-analysis` workflow output for this project.
