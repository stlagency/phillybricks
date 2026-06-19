# Bandbox.pro — Brand & Design System
### Architectural brutalism · flat & graphic · third-generation South Philadelphian voice
**Status:** Folded into the unified system. **`design/DESIGN.md` ("The Survey Table, Warmed") is the canonical visual source of truth** — it merges this brutalist language with the "Rowhouse" transparency mechanics per the owner's decision; `TOKENS.css` holds the canonical tokens. This doc stays authoritative for **brand voice, the PHILLY/BRICKS logo, and rationale**; on merged visual decisions (dark mode, lens colors, the transparency components) DESIGN.md wins.

---

## 1. Positioning in one line
The parcel-level intelligence tool for people who knew what a rowhouse was worth before Zillow had a Philadelphia office.

Bandbox is an *off-market, public-record* intelligence instrument — not an MLS clone. The brand has to feel like a serious civic-data instrument (assessor's office meets Bloomberg terminal) wearing the face of a South Philadelphia block: hard edges, brick red, concrete gray, no decoration it didn't earn.

---

## 2. The aesthetic: architectural brutalism, flat
Truer to *béton brut* than to the playful neo-brutalist web trend. The system is built from solid color blocks, hard black borders, and offset shadows — **no grain, no photographic texture, no mortar-line patterns.** Structure is the ornament. Borders divide the screen the way party walls divide a block.

Design principles:

1. **Mass over decoration.** Heavy type, solid blocks, real weight. If an element isn't load-bearing (structural or informational), cut it.
2. **Hard edges, hard borders.** 3px black borders. Zero border-radius — corners are square like a cut brick. Offset box-shadows (no blur) for depth.
3. **The grid is visible.** Don't hide structure behind whitespace. Dividing lines, block layouts, and column rules are part of the look.
4. **Red is a signal, not a decoration.** Phillies red marks the thing that matters on a screen — the distress score, the CTA, the alert. Never wallpaper.
5. **Data is typeset, not styled.** Numbers, parcel IDs, prices, and coordinates are set in monospace so they read like a survey record / terminal output.
6. **Flat, always.** No gradients, no glows, no soft shadows. A surface is one solid color with a hard border.

---

## 3. Color — concrete + blue, with red as the signal

The palette is concrete neutrals + a patriotic blue working set, with Phillies red held in reserve. **Red is signal-only.** Brick red is demoted to small text accents — it does not work as a large fill. Blue does the structural and data work and gives the UI a mild patriotic (Philly!) lift.

| Role | Name | Hex | Use |
|---|---|---|---|
| **Signal red** | Phillies Red | `#E81828` | The one loud color. Reserved for the distress score, the primary action, a true alert. Nothing else. Use surgically. |
| **Structure blue** | Navy | `#0A2A5E` | Section headers, structural fills, primary blue mass. The "do the work" blue. |
| **Data blue** | Federal Blue | `#2C6FBF` | Data emphasis, links, chart bars, interactive elements. |
| **Accent blue** | Sky | `#6FA8DC` | Lighter accents, secondary bars, metadata on dark grounds. |
| **Highlight tint** | Sky Tint | `#DCE8F6` | Soft highlight fills behind a featured metric/cell. |
| **Ink** | Concrete Black | `#1A1714` | All borders, primary text, the heaviest blocks. Near-black, warm. |
| **Paper** | Mortar | `#E7E3DA` | Primary warm-neutral background. The concrete/page ground. |
| **Surface** | Bone | `#FFFFFF` | Card / data surfaces that sit on Mortar. |
| **Stone** | Concrete | `#D9D4CA` | Recessed panels, secondary ground, table zebra. |
| **Aggregate** | Gravel | `#BDB7AC` | Muted blocks, inactive bars, neutral fills. |
| **Dim** | Slate Gray | `#8A8479` | Muted/secondary text, labels, metadata. |
| **Accent (small only)** | Brick Red | `#A8341F` | Small text accents only — sheriff/distress history line, aged signals. **Never a large fill.** |
| **Blueprint ground** | Draft Navy | `#1C2530` | The dark technical ground for **map / parcel views only**. |
| **Blueprint line** | Draft Blue | `#7FB0E0` | Survey lines, parcel outlines, grid on the blueprint ground. |

Semantic mapping for the data tool:

- **Distress / danger / true alert** → Phillies Red `#E81828` (sparingly — one or two per screen max)
- **Structure / headers** → Navy `#0A2A5E`
- **Data emphasis / charts / links** → Federal Blue / Sky, Sky Tint for highlight fills
- **Aged / sheriff-sale history** → Brick `#A8341F` as *text only*
- **Neutral / inactive / structural** → Gravel / Stone / Slate
- **Map & parcel geometry** → Draft Navy ground + Draft Blue lines + a single red active-parcel highlight

The red budget: aim for **no more than one or two red elements visible per screen.** If a screen has a red distress score and a red CTA, that's the budget spent — everything else is blue/neutral.

Accessibility note: Phillies Red and Navy on white both pass AA for large/bold text and UI. Body copy is always Concrete Black on Mortar/Bone. Red is for the distress number, pills, and the primary button (white text on red).

Patriotic note: a restrained red/white/blue is welcome (e.g. a small flag bar beside **MADE IN PHILADELPHIA**), but keep it understated — civic, not a fireworks stand.

---

## 4. Typography — all Fontshare (free) + one mono

Pointers, not reproductions — load lines live in `TOKENS.css`.

| Role | Typeface | Source | Where |
|---|---|---|---|
| **Display / headline** | **Tanker** | Fontshare | Page titles, the wordmark, big address lines, anything that's "mass." Condensed, heavy, chiseled. |
| **Editorial / voice** | **Zodiak** (slab) | Fontshare | Long-form, the South Philly voice, marketing/landing copy, pull quotes. Thick bracketed slab serifs = gravitas. |
| **Interface / body** | **Satoshi** | Fontshare | UI body, labels, table text, forms. Clean neutral grotesk — keeps the tool legible. |
| **Data / mono** | **Space Mono** | Google Fonts | Parcel IDs, prices, $/SF, coordinates, timestamps, code-like metadata. The "survey record" texture. |

Pairing logic: Tanker is the building; Zodiak is the person telling you about it; Satoshi is the clerk reading the file; Space Mono is the record itself.

Rules: sentence case in product UI; Tanker may run uppercase for the wordmark and section markers. Two functional weights of Satoshi (400/500). Never letterspace body; do letterspace mono labels (~.12em) and the wordmark mark lines.

---

## 5. Logo & identity (locked)

**Wordmark — primary:** `PHILLY` stacked over `BRICKS`, set in Tanker with tightened tracking. PHILLY in Concrete Black, BRICKS in Phillies Red. The name self-describes: mortar (black) + brick (red). The stack reads as a solid monolithic block.
- One-color version: all Concrete Black (for stamps, single-color, faxable contexts).
- Reversed: Mortar/Bone on Concrete Black.

**Holding mark:** a **plain Phillies-Red square** with a 3px black border and offset shadow — no letterform, no notch. In the primary lockup the square sits to the left of the stacked wordmark and its height matches the wordmark's height. *(The earlier "PB brick / map-pin" mark is dropped. A final icon and tagline are still TBD — to be designed later.)*

Construction constants: 3px borders everywhere; offset shadow = `6px 6px 0 #1A1714` (cards/marks), `8px 8px 0` for the hero; zero radius. No `.net`/tagline lockup for now.

**Credit line:** `MADE IN PHILADELPHIA` set in Space Mono, tracked, on a Navy band, optionally flanked by a small red/white/blue flag bar.

---

## 6. Voice — third-generation South Philadelphian

Not a gimmick accent. This is *perspective*: someone whose family has owned the same rowhouse since their grandparents, who understands a block as lived-in territory, not inventory. The voice is:

- **Rooted & specific.** Talks in blocks and corners, not "submarkets." Knows that Passyunk ≠ Point Breeze ≠ Fishtown and would never blur them.
- **Plain and unimpressed.** No hype, no "unlock synergies." Direct, a little dry, confident because it actually knows the ground.
- **Protective of the neighborhood.** Treats homes as homes. Tools for investors, but never contemptuous of the people who live there. No vulture energy.
- **Numbers don't lie, people do.** Trusts the public record. The product's job is to put the receipts in front of you.

Voice in practice:
- Headline: *"Know the block before you knock."*
- Empty state: *"No comps within a quarter mile. Widen the radius or check the next block over."*
- Distress label: plain — `TAX-DELINQUENT`, `VACANT`, `SHERIFF '98` — let the record speak.
- Avoid: "luxury," "opportunity zone" as a slogan, exclamation points, anything that sounds like a national flipper brand.

Tagline candidates: "Parcel-level intelligence." · "Every brick has a record." · "Know the block."

---

## 7. UI application rules (Concept B)

- **Surfaces:** Bone cards on a Mortar or Stone ground, each with a 3px Concrete Black border. Recessed/secondary panels use Stone.
- **Borders as mortar:** dividing rules between metrics, table rows, and sections are 3px black (primary divisions) or 1px Gravel (within a card).
- **Metric blocks:** label in Space Mono (10px, tracked, Slate) above a Space Mono bold number. The single most important metric block flips to a solid Phillies Red fill with white text.
- **Buttons:** square, 3px border. Primary = Phillies Red fill, white Space Mono label, `→`. Secondary = Concrete Black fill, Mortar label, `＋`.
- **Pills/tags:** Space Mono, 10px, bold, 2px black border. Danger states = red fill/white; neutral = black fill/bone.
- **Charts:** blocky bars with 2px black borders; neutral bars Gravel, the highlighted/median bar Brick or Phillies Red. No gridlines unless on the blueprint ground.
- **Map & parcel views:** Draft Navy ground, Draft Blue survey grid + parcel outlines, red highlight on the active parcel, red corner nodes.

---

## 8. What to avoid
- No grain, paper texture, brick-photo fills, or mortar-line background patterns (explicitly cut).
- No rounded corners, no soft/blurred shadows, no gradients.
- No stock "real-estate" blue, no glossy SaaS gradients, no emoji in product UI.
- No national-flipper hype voice.
- Red as wallpaper. Red is the signal; if everything's red, nothing is.
