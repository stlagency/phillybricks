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

## Open questions (decide at session start)
1. **Intensity** — light declutter (keep character, add restraint) · moderate (cut a
   type family + pull red + lighten devices) · bold reset (meaningfully calmer)?
2. **Scope/order** — start with the busiest surface (Market Scan homepage), or a
   global design-system pass (type + color + devices) that cascades everywhere?
3. **Type** — consolidate the 4 families to 2–3? (rec: Tanker for wordmark/hero + one
   UI sans + mono for data only; drop one of Zodiak/the extras.)
4. **Reference** — any sites/aesthetics that capture the target "calm but data-rich" feel?
