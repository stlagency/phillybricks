# Bandbox component kit — "The Survey Table, Warmed"

Hard-border brutalist kit + civic-warm transparency mechanics, implementing
`design/DESIGN.md` verbatim against the FROZEN contracts in
`@bandbox/core/contracts`. Every component is driven by typed mock data
today (`src/lib/mock/*`) and by live API responses later. This file maps each
prop surface to the route that will feed it (PRD §6).

## API-wiring map (mock today → route tomorrow)

| Component | Prop source today | Production route / field (PRD §6) |
|---|---|---|
| `BlueprintMap`, `LensSwitcher`, `MapLegend`, `TimeStrip` | `src/lib/mock/scan.ts` (`HOODS`, `LENS_*`, `buildScanResponse`) | `GET /api/scan?geo=&lens=&period=` → `ScanResponse.features[].bucket` for the choropleth; `period_min/max` for `TimeStrip`; `legend` + `metric_class` for `MapLegend` / the "tracking since" note. Parcels/boundaries served as **PMTiles on Supabase Storage via MapLibre**; this SVG is the design reference for the choropleth + instrument chrome. |
| `FilterRail` | local UI state | Filter values become `/api/scan` + `/api/leads` query params. |
| `DistressBlock` (scan rail) | `pointBreezeDetail.distress` | tract-aggregated `DistressResult` (the `distress_signal` matview rolled to the tract). |
| `DistressBar` (deep-dive) | `firthStDeepDive.distress` | `GET /api/parcel/:pk` → `ParcelDeepDive.distress` (the exact §5.3 `DistressResult` shape — `{component, raw_value, normalized, weight, contribution, source_url}`). |
| `ValueDerivationDrawer` | `firthStDeepDive.comps` | `GET /api/comps?pk=…` (also embedded in `ParcelDeepDive.comps`) → `CompsResult.estimate` + `distribution`; the `insufficient` flag renders the empty state. |
| `MetricStrip` / `MetricCell` (assessment) | `firthStDeepDive.assessment_vs_sale` | `ParcelDeepDive.assessment_vs_sale` (each value is a `Sourced<T>` carrying `source_url`). |
| `Ledger` (sale history) | `firthStDeepDive.transfers` | `ParcelDeepDive.transfers[]` (`TransferRow`). |
| `Ledger` (permits/violations, taxes) | `firthStDeepDive.li` / `.tax` | `ParcelDeepDive.li[]` (`LiRow`) / `.tax` (`TaxStatus`). |
| `TrendChart` (nearby / rail trend) | `pointBreezeDetail.trend`, `firthStDeepDive.nearby` | `geo_metric` series (PRD §5.4) / `ParcelDeepDive.nearby` counts+trend. |
| `SourceStamp` / `GlossaryTerm` / `ContextRail` | `source_url` on each contract field; `GLOSSARY` | The `source_url` already on every `Sourced<T>` / `*Component` resolves the originating public record (Atlas); glossary from the education layer (PRD §7.6). |
| Leads (M6, not yet a route) | `src/lib/mock/leads.ts` | `GET /api/leads` → `LeadsResponse.rows[]` (`LeadRow`, embeds `DistressResult`). |

## Design invariants honored

- **Red budget:** 1–2 true-red elements per screen. Deep-dive spends it on the
  distress hero (red fill) + the one primary CTA; everything else is ink / sky-
  tint / brick-edge. The scan map spends it on the active-parcel outline (and,
  when the Distress lens is active, the ramp **is** the red — the encoding, not
  extra chrome), so the rail CTA stays ink-budget-aware via the caller.
- **Structure:** 3px ink borders (4px on primary regions), square corners,
  offset HARD shadows (6/8/10, no blur). Pressed = `translate(2px,2px)`.
- **Brick** is text/edge only (wordmark BRICKS, aged/sheriff pills, why-this-comp
  flags, section rule) — never a fill.
- **Reduced motion:** lens/resolution transitions become instant swaps; offset
  shadows STAY (they are structure, not motion).
- **Theme:** `data-theme` on `<html>`, persisted to `localStorage` (`pb-theme`),
  default respects `prefers-color-scheme`; pre-paint script in `layout.tsx`
  prevents FOUC. AA verified both themes (per DESIGN.md).
- **Transparency:** every figure carries a `SourceStamp`; dotted terms + stamps
  push into the `ContextRail` (never a modal); the value derivation is fully
  decomposed in the drawer; the distress composite is fully decomposable.
