# Elyscents OMS — Full Specification
### Order Management System for Pakistan COD, built to reduce courier return rate

**Version:** 1.0 · **Date:** 2026-07-01 · **Market:** Pakistan (Elyscents PK)
**North-star metric:** Reduce courier RTO (Return-to-Origin) rate from the current ~13–19% toward < 10%.

---

## 0. Why this exists (the Pakistan COD problem)

- Cash-on-Delivery is **~80%+ of all Pakistani e-commerce orders**. The customer pays nothing upfront, so there is **zero commitment** at checkout.
- Pakistan has the **highest RTO rate in the world (30–40% industry average)**. Every return costs you twice: forward shipping + return shipping + repackaging + locked-up cash + dead inventory time.
- The single highest-impact intervention is **confirming every order before dispatch**. Industry data: WhatsApp confirmation before dispatch drops RTO from 30–35% → 18–22% in the first month, and lifts confirmation rates from 60–70% → 85–92% when the first touch happens within 5 minutes.
- Elyscents already runs **below the industry RTO** (PostEx ~18.7%, Leopards ~5.7% on 14-day closed basis) — the OMS is about pushing that structurally lower and making the confirmation/dispatch process fast and measurable.

**Design principle:** *Only a confirmed, address-complete, non-duplicate, acceptable-risk order should ever reach a courier.* Everything else is worked in a queue first.

---

## 1. Where it plugs into the existing system

The OMS is a new module inside the existing dashboard. It reuses infrastructure already built:

| Existing component | Role in OMS |
|---|---|
| **Shopify PK store** (`SHOPIFY_PK_*`) | Source of new orders (webhook `orders/create`) |
| **WhatsApp Business API** (`WHATSAPP_*`, `META_PAGE_ACCESS_TOKEN`) | Confirmation, address requests, dispatch alerts, feedback |
| **`/api/webhooks/whatsapp`** (existing) | Receives customer replies → drives order state |
| **`messages` table** (existing, Claude-categorised) | WhatsApp/call conversation thread per order |
| **PostEx + Leopards integration** (`lib/courier.ts`) | Booking (dispatch) + tracking |
| **Courier Intelligence** (return-by-city, return reasons, tracking enrichment) | **Feeds the risk engine** — city RTO %, repeat-returner detection, NDR signals |
| **Supabase** | All OMS tables |
| **Claude API** (`ANTHROPIC_API_KEY`) | Address parsing, WhatsApp reply intent detection, risk explanations |
| **Vercel cron** | Retry queues, escalations, SLA timers |

The OMS sits **between Shopify and the courier**: `Shopify order → OMS (confirm/verify/score) → PostEx/Leopards booking`.

### End-to-end integration flow

```
   ┌──────────┐  orders/create (webhook)   ┌───────────────────────────┐
   │ Shopify  │ ─────────────────────────▶ │   OMS  (this dashboard)   │
   │  PK      │ ◀───────────────────────── │  confirm · verify · score │
   └──────────┘   write-back:              └────────────┬──────────────┘
        ▲          tags, note, address,                 │ only ready_to_dispatch
        │          cancel, FULFILLMENT+tracking         │
        │                                               ▼
        │                                  ┌───────────────────────────┐
        │        fulfillment + tracking    │  PostEx create-order /    │
        └──────────────────────────────────│  Leopards bookPacket      │
                (written back to Shopify)   │  (DIRECT API, not their   │
                                            │   Shopify apps)           │
                                            └────────────┬──────────────┘
                                                         │ tracking #
                                                         ▼
                                            ┌───────────────────────────┐
                                            │ courier_orders + Courier  │
                                            │ Intelligence (existing)   │
                                            └───────────────────────────┘
```

**Two hard rules:**
1. **We never route bookings through the couriers' Shopify apps** — those auto-book everything in Shopify and bypass the confirmation gate. We call PostEx/Leopards APIs directly so *we* decide which orders ship.
2. **Every OMS edit mirrors back to Shopify** (tags, address, cancel, fulfillment) so Shopify stays the accurate storefront record. One custom app (existing token) does both directions — no public app needed.

---

## 1A. Data Safety & Guardrails (NON-NEGOTIABLE)

Shopify is the storefront system-of-record and holds financially important data. The OMS must be **incapable of destroying it**. These rules are enforced centrally in `shopifySync()` — not left to individual call sites.

| Guardrail | Rule |
|---|---|
| **Additive-only writes** | Use `tagsAdd` (never `tagsReplace`); append to notes/timeline (never overwrite the note field). The app has **no delete capability** of any kind. |
| **Snapshot on ingest** | Store the raw Shopify order JSON in `oms_orders.raw_shopify_order` (jsonb), untouched. The original address, tags, and every field is always recoverable — nothing we do is one-way. |
| **Destructive ops are human-gated** | **Cancellations** and **shipping-address overwrites** require an explicit agent action + confirm dialog. They are **never** automated or silent. |
| **Auto-cancel is tag-only by default** | When the retry loop exhausts (unreachable ×N), the OMS marks its *own* state `cancelled` and adds a Shopify **tag** `oms-cancelled` — it does **NOT** call Shopify `orderCancel`. A human approves the real Shopify cancellation. (Configurable to full auto-cancel later, once trusted, with a daily cap.) |
| **Idempotency** | Every write is keyed by `shopify_order_id + change-hash`, so retries and duplicate webhooks can never double-apply (no duplicate fulfillments, no repeated tags). |
| **Read-before-write** | Fetch the current order state first; if it changed underneath us, abort and re-queue (optimistic concurrency) — we never blind-overwrite. |
| **Least-privilege scopes** | Only `read_orders, write_orders, write_fulfillments, write_merchant_managed_fulfillment_orders`. **No** product / inventory / customer-write / payout / delete scopes are ever requested. |
| **Global kill-switch** | `oms_settings.shopify_writeback_enabled` — flip off to instantly halt ALL Shopify writes while order *pull* keeps working. One row, one boolean, instant stop. |
| **Full audit trail** | Every Shopify write is logged to `oms_events` with before/after values and the raw GraphQL response — anything can be traced and manually reverted. |
| **Rate-limit safe** | GraphQL cost-aware with exponential backoff and a failure queue — never hammer the API or risk throttling/lockout. |
| **Staged rollout** | Write-back ships in **shadow / log-only mode first** (computes the write, logs it, does NOT send). Verify the logged writes are correct → enable on **one test order** → then enable fully. Cancellations stay tag-only until explicitly trusted. |
| **Bulk safety** | Bulk book/cancel shows a **preview count + confirm**; a daily cap limits how many orders any automated rule can cancel. |
| **Test in isolation** | Initial development/testing runs against a Shopify **development store** or a single dedicated test order — never bulk-tested on the live catalogue. |

**Blast-radius summary:** the worst an OMS bug can do under these rules is add a wrong *tag* or a wrong *note* (both trivially removable) or create a wrong *fulfillment* (cancellable). It **cannot** delete an order, silently cancel one, wipe an address, or touch products/inventory/customers.

---

## 2. The order lifecycle (state machine — the heart of the OMS)

Every order moves through an explicit state. Transitions are logged to an audit table. States:

```
                         ┌─────────────────────────────────────────────┐
   Shopify order/create  │                                             │
            │            ▼                                             │
            ▼      ┌───────────┐  auto-checks (address, dup, risk)    │
        [ new ] ──▶│ triage    │──┬──────────────────────────────────┐│
                   └───────────┘  │                                  ││
                                  ▼                                  ▼│
                    ┌──────────────────────┐        ┌───────────────────────┐
                    │ pending_confirmation │        │ incomplete_address    │
                    │ (WhatsApp + call)    │        │ (WA asks for address) │
                    └──────────┬───────────┘        └───────────┬───────────┘
              confirm │  cancel│  no reply                       │ fixed
                      ▼        ▼        ▼                        ▼
               ┌───────────┐ ┌─────────┐ ┌────────────┐   back to pending
               │ confirmed │ │cancelled│ │ no_answer  │
               └─────┬─────┘ └─────────┘ │ (retry x N)│
                     │                   └─────┬──────┘
       dup/high-risk │                         │ exhausted → cancelled
                     ▼                         │
             ┌───────────────┐                 │
             │  review_hold  │ (duplicate or   │
             │  high_risk)   │  high risk)     │
             └───────┬───────┘                 │
        release      │  cancel                 │
                     ▼                         │
             ┌────────────────┐                │
             │ready_to_dispatch│◀──────────────┘ (after re-confirm)
             └───────┬────────┘
                     │ book to PostEx/Leopards
                     ▼
             ┌────────────┐   (courier_orders takes over: in_transit → delivered / returned)
             │ dispatched │
             └────────────┘
```

### State definitions

| State | Meaning | Who works it |
|---|---|---|
| `new` | Just imported from Shopify, not yet triaged | System (auto) |
| `pending_confirmation` | Confirmation flow running (WhatsApp sent, awaiting reply/call) | System + Agent |
| `confirmed` | Customer explicitly confirmed the order | — |
| `no_answer` | Couldn't reach (no WA reply + call unanswered); in timed retry loop | System + Agent |
| `incomplete_address` | Address failed completeness check; WA/agent gathering details | System + Agent |
| `review_hold` | Flagged **duplicate** or **high-risk**; needs a human decision | Agent |
| `cancelled` | Customer cancelled, or unreachable after N attempts | — |
| `ready_to_dispatch` | Confirmed + complete + not-duplicate + acceptable risk | — |
| `dispatched` | Booked to courier; `courier_orders` tracking takes over | — |

**Guard rule (enforced in code):** an order can only be **booked to a courier from `ready_to_dispatch`**. Nothing skips confirmation.

---

## 3. Modules

### Module A — Order Ingestion & Two-Way Shopify Sync

**Pull (Shopify → OMS):**
- **Shopify webhook** `orders/create` → `POST /api/oms/ingest` → insert into `oms_orders` as `new`. Captures **all new orders from go-live forward.**
- Missed-webhook safety net: a cron poll re-pulls recent orders and dedupes by `shopify_order_id`.
- Normalise on ingest: phone (to `+92`/`03xx` canonical), city (map to a canonical city list — reuse the courier city list), COD amount, line items.
- Immediately run **auto-triage** (Module D checks) → route to the right queue.

**Launch backfill (one-time, scoped — NOT full history):**
- On go-live, import only Shopify orders that are **`fulfillment_status = unfulfilled`** and created in the **last 14 days** (configurable). These are the orders that haven't shipped yet — the ones the OMS can still confirm.
- **Do NOT import** already fulfilled / delivered / cancelled / returned orders — the OMS confirms *before dispatch*, so shipped history is noise in the queue.
- **Risk history is separate:** the risk engine reads customer past-return history from the existing `courier_orders` (90-day) + Shopify customer object on demand — it does **not** need old orders imported into `oms_orders`. So risk scoring is fully informed without backfilling history.

**Write-back (OMS → Shopify) — everything we change mirrors to Shopify.** A single `shopifySync(order, change)` helper wraps each write; failures queue for retry (idempotent). After ingest the **OMS is the working copy; Shopify is the mirror + storefront system-of-record.**

| OMS change | Shopify write | API (GraphQL Admin) |
|---|---|---|
| State change | Order tag: `oms-confirmed` / `oms-cancelled` / `oms-no-answer` / `oms-incomplete-address` / `oms-duplicate` / `oms-high-risk` | `tagsAdd` |
| Risk level | Tag `risk-high` + metafield `oms.risk_score` | `metafieldsSet` |
| Address fix | Updated shipping address | `orderUpdate` |
| Agent note | Order note / timeline comment | `orderUpdate` / `timelineSubjectCommentCreate` |
| Cancel | Order cancelled (reason) | `orderCancel` |
| Duplicate link | Tag `duplicate-of-<orderNo>` | `tagsAdd` |
| Dispatch | Fulfillment with tracking # + courier | `fulfillmentCreateV2` |

Required Shopify custom-app scopes: `read_orders, write_orders, write_fulfillments, write_merchant_managed_fulfillment_orders`.

### Module B — Confirmation Engine (the core RTO lever)

Multi-channel, escalating, time-boxed. Mirrors Betalogics' proven flow but tuned for Elyscents.

**Step 1 — Instant WhatsApp (t+0 to 5 min)**
Interactive template with 3 buttons:
> "Assalam o Alaikum {name}! Elyscents here 🌸. We received your order #{order_no} for {items} — COD PKR {amount} to {city}. Please confirm:"
> `[✅ Confirm]` `[✏️ Change Address]` `[❌ Cancel]`

- `Confirm` → state `confirmed`.
- `Change Address` → state `incomplete_address` (Module E).
- `Cancel` → state `cancelled` (reason: customer).
- Received via existing `/api/webhooks/whatsapp`; button payload maps to the action.

**Step 2 — Reminder (t+2–4 h, if no reply)**
Second WhatsApp nudge ("Just confirming your Elyscents order is still on…"). Also pushes the order into the **agent call queue**.

**Step 3 — Agent call / RoboCall (t+4–24 h)**
- Agent opens the order in the **Agent Workspace** (Module C), calls the customer, and records the outcome: `confirmed / cancelled / no_answer / wrong_number / incomplete_address`.
- Optional RoboCall/IVR integration (like Betalogics "1000+ in minutes") for scale — press 1 to confirm, 2 to cancel. Deferred to Phase 4.

**Step 4 — Retry loop for `no_answer`**
- Auto-retry schedule: WhatsApp + call attempts at +6 h, +24 h, +48 h (configurable). Each attempt logged.
- After **N attempts (default 3) with no contact → auto-`cancelled`** (reason: unreachable). This alone removes a large chunk of would-be RTOs (the "customer not home / not reachable" bucket, which your Return Reasons module already shows is significant).

**SLA timers** (cron-driven): every order in `pending_confirmation`/`no_answer` has a next-action timestamp; the cron advances the flow and surfaces overdue orders in red.

### Module C — Agent Workspace (call-center view)

A focused operator screen. Left = queues, right = the active order card.

**Queues (tabs with live counts):**
- 🔴 **Pending Confirmation** (sorted by age, oldest first)
- 📵 **No Answer** (retry due first)
- 🏠 **Incomplete Address**
- 👥 **Duplicates** (needs decision)
- ⚠️ **High Risk** (needs decision)

**Order card shows everything the agent needs at a glance:**
- Customer name, phone (**click-to-call** / click-to-WhatsApp), city, full address (with the **missing pieces highlighted** if incomplete).
- Items, quantities, COD amount.
- **Attention flags** — e.g. `Incomplete address`, `2nd order in 3 days`, `High-return city (Dera Ghazi Khan 47%)`, `High COD value`. This directly answers your requirement: *the agent sees which aspect the order needs attention for.*
- Embedded **WhatsApp thread** (from `messages` table) so the agent sees what the customer already replied.
- Action buttons: `Confirm` · `Cancel (reason)` · `No Answer` · `Mark Address Fixed` · `Send WhatsApp template` · `Add note`.
- Every action writes to `oms_events` (who/what/when/channel) for a full audit trail.

**Agent productivity metrics** (per agent): orders worked/day, confirmation %, avg handle time, cancels vs confirms.

### Module D — Auto-Triage checks (run on ingest + on demand)

Three automated gates that decide the initial queue:

1. **Address completeness** → Module E
2. **Duplicate detection** → Module F
3. **Risk scoring** → Module G

If none trip, the order goes straight to `pending_confirmation`.

### Module E — Address Verification & Completion

**Completeness scoring (heuristic + Claude):**
- Hard checks: phone is a valid PK mobile (`03XXXXXXXXX` / `+92`), address length ≥ threshold, contains a house/street token, city resolves to a known city.
- **Claude pass** (`ANTHROPIC_API_KEY`): classify the address as `complete / vague / missing-landmark / city-only` and extract structured fields (house, street, area, city). Pakistani addresses are messy and landmark-based — a rules-only check is not enough.
- Incomplete → state `incomplete_address` + auto-WhatsApp:
  > "To make sure your Elyscents order reaches you, please share your **complete address** with a nearby landmark (e.g. house #, street, area, city). 🙏"
- Customer's reply is parsed by Claude → fields updated → re-scored → if complete, back to `pending_confirmation`.
- Agent can also fix it manually from the workspace.

**Why it matters:** "Incomplete/incorrect address" (PostEx code **ICA**) is one of your top return reasons — your own Return Reasons module shows Address Issues at ~12% of returns. Catching these *before* dispatch directly removes those RTOs.

### Module F — Duplicate Detection

Flags repeat/accidental orders so you don't ship two.

- **Primary match:** same normalised **phone number** with another order in the last **N days** (default 7).
- **Secondary match:** fuzzy **address + name** similarity (Levenshtein/normalised) for customers who reorder from a slightly different number.
- **Product match:** same SKU(s) → likely accidental double-submit; different SKUs → possibly a genuine second order (surface, don't auto-cancel).
- Outcome: state `review_hold` (reason: duplicate), linked to `duplicate_of`. Agent decides: **merge** (ship one), **cancel one**, or **keep both** (confirm it's intentional).
- **Dispatch effectiveness:** merging duplicates into a single shipment saves a booking + avoids the confusion that causes returns, and lets you combine into one parcel.

### Module G — Risk Scoring (RTO prediction)

A 0–100 score (Low / Medium / High) computed at ingest, using signals you *already have* from Courier Intelligence:

| Signal | Source | Weight (example) |
|---|---|---|
| Destination **city return rate** | Return-by-City module | High |
| Customer's **past return history** (repeat returner / blacklist) | `courier_orders` history by phone | High |
| **First-time vs repeat buyer** | Shopify / order history | Medium |
| **COD value** (high value = higher walk-away risk) | order | Medium |
| **Address quality** score | Module E | Medium |
| **Order channel / time** (e.g. late-night impulse) | Shopify | Low |
| **Product mix** (known high-return SKUs) | Return Reasons by SKU | Low |

- **High risk** → `review_hold`. Agent options: require **extra confirmation**, nudge **COD → prepaid / partial advance** (see Module I), or cancel.
- **Medium** → normal flow but tagged (agent double-confirms address & intent).
- **Low** → normal flow.
- Store `risk_score` + `risk_factors[]` (human-readable, e.g. "City 47% RTO", "2 past returns") so agents understand *why*.

### Module H — Courier Assignment & Dispatch

- Only `ready_to_dispatch` orders are bookable.
- **Smart courier suggestion:** recommend PostEx vs Leopards per order using Courier Intelligence — e.g. pick the courier with the lower return rate / better delivery record **for that destination city**. (Leopards currently far outperforms PostEx on returns; the system can auto-prefer it where it has coverage.)
- **Dispatch = direct courier API, NOT the couriers' Shopify apps.** One-click / bulk "Book to courier" calls **PostEx `create-order`** / **Leopards `bookPacket`** directly (we already integrate both APIs for tracking; we add the create-shipment call). The response returns a tracking number + shipping-label PDF.
  - Why not their Shopify apps: those apps auto-book *whatever is in Shopify*, which bypasses the confirmation gate — the entire RTO-reduction mechanism. We must be the one deciding *which* orders get booked.
- On successful booking: order → `dispatched`, `tracking_number` + `courier` stored, and it flows into the existing `courier_orders` + Courier Intelligence pipeline.
- **Write-back to Shopify:** create a **Shopify fulfillment** (`fulfillmentCreateV2`) carrying the tracking number + courier so the storefront/customer sees "Fulfilled + track". This replaces what the couriers' Shopify apps would have done — we do it ourselves, under our control.
- Dispatch WhatsApp alert to customer with tracking.

> **On needing a Shopify app:** you already have a **custom app** (source of `SHOPIFY_PK_ACCESS_TOKEN`). One custom app covers both *pull* (webhooks) and *write-back* (tags/fulfillment). No public/App-Store app is required. It just needs scopes `read_orders, write_orders, write_fulfillments, write_merchant_managed_fulfillment_orders`.

### Module I — NDR / Re-attempt Management (post-dispatch)

Closes the loop with the tracking enrichment already built.

- The `enrich-tracking` job detects a **failed attempt** (PostEx code `0013`, Leopards attempt status) or an in-transit stall.
- On first failure → **auto-WhatsApp within 30 min**: "Our courier tried to deliver your Elyscents order but couldn't reach you. Reply `1` to reschedule, `2` to confirm address." + push to an **NDR queue** for agent follow-up.
- Industry data: fast NDR intervention converts **30–50% of first-attempt failures** into deliveries.
- Feeds re-attempt instructions back to the courier where the API allows.

### Module J — COD → Prepaid Nudge (optional, high ROI)

- For **high-risk** orders, offer an incentive to prepay (small discount / free shipping) via WhatsApp payment link (JazzCash/Easypaisa/Shopify).
- Prepaid orders have ~0% RTO. Even a 15–20% conversion on high-risk COD meaningfully cuts returns.
- Phase 4+; requires a payment-link integration.

### Module K — OMS Analytics / KPIs

A dashboard tab tying it all together. Core KPIs:

- **Confirmation rate** (confirmed / total) and **time-to-confirmation** (target < 30 min median).
- **Auto-confirm % (WhatsApp)** vs **agent-confirm %** — shows automation leverage.
- **Pre-dispatch cancellation rate** (cancels caught before shipping = money saved).
- **RTO rate** (north star, from Courier Intelligence) — trend line, target < 10%.
- **Incomplete-address rate**, **duplicate rate**, **high-risk %**.
- **NDR recovery rate** (failed attempts converted to delivery).
- **Agent productivity** leaderboard.
- **£ saved** estimate: (prevented RTOs × avg round-trip shipping + COD value protected).

---

## 4. Data model (Supabase)

```sql
-- Core order record
oms_orders (
  id                bigint pk,
  shopify_order_id  text unique,
  order_number      text,
  customer_name     text,
  phone             text,          -- normalised +92 / 03xx
  address_raw       text,
  address_house     text,          -- parsed by Claude
  address_street    text,
  address_area      text,
  city              text,          -- canonical
  address_complete  boolean,
  address_score     int,           -- 0-100
  items             jsonb,         -- [{sku, name, qty, price}]
  cod_amount        numeric,
  state             text,          -- new | pending_confirmation | confirmed | no_answer
                                   --  | incomplete_address | review_hold | cancelled
                                   --  | ready_to_dispatch | dispatched
  cancel_reason     text,
  risk_score        int,           -- 0-100
  risk_level        text,          -- low | medium | high
  risk_factors      jsonb,         -- ["City 47% RTO","2 past returns"]
  duplicate_of      bigint,        -- fk oms_orders.id
  is_duplicate      boolean,
  confirmation_attempts int default 0,
  next_action_at    timestamptz,   -- SLA / retry timer
  assigned_agent    text,
  courier           text,          -- postex | leopards (after dispatch)
  tracking_number   text,
  label_url         text,          -- courier shipping-label PDF
  shopify_fulfillment_id text,     -- for tracking-update write-back
  shopify_synced_at timestamptz,   -- last successful mirror to Shopify
  shopify_sync_error text,         -- last sync failure (retried by cron)
  raw_shopify_order jsonb,         -- SAFETY: untouched original order snapshot on ingest
  confirmed_at      timestamptz,
  dispatched_at     timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz
)

-- SAFETY: global switches (one row). Kill-switch stops Shopify writes instantly.
oms_settings (
  id                        int primary key default 1,
  shopify_writeback_enabled boolean default false,  -- master kill-switch (starts OFF)
  shopify_writeback_mode    text default 'shadow',  -- shadow (log-only) | live
  auto_cancel_to_shopify    boolean default false,  -- false = tag-only (safe default)
  auto_cancel_daily_cap     int default 20,
  updated_at                timestamptz
)

-- Immutable audit log of everything that happened to an order
oms_events (
  id          bigint pk,
  order_id    bigint fk,
  event_type  text,     -- state_change | whatsapp_sent | whatsapp_reply | call | note | risk_scored | address_fixed | booked
  actor       text,     -- system | agent:<name> | customer
  channel     text,     -- whatsapp | call | robocall | system
  from_state  text,
  to_state    text,
  detail      text,
  created_at  timestamptz default now()
)

-- Agents (call-center operators)
oms_agents ( id, name, phone, active, created_at )

-- Confirmation attempts (for retry logic + analytics)
oms_confirmation_attempts (
  id, order_id fk, attempt_no int, channel text,
  outcome text,   -- confirmed | cancelled | no_answer | wrong_number | reschedule
  attempted_at timestamptz, agent text
)
```

Indexes: `oms_orders(state, next_action_at)`, `oms_orders(phone)`, `oms_orders(city)`, `oms_events(order_id)`.

---

## 5. WhatsApp flows (Meta Business API)

Requires **pre-approved template messages** (Meta) for business-initiated messages; interactive **button** replies handled via the existing webhook.

| Template | Trigger | Buttons |
|---|---|---|
| `order_confirm` | on ingest (t+0) | Confirm / Change Address / Cancel |
| `confirm_reminder` | t+2–4 h no reply | Confirm / Cancel |
| `address_request` | incomplete address | (free-text reply → Claude parse) |
| `dispatch_alert` | on dispatch | Track link |
| `ndr_reschedule` | failed attempt | Reschedule / Confirm address |
| `feedback` | on delivery | ⭐ rating |

Webhook maps button payloads → order actions; free-text replies → Claude intent (`confirm / cancel / address / question`) → route.

---

## 6. Technical architecture (fits current stack)

- **API routes** (`app/api/oms/*`): `ingest`, `order/[id]` (get/update), `action` (confirm/cancel/no-answer/fix-address), `book` (dispatch), `queues`, `analytics`.
- **Webhooks:** extend existing `/api/webhooks/whatsapp` + add Shopify `orders/create`.
- **`lib/shopify-sync.ts`** — one helper `shopifySync(orderId, change)` that turns every OMS mutation into the matching Shopify GraphQL Admin write (tags/note/address/cancel/fulfillment). Records `shopify_synced_at`; failures logged to `oms_events` and retried by the cron. Keeps the two-way sync in one place.
- **`lib/courier-book.ts`** — `bookPostex(order)` / `bookLeopards(order)` wrapping PostEx `create-order` + Leopards `bookPacket`; returns `{ trackingNumber, labelUrl }`. Called by `/api/oms/book`, which then calls `shopifySync(...'fulfillment')`.
- **Cron (Vercel):** `oms-tick` every 15–30 min → advances SLA/retry timers, sends reminders, auto-cancels exhausted no-answers, triggers NDR messages, retries failed Shopify syncs.
- **Claude:** address parse + reply-intent classification (batched, cheap — Haiku-class).
- **Frontend:** new top-level **OMS** tab with sub-views: Agent Workspace, Queues, Analytics. Reuse the component patterns from Courier Intelligence.
- **Auth:** agent actions gated by Clerk; each agent identified for the audit log.
- **Shopify custom-app scopes needed:** `read_orders, write_orders, write_fulfillments, write_merchant_managed_fulfillment_orders` (verify on the existing `SHOPIFY_PK_ACCESS_TOKEN`).

---

## 7. Build roadmap (phased, shippable increments)

| Phase | Scope | Outcome |
|---|---|---|
| **P1 — Foundation + Shopify sync** | `oms_orders` + state machine + Shopify ingest + **two-way sync (`shopifySync`: tags/note/cancel)** + Agent Workspace with **manual** confirm/cancel/no-answer + audit log | Team works orders in queues; every edit mirrors to Shopify; every dispatch is confirmed |
| **P2 — WhatsApp automation** | Interactive `order_confirm` template + webhook button handling + reminder + auto-cancel retry loop | Most orders auto-confirm; agents only handle exceptions |
| **P3 — Address + Duplicates** | Completeness check (rules + Claude), incomplete-address queue + WA request, duplicate detection & merge, address write-back to Shopify | Bad-address & double orders caught pre-dispatch |
| **P4 — Risk + Direct Dispatch** | Risk scoring from Courier Intelligence, high-risk hold, smart courier suggestion, **direct PostEx/Leopards booking + Shopify fulfillment write-back** | High-RTO orders intercepted; best courier per city; tracking back in Shopify |
| **P5 — NDR + Prepaid + Analytics** | NDR auto-reschedule, COD→prepaid nudge, full KPI dashboard + £-saved | Closes post-dispatch loop; measurable RTO reduction |

**MVP = P1 + P2** delivers most of the return-rate benefit (confirm-before-dispatch + auto-cancel unreachable).

---

## 8. Success metrics (how we know it worked)

- **RTO rate** ↓ (north star) — target < 10% within 60 days of P2.
- **Confirmation rate** ≥ 85%, **median time-to-confirm** < 30 min.
- **Pre-dispatch cancel rate** — every one is a prevented RTO (pure savings).
- **Incomplete-address catch rate** — % of ICA-risk orders fixed before dispatch.
- **NDR recovery** ≥ 30% of first-attempt failures.
- **Agent throughput** — orders confirmed per agent-hour.

---

## 9. Sources (research)

- Betalogics — E-commerce Automation, Robo-Call order confirmation, order-management flow (Pakistan).
- Pakistan COD RTO benchmarks & WhatsApp-confirmation impact (30–35% → 18–22%).
- Indian OMS (Shiprocket NDR management, Unicommerce/Shipway, risk scoring, COD→prepaid) for NDR + fraud/risk patterns.

*(Full URLs listed in the chat message accompanying this spec.)*
