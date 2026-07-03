-- ============================================================================
-- Elyscents OMS — Phase 1 schema
-- Run once in Supabase → SQL Editor. Safe: creates new tables only, touches
-- nothing existing. All writes go through the service role (RLS not required).
-- ============================================================================

-- ── Core order record ───────────────────────────────────────────────────────
create table if not exists oms_orders (
  id                     bigint generated always as identity primary key,
  shopify_order_id       text unique not null,
  order_number           text,
  customer_name          text,
  phone                  text,           -- normalised 03xx / +92
  address_raw            text,
  address_house          text,
  address_street         text,
  address_area           text,
  city                   text,
  address_complete       boolean default false,
  address_score          int default 0,
  items                  jsonb,          -- [{sku,name,qty,price}]
  cod_amount             numeric default 0,
  state                  text not null default 'new',
  cancel_reason          text,
  risk_score             int default 0,
  risk_level             text default 'low',
  risk_factors           jsonb default '[]'::jsonb,
  duplicate_of           bigint references oms_orders(id),
  is_duplicate           boolean default false,
  confirmation_attempts  int default 0,
  next_action_at         timestamptz,
  assigned_agent         text,
  courier                text,
  tracking_number        text,
  label_url              text,
  shopify_fulfillment_id text,
  shopify_synced_at      timestamptz,
  shopify_sync_error     text,
  raw_shopify_order      jsonb,          -- SAFETY: untouched original snapshot
  confirmed_at           timestamptz,
  dispatched_at          timestamptz,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);
create index if not exists oms_orders_state_next  on oms_orders (state, next_action_at);
create index if not exists oms_orders_phone        on oms_orders (phone);
create index if not exists oms_orders_city         on oms_orders (city);
create index if not exists oms_orders_created      on oms_orders (created_at desc);

-- ── Immutable audit log ─────────────────────────────────────────────────────
create table if not exists oms_events (
  id          bigint generated always as identity primary key,
  order_id    bigint references oms_orders(id),
  event_type  text not null,   -- state_change | whatsapp_sent | whatsapp_reply | call | note | risk_scored | address_fixed | booked | shopify_sync | shopify_sync_shadow | shopify_sync_error
  actor       text,            -- system | agent:<name> | customer
  channel     text,            -- whatsapp | call | robocall | system | shopify
  from_state  text,
  to_state    text,
  detail      text,
  payload     jsonb,           -- before/after or API response
  created_at  timestamptz default now()
);
create index if not exists oms_events_order on oms_events (order_id, created_at desc);

-- ── Agents ──────────────────────────────────────────────────────────────────
create table if not exists oms_agents (
  id         bigint generated always as identity primary key,
  name       text not null,
  phone      text,
  active     boolean default true,
  created_at timestamptz default now()
);

-- ── Confirmation attempts (retry logic + analytics) ─────────────────────────
create table if not exists oms_confirmation_attempts (
  id           bigint generated always as identity primary key,
  order_id     bigint references oms_orders(id),
  attempt_no   int,
  channel      text,          -- whatsapp | call | robocall
  outcome      text,          -- confirmed | cancelled | no_answer | wrong_number | reschedule
  agent        text,
  attempted_at timestamptz default now()
);
create index if not exists oms_conf_order on oms_confirmation_attempts (order_id);

-- ── Global settings / SAFETY kill-switch (single row) ───────────────────────
create table if not exists oms_settings (
  id                        int primary key default 1,
  shopify_writeback_enabled boolean default false,   -- master kill-switch (OFF)
  shopify_writeback_mode    text    default 'shadow', -- shadow (log-only) | live
  auto_cancel_to_shopify    boolean default false,    -- false = tag-only (safe)
  auto_cancel_daily_cap     int     default 20,
  backfill_days             int     default 14,
  updated_at                timestamptz default now(),
  constraint oms_settings_singleton check (id = 1)
);
insert into oms_settings (id) values (1) on conflict (id) do nothing;
