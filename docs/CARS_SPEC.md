# Elyscents — Checkout Abandonment Recovery System (CARS)

**Dashboard-native SPEC v1** · Author: Claude · Status: **SPEC ONLY — not built** · Market v1: **elyscents.pk**

Recovers abandoned Shopify checkouts via WhatsApp Cloud API, with revenue
attribution, full message history, and a live in-dashboard stats tab. Built
**inside the existing Elyscents dashboard** (Next.js 15 · Vercel · Supabase ·
Clerk), reusing the Shopify + WhatsApp + cron + RBAC infrastructure the OMS
already runs on. Zero human intervention except monitoring + reply handling.

---

## 0. What changes vs the pasted reference spec

The reference spec assumes a standalone service. We already have the platform,
so we drop the bespoke infra and reuse ours:

| Reference spec (out of scope) | We use instead (already live) |
|---|---|
| SQLite `cars.db` | **Supabase Postgres** — one idempotent migration, `cars_*` tables |
| VPS + cron + nginx + Let's Encrypt | **Vercel serverless + cron jobs** (`vercel.json`), HTTPS built-in |
| New standalone WhatsApp webhook server | **Extend** existing `/api/webhooks/whatsapp` (verified handshake already live) |
| New Shopify app + token plumbing | **Reuse** `lib/shopify.ts` token (DB-first) + GraphQL client (only add scopes) |
| Google Sheet reports + Apps Script | **New "Recovery" dashboard tab** + CSV export (Reports pattern) + WhatsApp daily summary (existing daily-report cron) |
| `.env` on VPS | **`site_settings`** (DB-first, same as OMS/WhatsApp/Shopify tokens) |
| YAML config file | **`site_settings.cars_config`** JSON, editable from an admin Setup panel |

Everything else (poller, exclusion rules, 3-step sequence, 3-tier attribution,
suppression list, rate limits, quality-rating auto-pause, daily summary) is kept
— re-homed onto our stack.

---

## 1. Architecture (reuse map)

```
Shopify PK Admin API ──(cron /api/cars/tick, every 15m)──► Recovery engine
   abandonedCheckouts                                          │
                                                     ┌─────────▼──────────┐
                                                     │  Supabase (cars_*) │  ← system of record
                                                     └─────────┬──────────┘
        ┌──────────────────────────┬───────────────────────────┼───────────────────┐
        ▼                          ▼                            ▼                   ▼
  WhatsApp Cloud API        /api/webhooks/whatsapp      /api/webhooks/shopify   Recovery tab
  (send templates)          (delivery/read + replies)   (orders/create →         (dashboard UI
   via lib/cars/whatsapp     — EXTEND existing)          attribution) +           + CSV + daily
                                                         hourly sweep             WhatsApp summary
```

**Reused primitives (no rebuild):**
- `lib/shopify.ts` — `shopifyGraphQL()`, DB-first token, PK domain, `normalisePhone()`.
- `lib/oms/whatsapp.ts` — token/phone/WABA resolution (`getWhatsappToken`, `getPhoneId`, `getWabaId`), `fetchTemplates()` (status + category + `quality_rating`), the template-spec parser + send-payload builder. CARS gets a thin `lib/cars/whatsapp.ts` that reuses these to send **recovery** templates and log to `cars_messages`.
- `/api/webhooks/whatsapp` — already does the Meta verify handshake and inbound-message ingest. **Extend** it to (a) read `value.statuses[]` (delivery/read/failed) and (b) route by receiving `phone_number_id` (OMS vs CARS number).
- `/api/webhooks/shopify` — already feeds the order mirror. **Hook** CARS attribution onto new orders.
- Vercel cron array in `vercel.json`; RBAC (`lib/rbac.ts` `guardModule`); Reports/CSV UI pattern; daily-report cron for the summary.
- **The order mirror is a superpower here:** we already mirror *every* Shopify order into `oms_orders` (with `raw_shopify_order`). So "did this customer already buy?" (the critical pre-send check) and Tier-3 attribution are **local DB queries**, not extra Shopify calls.

---

## 2. Shopify integration

### 2.1 Scopes (custom app — one-time addition)
Current app has `read_orders` etc. **Add:** `read_checkouts` (pull abandoned
checkouts) and `write_price_rules` + `write_discounts` (unique recovery codes —
see §7). No code change to the token layer; just re-grant scopes in the Shopify
admin and re-install.

### 2.2 Abandoned-checkout pull (GraphQL, Admin `2024-10`)
New query in `lib/cars/shopify.ts` using the existing `shopifyGraphQL()`:

```graphql
query($q: String!, $after: String) {
  abandonedCheckouts(first: 100, query: $q, after: $after, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id  name  createdAt  updatedAt  completedAt
      abandonedCheckoutUrl
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { id firstName lastName phone email numberOfOrders }
      billingAddress { phone } shippingAddress { phone city }
      lineItems(first: 20) { nodes { title quantity image { url }
        variant { title price product { title } } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```
- Query window: `created_at:>=T-72h` (only actionable ones), cursor-paginate.
- `completedAt != null` ⇒ already converted ⇒ mark `recovered`/`excluded`, never message.
- Phone resolves via `customer.phone → shippingAddress.phone → billingAddress.phone`, canonicalised with the existing `normalisePhone()`.

### 2.3 Order completion detection (two mechanisms — both kept)
- **Primary:** `orders/create` webhook (we already receive it) → run attribution immediately.
- **Safety net:** hourly sweep (`/api/cars/attribution`) over `oms_orders` created in the last ~2h (they're already mirrored) → attribute any the webhook missed.

### 2.4 Exclusion rules (do NOT message) — checked at ingest AND re-checked before every send
1. Checkout completed (order exists for token / phone / email).
2. No usable phone.
3. Phone on the **suppression list** (STOP/opt-out) — permanent.
4. Phone already in a recovery sequence in the last **72h** (frequency cap — one sequence per customer per 3 days).
5. Cart total `< cars_config.min_cart_value` (default Rs 1,000).
6. Phone in team/test blocklist (`cars_config.blocklist`).

---

## 3. WhatsApp Cloud API

### 3.1 Number strategy — **DECIDED (2026-07-03): reuse the OMS number**
Recovery sends go out on the existing OMS WhatsApp number. Fast, no new
registration. **Accepted risk:** recovery is MARKETING (higher block/opt-out
risk than confirmations) and Meta's quality rating is per-number, so a bad
stretch could also throttle order-confirmation sends. **Mitigations (required
for this choice):** conservative `daily_send_cap`, strict suppression +
frequency cap, and **quality auto-pause that halts recovery sends at YELLOW**
(before RED, where Meta limits the number) — confirmations keep flowing.
**Reversible:** the send + webhook layers are number-agnostic (branch on
`metadata.phone_number_id`), so moving recovery to a dedicated number later is
just setting `cars_whatsapp_phone_number_id` — no rework.

### 3.2 Templates (MARKETING, submit to Meta once)
Roman-Urdu bodies, mirroring the reference copy. Registered in
`site_settings.cars_wa_templates` (same shape as `oms_wa_templates`):
- `cart_recovery_1h` — vars: name, product summary, recovery URL; buttons: URL "Complete Order" (dynamic) + quick-reply "Sawal hai".
- `cart_recovery_24h` — vars: name, product, discount code, recovery URL.
- `cart_recovery_72h` — vars: name, product, discount code, recovery URL.

`fetchTemplates()` already surfaces each template's `status` + `category`, so the
Setup panel shows approval state and blocks sends until `APPROVED`.

### 3.3 Sequence
| Step | Timing (after abandonment) | Template | Guard before send |
|---|---|---|---|
| 1 | 60 min | `cart_recovery_1h` | still open · not excluded · in send window |
| 2 | 24 h | `cart_recovery_24h` (+ unique code) | step 1 delivered · no reply · no order |
| 3 | 72 h | `cart_recovery_72h` | still open · no order |
| stop | any | — | order placed · reply · opt-out · 3 sent |

**Non-negotiable:** re-run the completion + suppression + frequency checks
immediately before *every* send (against the local mirror). Never message a
customer who already bought.

### 3.4 Send window, rate limits, quality
- Send window `09:00–22:00 PKT` (`cars_config.send_window`); out-of-window steps queue to window open (a 2 AM abandonment → step 1 at 9 AM).
- Daily cap `cars_config.daily_send_cap` (start 200, respects WABA tier); overflow → next day, **prioritised by cart value DESC**.
- Poll `quality_rating` daily via `fetchTemplates()` (phone field). On `YELLOW`/`RED` → **auto-pause sends** (flip an internal pause flag) + alert team. Hard caps: max 1 template / phone / 20h; max 3 / checkout lifetime.

---

## 4. Data model — Supabase migration `docs/cars-schema.sql`

One idempotent, paste-into-SQL-Editor migration (ends with `notify pgrst,
'reload schema';`). `cars_` prefix — no collision with the existing `messages`
table (that's the conversation-intelligence hub).

```sql
create table if not exists cars_checkouts (
  checkout_id     text primary key,          -- Shopify checkout GID
  checkout_token  text,
  store           text not null default 'PK',
  phone           text, email text, customer_id text, customer_name text,
  is_returning    boolean default false,
  cart            jsonb,                      -- full line-item snapshot
  cart_summary    text,                       -- "Royal Oud 50ml + 1 more"
  total_price     numeric, currency text,
  recovery_url    text,
  abandoned_at    timestamptz,
  status          text default 'new',         -- new|queued|in_sequence|replied|recovered|expired|suppressed|excluded
  exclusion_reason text,
  discount_code   text,
  next_step       int default 1,
  next_action_at  timestamptz,                -- when the next step is due
  created_at      timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists cars_checkouts_phone_idx  on cars_checkouts(phone);
create index if not exists cars_checkouts_due_idx    on cars_checkouts(status, next_action_at);

create table if not exists cars_messages (
  message_id   text primary key,              -- WhatsApp wamid (or "shadow_<uuid>")
  checkout_id  text references cars_checkouts,
  phone        text, template_name text, sequence_step int,
  sent_at      timestamptz,
  status       text default 'sent',           -- shadow|sent|delivered|read|failed
  status_updated_at timestamptz, failure_reason text,
  cost_estimate numeric
);
create index if not exists cars_messages_checkout_idx on cars_messages(checkout_id);

create table if not exists cars_replies (
  id bigint generated always as identity primary key,
  checkout_id text, phone text, reply_text text, replied_at timestamptz,
  handled_by text, outcome text               -- converted|lost|pending|opted_out
);

create table if not exists cars_recoveries (
  order_id text primary key,                   -- Shopify order GID
  order_name text, checkout_id text references cars_checkouts, phone text,
  order_total numeric,
  attribution_method text,                     -- discount_code|checkout_token|phone_match_48h
  attribution_confidence text,                 -- exact|high|probable
  last_message_step int, hours_from_message_to_order numeric,
  recovered_at timestamptz default now()
);

create table if not exists cars_suppression (
  phone text primary key, reason text, added_at timestamptz default now()
);

-- rollup written by the daily summary cron (trend + MTD + "money actually made")
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
  net_made numeric,          -- cash_collected − incentive − msg − return costs
  roi numeric,
  primary key (date, store)
);

notify pgrst, 'reload schema';
```

---

## 5. Config — `site_settings.cars_config` (JSON, admin-editable)

```jsonc
{
  "store": "PK",
  "min_cart_value": 1000,
  "sequence_delays_min": [60, 1440, 4320],   // 60m, 24h, 72h
  "frequency_cap_hours": 72,
  "attribution_window_hours": 48,
  "discount_type": "free_shipping",           // free_shipping | percent | none
  "discount_percent": 0,
  "send_window": "09:00-22:00",               // PKT
  "daily_send_cap": 200,
  "quality_pause": true,
  "step3_enabled": true
}
```
Plus discrete keys (mirrors OMS): `cars_enabled` (master kill-switch, **default
`false`** → shadow mode), `cars_whatsapp_phone_number_id`, `cars_wa_templates`,
`cars_test_numbers` (first-live allowlist).

---

## 6. Sequence engine (crons)

Add to `vercel.json` (UTC):
- `*/15 * * * *` → **`/api/cars/tick`** (CRON_SECRET): (1) pull abandoned checkouts → upsert `cars_checkouts` + apply exclusions; (2) select rows where `status in (new,queued,in_sequence)` and `next_action_at <= now()` and in send window → re-check completion/suppression/frequency → send the due step → write `cars_messages`, set `next_step`/`next_action_at`.
- `0 * * * *` → **`/api/cars/attribution`** (CRON_SECRET): hourly sweep of recently-mirrored orders → attribute (§7).
- `5 4 * * *` → **`/api/cars/daily-summary`** (CRON_SECRET, 9:05 AM PKT): compute yesterday's funnel → write `cars_daily_stats` → WhatsApp summary to team (reuse the daily-report sender) + fire alerts.

`maxDuration` 300 on `tick`/`attribution` (batch work), matching heavy OMS routes.

---

## 7. Revenue attribution (three tiers, honest separation)

Run on every new order (webhook + hourly sweep). Orders are already in
`oms_orders` with `raw_shopify_order`, so most matching is local.
- **Tier 1 — Exact (unique discount code).** Step 2/3 issues a **unique, single-use, 48h** code via Shopify `discountCodeBasicCreate` (free-shipping by default — protects margin and doubles as the incentive). Order used that code ⇒ `confidence=exact`. This is the backbone of *confirmed* recovery.
- **Tier 2 — High (checkout token).** If the order carries the abandoned checkout's token/cart token, match it ⇒ `confidence=high`. *Best-effort* — GraphQL Order doesn't always expose the token; fall back to Tier 3 when absent.
- **Tier 3 — Probable (phone/email within window).** Order phone (via `normalisePhone`) or email matches a messaged checkout, placed within `attribution_window_hours` (48h) of the last message ⇒ `confidence=probable`.

**Rules:** one order → at most one checkout (dedupe to most-recent message);
hard 48h cutoff; store `last_message_step` (which message converted). Report
**exact + high = "Confirmed Recovered Revenue"** and **probable = "Assisted
Revenue"** on separate lines — never blend them.

**Delivery linkage (feeds §9.1 "money actually made"):** `cars_recoveries.order_id`
is the same Shopify order that flows through the OMS. At report time we join to
`oms_orders` (state) + `courier_orders` (`norm_status`, COD amount) to resolve
each recovered order's true outcome — delivered (cash collected), in-transit, or
returned (cost) — so recovery is measured as **realized cash**, not just orders
placed. No new writes here; it's a read-time join over data we already own.

---

## 8. Reply handling + suppression (extend `/api/webhooks/whatsapp`)

- **Statuses:** read `value.statuses[]` → match `wamid` to `cars_messages` → set `delivered`/`read`/`failed` (+ `failure_reason`). (Currently the webhook ignores `statuses` entirely.)
- **Routing:** if a separate CARS number, branch on `value.metadata.phone_number_id`; CARS inbound goes to CARS handling, OMS inbound stays with `applyOmsReply()`.
- **Replies (v1 = human close):** insert `cars_replies`, set checkout `status=replied`, auto-ack ("Shukriya! Hamari team abhi aapko jawab degi 🙂" in window; after-hours variant), and surface in the Recovery tab (+ optional forward to a team WhatsApp/notification). **v2:** Claude auto-responder for FAQs with handoff on purchase-intent — reuse the existing hub Claude layer.
- **Opt-out:** reply containing `stop|unsubscribe|band karo|block` → insert `cars_suppression`, confirm once, never message again. Suppression is checked before **every** send — non-negotiable for WABA health.

---

## 9. Reporting — "Recovery" dashboard tab + daily WhatsApp summary

New top-level **Recovery** tab (RBAC-gated) + `GET /api/cars/report?from&to`
(one bundle, guarded), following the Reports/CSV pattern.

### 9.1 Money actually made (delivery-realized — the headline view)
A recovered COD order is **not money** until it's delivered and cash is
collected; a returned one *costs* double shipping. Because every recovered order
(`cars_recoveries.order_id`) is also in the OMS/courier pipeline, we track it to
its real outcome by joining `oms_orders` (state) + `courier_orders`
(`norm_status`, COD amount). Two clean lenses, both shown per **Day / MTD /
All-time**:

**A) Recovery activity** (by recovery date — "what we recovered"):
- Recovered orders — count, **split Confirmed (code/token) vs Assisted (phone-match)**.
- Gross recovered value (order totals), same split.
- Recovery rate % (recovered ÷ messaged), read %, replies.

**B) Realized money** (by delivery date — "money actually made"):
- **Delivered** — recovered orders that reached delivered → **cash actually collected** (COD collected + prepaid). ← the number you asked for.
- **In transit / pending** — recovered orders still out (not money yet).
- **Returned (RTO)** — recovered orders that came back → count + **return shipping cost lost**.
- **Costs** — WhatsApp message cost + free-shipping given (on delivered orders) + return-shipping cost.
- **NET money made = cash collected − all costs.**  **ROI = net money made ÷ CARS cost.**

Headline tiles at the top of the tab: **Recovered today · Delivered (money made) today · MTD money made · All-time money made**, each with a small "still-in-transit (potential)" sub-figure so nothing looks lost while orders are mid-delivery.

### 9.2 Supporting views
- **Per-template performance:** sends, read rate, recovered, **delivered + net money** per template (which message actually makes money → drives copy iteration).
- **Detail log:** one row per recovered order — date, **masked phone (0300\*\*\*1234)**, cart, order value, attribution (confirmed/assisted), step that converted, **delivery status (delivered / in-transit / returned), cash collected, net**. CSV export. Plus a messaged-but-not-recovered log for completeness.
- **Daily 9 AM WhatsApp** (reuse daily-report sender): abandoned · messaged · read% · recovered · **delivered = Rs X money made** · MTD money made · recovery rate · ROI · alerts.
- **Alerts (immediate):** quality-rating drop from Green · template paused/rejected · send-failure > 20%/hour · poller heartbeat miss · recovery rate < 5% for 3 consecutive days.

> Timing note: recovered-today and money-made-today are different cohorts (an order recovered today delivers in a few days). The tab labels each clearly so the numbers are never conflated — "recovered" counts on conversion date, "money made" counts on delivery date.

---

## 10. RBAC

Add `recovery` to `ModuleKey` + `MODULES` (`lib/rbac-constants.ts`); map the tab
in `TAB_MODULE`. Grant to **admin** (auto), **ops_manager**, **marketing**
(revenue-recovery is marketing-owned), and **analyst** (read). Server-guard
every `/api/cars/*` route with `guardModule('recovery')` (CRON routes stay
CRON_SECRET-gated, never role-guarded).

---

## 11. Safety & compliance (this is automated outbound to real customers)

Same posture as the OMS write-back / courier booking:
- **`cars_enabled` master kill-switch, default OFF → full SHADOW mode:** the whole pipeline runs (pulls checkouts, computes the exact sequence + variables, writes `cars_messages` with `status='shadow'`) but **sends nothing**. Lets us watch real decisions for days before going live.
- **Supervised first live run:** `cars_test_numbers` allowlist → only the founder's number receives real sends until we flip it off.
- Suppression checked before every send · frequency cap · pre-send completion re-check · send window · daily cap · quality auto-pause.
- Webhooks verify signatures (Shopify HMAC + Meta `X-Hub-Signature-256`) — extend the existing verified handshake. Phone numbers masked in the UI; full numbers only in the DB. Tokens stay in `site_settings`/env, never in code.

---

## 12. Multi-market readiness

`store` column on every table + `cars_config.store`. v1 targets **PK only**
(matches the PK-only order mirror + PK Shopify/WhatsApp). UAE/BD plug in later
with: their Shopify creds + scopes, their WhatsApp number + AED/Bangla
templates, and a per-store config row — no schema change.

---

## 13. Build phases (incremental, our style — each ends built + deployed)

- **C0 — Schema + config + RBAC:** `cars-schema.sql` migration, `cars_config` defaults, `recovery` module + empty tab, `cars_enabled=false`.
- **C1 — Ingest (read-only):** `lib/cars/shopify.ts` abandoned-checkout pull + `/api/cars/tick` poll half + exclusions → populate `cars_checkouts`. No sends. Recovery tab shows the abandonment funnel from real data.
- **C2 — Sequence engine in SHADOW:** decision logic + `lib/cars/whatsapp.ts` builds real payloads but logs `status='shadow'`. Watch the intended sequence against live carts.
- **C3 — Live sends (supervised):** templates approved + number configured → enable to `cars_test_numbers` only → verify end-to-end on the founder's number → widen.
- **C4 — Attribution + discount codes:** unique-code issuance, `orders/create` hook + hourly sweep, 3-tier attribution, `cars_recoveries`.
- **C5 — Reporting + alerts:** full Recovery tab (funnel / per-template / detail / MTD) + CSV + daily WhatsApp summary + alerts + quality auto-pause.
- **C6 — Tune:** first-week data → timing/copy A/B (Roman-Urdu vs Urdu, 60m vs 90m), raise cap with tier.
- **Later:** Claude reply auto-responder; UAE/BD onboarding.

---

## 14. Decisions

**LOCKED (2026-07-03):**
1. ✅ **WhatsApp number = reuse the OMS number** (see §3.1 for accepted risk + mitigations + reversibility).
2. ✅ **Step-2/3 incentive = unique single-use free-shipping code** (protects margin + exact attribution). Requires `write_discounts` scope.

**Defaults adopted (all tunable in `cars_config`, override anytime):**
3. **Reply owner (v1):** whoever handles order confirmations today; replies also surface in the Recovery tab regardless.
4. **Cart floor:** Rs 1,000.
5. **Third message:** keep the 72h step (kill if opt-outs spike).
6. **Attribution:** Confirmed (exact+high) vs Assisted (probable) shown as separate lines.

**Prerequisite before live sends (user action, in Shopify admin):** re-grant the
custom app with `read_checkouts` + `write_discounts` and re-install.
```
