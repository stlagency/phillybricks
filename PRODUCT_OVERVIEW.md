# Bandbox — Product Overview

*Philadelphia residential real-estate intelligence, built on public records.*

**Audience:** investors and partners. This is a plain-language overview — no engineering detail. For the technical plan see `PRD.md`; for product scope and the research behind it see `CONCEPT_v2_shared_understanding.md`; for current build status see `STATUS.md`.

**Date:** June 18, 2026.

---

## In one line

Bandbox is a parcel-level intelligence tool for people who want to understand the value, risk, and history of any property in Philadelphia — built entirely on public records, transparent about how every number is calculated, and cheap enough to run that it can stay open and community-minded rather than locked behind a high price.

The positioning: *the intelligence tool for people who knew what a Philadelphia rowhouse was worth before Zillow had an office here.*

---

## Executive summary

**Data sources.** Bandbox assembles more than a dozen public Philadelphia datasets and connects them around each individual property, refreshed every night:

- **Property assessments** — ~584,000 parcels, with owner and full mailing details (the basis for flagging the ~37,800 out-of-state owners).
- **Deeds & sales** — ~5.1 million transactions going back to 1974, the backbone of comparable-sales analysis.
- **Licenses & Inspections** — permits (~923K), violations (~2.0M), complaints (~1.0M), and case investigations (~2.1M).
- **Distress & foreclosure** — tax delinquencies (~54K, which flag actionable and sheriff-sale status), tax balances (~684K), the city's unsafe/imminently-dangerous/demolition inventory, and a live scrape of active sheriff's-sale (foreclosure auction) listings.
- **Livability** — crime incidents (~3.6M) and 311 service requests (~5.8M), mapped to each neighborhood.
- **Rental licenses** (~431K) and **neighborhood/ZIP/tract boundaries** for the map.

*Phase 2 (not yet built): lead-paint and rental-suitability certifications, plus census demographic overlays.*

**Features.** Three core experiences, all free to browse:

1. **Market scan** — a multi-zoom interactive city map with four switchable lenses: price & value, development momentum, distress & risk, and livability.
2. **Property deep-dive** — the full file on any address: assessment vs. last sale, complete sale history (real sales flagged apart from estate transfers and foreclosures), open permits/violations, taxes owed, nearby crime and 311 activity, comparable sales, and a transparent value estimate — every figure linked to its raw public record.
3. **Leads + mini-CRM** — filter the city by distress signals and property traits to build a target list, then save, tag, and track properties; signed-in users can export lists and connect their own owner-contact lookup.

A transparency-and-education layer runs across all three: plain-English explanations and source links on every number, with no black-box scoring and deliberately no machine-learning valuation.

**Monetization (planned — deferred until validated).** The intended model is *free to browse, pay to act*: a low flat monthly subscription (via Stripe) would unlock personalization and automation — saved areas, change alerts, the leads CRM, data export, and bring-your-own-key owner lookup — with optional usage-based add-ons on top. **In v1 these workflow tools are login-gated but free** while the product builds an audience; the subscription seam (Stripe + the entitlement check) is built and kept dormant, switched on in a later milestone (M8) once demand is validated. Crucially, **no property data is ever paywalled**: every fact is free to view. Owner-contact lookup is bring-your-own-account only, so Bandbox orchestrates but never resells contact data. The whole system is engineered to run for roughly **$45/month**, keeping the eventual price low by design.

---

## The problem

People who buy, sell, fix up, or invest in Philadelphia homes are flying half-blind. The information that actually matters — who owns a property, what they paid, what they owe in taxes, whether it has open violations, whether it's headed for a sheriff's sale, what comparable homes have sold for — is all public. But it's scattered across a dozen separate government databases, each with its own format, its own quirks, and no easy way to connect them.

The tools that do exist don't fill the gap:

- **Zillow and the consumer portals** focus on listed, on-market homes and consumer-friendly estimates. The off-market and distressed properties — exactly where investors and neighbors find opportunity — never show up there.
- **The MLS (Bright MLS covers Philadelphia)** is real, but its comparable-sales data is gated to licensed agents. A regular buyer or small investor can't get at it.
- **Existing investor data tools** tend to be expensive, closed "black boxes" that hand you a score without showing how they got there — and ask you to trust it.

So the raw truth is public, but practically out of reach. Bandbox closes that gap.

---

## What it does

Bandbox pulls together Philadelphia's public property records every night, connects them around each individual parcel, and presents them through three main experiences. Anyone can browse all three for free.

**1. The market scan — the front door.** An interactive map of the whole city that you can read at any zoom level: citywide, by ZIP, by neighborhood, down to the individual property. You switch between four "lenses" that recolor the map to answer different questions:

- *Price & value* — what's selling, and for how much.
- *Development momentum* — where permits and construction activity are picking up.
- *Distress & risk* — where tax delinquency, violations, and foreclosure pressure are concentrated.
- *Livability* — crime and 311 service-request patterns.

**2. The property deep-dive — underwrite any address.** Click any property and get the full file: its assessment versus its last sale price, complete sale history (flagging which sales were genuine open-market deals versus estate transfers or foreclosures), open permits and violations, taxes owed, nearby crime and service-request activity, comparable sales, and a transparent value estimate. Every single figure links back to the original public record it came from.

**3. Leads — find and track opportunities.** Filter the whole city (or a saved area) by distress signals and property characteristics to build a target list, then save promising properties into a lightweight CRM with notes, tags, and status. Signed-in users can export this list and connect their own contact-lookup service to find owners (free in v1; see Monetization).

Around all three runs an **education layer**: plain-English explanations of what each number means and where it comes from, so the tool teaches as much as it informs.

---

## What makes it different

**Transparency over black boxes.** Every derived number — the value estimate, the distress score — can be opened up and traced back to the raw public records behind it. There is no secret algorithm and deliberately no machine-learning "automated valuation." If the tool says a home is worth $268k, it shows you the comparable sales and the math. This is the core philosophy and the main trust advantage over closed competitors.

**Off-market focus.** Because it's built on public records rather than listings, Bandbox surfaces exactly the properties the consumer portals miss — the distressed, the vacant, the about-to-be-foreclosed, the long-held family homes.

**Open and low-cost by design.** The product is open-source and engineered to run for roughly **$45 a month** in infrastructure. That low cost is a strategic choice: it lets Bandbox stay genuinely affordable and community-minded instead of needing to extract a high subscription price to survive.

**A point of view.** The brand voice is a third-generation South Philadelphian — someone who treats homes as homes, knows that Passyunk, Point Breeze, and Fishtown are not interchangeable, and has no patience for hype. It's a tool for investors, but it's deliberately not predatory toward the people who actually live on the block.

**Philly first, but portable.** Everything specific to Philadelphia is isolated in one place in the design, so expanding to a second city is meant to be an additive configuration effort rather than a rebuild.

---

## Who uses it, and how it makes money

The intended model is **free to browse, pay to act** — though in v1 the "act" tier is **login-gated but free** while the product builds an audience; paid subscription is deferred to a later milestone (M8).

| | Anonymous | Signed-in (free in v1) |
|---|---|---|
| **Who** | The public, curious neighbors, anyone searching | Active investors and professionals |
| **Gets** | The full map, any property deep-dive, comparable sales, value estimates, the glossary — all of it, read-only | Everything free, plus saved target areas, change alerts, the leads CRM, data export, and the ability to connect a contact-lookup service |

Importantly, **no data is ever locked behind a paywall.** Every fact about every property is free to look at. The "act" tier is *personalization and automation* — saving areas, getting alerted when something changes, building and exporting lead lists, and running a workflow. The plan is to charge a low flat monthly subscription (run through Stripe) for it once demand is validated; the Stripe seam is already built and dormant, so turning it on later is a configuration step, not a rebuild.

On owner contact lookup ("skip tracing"), Bandbox takes a deliberately conservative, low-liability path: users connect **their own** contact-data account, and Bandbox only orchestrates the lookup — it never resells that data. This keeps the legal and licensing responsibility with the user and keeps the platform clean.

---

## The data foundation (why this is hard to copy)

The defensible work is in the plumbing. Bandbox ingests and connects more than a dozen public Philadelphia datasets every night, including:

- The **property assessment roll** — roughly **584,000 parcels**, with owner and mailing details (which lets the tool flag the ~37,800 out-of-state owners).
- The **deed and sales record back to 1974** — about **5.1 million transactions**, the backbone of comparable-sales analysis.
- **Permits, violations, and complaints** — millions of records from the Department of Licenses & Inspections.
- **Tax delinquency and balances**, **crime incidents**, **311 service requests**, **rental licenses**, and the city's **active sheriff's-sale (foreclosure auction) listings**.

Connecting these is genuinely tricky — the same property is identified differently across databases, and naïvely joining them silently drops records. Getting that right, capturing history every night (so the tool can show trends and fire "this just changed" alerts), and doing it reliably and cheaply is the real moat. Much of the truth here is public but, in practice, very few people can assemble it.

---

## Where it stands today

**The product is built and live.** The project is public and open-source, the production database is provisioned and running, the automated quality and security checks are green, and the nightly pipeline ingests all 14+ data sources into the live warehouse every night — history is accruing. The historical sales backfill (to 1974), the foreclosure-listing scraper, and the derived analytics (distress scores, comparables, neighborhood metrics) are all done and verified live. The public-facing surfaces are shipped too: the interactive market-scan map, the property deep-dives (every figure traced to its public record), and the leads + mini-CRM + export + bring-your-own-key skip-trace.

What's next is **accounts and alerts** (M7 — sign-in, saved areas, change-alert email digests), which lights up the already-built workflow tools, followed by optional paid monetization (M8) when validated. In short: **the hard back-end groundwork and the core product surfaces are done and live; sign-in + alerts come next.**

---

## The pitch, summarized

Philadelphia's property truth is public but practically unreachable. Bandbox makes it reachable — transparently, affordably, and with a real point of view — for the buyers, investors, and neighbors the big portals ignore. It's cheap to run, open by design, and built so the same engine can light up the next city when the time comes.

---

### Summary & recommendations *(plain-language)*

**What this is:** Bandbox is a website that gathers all of Philadelphia's public property information — who owns what, what they paid, what they owe, what's broken, what's being foreclosed — and puts it on one easy map. It's free to look at anything, and the extra tools (alerts, saved searches, downloadable lists) are free in v1 too — the plan is to charge a small monthly fee for them later, once the product has proven demand. Its big selling point is honesty: it always shows you exactly how it got every number, unlike competitors that hide their math.

**Recommendations:**

1. **Lead with transparency and price.** Against closed, expensive competitors, "we show our work and cost a fraction to run" is the strongest, clearest story for investors and users alike.
2. **Add real screenshots once the map and property pages are built.** This overview is currently all words; a few visuals will make the pitch land much harder.
3. **Pin down the one open business number — the subscription price.** Monetization is intentionally deferred (v1 is free to build an audience), but for an investor conversation, having a planned price (and the math behind it) for the M8 turn-on closes an obvious gap.
4. **Keep this file updated from `STATUS.md`.** The "where it stands" section will go stale fast as the build progresses; refresh it before any investor meeting.
