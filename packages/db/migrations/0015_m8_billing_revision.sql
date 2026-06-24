-- 0015_m8_billing_revision.sql
-- Billing-revision pass (M8): $2/mo + $20/yr pricing + an owner "comp to free" path.
--
-- Adds an admin-comp audit trail to app.subscription. The status column stays free
-- text (no enum), so 'comped' is a new legal value alongside 'active'/'inactive':
--   active  → paid Stripe subscription (written by the verified webhook)
--   comped  → granted free by an admin (written by the admin route, no Stripe)
--   inactive→ none / lapsed / revoked
-- Both 'active' and 'comped' unlock the paid gates (see lib/auth hasActiveSubscription).
--
-- WRITE PATH UNCHANGED: app.subscription is still write-locked to anon+authenticated
-- (the only writers are the service_role webhook and the admin-comp route, both on the
-- RLS-exempt server connection). This migration adds columns only — no new grants.
-- Additive + idempotent (add column if not exists): safe to re-run.

alter table app.subscription add column if not exists comped_by uuid;        -- admin uid who granted the comp
alter table app.subscription add column if not exists comped_at timestamptz; -- when the comp was granted

comment on column app.subscription.status is
  '''active'' (paid) and ''comped'' (admin-granted free) unlock the paid gates; ''inactive'' = none/lapsed';
