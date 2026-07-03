-- ============================================================================
-- OMS Phase 2c — Returns Receiving
-- Run ONCE in Supabase → SQL Editor. Safe & idempotent (creates one new table).
-- ============================================================================

create table if not exists oms_returns_received (
  id               bigint generated always as identity primary key,
  order_id         bigint references oms_orders(id),
  shopify_order_id text,
  order_number     text,
  tracking_number  text,
  courier          text,
  condition        text,          -- good | damaged | mixed
  items            jsonb,         -- [{ name, qty }] snapshot of what came back
  received_by      text,          -- warehouse staff
  notes            text,
  received_at      timestamptz default now()
);
create index if not exists oms_returns_received_tn on oms_returns_received (tracking_number);
create index if not exists oms_returns_received_at on oms_returns_received (received_at desc);

notify pgrst, 'reload schema';
