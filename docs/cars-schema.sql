-- ════════════════════════════════════════════════════════════════════════════
-- CARS — Checkout Abandonment Recovery System schema (Supabase / Postgres)
-- Idempotent. Paste into Supabase SQL Editor and run. Safe to re-run.
-- See docs/CARS_SPEC.md. cars_* prefix — no collision with the hub `messages`.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists cars_checkouts (
  checkout_id      text primary key,          -- Shopify checkout GID
  checkout_token   text,
  store            text not null default 'PK',
  phone            text, email text, customer_id text, customer_name text,
  is_returning     boolean default false,
  cart             jsonb,                      -- full line-item snapshot
  cart_summary     text,                       -- "Royal Oud 50ml + 1 more"
  total_price      numeric, currency text,
  recovery_url     text,
  abandoned_at     timestamptz,
  status           text default 'new',         -- new|queued|in_sequence|replied|recovered|expired|suppressed|excluded
  exclusion_reason text,
  discount_code    text,
  next_step        int default 1,              -- 1/2/3 = which step is next
  next_action_at   timestamptz,                -- when the next step is due
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index if not exists cars_checkouts_phone_idx on cars_checkouts(phone);
create index if not exists cars_checkouts_due_idx   on cars_checkouts(status, next_action_at);

create table if not exists cars_messages (
  message_id        text primary key,          -- WhatsApp wamid (or "shadow_<uuid>")
  checkout_id       text references cars_checkouts(checkout_id),
  phone             text, template_name text, sequence_step int,
  sent_at           timestamptz,
  status            text default 'sent',       -- shadow|sent|delivered|read|failed
  status_updated_at timestamptz, failure_reason text,
  cost_estimate     numeric
);
create index if not exists cars_messages_checkout_idx on cars_messages(checkout_id);
create index if not exists cars_messages_status_idx   on cars_messages(status);

create table if not exists cars_replies (
  id          bigint generated always as identity primary key,
  checkout_id text, phone text, reply_text text, replied_at timestamptz default now(),
  handled_by  text,                             -- auto|human|claude
  outcome     text                              -- converted|lost|pending|opted_out
);

create table if not exists cars_recoveries (
  order_id                text primary key,     -- Shopify order GID
  order_name              text,
  checkout_id             text references cars_checkouts(checkout_id),
  phone                   text, order_total numeric,
  attribution_method      text,                 -- discount_code|checkout_token|phone_match_48h
  attribution_confidence  text,                 -- exact|high|probable
  last_message_step       int,
  hours_from_message_to_order numeric,
  recovered_at            timestamptz default now()
);
create index if not exists cars_recoveries_checkout_idx on cars_recoveries(checkout_id);

create table if not exists cars_suppression (
  phone    text primary key,
  reason   text,
  added_at timestamptz default now()
);

-- Rollup written by the daily-summary cron (trend + MTD + "money actually made").
create table if not exists cars_daily_stats (
  date date, store text default 'PK',
  checkouts_abandoned int, abandoned_value numeric,
  messages_sent int, msg_delivered int, msg_read int, msg_failed int, replies int,
  -- recovery activity (by recovery date)
  orders_recovered int, orders_recovered_confirmed int,
  revenue_recovered numeric, revenue_probable numeric, recovery_rate numeric,
  -- realized money (by delivery date) — the "money actually made" view
  recovered_delivered int, cash_collected numeric,
  recovered_returned int, return_cost numeric,
  incentive_cost numeric, msg_cost numeric,
  net_made numeric, roi numeric,
  primary key (date, store)
);

notify pgrst, 'reload schema';
