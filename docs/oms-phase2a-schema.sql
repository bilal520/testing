-- ============================================================================
-- OMS Phase 2a — RTO detection + Online Payments (manual prepaid)
-- Run ONCE in Supabase → SQL Editor. Safe & idempotent (add-if-not-exists only;
-- touches nothing existing). Ends with a PostgREST schema reload.
-- ============================================================================

-- ── courier_orders: normalized customer phone, for RTO matching ──────────────
-- The customer phone already lives in the stored `raw` payload
-- (PostEx raw.customerPhone / Leopards raw.consignment_phone). This adds a
-- clean, indexed column so we can match a new order's phone to past returns.
alter table courier_orders add column if not exists cust_phone_norm text;
create index if not exists courier_orders_phone_norm on courier_orders (cust_phone_norm);

-- Backfill existing rows from the stored raw payload. The couriers already store
-- the phone as 03XXXXXXXXX, so we take it directly when it's a clean PK mobile.
update courier_orders
   set cust_phone_norm = coalesce(raw->>'customerPhone', raw->>'consignment_phone')
 where cust_phone_norm is null
   and coalesce(raw->>'customerPhone', raw->>'consignment_phone') ~ '^03[0-9]{9}$';

-- ── oms_orders: RTO profile snapshot + prepaid payment fields ────────────────
alter table oms_orders add column if not exists rto_return_count   int default 0;
alter table oms_orders add column if not exists rto_last_return_at  timestamptz;
alter table oms_orders add column if not exists rto_reasons         jsonb default '[]'::jsonb;

alter table oms_orders add column if not exists payment_state       text;         -- awaiting | paid | failed
alter table oms_orders add column if not exists payment_method      text;         -- jazzcash | easypaisa | bank
alter table oms_orders add column if not exists payment_amount      numeric;
alter table oms_orders add column if not exists payment_ref         text;
alter table oms_orders add column if not exists payment_link_sent_at timestamptz;
alter table oms_orders add column if not exists paid_at             timestamptz;
alter table oms_orders add column if not exists paid_by             text;

-- Reload PostgREST so the new columns are queryable immediately.
notify pgrst, 'reload schema';
