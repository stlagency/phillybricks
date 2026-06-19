# Bandbox — Design System (v1.0)
## "The Survey Table, Warmed"

**This is the canonical visual source of truth for the build.** It reconciles the two earlier systems on the product owner's instruction: **brutalist bones** (the structure, type, color discipline, and South-Philly voice of `../BRAND.md`) + **civic-warm air and transparency mechanics** (the show-the-work interaction layer from the "Rowhouse" exploration). Verified rendering in light + dark.

- **Tokens (canonical):** `../TOKENS.css` (`--pb-*`). **Machine-readable spec:** `./design-system.json`.
- **Brand voice / logo / rationale:** `../BRAND.md` (still valid for voice + identity; this doc supersedes it on the merged visual decisions).
- **Reference mockups:** `./mockups/01-market-scan.html`, `./mockups/02-property-deep-dive.html` — open in a browser; the `DARK` button toggles themes. (Superseded explorations live in `./_archive/`.)
- **Self-host fonts:** `../_fonts/` (woff2 + `@font-face`).

> Concept: from the brutalist-forward variant we keep the **skeleton + discipline** (4px party-wall frames on primary regions, the 6/8/10px offset-shadow tiers, the visible 12-col grid, the accountable red-budget math, the survey "instrument readout" + corner-registration ticks). From the warmth-balanced variant we keep the **air + voice** (warm-air gutter materials, looser inter-block rhythm so blocks breathe, the warm-umber dark ground, and the Zodiak voice getting real square footage). **A is the bones, B is the air.**

---

## Type — Fontshare set + Space Mono (owner's choice, final)
Pairing law: **Tanker** is the building, **Zodiak** is the person telling you about the block, **Satoshi** is the clerk reading the file, **Space Mono** is the survey record itself.

| Role | Face | Where |
|---|---|---|
| Display / wordmark / mass | **Tanker** (−0.01em, leading 0.9, often uppercase) | Headlines ("Know the block before you knock."), big addresses, section markers |
| The voice / long-form | **Zodiak** slab (400/700/700i, ~64ch, lh 1.65) | Explainers, glossary defs, value-derivation prose, community-signal lines, empty states — **warmth lives here** |
| UI / body | **Satoshi** (400/500; 700/900 for table headers) | Body, labels, table-cell prose, secondary buttons; never letterspaced as body |
| Data / evidentiary | **Space Mono** (400/700/400i; mono labels uppercase +0.12em) | All data: parcel/OPA IDs, prices, $/SF, coords, timestamps, **source stamps**, metric numbers, pills, primary-button labels, ledger values, legend ticks, instrument readout |

**Imports** (two lines — already in `TOKENS.css`):
```
@import url("https://api.fontshare.com/v2/css?f[]=tanker@400&f[]=zodiak@700,400,700i&f[]=satoshi@900,700,500,400&display=swap");
@import url("https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap");
```
Self-host fallback for the AGPL repo: `../_fonts/*.css`. **Scale (px):** 11 / 13 / 15 / 18 / 22 / 30 / 44 / 62, **+ 84 (`--pb-text-5xl`, Tanker hero only)**.

**Wordmark — PHILLY/BRICKS lockup (kerning rule):** `PHILLY` stacked over `BRICKS` in Tanker; `PHILLY` in ink/bone, `BRICKS` in brick (light) / brick (dark). **`PHILLY` is letter-spaced so its rendered width exactly equals `BRICKS`** (the two stacked words share one right edge — a solid monolithic block). Implementation: measure after `document.fonts.ready` and set `PHILLY`'s `letter-spacing = (BRICKS_width − PHILLY_width) / 6` (see the equalizer script in the mockups); the build's `<Wordmark>` component does the same measurement, or bakes a precomputed tracking value for the fixed nav size. To the left sits the holding mark — a plain Phillies-red square, 3px ink border, offset shadow.

---

## Color (hex is authoritative; OKLCH for tooling). Red is signal-only; **blue does the structural + data lifting.**

| Role | Token | Light | Dark (warm-umber, lamplit) |
|---|---|---|---|
| Border + (light) text | `--pb-ink` | `#1A1714` | `#0C1016` |
| Primary text | `--pb-text` | `#1A1714` | `#ECE6DA` (warm bone, not cold white) |
| Muted text | `--pb-slate` | `#8A8479` | `#A39A8B` |
| Bg (mortar) | `--pb-paper` | `#E7E3DA` | `#1B1814` |
| Card (bone) | `--pb-surface` | `#FFFFFF` | `#25211B` |
| Recessed / zebra | `--pb-stone` | `#D9D4CA` | `#2F2A22` |
| Derivation well | `--pb-recessed` | `#CFC9BE` | `#161310` |
| Group-gutter air | `--pb-paper-warm` | `#EDE9E0` | `#211D17` |
| Teach rail surface | `--pb-rail` | `#F2EEE6` | `#2A251D` |
| Inactive / hairline | `--pb-gravel` | `#BDB7AC` | `#3A4555` |
| Structure mass | `--pb-navy` | `#0A2A5E` | `#16407F` |
| Data / links / bars | `--pb-blue` | `#2C6FBF` | `#5C97D8` |
| Accent | `--pb-sky` | `#6FA8DC` | `#8FBCE6` |
| Secondary highlight fill | `--pb-sky-tint` | `#DCE8F6` | `#25344A` |
| **Signal red** (signal-only) | `--pb-red` | `#E81828` | `#FF3A47` |
| **Brick** (text/edge accent only) | `--pb-brick` | `#A8341F` | `#D9663F` |
| Blueprint ground / line | `--pb-draft-bg` / `--pb-draft-line` | `#1C2530` / `#7FB0E0` | same |

**Lens hues** (matched lightness, lower chroma = solid blocks not glow; one lens active at a time):
Price `#2C6FBF` (federal-blue) · Momentum `#3E7D5A` (park-green) · **Distress `#E81828`** (the one lens allowed signal-red as fill — the lens *is* the alert) · Livability `#B5703A` (desaturated terracotta — the one warm lens, deliberately distinct from both reds). Dark: `#5C97D8` / `#5FA77E` / `#FF3A47` / `#D69A4E`.

**Functional:** focus ring `--pb-blue` 3px solid offset 2px; links `--pb-blue` underline. **AA verified** both themes (ink-on-mortar 12.8:1; ink-on-bone 16.1:1; bone-on-dark-bg 13.8:1; white-on-red ≈4.6–4.9:1 → red text only ≥15px bold or white-on-red fill, never red body; brick-on-bone 6.4:1).

---

## Red discipline (the budget enforcer)
**Two reds, strict separation, hard cap of 1–2 true-red elements per screen.**
- **True Phillies Red `--pb-red`** = SIGNAL ONLY, four sanctioned jobs: (1) the distress score + the dominant segment of the decomposable distress bar + the Distress-lens choropleth; (2) the single primary CTA per screen; (3) the active-parcel highlight + corner ticks on the map. Danger pills (TAX-DELINQUENT/VACANT) may use it but **count against the budget**.
- **Muddy Brick `--pb-brick`** = TEXT/EDGE ACCENT ONLY, never a fill: wordmark `BRICKS`, aged/sheriff-history lines (`SHERIFF '98`), "why this comp" flags, drop-cap, section rule, history-tag pill borders.
- **Concrete accounting** (deep-dive): distress hero (red fill) = 1; primary "Save this lead →" CTA (red) = 2 → **budget spent**; every other action drops to ink/ghost, other metrics use sky-tint or neutral, danger pills downshift to brick-border/bone-fill. On the map: active-parcel red = 1; if the Distress lens is active, the ramp IS the red (the encoding, not extra chrome) so CTAs go ink.
- Livability terracotta is its own warm hue so the eye never reads "pleasant to live here" as "this is on fire." **Never:** red card backgrounds, red bands, red body text, two red CTAs, red+brick on the same word. Want louder? Bigger Tanker headline + heavier Navy block — not more red.

---

## Structure (brutalist constants — non-negotiable)
- **Borders:** default party-wall `3px solid --pb-ink` (`--pb-border-w`); **promote to 4px** (`--pb-border-w-lg`) on primary regions (header band, table frame, hero block, lens rail, context rail). Within-card hairline = `1px --pb-gravel` only. Borders are **full on all four sides** — a >1px border-left-only colored accent stripe is **banned** (the full 3px border is the language).
- **Radius: `0` everywhere**, no exceptions ("cut-brick" corners).
- **Offset HARD shadows** (the sanctioned brutalist exception — *no blur ever*; soft/blurred shadows banned): `--pb-shadow` 6/6, `--pb-shadow-lg` 8/8 (hero + primary CTA), `--pb-shadow-mass` 10/10 (the single page-defining block). Always down-right; never stacked. Pressed = `translate(2px,2px)` + shadow shrinks to 4/4 (no scale-bounce).
- **Visible grid:** 12-col with 3px `--pb-ink` dividers at section breaks; metric strips are equal-width cells split by 3px rules (not gaps).
- **Spacing:** 4/8/12/14/18/22/34/48 (`--pb-space-1..9`). **34px group gutters** between cards (so 6px shadows read, never collide); 22px card padding; **48px** between major sections; card groups sit on `--pb-paper-warm` so whitespace is a deliberate material.
- **Layout:** fixed Navy top band (4px bottom border) + left structural rail (desktop); content on Mortar; right **context rail** (4px border, `--pb-rail`) holds teach-in-place/glossary/source links — **never a floating modal**. **Mobile:** left rail → bottom-pinned lens-switcher bar; shadows reduce to 4px; grid stacks to one column of full-bleed bordered blocks; context rail becomes an in-flow expandable block.

---

## Components (one hard-border kit — structure ≠ opacity)
- **Card:** Bone, 3px ink border, 6px offset shadow, square, on `--pb-paper-warm` gutters; header in Tanker or Satoshi-900 small-caps over a 3px divider.
- **Metric block:** Space Mono tracked-uppercase label over Space Mono-700 number, in equal-width strips split by 3px rules. **The one most-important metric per card flips to solid `--pb-red` + white** (the red-budget enforcer — exactly one). A secondary featured metric may use `--pb-sky-tint` (never red).
- **Ledger rows** (the table = receipts surface, set as a survey printout): zebra via `--pb-stone`, Satoshi-700 small-caps header on Navy/ink, 1px gravel dividers, Satoshi label-left / Space Mono tabular value right-aligned. **Every value-bearing cell carries a 1px-dotted underline (offset 3px) = click-to-source + a trailing source stamp.**
- **Source stamp:** inline Space Mono xs slate, `[OPA · 2026-06-12]` / `[L&I '23]` / `[RTT]` / `[SHERIFF '98]`; click expands the record link **in the context rail** (no modal); a quiet "Where this comes from · refreshed Xd ago" sits under each section in Zodiak-italic.
- **Value-derivation drawer:** recessed well below the estimate, 3px top border; collapsed = dotted-underlined "$268k"; expanded = plain-English Zodiak "3 arms-length comps within 0.3mi · median $/SF 235 × 1,140 SF · −4% condition = $268k", each operand dotted to its source.
- **Decomposable distress bar:** horizontal stacked bar, 3px ink border, radius 0, 1px ink seams; segments = components sized by contribution; dominant segment true red, lesser segments brick→gravel ramp; hover any segment → `{component, raw_value, normalized 0–1, weight, contribution, source_url}` in the rail. The score above it is the screen's one red metric block.
- **Buttons:** square, 3px border. Primary = red fill + white Space Mono + "→" + 8px shadow (the CTA = the budget); secondary = ink fill + bone Satoshi + "+"; tertiary/ghost = transparent + 3px ink border.
- **Pills:** Space Mono 10px bold, 2px ink border, square. Danger = red fill/white (counts against budget); neutral = ink fill/bone; aged = bone fill + brick text + brick border.
- **Charts:** blocky bars, 2px ink borders, no gridlines (except blueprint); bars Federal/Sky, the one highlighted/median bar red or brick.
- **Lens switcher:** inline segmented control of 4 hard-bordered cells; active = ink fill + bone label + a 3px red bottom-marker block (a chunk, not a thin stripe); one active so color means one thing.
- **Context rail / glossary:** right 4px-bordered `--pb-rail` column; glossary terms are dotted-underlined inline, expand a one-sentence Zodiak definition into the rail.
- **Empty states:** the voice, in Zodiak ("No comps within a quarter mile. Widen the radius or check the next block over.").

---

## Map — blueprint mode (permanent technical skin, light AND dark)
Ground `--pb-draft-bg` with `--pb-draft-line` 1px survey hairlines + sparse Space Mono labels until zoom. **Multi-resolution** city/ZIP → neighborhood → tract → parcel (opacity/scale ease-out; reduced-motion = instant). City default foregrounds neighborhood **names** (Passyunk ≠ Point Breeze). **4-lens choropleth**, one active, sequential ramp per the lens hue at matched lightness, flat blocks ~70% opacity so survey lines read through, 1px draft-line seams, no glow. **Active parcel = single red** 3px outline + red corner-registration ticks (regardless of lens); hover = 1px federal-blue stroke (so red stays active-only). **Legend:** bottom-right card on `--pb-rail`, plain-language Zodiak caption + Space Mono numeric break ticks (min · median · max + units) + lens-hue square chips. **Instrument readout:** top-right Space Mono cursor coords + scale bar. **Time control:** bordered slider + "tracking since {date}". Tech: MapLibre + PMTiles base; deck.gl only for advanced overlays.

---

## Transparency, mechanics & voice (all Rowhouse mechanics survive, rebuilt in brutalist hardware)
Source stamps on every figure (screen + API share the distress-component shape); plain-English value-derivation drawer (no black box); teach-in-place glossary in the warm context rail (no modal) + freshness lines; the multi-res 4-lens scan is the front door; **community-value framing** woven in (vacant/distressed → a quiet Zodiak "Community signal: Vacant 3+ yrs — rehab adds a home back to Fishtown"; aggregate strips frame the user as a participant in recovery, in park-green, never red); comps arms-length-only with N≥5 widening ladder, p5/p95 trim, "why this comp". **Voice = third-gen South Philadelphian** throughout (rooted/specific, plain & unimpressed, protective — zero vulture energy, receipts-forward), carried mostly in Zodiak with room to breathe. **Warmth budget:** warmth lives ONLY in the Mortar/paper-warm ground + the warm rail, the Zodiak voice getting room, and small brick text accents — **never** in soft corners, blur, tint-elevation, or gradients.

## Theme & accessibility
Full **light + dark** parity (dark = warm-umber lamplit, the blueprint family — never blue-black/neon/glass). **WCAG AA** in both. `prefers-reduced-motion`: resolution/lens transitions become instant swaps; **offset shadows stay** (they are structure, not motion).
