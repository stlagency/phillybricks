# Scope for next session — Rebrand → Bandbox, descope monetization, Resend → ZeptoMail

> **✅ EXECUTED 2026-06-19** on branch `rebrand-bandbox-descope`. All three changes landed:
> the PhillyBricks→Bandbox rebrand (`@bandbox/*` scope; internal `phillybricks_worker`/
> `phillybricks-tiles`/`pb-*` kept), the monetization descope (`requireEntitlement`→`requireUser`,
> Stripe dormant → M8), and the Resend→ZeptoMail docs/env swap. The §0 memory/secrets migration
> ran. **Still open:** `www.bandbox.pro` DNS at Cloudflare (no DNS token in-env), the `gh`/Vercel
> renames (do with the PR merge), and the ZeptoMail token (M7-time). This file is retained as the
> historical plan of record; it intentionally still uses both old and new names for clarity.

**Status (original): PLAN ONLY. Nothing here is executed yet** (this session was scope-only). A
fresh session executes it. Derived from an exhaustive read-only inventory of the repo
(grep counts cited below). The current docs (`PRD.md`, `README.md`, `STATUS.md`, code,
`.env.example`) still describe the **PhillyBricks / Resend / monetization-planned** state
because that is what is true on disk today — they get rewritten when this is executed.

There are **three changes**, best landed as **two units of work**:

- **PR A — "Rebrand + descope" (do first, in one branch):** rename PhillyBricks→Bandbox +
  domain, relax the paid gates (monetization postponed), and swap Resend→ZeptoMail in
  **docs/env only** (no email code exists yet). This is a self-contained, fully-testable PR.
- **M7 build (later):** the ZeptoMail digest is *code* that belongs to the M7 alerts build;
  only its spec/env move now. M7 is also redefined below (no payments).

Recommended order within PR A: **(1) monetization descope → (2) rebrand → (3) ZeptoMail docs/env**,
then `pnpm run verify`, deploy, verify live.

---

## 0 · Pre-flight (do BEFORE any rename) — ⚠ migrate the memory + secrets

**Aaron is renaming this working folder before the next session.** The auto-memory
directory is keyed off the absolute cwd (`/` and `_` → `-`), so renaming the folder
points the new session at an **empty** memory dir and **orphans the project memory AND
the secret files** (`memory/database-url.secret`, `memory/supabase-access-token.secret`)
that the DB/deploy/Supabase-Management steps depend on.

**First thing the new session must do** (it can read its own new cwd; the OLD path is fixed):
```bash
OLD=~/.claude/projects/-Users-aaroncohen-CLAUDEMAXING-cw-Philly
NEW=~/.claude/projects/$(pwd | tr '/_' '--')          # encoding: / and _ → -
cp -Rn "$OLD/memory" "$NEW/"                            # carries MEMORY.md, philly-*.md, AND the .secret files
ls "$NEW/memory"                                        # verify: MEMORY.md + *.secret present
```
Then confirm `MEMORY.md` lists the `philly-*` entries and the two `.secret` files are
present (chmod 600). Without them: no `DATABASE_URL`, no Supabase Management token → the
DNS/deploy/migration steps can't run.

**Infra steps the new session AUTOMATES** (all confirmed by Aaron): `gh repo rename`,
Vercel project rename + `www.bandbox.pro` custom domain, and the Cloudflare DNS records
(see §2d). The only thing Aaron does by hand is the ZeptoMail account/domain/token (M7-time).

---

## Decisions — CONFIRMED + the keep-as-is recommendations

**Resolved (recommended; the plan below assumes these):**
- Rename the **npm package scope** `@phillybricks/*` → `@bandbox/*` across all 5 packages (clean brand match; ~161 imports — mechanical, one regex pass).
- **Keep internal infra names** (no churn, no benefit to renaming): Supabase **DB name**, **DB role `phillybricks_worker`** (migration `0011` + matview ownership reference it), **Storage bucket `phillybricks-tiles`** (renaming forces a full tile re-upload + `NEXT_PUBLIC_TILES_BASE_URL` change), and the **`pb-*` CSS prefix** (2,926 uses; it's an internal design-system token, not the brand name).
- **Keep** the Philly voice + tagline ("Know the block before you knock") + the brutalist design — per the user, only the *name* changes. Wordmark splits **BAND / BOX** (same Tanker, black-over-red).
- Monetization: **keep** `app.subscription`, `hasActiveSubscription`, the `stripe` dep, and the Stripe RLS/grants as a **dormant seam** (don't delete — re-activating later is a webhook + keys, not a schema rewrite). Just stop enforcing it.
- CSV export + skip-trace stay **login-gated but free** (preserve the future paywall seam + discourage abuse); skip-trace keeps its lawful-use **attestation**.
- ZeptoMail via **raw HTTPS** (`POST https://api.zeptomail.com/v1.1/email`, header `Authorization: Zoho-enczapikey <token>`) — no SDK dep.

**CONFIRMED by Aaron (2026-06-19):**
- ✅ Keep internal names · ✅ keep the login gate (export/skip-trace free-but-authenticated) · ✅ monetization deferred to M8.
- ✅ **Package scope `@phillybricks/*` → `@bandbox/*` proceeds** (not vetoed — do it in one regex pass).
- ✅ **GitHub repo rename → `stlagency/bandbox`** — the new session runs `gh repo rename bandbox` and updates the doc links (GitHub redirects the old URL). Also update the local `git remote set-url origin`.
- ✅ **Vercel project rename → `bandbox`** — via the Vercel API/CLI; add `www.bandbox.pro` as the custom domain.
- **Domain:** `bandbox.pro` is **registered**, DNS **managed by Cloudflare** → the new session wires DNS automatically (see §2d). No manual DNS from Aaron.
- **Folder rename:** Aaron renames the working folder before the next session → triggers the §0 memory/secrets migration.
- **ZeptoMail:** Aaron is creating the account now → `ZEPTOMAIL_TOKEN` + a verified `bandbox.pro` sender will be available for the M7 build.

---

## Change 1 — Monetization postponed (relax the paid gates; keep the seam dormant)

**Why:** today CSV export + BYO skip-trace require an active subscription
(`requireEntitlement`). With monetization deferred, they become **free for any
authenticated user**; the subscription machinery stays in place but unenforced.

Grep: `Stripe` 46 hits/13 files · `subscription` 71/20+ · `requireEntitlement` 9 · `hasActiveSubscription` 3.

**Code (`apps/web/src/…`):**
- `lib/auth.ts` — at the two call sites use `requireUser` instead of `requireEntitlement`. Keep `requireEntitlement`/`hasActiveSubscription` defined but **mark `@deprecated — dormant until monetization (M8)`**. Remove the `PHILLYBRICKS_DEV_ENTITLED` seam (moot once nothing checks entitlement); keep the dev-user seam (renamed to `BANDBOX_DEV_USER_ID`, see Change 2).
- `app/api/leads/export/route.ts` — `requireEntitlement` → `requireUser`.
- `app/api/skiptrace/[pk]/route.ts` — `requireEntitlement` → `requireUser` (leave the `hasSkiptraceAttestation` gate intact).
- `components/SkipTraceButton.tsx` — drop the `subscription_required` refusal case.
- `app/leads/LeadsView.tsx` — `'Subscription required'` → `'Sign in to export'`; fix the file-header comment.
- `app/api/leads/route.ts` — comment "auth + active sub" → "auth only".

**Schema / dep (KEEP, document as deferred):**
- `packages/db/migrations/0007_app_user.sql` — leave `app.subscription` + its RLS/grants; add a top comment `-- DEFERRED: Stripe postponed; app.subscription is ready but unused until monetization (M8).` (`migrations.test.ts` subscription assertions stay green — they document the dormant posture.)
- `apps/web/package.json` — keep `stripe` (comment `deferred monetization`).
- `.env.example` — comment out `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` under a `# --- Stripe (DEFERRED — monetization postponed) ---` header; drop `PHILLYBRICKS_DEV_ENTITLED`.

**Docs reframe ("subscriber tier" → "free for authenticated users"):** `PRD.md` §1/§7.5/§11 + the M7 DoD, `CONCEPT_v2_shared_understanding.md`, `README.md`, `PRODUCT_OVERVIEW.md`, `SELF_HOST.md`, `STATUS.md`, `docs/NEXT_SESSION.md`. Move the Stripe sub + price-point to a new **deferred milestone "M8 — monetization (when validated)"**.

**Verify:** with `BANDBOX_DEV_USER_ID` set (no entitlement env), CSV export + skip-trace work; unset → 401.

---

## Change 2 — Rebrand PhillyBricks → Bandbox + domain www.bandbox.pro

Grep: `PhillyBricks` (any case) **279** in ~18 files · `@phillybricks/` **161** imports · `phillybricks.vercel.app` 5 · `stlagency/phillybricks` 3 · docs ~145 across 12 `.md`.
**Keep unchanged:** `phillybricks_worker`, `phillybricks-tiles`, `pb-*`, Supabase DB name, the Philly voice + tagline.

**(a) User-facing strings:**
- `components/Wordmark.tsx` — `PHILLY/BRICKS` → `BAND/BOX`; `aria-label` → `Bandbox`; update the equalizer docstring. *(verify BAND/BOX widths render in light+dark.)*
- `app/layout.tsx` — `title` + `applicationName` → Bandbox (KEEP the tagline).
- `app/parcel/[pk]/page.tsx`, `app/leads/page.tsx` — page `<title>` `— PhillyBricks` → `— Bandbox`.
- `components/ContextRail.tsx` ("PhillyBricks model · …"), `components/ValueDerivationDrawer.tsx` ("PhillyBricks value estimate" ×2), `app/parcel/[pk]/DeepDive.tsx` footer ("PHILLYBRICKS · …" KEEP tagline) → Bandbox.
- `app/leads/LeadsView.tsx` export filename stays `leads-export.csv` (fine; optionally `bandbox-leads.csv`).

**(b) Package scope `@phillybricks/*` → `@bandbox/*`:** the 5 `package.json` `name` fields + `dependencies`; every import (~161) across `packages/*` + `apps/web` + `infra/workflows/*.mjs` + scripts; `apps/web/next.config.mjs` `transpilePackages` + comments; `tsconfig*`; `.claude/launch.json` `--filter`; all `pnpm --filter @phillybricks/...` in CI/docs/Dockerfiles. Then `pnpm install` to regenerate `pnpm-lock.yaml`. Root `package.json` `name` → `bandbox`.

**(c) Infra / config (names that ARE the brand or domain):**
- `.github/workflows/{ci,nightly,weekly}.yml` — comments + `--filter` scope; nightly `git config user.name phillybricks-bot` → `bandbox-bot`. **Do NOT change** `SUPABASE_STORAGE_BUCKET: phillybricks-tiles`.
- `docker-compose.yml`, `infra/docker/{web,worker}.Dockerfile` — comments + `--filter` (POSTGRES_DB default may stay `phillybricks` or become `bandbox` — self-host only, low stakes).
- `.gitleaks.toml` title; `design/mockups/*.html` + `design/_archive/*` `<title>`/`aria-label`.
- `lib/skiptrace.ts` — `galaxy-ap-name: phillybricks` → `bandbox` (Endato request id; cosmetic until a live vendor key).
- `.env.example` — header + `RESEND_FROM`/`ZEPTOMAIL_FROM` domain → `@bandbox.pro`; the dev env var → `BANDBOX_DEV_USER_ID`.

**(d) Domain — `bandbox.pro` registered, Cloudflare DNS (automatable):** in Vercel add `www.bandbox.pro` (+ apex) to the project → Vercel returns the CNAME/A target → create that record in **Cloudflare DNS** (via a Cloudflare DNS/zones MCP if connected, else the Cloudflare API with a zone token; note: the Cloudflare MCP seen this session was storage/compute [D1/KV/R2/Workers] — confirm a **DNS/zones**-capable Cloudflare server/token is available, or have Aaron add one). Set the Cloudflare proxy to "DNS only" for the Vercel record. Then redirect `phillybricks.vercel.app` → `www.bandbox.pro`. Update the 5 `phillybricks.vercel.app` doc refs → `https://www.bandbox.pro`. `NEXT_PUBLIC_*` env values are unaffected (Supabase URLs are project-ref based, not brand-based).

**(e) Docs:** batch `PhillyBricks`→`Bandbox` across `README.md`, `PRD.md`, `BRAND.md` (`PhillyBricks.net` → `Bandbox.pro`), `STATUS.md`, `SELF_HOST.md`, `CONCEPT_v2_shared_understanding.md`, `PRODUCT_OVERVIEW.md`, `HANDOFF.md`, `design/DESIGN.md`, `docs/NEXT_SESSION.md`, `.impeccable.md`, `NEW_SESSION_BUILD_PROMPT.md` — **but keep** the tagline + South-Philly-voice descriptions.

**Risk to retest:** Wordmark equalizer with BAND/BOX (widths differ from PHILLY/BRICKS); full `pnpm run verify` after the scope rename (catches any missed import).

---

## Change 3 — Resend → ZeptoMail (docs/env now; code at M7)

Grep: `Resend` **25 mentions / 9 files**, **zero code** (M7 email is unbuilt — only `app.alert_event` / `app.alert_subscription` tables exist). So this is a **docs + env** change now; the send code is built in M7.

**Now (docs/env):**
- `.env.example` — `RESEND_API_KEY` → `ZEPTOMAIL_TOKEN`; `RESEND_FROM` → `ZEPTOMAIL_FROM="Bandbox <alerts@bandbox.pro>"`; section header → `# --- ZeptoMail (Zoho; alert email digest) ---`; comment "verified Resend domain" → "verified ZeptoMail sending domain (DKIM/SPF)".
- Docs: every `Resend` → `ZeptoMail` in `PRD.md` (§6 email-delivery, §7.4, §8 cost "Resend free-tier", §9 M7 DoD), `STATUS.md`, `docs/NEXT_SESSION.md`, `HANDOFF.md`, `CONCEPT_v2`, `NEW_SESSION_BUILD_PROMPT.md`, `SELF_HOST.md`, `README.md`. The §7.4 invariants are unchanged (per-user aggregation bounded by `last_sent_at`; **List-Unsubscribe header + unsubscribe link / CAN-SPAM**).

**At M7 (build):**
- `apps/web/src/lib/zeptomail.ts` (or `packages/ingestion/src/services/zeptomail.ts`): `sendViaZeptoMail(to, subject, htmlBody, from, unsubscribeUrl) → {request_id}` — HTTPS POST, `Authorization: Zoho-enczapikey <ZEPTOMAIL_TOKEN>`, sets the `List-Unsubscribe` header.
- Digest query/render + `/api/unsubscribe?id=<alert_subscription_id>` route (sets `last_sent_at`); wire into the nightly after `finalizeDerived`, **non-fatal**.

**⚠ Human pause-points (M7-time):** create the Zoho/ZeptoMail account; verify the `bandbox.pro` sending domain (DKIM/SPF/CNAME at the registrar); mint a Send-Mail token → store as the `ZEPTOMAIL_TOKEN` GitHub Actions secret + Vercel prod env.

---

## M7 — redefined (no payments)

> **M7 — Accounts + alerts (free).** Supabase Auth → fill in `getUserId(req)` in
> `apps/web/src/lib/auth.ts` (resolve the session cookie / `Bearer` JWT → `auth.uid()`;
> drop the `BANDBOX_DEV_USER_ID` seam). That single change lights up the (now free,
> login-gated) CSV export + mini-CRM save + skip-trace. Then **saved areas** (3 modes) +
> **alerts**: nightly diff → `app.alert_event` → **ZeptoMail** digest (List-Unsubscribe /
> CAN-SPAM) + in-app feed. **No Stripe.** DoD: sign in → save an area → receive a
> real-change digest; unsubscribe works.

> **M8 — Monetization (deferred, when validated).** Stripe low-flat sub + **verified
> webhook** (raw body, `constructEvent`, idempotent, service_role writes `app.subscription`)
> → flip the two free gates back to `requireEntitlement` (the dormant seam is already there).
> Stripe keys needed. Price set against the ~$45/mo floor.

---

## Pause-points — what's automated vs. genuinely human

**The new session does these itself** (all confirmed): `gh repo rename bandbox` + `git remote set-url`; Vercel project rename + add `www.bandbox.pro`; Cloudflare DNS record for the Vercel target (§2d, if a DNS-capable Cloudflare MCP/token is present); the §0 memory/secrets migration; the whole rebrand+descope PR + deploy + live-verify.

**Genuinely human (Aaron):**
1. **Folder rename** — done before the next session (triggers §0 migration). ✅ planned.
2. **`bandbox.pro`** — registered, Cloudflare DNS. ✅ done. (New session only needs a Cloudflare DNS token/MCP to write the record — confirm it's connected.)
3. **ZeptoMail (M7-time):** Zoho/ZeptoMail account (being set up now) → verify the `bandbox.pro` sending domain (DKIM/SPF) → mint `ZEPTOMAIL_TOKEN` → store as a GH Actions secret + Vercel env.
4. **Stripe keys** — only when M8 monetization is taken off the shelf.
