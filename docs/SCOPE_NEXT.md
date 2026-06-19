# Scope for next session — Rebrand → Bandbox, descope monetization, Resend → ZeptoMail

**Status: PLAN ONLY. Nothing here is executed yet** (this session was scope-only). A
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

## Decisions — resolved defaults vs. Aaron's call

**Resolved (recommended; the plan below assumes these):**
- Rename the **npm package scope** `@phillybricks/*` → `@bandbox/*` across all 5 packages (clean brand match; ~161 imports — mechanical, one regex pass).
- **Keep internal infra names** (no churn, no benefit to renaming): Supabase **DB name**, **DB role `phillybricks_worker`** (migration `0011` + matview ownership reference it), **Storage bucket `phillybricks-tiles`** (renaming forces a full tile re-upload + `NEXT_PUBLIC_TILES_BASE_URL` change), and the **`pb-*` CSS prefix** (2,926 uses; it's an internal design-system token, not the brand name).
- **Keep** the Philly voice + tagline ("Know the block before you knock") + the brutalist design — per the user, only the *name* changes. Wordmark splits **BAND / BOX** (same Tanker, black-over-red).
- Monetization: **keep** `app.subscription`, `hasActiveSubscription`, the `stripe` dep, and the Stripe RLS/grants as a **dormant seam** (don't delete — re-activating later is a webhook + keys, not a schema rewrite). Just stop enforcing it.
- CSV export + skip-trace stay **login-gated but free** (preserve the future paywall seam + discourage abuse); skip-trace keeps its lawful-use **attestation**.
- ZeptoMail via **raw HTTPS** (`POST https://api.zeptomail.com/v1.1/email`, header `Authorization: Zoho-enczapikey <token>`) — no SDK dep.

**Aaron's call (flagged ⚠ in steps — confirm before/at execution):**
- **Domain/DNS** — register `bandbox.pro`, point DNS at Vercel, add `www.bandbox.pro` as the custom domain (keep `phillybricks.vercel.app` as a redirect). *Human action.*
- **GitHub repo rename** `stlagency/phillybricks` → `stlagency/bandbox`? Recommended for brand clarity (GitHub auto-redirects old links); if kept, just note the historic name. *Human action if done.*
- **Vercel project rename** `phillybricks` → `bandbox` (cosmetic; doesn't touch env/connection strings). *Human action.*

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

**(d) Domain (⚠ human):** register `bandbox.pro`; in Vercel add `www.bandbox.pro` (+ apex redirect) to the project; redirect `phillybricks.vercel.app` → `www.bandbox.pro`. Update the 5 `phillybricks.vercel.app` doc refs → `https://www.bandbox.pro`. `NEXT_PUBLIC_*` env values are unaffected (Supabase URLs are project-ref based, not brand-based).

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

## Net human pause-points (all of the above)
1. **`bandbox.pro`** — register + DNS → Vercel; add `www.bandbox.pro` custom domain (+ redirect from `phillybricks.vercel.app`).
2. **Vercel project rename** phillybricks → bandbox (optional, cosmetic).
3. **GitHub repo rename** (optional) phillybricks → bandbox.
4. **ZeptoMail (M7):** Zoho account + verify `bandbox.pro` sending domain + mint `ZEPTOMAIL_TOKEN` (GH Actions secret + Vercel env).
5. **Stripe keys** — only when M8 monetization is taken off the shelf.
