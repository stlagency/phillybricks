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

## ✅ EXECUTED 2026-06-20 (branch `design-restraint`, not yet merged)

Implemented as one coherent pass across **10 files** (token layer in both `TOKENS.css` + `globals.css`; `components.css` levers B/C/D + the mobile-shadow scope fix; `leads.css`; `Pill.tsx` `urgent` kind; 4 JSX de-caps in `DistressBar`/`DeepDive`/`ValueDerivationDrawer`; `DESIGN.md` synced + addendum). Bracketed by **two adversarial-review workflows** — a pre-flight completeness/usage/brand audit (caught the `--frame`/`--mass` gravel-strand bug + ~11 missed labels + the brick-fill-vs-DESIGN.md tension before editing) and a post-implementation a11y/brand/completeness review.

**Review fixes applied** beyond the original plan:
- `.pb-ledger thead th` (deep-dive sale-history table) was ALSO re-cast to sentence-case — the plan only named the leads table, leaving this one shouty.
- `.pb-btn--secondary` + `.pb-btn--ghost` **type** re-cast to sentence-case Satoshi (the plan tiered only their border/shadow; `.pb-btn` base still forced mono-caps). Primary CTA stays mono-caps (sanctioned). De-capped the two hardcoded JSX literals (`ADD NOTE +` → `Add note +`, `EXPORT RECORD` → `Export record`).
- Ghost button border kept **1px ink** (not gravel): 1px gravel on transparent is ~1.6–2:1, under WCAG SC 1.4.11 3:1, and the border is the button's only affordance. 1px ink stays tiered/thin but visible.
- `.pb-mlabel`/`.pb-eyebrow` weight 500→**600** (thinner Satoshi at 11px needs the weight for legibility).
- `--pb-red` comment reworded off the misleading "cap 1-2/screen" (DESIGN.md's own sanctioned reds run to 3–4 on the distress scan) to a "heroes only" framing. Stale comments in `Card.tsx`/`LensSwitcher.tsx` fixed.

**Verified:** typecheck + lint green; `pnpm run verify` green (db/core/tiles/ingestion + portability + security gates); homepage/parcel/leads eyeballed in light + dark with no console errors; tiering confirmed via computed styles (plain card 1px gravel/no-shadow vs `--frame` 4px ink/shadow).

**✅ FIXED 2026-06-20 — light-theme small-label contrast (the deferred a11y item below).**
Added a dedicated `--pb-label` token (option *b*) instead of darkening `--pb-slate` globally, because slate labels land on five different surfaces — including the darkest, `--pb-recessed` #CFC9BE (the measure-line lead) — and a single darkening that cleared recessed would have muddied every recessive aside. `--pb-label` light = **#595348** (same warm hue as slate, just darker); dark = #A39A8B (= slate; dark already passed). Repointed ~26 small **functional** labels (metric/filter labels, source stamps, table headers, eyebrows, breadcrumbs, counts, legend/timestrip heads, measure-line lead, leads total/th/rank/none) `--pb-slate → --pb-label` across `components.css` (22) + `leads.css` (4); **kept `--pb-slate`** for 6 recessive serif-italic asides (kicker, freshness/freshline, trend/time notes, distress rank) + decorative hairlines (dotted underlines, derivation/term borders, leads row-rule). Tokens edited in BOTH `globals.css` + `TOKENS.css`; `DESIGN.md` color table + Functional note synced. **Verified** computed contrast in-browser both themes: light functional labels 4.63 (recessed/stamp, the binding worst case) → 7.62; dark unchanged 5.47–6.66; `pnpm verify` green; no console errors.
  - *Remaining by design (option b):* the 6 serif-italic asides stay on `--pb-slate` (13–15px, deliberately airy, supplementary) and so remain <AA — an accepted scoping choice, not an oversight.

**Deferred (NOT done — future work):**
- **Wire `.pb-pill--urgent`** to a genuine crisis signal (e.g. unsafe/imminently-dangerous) — the class + `PillKind` member exist but no call site consumes it yet.
- `--pb-shadow-tier1` is defined (both files) but unused — kept as a documented forward token.
- `account.css` is a separate token fork (`--pb-acc-*`, rounded corners, hairline borders) — left isolated; a candidate for its own reconciliation pass.
- Rail density / progressive-disclosure-on-zoom + leads redundant columns (the original DEFER list below).

## Implementation plan — analysis complete, ✅ NOW IMPLEMENTED (see EXECUTED note above)

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
