# OMS Phase 2 Spec — Fulfillment Pipeline, RTO Defense, Payments, Reports & Telephony

**Status:** SCOPE LOCKED — ready to build on approval · **Date:** 2026-07-02 · Scope: PK store
**One-line goal:** turn the OMS from a confirm-before-dispatch desk into an **end-to-end operations cockpit** — catch repeat returners, convert risky orders to prepaid, run a scan-driven warehouse pipeline, give the ops manager real reports, and (later) put calling + call-QA inside the tool — all aimed at **cutting the return rate**.

### Decisions locked (2026-07-02)
1. **Prepaid payment method:** JazzCash / Easypaisa / bank transfer with **manual mark-paid** (agent verifies proof). No Shopify online-checkout dependency. (§4)
2. **Courier booking:** **API-book** — auto-create consignment + label via Leopards/PostEx APIs at the Booking stage. Requires courier accounts configured for API booking. (§6.2)
3. **Inventory:** **not tracked in Shopify** → Returns Receiving is **reporting + reconciliation only**, no Shopify inventory writes (optional internal stock ledger later). (§7.3)
4. **Telephony:** **local Pakistani provider** (WebRTC/SIP + recording) — specific provider to be shortlisted; architecture is provider-agnostic. (§8)

> Builds on what's already live: full Shopify mirror, confirm-before-dispatch workflow, risk engine (city return rate), Courier Intelligence (PostEx/Leopards data), and the WhatsApp panel. This spec is **additive** and reuses those.

---

## 0. How to read this
Each feature you gave maps to a module (§3–§9). §2 is the new state machine that ties them together. §10 is the data model. §13 is the recommended build order. §14 is the short list of decisions I need from you before building. Where you asked "is there a smarter way?", the answer is called out in a **💡 Recommendation** box.

## 1. Your asks → modules

| # | Your ask | Module |
|---|---|---|
| 1 | Repeat returner → "RTO Customer" tab | **A — RTO Defense** (§3) |
| 2 | "Online Payments" tab (agent forces prepaid) | **B — Prepaid Conversion** (§4) |
| 3 | Move orders back & forth between tabs | **C — Manual routing** (§5) |
| 4 | Mandatory agent notes (esp. on moves) | **C — Notes** (§5) |
| 5 | Ready → Booking → Print CNs → Pack/Scan → Picked | **D — Fulfillment pipeline** (§6) |
| — | Courier selection (Leopards/PostEx) at booking | **D / E** (§6.2) |
| 6 | Reports for the ops manager | **F — Reports** (§7) |
| — | "Return received" → restock | **F — Returns Receiving** (§7.3) |
| — | Which staff tagged which order | **F — Staff audit** (§7.8) |
| 7 | Call from PC + recording | **G — Telephony** (§8) |
| — | Call sentiment / agent-behavior QA | **G — Call QA** (§8.3) |

---

## 2. The new state machine (the backbone)

Today: `new → pending_confirmation → confirmed → ready_to_dispatch → dispatched` (+ `no_answer`, `incomplete_address`, `review_hold`, `cancelled`, `observed`).

**Phase 2 adds two pre-dispatch holding tabs and a post-ready warehouse pipeline:**

```
                       ┌─ rto_hold ──┐        (repeat returner — decide)
new → pending_confirm ─┼─ no_answer   │
                       ├─ incomplete  │
                       ├─ review_hold │
                       ├─ awaiting_payment ─(paid)─┐   (prepaid conversion)
                       └─ confirmed ──────────────┴─→ ready_to_dispatch
                                                          │
   ready_to_dispatch → booking → booked → cn_printed → packed → picked_up → dispatched
                                                                               │
                                                        (courier tracking) → delivered / returned
   returned → return_received → restocked            (inbound returns loop, §7.3)
```

- **New workflow states:** `rto_hold`, `awaiting_payment`, `booking`, `booked`, `cn_printed`, `packed`, `picked_up`, `return_received`.
- **Manual moves** (§5) can push an order between most non-terminal states with a mandatory note; the machine keeps a hard guard that a courier is booked only from `ready_to_dispatch` (unchanged safety rule).
- Each state = one **tab** in the relevant workspace (Agent desk vs Warehouse desk vs Manager reports).

---

## 3. Module A — RTO Customer defense

**Problem:** a customer who previously **refused** a parcel or whose delivery was **marked return** is a high RTO risk when they order again.

### 3.1 What counts as an "RTO customer"
Match the **new order's normalized phone** (`03XXXXXXXXX`) against historical courier parcels where `norm_status = 'returned'`, or `attempted` with a refusal/return reason (we already classify these in `lib/courier.ts`). Optionally also match on name+city as a secondary signal.

Per matched customer we compute an **RTO profile**: lifetime parcels, returns, return rate, last-return date, and the return reasons/cities (Courier Intelligence already has reasons for Leopards + PostEx).

### 3.2 Behaviour
- On ingest / at confirmation time, if the phone has RTO history → set `rto_flag=true` + attach the profile, and route the order to the **RTO Customer tab** (`rto_hold`) instead of straight to pending/confirmed.
- The RTO tab shows each order with: customer, phone, **# past returns / return rate**, reasons, cities, and the current order. The agent then chooses one of:
  1. **Require prepaid** → move to Online Payments (§4).
  2. **Confirm anyway** → move to pending/confirmed (with a note).
  3. **Cancel** (with reason).
- Tiering: e.g. 1 prior return = "caution", 2+ = "high" → high tier could **default** to requiring prepaid.

### 3.3 Data
`courier_orders` return history is the source. Requires a **normalized phone on `courier_orders`** for matching — Leopards exposes `consignment_phone`; PostEx exposes customer phone; we persist a `cust_phone_norm` column and backfill it during the existing courier sync/enrichment. New `oms_orders` fields: `rto_flag`, `rto_return_count`, `rto_last_return_at`, `rto_reasons` (jsonb).

> 💡 This is the single highest-leverage anti-RTO feature: it stops known bad addresses/customers *before* you pay to ship to them again. It composes with the existing city-level risk score (city rate × customer history = combined risk).

---

## 4. Module B — Online Payments (COD → prepaid conversion)

**Goal:** for risky orders, collect payment **before** dispatch, eliminating that order's RTO risk entirely.

### 4.1 Flow (LOCKED: JazzCash / Easypaisa / bank, manual confirm)
1. Agent clicks **"Require prepaid"** on any order → state `awaiting_payment`, order lands in the **Online Payments tab**. (Mandatory note, e.g. "2 prior returns".)
2. Agent sends **payment instructions** — a configurable set of accounts (`site_settings`: JazzCash / Easypaisa / bank IBAN + account title) plus a **per-order reference** (order number) so transfers are traceable. Sent via WhatsApp.
3. Customer pays and shares proof → agent clicks **"Mark paid"**, entering **method + amount + reference/screenshot note** → order advances to `confirmed` → `ready_to_dispatch`. (Optional: a second role verifies large amounts.)
4. If unpaid after a configurable window (e.g. 48h, 2 reminders) → auto-return to `pending_confirmation` or `cancelled` (configurable).

### 4.2 Notes
- Confirmation is **manual by design** — local wallets/bank have no push-confirmation without a gateway, so we do **not** depend on Shopify `financial_status`.
- Future upgrade path (additive, not now): integrate a JazzCash/Easypaisa merchant API for automatic confirmation.
- Optionally add an `oms-paid` Shopify tag for visibility (additive, safe).

### 4.3 Data
`oms_orders`: `payment_required` (bool), `payment_state` (`awaiting`/`paid`/`failed`), `payment_method`, `payment_amount`, `payment_ref`, `payment_link_sent_at`, `paid_at`, `paid_by` (agent). Payment-account details live in `site_settings`.

---

## 5. Module C — Manual routing + mandatory notes

### 5.1 Move between tabs
- A **"Move to…"** control on every order lets an agent send it to another queue/tab (pending, no_answer, incomplete, review, rto_hold, awaiting_payment, confirmed, ready, cancelled).
- Implemented as a `manual_move` action that relaxes the transition guard for agent-initiated moves (system still blocks illegal *automated* transitions and still only books from `ready_to_dispatch`).
- Every move is written to the audit log with **from → to + agent + note**.

### 5.2 Notes (mandatory)
- Each order has a **Notes thread** (already storable in `oms_events` type `note`) shown in the order card.
- A note is **required** (non-empty, enforced client + server) on: manual move, cancel, require-prepaid, confirm-with-RTO-flag, and any hold. Free-text notes can be added anytime.
- Notes are attributed to the agent and timestamped → feed the staff-audit report (§7.8).

---

## 6. Module D — Warehouse fulfillment pipeline

Turns the single "book" step into a scan-driven line. **Two desks:** the Agent desk ends at `ready_to_dispatch`; the **Warehouse desk** owns everything after.

### 6.1 Stages (each a tab in the Warehouse desk)
| Tab | State | What happens | Exit trigger |
|---|---|---|---|
| **Ready to Dispatch** | `ready_to_dispatch` | Confirmed, complete, acceptable risk. Awaiting booking. | Booked |
| **Booking** | `booking`→`booked` | Select orders (single/bulk), pick courier, call courier API to create the consignment → get **CN + label**. | CN assigned |
| **Print CNs** | `booked`→`cn_printed` | Booked parcels with labels; **bulk-print** labels/CNs (one PDF). | Marked printed |
| **Pack / Scan** | `cn_printed`→`packed` | Warehouse **scans each CN** to confirm the physical parcel is packed. | Scanned |
| **Picked by courier** | `packed`→`picked_up`→`dispatched` | Handover to courier; parcel leaves. | Courier pickup |

### 6.2 Booking + courier selection (Module E)
- At **Booking**, choose **Leopards or PostEx** per order or in bulk. The risk engine already recommends the lower-return courier for the destination city — shown as a **suggested default**, agent can override.
- Booking calls the courier API (PostEx create-order / Leopards book-packet) → stores `cn_number`, `label_url`, `courier`, `booked_at`. Writes the Shopify fulfillment (existing `fulfillmentCreateV2`) at pickup so tracking flows to the customer.
- Courier choice is logged → **Courier Selection report** (§7.9).

> ✅ **LOCKED: API-driven booking** (auto CN + label). Credentials are **already in hand** — the existing PostEx token + Leopards api_key/api_password are the same keys used for booking (today they only do reads). The one booking-specific input is a **pickup/origin address** (from each courier portal), which I'll capture via a test booking / quick lookup at build time. We'll validate with a dry-run before go-live and keep a **manual-CN fallback** for any booking that errors.

### 6.3 💡 "Is scanning the smartest option?" — recommendation
Scanning is the right primitive, but do it as **scan-to-pack, not just scan-to-count**:
- The packer scans the **CN barcode on the printed label** (a cheap USB/Bluetooth scanner acts as a keyboard — no special hardware/SDK). The scan:
  1. **verifies** the CN belongs to a booked order (rejects a wrong/duplicate label with a beep),
  2. **pops the pick list** (items + qty + a product thumbnail) so the packer packs the *right* products — this directly cuts "wrong item → return",
  3. marks the order `packed` and stamps `packed_at` + `warehouse_agent`.
- **Don't make pickup a manual scan.** Detect **"Picked by courier" automatically** from the courier tracking status we already poll (booked → picked/in-transit) — with a manual "handed over" fallback + a **handover manifest** (a per-courier list the rider signs). This removes a double-handling step and a source of error.
- Optional later: a **weight check** at pack (scale integration) to catch missing items — highest accuracy, but hardware-dependent; park it.

### 6.4 Data
`oms_orders`: `courier_selected`, `cn_number`, `label_url`, `booked_at`, `printed_at`, `packed_at`, `picked_at`, `warehouse_agent`. (Several already exist: `courier`, `tracking_number`, `label_url`, `shopify_fulfillment_id`, `dispatched_at`.)

---

## 7. Module F — Reports (Operations Manager)

A **Reports** desk (role-gated, §11). Each report: date-range + courier/city/agent filters, on-screen table + CSV/PDF export. Sources noted.

| # | Report | Definition & source |
|---|---|---|
| 7.1 | **Products dispatched** | Per SKU/product: qty dispatched in period. Source: `oms_orders.items` for `dispatched`/`picked_up` in range. |
| 7.2 | **Pack summary** | Parcels packed per day / per warehouse agent. Source: `packed_at`, `warehouse_agent`. |
| 7.3 | **Return received summary** | Inbound returns scanned back + restocked (see §7.3 flow). Source: `oms_returns_received`. |
| 7.4 | **Dispatch summary** | Orders dispatched by day / courier / city. Source: `dispatched_at`, `courier`, `city`. |
| 7.5 | **Return summary** | Returns by reason / city / courier + return rate. Source: Courier Intelligence (`courier_orders`, reasons). |
| 7.6 | **Cancellations (daily, by user)** | Cancels per day by reason + agent. Source: `oms_events` state_change → cancelled + `cancel_reason`. |
| 7.7 | **Courier summary** | Per courier: booked, delivered, returned, return rate, COD collected vs outstanding. Source: `courier_orders` + CPR/payment data. |
| 7.8 | **Staff/General summary** | Which staff tagged/actioned which order; productivity (confirms, cancels, packs, moves per agent). Source: `oms_events.actor`. |
| 7.9 | **Courier selection** | At booking, Leopards vs PostEx split + resulting return rate per courier — proves which courier is better per city. Source: booking log. |

### 7.3 💡 Returns Receiving (the "restock" loop) — recommendation
When a courier sends returns back, don't just eyeball them — run a **Returns Receiving station**:
1. Warehouse **scans the returned CN barcode**.
2. System **auto-identifies** the order + expected items (no manual lookup).
3. Packer marks **condition per item** (good / damaged / missing).
4. **Condition per item** logged to `oms_returns_received` (good / damaged / missing). **No Shopify inventory writes** — you don't track stock in Shopify (locked §14). Good items are recorded as "returned to stock" in the report only; damaged → write-off bucket. *(Optional later: a lightweight internal stock ledger in the dashboard if you ever want counts — additive.)*
5. Order state → `return_received`; feeds the Return-Received report and **reconciles against the courier's return manifest** (catches "courier says returned but never arrived" = the stolen/lost signal you already track).
> Even without Shopify inventory, this closes the operational loop: dispatched → returned (courier) → received (warehouse) → condition-logged, with a full audit + shrinkage detection.

---

## 8. Module G — Telephony (call from PC + recording + QA)

**Feasibility: yes, fully doable.** It's the most complex and the only cost-bearing/consent-sensitive piece, so it's phased last and needs a provider decision.

### 8.1 Calling from the PC (click-to-call) — LOCKED: local PK provider
- A **browser softphone (WebRTC)** embedded in the order card: agent clicks "Call", talks through their **headset**, no desk phone.
- **Delivered by a local Pakistani cloud-PBX / SIP provider** (cheaper local rates + local caller ID). The architecture is **provider-agnostic**: any provider exposing WebRTC/SIP + call recording works.
- **Action item:** I'll shortlist local providers (WebRTC softphone support, call recording, outbound to PK mobiles, API for click-to-call + recording retrieval) and recommend one with pricing before this sub-phase starts. If you already have a preferred provider/PBX, name it and I'll spec directly against it.

### 8.2 Call logging
- Every call → `oms_calls`: order_id, agent, customer phone, direction, start/end, duration, outcome, **recording_url**. Shown on the order timeline + a **"Calls made by agents"** report.

### 8.3 💡 Call sentiment / agent-behavior QA
- Pipeline: recording → **transcribe** (provider STT or Whisper) → **analyze with Claude** → structured result: overall sentiment (positive/neutral/negative), **agent-behavior flags** (rudeness, script adherence, over-promising), customer emotion, and a short summary.
- Stored on `oms_calls`; surfaced as **"Call sentiment by customer"** + a QA queue that **flags negative/agent-misbehavior calls** for the manager to review. Directly addresses "if our agent is misbehaving".
- **Legal/consent:** calls must announce recording ("this call may be recorded"). Add a consent line to the script + store consent flag.

---

## 9. Cross-cutting: notifications & alerts
- Manager alerts (in-app + optional WhatsApp/push): new RTO order over a threshold, negative-sentiment call, payment received, drift/backlog in any pipeline tab.

## 10. Data model (new/changed)

**New tables:**
- `oms_calls` — telephony log + recording + sentiment/QA.
- `oms_returns_received` — inbound return receiving + condition + restock.
- `oms_payments` (or fields on order) — prepaid link lifecycle.
- `oms_roles` / user↔role map — RBAC (or store role in Clerk metadata).

**`oms_orders` new columns:** `rto_flag`, `rto_return_count`, `rto_last_return_at`, `rto_reasons`, `payment_required`, `payment_link`, `payment_link_sent_at`, `paid_at`, `payment_method`, `courier_selected`, `cn_number`, `booked_at`, `printed_at`, `packed_at`, `picked_at`, `warehouse_agent`, `return_received_at`. (`courier`, `tracking_number`, `label_url`, `shopify_fulfillment_id`, `dispatched_at` already exist.)

**`courier_orders`:** add `cust_phone_norm` (for RTO matching), backfilled in sync.

**`oms_events`:** already handles notes + audit; add event types (`manual_move`, `payment_link_sent`, `paid`, `booked`, `printed`, `packed`, `picked`, `return_received`, `call`).

> **DDL / SQL plan (confirmed):** this phase needs new tables + columns and the runtime has no direct DDL access, so **per phase I'll hand you one ready-to-paste, idempotent SQL migration** (`create table if not exists …`, `alter table … add column if not exists …`, ending with `notify pgrst, 'reload schema';`). You paste it once into the **Supabase → SQL Editor** and run it — same simple flow as the Phase 1 schema. I'll keep each migration small and reversible, and only introduce a table when a feature actually needs it (RTO flags/notes ride existing columns; `oms_calls` + `oms_returns_received` get their own tables).

## 11. Roles, permissions & in-dashboard team management (DASHBOARD-WIDE)

**Scope expanded (2026-07-02):** RBAC now covers the **entire dashboard**, not just OMS — every top-level module (marketing, courier, OMS, reports, setup…) is role-gated, and you **add/manage team members from inside the dashboard**. Because it now spans marketing modules too, this is its own workstream (Phase 2-RBAC, can run in parallel with 2a).

### 11.1 Recommended approach (best option for a non-technical admin)
- **Keep Clerk as the identity provider** (already in use) — it securely handles email invites, passwords, and sessions. We do **not** build our own login.
- Add an **admin-only "Team & Roles" page** in Setup that uses the **Clerk backend API** to: **invite a user by email**, assign a **role**, enable/disable them, and (optionally) fine-tune their **module allowlist**. The role + allowed-modules are stored in the user's Clerk `publicMetadata` — no separate users table to maintain.
- On login, the dashboard reads the user's role from the Clerk session and **shows only the modules they're allowed**. **Every API route also checks the role server-side** (hiding a tab is not security — the server enforces it too).
- **Bootstrap:** the founder (elyscentsiq@gmail.com) is the first **Admin**; everyone else is invited from Team & Roles.

### 11.2 Top-level modules that get gated
Markets — **PK / UAE / BD** (ads), **Revenue Intel**, **Competitors**, **Scripts**, **Creative Studio**, **Intelligence**, **Courier**, **OMS** (sub-desks: Agent/Confirm, Warehouse, All Orders), **Reports**, **Setup**, **Notifications**.

### 11.3 Predefined roles → what they unlock (matrix is editable in the UI)
| Role | Unlocks |
|---|---|
| **Admin** | Everything, incl. Setup + Team & Roles |
| **Ops Manager** | OMS (all desks) + Courier + Reports + Notifications |
| **Confirmation Agent** | OMS → Agent/Confirm desk + All Orders (read-only) |
| **Warehouse** | OMS → Warehouse pipeline + Returns Receiving (+ scanning) |
| **Marketing** | PK / UAE / BD + Revenue Intel + Competitors + Creative Studio + Scripts + Intelligence |
| **Analyst / Viewer** | Read-only Reports + Revenue Intel |

- Assigning a role applies its default module set; the Admin can **override per user** with module checkboxes (e.g. a marketer who also needs Reports). 
- So: *add a marketing teammate → assign "Marketing" → they log in and see only the marketing modules*, exactly as you described.

### 11.4 Enforcement & audit
- Layout hides disallowed modules; middleware redirects direct URLs; API routes return 403 for out-of-role calls.
- Role changes + invites are logged (who granted what, when).

## 12. Reused building blocks (no rebuild)
Risk engine (`lib/oms/risk.ts`), Courier Intelligence + `courier_orders` (returns/reasons/CPR), courier clients + status normalisers (`lib/courier.ts`), the Shopify mirror (auto-paid detection, fulfillment write-back), WhatsApp send, `oms_events` audit.

## 13. Recommended build order (ROI-first)

| Phase | Modules | Why first | Effort |
|---|---|---|---|
| **2a** | RTO tab (§3) + Manual routing & mandatory notes (§5) + Online Payments (§4, manual mark-paid) | Biggest RTO reduction, mostly reuses existing data; low new infra (no DDL beyond a few order columns) | S–M |
| **2b** | Fulfillment pipeline (§6): API booking + courier selection + print CNs + scan-to-pack + auto-picked | Operational backbone; needs courier API booking setup | M–L |
| **2-RBAC** | Dashboard-wide roles + Team & Roles admin page (§11) | Can run in parallel with 2a; unlocks safe delegation (marketing/agents/warehouse each see only their modules) | S–M |
| **2c** | Returns Receiving (§7.3) + Reports suite (§7) | Manager visibility + return-condition loop | M |
| **2d** | Telephony (§8): softphone + recording, then sentiment/QA | Highest complexity + cost + consent; do once desk workflow is solid | L |

Each phase ships behind the existing safety model (kill-switch, additive tags, gated sends) and is independently testable before go-live.

## 14. Decisions — RESOLVED (2026-07-02) + still-open

**Resolved:**
1. **Prepaid payment** → JazzCash / Easypaisa / bank, **manual mark-paid** (§4). ✅
2. **Courier booking** → **API-book** auto CN + label (§6.2); prerequisite = courier API booking setup. ✅
3. **Inventory** → **not in Shopify** → Returns Receiving is reporting/reconciliation only, no Shopify restock (§7.3). ✅
4. **Telephony** → **local PK provider** (provider-agnostic WebRTC/SIP + recording); I'll shortlist (§8.1). ✅

**Resolved (2026-07-02, round 2):**
5. **Warehouse scanner** → **USB scanner already owned** → scan-to-pack + returns-receiving confirmed. ✅
6. **DDL/SQL** → I hand you one paste-ready idempotent migration per phase for the **Supabase SQL Editor** (§10). ✅
7. **RBAC scope** → **dashboard-wide**, managed **in-dashboard** via a Clerk-backed "Team & Roles" page; role → module unlock (e.g. Marketing sees only marketing modules). Predefined roles in §11.3, editable per user. ✅

**Still open (needed only when their phase starts):**
8. **Courier pickup/origin config (NOT new credentials):** the existing PostEx token + Leopards api_key/api_password already cover booking — same keys, currently used only for reads. The only booking-specific input is a one-time **pickup/origin address** (PostEx pickup address code; Leopards origin city + registered shipper), which lives in the courier portals. At §6.2 build time I'll fetch/confirm it via a test booking or a quick portal lookup — no action from the founder now.
9. **Team roster:** the actual people + which role each gets (to send Clerk invites) — gates the RBAC rollout. Confirm the §11.3 role→module matrix or tell me what to change.

## 15. Risks & mitigations
- **API booking mis-config → failed shipments:** dry-run mode + validate shipper/pickup before go-live; keep manual-CN fallback.
- **Auto-restock wrong counts:** condition step + manager approval before inventory increment; reconcile vs courier return manifest.
- **Telephony cost/consent:** recording announcement; budget caps; start with a pilot set of agents.
- **Prepaid friction lowers conversion:** apply only to RTO/high-risk tiers, not all orders.
- **Scope creep:** ship 2a first (fastest RTO win), measure return-rate impact, then proceed.
