# OMS Full-Mirror Spec — "No Gap" between Shopify and the Dashboard

**Status:** APPROVED-SCOPE, ready to build · **Date:** 2026-07-02 · **Author:** OMS build
**Goal in one line:** the dashboard should hold a 100% faithful copy of every Shopify order **from the last 30 days (rolling), any status**, so the OMS "All Orders" view is identical to Shopify Admin for that window — while the existing confirm-before-dispatch workflow keeps running, untouched, on the actionable subset only.

### Decisions locked (2026-07-02)
1. **Market scope:** **PK store only** (`482886-3`, `market='PK'`). Data model carries a `market` column so UAE/BD are additive later.
2. **History horizon:** **rolling last 30 days** (by Shopify `processed_at`). Not full history. → keeps volume small enough that **plain cursor pagination replaces Bulk Operations**.
3. **Pre-OMS backlog:** old **unfulfilled** orders in the window are **`observed` only** — mirrored but never funneled into the confirmation workflow (no WhatsApp/calls). Agents may manually promote a specific one if genuinely pending.

---

## 1. Goal & non-goals

### Goal
- Import **all** Shopify orders regardless of `fulfillment_status` or `financial_status` (unfulfilled, fulfilled, partially fulfilled, cancelled, refunded, closed/archived) and regardless of age.
- Keep the dashboard mirror **continuously in sync** — creates, edits, fulfillments, cancellations, refunds, deletions — with a **drift-healing reconciliation** so there is provably no gap.
- Surface an **"All Orders" view** in the OMS that matches Shopify Admin 1:1, with the OMS workflow state shown as an overlay when relevant.

### Non-goals (explicitly out of scope)
- Do **not** put historical / fulfilled / cancelled orders into the confirmation workflow.
- Do **not** message customers, run Claude address AI, or run risk scoring on mirror-only orders.
- Do **not** change the write-back safety model (kill-switch, additive tags, tag-only cancel stay exactly as they are).
- Not (yet) a Shopify-Admin replacement for editing orders — this is a **read/mirror** first; editing stays as the current narrow, gated write-back.

---

## 2. Core principle — separate the **Mirror** from the **Workflow**

Two concerns that today are fused must be split:

| Concern | What it is | Applies to | Side effects |
|---|---|---|---|
| **Mirror** | A faithful, read-only reflection of a Shopify order (status, money, customer, items, tags, timestamps, raw snapshot) | **Every** order, all history | **NONE** — pure upsert |
| **Workflow** | Confirm-before-dispatch pipeline (`state`, risk, address AI, WhatsApp, write-back) | Only **active** orders (new, unfulfilled, open, recent) | WhatsApp / Claude / risk / Shopify tags |

**One row per Shopify order** in `oms_orders`. Every row always carries the mirror fields. Only rows classified `active` participate in the workflow. This gives the single "identical view" the user wants without a second table to drift.

---

## 3. Current state (grounded in the code today)

- **Pull** — `lib/shopify.ts › listUnfulfilledOrders(days, limit)` hard-filters `fulfillment_status:unfulfilled created_at:>=<since>`, caps at 50, **no pagination**, default window `backfill_days = 14`.
- **Ingest** — `lib/oms/ingest.ts › ingestOrder()` is **workflow ingest**: idempotent *skip-if-exists* (never updates), then duplicate check → Claude address AI (`address-ai.ts`) → risk (`risk.ts`) → assigns a workflow `state` → **fires WhatsApp** → **Shopify shadow-sync tag**.
- **State** — `lib/oms/state.ts`: 9 states (`new → pending_confirmation → confirmed → ready_to_dispatch → dispatched`, plus `no_answer / incomplete_address / review_hold / cancelled`). No concept of "mirror / observed / fulfilled-elsewhere."
- **Idempotency** — `oms_orders.shopify_order_id` is `unique`; existing orders are **skipped**, so a later Shopify change (fulfilled, cancelled, edited) is **never reflected**. ← this is the core "gap."
- **Webhook** — `app/api/webhooks/shopify/route.ts` handles create-type events and **explicitly skips anything not `unfulfilled`**. No `orders/updated`, `orders/cancelled`, `orders/fulfilled`, `orders/delete`.
- **Cron** — `app/api/oms/tick/route.ts` auto-ingests via `listUnfulfilledOrders` (same 50-cap/14-day window) then runs the retry loop (gated on WhatsApp).
- **Queues UI** — `queues/route.ts` returns only non-terminal actionable orders grouped into agent queues. There is **no "all orders" list**.
- **Scope** — everything is wired to the **PK store only** (`shopify_pk_*`, domain `482886-3.myshopify.com`). UAE/BD are separate stores, not yet wired (see §11).

---

## 4. Data-model changes

> **Implementation note (2026-07-02): shipped WITHOUT a DDL migration.** The runtime has no direct Postgres/DDL access (no connection string, no `psql`, no management token), and the 30-day window is small, so the mirror is implemented on the existing schema:
> - **`lifecycle`** is encoded in the existing free-text `state` column via a new value **`observed`** (verified: no CHECK constraint — insert probe succeeded).
> - **All Shopify status/timestamp/total fields** are captured in the existing **`raw_shopify_order` jsonb** (by extending `ORDER_FIELDS`) and derived at read time; change-detection compares `raw_shopify_order->>'updatedAt'`.
> - **Cursors/flags/cutoff** live in **`site_settings`** (seeded).
> - `market` is constant `'PK'`.
>
> The dedicated-column design below (4.1) is kept as the documented target for when DDL access exists / the window widens (adds indexes + cleaner filtering), but is **not** what shipped.

### 4.1 New mirror columns on `oms_orders` (deferred — target design, not shipped)
```sql
alter table oms_orders
  add column if not exists shopify_fulfillment_status text,   -- UNFULFILLED | FULFILLED | PARTIALLY_FULFILLED | RESTOCKED
  add column if not exists shopify_financial_status   text,   -- PAID | PENDING | PARTIALLY_REFUNDED | REFUNDED | VOIDED | AUTHORIZED
  add column if not exists shopify_cancelled_at        timestamptz,
  add column if not exists shopify_closed_at           timestamptz,   -- archived
  add column if not exists shopify_processed_at        timestamptz,   -- Shopify order created/processed time (authoritative order date)
  add column if not exists shopify_updated_at          timestamptz,   -- high-water mark for change detection
  add column if not exists total_amount                numeric,       -- gross order total (not just COD)
  add column if not exists currency                    text,
  add column if not exists market                      text default 'PK',  -- PK | UAE | BD (see §11)
  add column if not exists lifecycle                   text default 'active',  -- active | observed  (see §7)
  add column if not exists mirror_synced_at            timestamptz,   -- last time we refreshed from Shopify
  add column if not exists deleted_in_shopify          boolean default false; -- orders/delete soft-flag

create index if not exists oms_orders_lifecycle   on oms_orders (lifecycle);
create index if not exists oms_orders_ffstatus     on oms_orders (shopify_fulfillment_status);
create index if not exists oms_orders_updated_hw   on oms_orders (shopify_updated_at desc);
create index if not exists oms_orders_market       on oms_orders (market);
```
> **Gotcha (from memory):** after any `alter table`, run `notify pgrst, 'reload schema';` or PostgREST returns `PGRST205` on the new columns. All new columns are nullable / defaulted so no `NOT NULL` backfill trap (cf. the `courier_orders` upsert trap).

### 4.2 New sync-cursor rows in `site_settings`
```
oms_mirror_backfill_cursor      -- Bulk-op id or GraphQL endCursor for the resumable full import
oms_mirror_backfill_status      -- idle | running | complete | error
oms_mirror_incremental_cursor   -- updated_at high-water mark (ISO) for the poll
oms_mirror_last_reconcile       -- ISO timestamp of last drift check
oms_activation_cutoff           -- ISO date; unfulfilled orders BEFORE this are 'observed', not workflow (default = OMS go-live 2026-07-01)
oms_mirror_suppress_side_effects -- 'true' during any mass import → hard-blocks WhatsApp/AI/writeback
```

---

## 5. Ingestion architecture — three layers + reconciliation

Split ingest into two functions:

- **`mirrorOrder(node)`** — NEW. Pure upsert of mirror fields keyed by `shopify_order_id`, with `shopify_updated_at` high-water compare (only writes when Shopify's `updatedAt` is newer). **Zero side effects.** Sets `lifecycle` via the classifier (§7). Never touches WhatsApp / Claude / risk / write-back.
- **`ingestOrder(node)`** — EXISTING workflow ingest, but now **only invoked for orders the classifier marks `active` AND newly entering the workflow.** It calls `mirrorOrder` first (to populate mirror fields), then runs the workflow triage.

### Layer A — 30-day backfill (cursor pagination, no Bulk Ops needed)
With a rolling 30-day window the volume is small, so a simple paginated pull is enough:
1. `orders(query:"processed_at:>=<30d ago>", first:250, sortKey:PROCESSED_AT)` — **no status filter** (all statuses).
2. Page through `endCursor`; `mirrorOrder()` each node (batched upserts).
3. Store `endCursor` in `oms_mirror_backfill_cursor` so a mid-run interruption resumes; typically completes in one request well within the 300s limit.

> Bulk Operations (`bulkOperationRunQuery`) is documented here as the fallback **only** if the window is later widened to full history — not needed for 30 days.

### Layer B — Incremental poll (steady state, closes webhook gaps)
Extend the `oms-tick` cron (already every 2h):
- Query `orders(query:"updated_at:>=<oms_mirror_incremental_cursor>", sortKey:UPDATED_AT, first:250)` with cursor pagination.
- `mirrorOrder()` each; advance the high-water cursor to the max `updatedAt` seen.
- For rows the classifier newly marks `active`, hand to `ingestOrder` (workflow). For rows that transition to fulfilled/cancelled in Shopify, downgrade `lifecycle` → `observed` and, if they were mid-workflow, resolve them (see §7.3).

### Layer C — Webhooks (near-real-time)
Register and handle: `orders/create`, `orders/updated`, `orders/cancelled`, `orders/fulfilled`, `orders/delete` (and `orders/edited`). All route to a single handler that:
- verifies HMAC (already implemented),
- re-fetches the canonical GraphQL node (so normaliser matches backfill),
- calls `mirrorOrder()` always,
- calls `ingestOrder()` only if classifier = `active` and not already in the workflow,
- on `orders/delete` sets `deleted_in_shopify = true` (soft — keeps the audit trail).
> Remove the current "skip anything not unfulfilled" early-return.

### Reconciliation sweep — the actual "no gap" guarantee
Webhooks get missed; polls have windows. A daily reconcile job proves parity:
1. Ask Shopify `ordersCount` (total + per status) and compare to mirror counts per market.
2. If counts differ, walk `orders(sortKey:UPDATED_AT)` ids for the divergent window and upsert any missing/stale rows.
3. Record `oms_mirror_last_reconcile` and expose "in sync / N behind" in the UI (§9).

---

## 6. Side-effect safety (most important section)

The #1 risk of "import everything" is messaging real customers or corrupting Shopify at scale. Hard rules:

1. **`mirrorOrder` can never** send WhatsApp, call Claude, compute risk, or write to Shopify. It is a pure DB upsert. (Enforced by not importing those modules into the mirror path.)
2. **Global suppression flag** — `oms_mirror_suppress_side_effects='true'` is set for the entire duration of any mass backfill; `sendOmsWhatsapp` and `shopifySync` short-circuit to shadow-log while it's on. Belt-and-suspenders on top of the existing `oms_whatsapp_enabled` gate.
3. **Activation cutoff** — unfulfilled orders with `processed_at < oms_activation_cutoff` are classified `observed`, **not** `active`. This prevents blasting confirmation messages to customers whose orders predate the OMS. Agents can manually promote a specific old order into the workflow if genuinely still pending.
4. **Workflow entry is one-way-guarded** — `ingestOrder` still refuses to re-enter an order that already has a workflow `state`; mirror updates never reset workflow state.
5. **Write-back unchanged** — kill-switch (`oms_settings.shopify_writeback_enabled`), additive-only tags, and tag-only cancel remain exactly as shipped. Mirroring is read-only; it adds no new writes to Shopify.

---

## 7. Lifecycle / state model

### 7.1 `lifecycle` (new, top-level)
- **`active`** — participates in the confirm-before-dispatch workflow; `state` drives it as today.
- **`observed`** — pure mirror; `state` is not meaningful (stored as `observed`, a new terminal state). No queue, no transitions, no side effects.

### 7.2 Classifier (runs in `mirrorOrder`)
Given a Shopify order node:
```
if cancelledAt        → observed  (state 'observed', mirror shows "Cancelled")
elif fulfillmentStatus in (FULFILLED, PARTIALLY_FULFILLED, RESTOCKED) → observed ("Fulfilled")
elif closedAt (archived) → observed
elif fulfillmentStatus == UNFULFILLED and open:
        if processed_at >= oms_activation_cutoff → active   (enters workflow)
        else                                     → observed (pre-OMS backlog)
else → observed
```

### 7.3 State machine additions (`lib/oms/state.ts`)
- Add `observed` to `OmsState` as a **terminal** state (empty transitions, `queueFor → null`, `STATE_TAG` omitted/none).
- Allow an active order to be moved to `observed` when Shopify fulfils/cancels it out-of-band (a new system transition `* → observed` used only by the sync layer, logged in `oms_events`). This keeps the mirror honest without agents doing anything.
- Everything else in the state machine is unchanged.

---

## 8. Shopify API strategy & limits

- **Fields to add** to `ORDER_FIELDS`: `updatedAt cancelledAt closedAt processedAt displayFinancialStatus displayFulfillmentStatus`. (Financial/fulfillment already present.)
- **Backfill:** Bulk Operations (async, JSONL, no rate-limit paging). One bulk op per store at a time (Shopify allows a single running bulk query per shop).
- **Incremental/reconcile:** cursor pagination `first:250`, respect the GraphQL cost bucket (1000 pts, ~50/s restore) — throttle/backoff on `THROTTLED`.
- **Vercel:** `maxDuration = 300` (Pro). Backfill is resumable so it never needs to finish in one request. Bulk-op polling is cheap.
- **Idempotency:** upsert on `shopify_order_id`; skip write when `incoming.updatedAt <= stored.shopify_updated_at`.

---

## 9. UI — the identical "All Orders" view

New view in `OmsWorkspaceTab` (tab/toggle: **Queues | All Orders**):
- **Server-side paginated table** (it's all orders — no client-side 1000-cap). Columns: Order #, Date (processed_at), Customer, City, Total, **Payment status**, **Fulfillment status**, Tags, Items count, and an **OMS overlay** chip (workflow state/queue) when `lifecycle = active`.
- **Filters:** payment status, fulfillment status, lifecycle (active/observed), date range, market; **search** by order # / phone / name.
- **Row → detail drawer** reusing `order/[id]` (raw snapshot already stored).
- **Sync header:** "Mirror: N orders · Shopify: M · ✅ in sync / ⚠️ N behind · last reconcile <time>" driven by the reconcile job. This is the at-a-glance "no gap" indicator.
- New API: `GET /api/oms/orders?status=&fulfillment=&lifecycle=&q=&page=` (paginated), plus `GET /api/oms/orders/stats` for header counts. Existing `queues` endpoint stays for the agent view.

---

## 10. Reconciliation & drift detection (detail)

- **Daily cron** (`/api/oms/reconcile`, add to `vercel.json`): compare `ordersCount` per status vs mirror, heal divergences, stamp `oms_mirror_last_reconcile`.
- **On-demand "Resync" button** in the sync header → triggers a bounded reconcile for the visible window.
- **Alert** (optional): if drift > threshold after reconcile, log a `oms_events` system alert / surface in header red.

---

## 11. Multi-market scope

**Locked: PK store only** (`shopify_pk_*`, `482886-3`, `market='PK'` on every row). The `market` column is present so UAE/BD are a purely additive future step (per-store token/domain resolution + a cursor per store) — not built now.

---

## 12. Rollout phases

| Phase | Deliverable | Safety |
|---|---|---|
| **M0** | Schema migration (§4) + `notify pgrst` | additive columns only |
| **M1** | `mirrorOrder()` + classifier + `observed` state; unit-test classifier | no side effects by construction |
| **M2** | Bulk-op backfill (resumable) with `suppress_side_effects` ON; import all PK history | suppression flag + observed default |
| **M3** | Incremental poll in `oms-tick` + high-water cursor; webhooks (create/updated/cancelled/fulfilled/delete) | mirror-only unless classifier=active |
| **M4** | "All Orders" UI + `/api/oms/orders` + sync header | read-only |
| **M5** | Reconcile cron + drift indicator + Resync button | proves parity |
| **M6** | (optional) Multi-market (UAE/BD) | per-store config |

Each phase is independently testable; nothing goes live until the phase's test passes. WhatsApp/write-back gates stay as-is throughout.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Mass-messaging old customers | `mirrorOrder` has no send path; suppression flag; activation cutoff; observed-by-default for history |
| Claude cost blow-up on 10k+ orders | address AI only runs in `ingestOrder` (active + new); never in mirror |
| Shopify rate-limit / timeout on full import | Bulk Operations (async JSONL) + resumable cursor + 300s maxDuration |
| Stale writes overwriting newer data | `updatedAt` high-water compare before any upsert |
| PostgREST 404 on new columns | `notify pgrst, 'reload schema';` in the migration |
| Duplicate rows | upsert on unique `shopify_order_id` (unchanged) |
| Order deleted in Shopify | `orders/delete` → soft `deleted_in_shopify` flag, keeps audit |
| Vercel env token drift | already DB-first (`getShopifyToken`) |

---

## 14. Decisions — RESOLVED (2026-07-02)

1. **Market scope** → **PK only** (`market='PK'`). ✅
2. **History horizon** → **rolling last 30 days** (by `processed_at`). ✅ → simplifies backfill to cursor pagination.
3. **Pre-OMS unfulfilled orders** → **`observed` only** (mirrored, never auto-messaged). ✅

No open decisions remain. Ready to build on approval.

### Implications of "rolling 30 days"
- The mirror is a **rolling window**: the reconcile/poll only guarantees parity for orders with `processed_at` within the last 30 days. Orders naturally age out of the "in-sync" scope (existing rows are kept, not deleted, unless you later choose to prune).
- Since OMS go-live was 2026-07-01, most of the current 30-day window predates it → those unfulfilled orders land as `observed` per decision 3 (correct — they won't be messaged).
- The "✅ in sync / ⚠️ N behind" badge is scoped to the 30-day window.
