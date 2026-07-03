# Courier Intelligence — Returns, Cities & Reasons Fix Spec

**Status:** proposed · **Scope:** Courier Intelligence tab (Return Rate, Return by City, Return Reasons) + the data pipeline that feeds them.
**Risk:** low — all changes are read-side analytics + one internal write-ownership fix. **No changes to what we send couriers; nothing customer-facing.**

---

## 1. What the user reported

1. **Return rate is disturbed** — the number in the Returns tab isn't right.
2. **Return by City shows only a few cities**, mostly ones with very few parcels, and **isn't sorted high→low**. Can't tell **which courier is bad in which city**.
3. **Return Reasons aren't working.**

## 2. Evidence (live data, last 45 days — pulled 2026-07-03)

- 14,911 orders in window: 10,797 delivered · 1,677 returned · 942 in-transit · 613 booked · 83 cancelled · 756 other.
- **`last_status_date` (the "return/last-movement date") is NULL for 100% of returns — all 1,677.**
- **`return_reason`:** Leopards = **null for 100%** (896/896). PostEx = populated but a mix of real codes (`Attempt Made: RFD`, `Attempt Made: OPN`) and the placeholder `"-"`.
- **Cities:** 599 distinct raw strings, 369 with ≥3 shipments. Same city is split by letter-case — `Okara`(11) vs `OKARA`(46), `Bhakkar`(15) vs `BHAKKAR`(23), `Shikarpur`(14) vs `SHIKARPUR`(6). PostEx uses **Title Case** (`Karachi`, `Islamabad`), Leopards uses **UPPERCASE** (`MULTAN`, `GUJRANWALA`, `SIALKOT`) → in the combined "overall" view the same city appears twice.
- Returned-parcel booking age: min 3d, **median 29d**, max 45d (censored by the 45-day fetch — older returns are invisible).
- Probing PostEx's live track API for returned parcels returns a **full timeline** with real reasons in the `0013` "Attempt Made" entries (e.g. `RFD(REFUSED TO RECEIVE)`, `OPN(CONSIGNEE WANTS TO OPEN PARCEL)`) and timestamps on every row — so the data we need **exists at the courier**, we're just not keeping it.

## 3. Root causes

### 3.1 ★ THE core bug: the sync clobbers enrichment (breaks return rate AND reasons)
`app/api/courier/sync/route.ts` → `upsertOrders()` runs 4×/day and upserts the **full** row, including three columns that the mapper always hardcodes to empty:
```
return_reason:    o.returnReason,     // mapper → "-" (PostEx) / null (Leopards)
attempt_count:    o.attemptCount,     // mapper → 0
last_status_date: o.lastStatusDate,   // mapper → null
```
The **enrichment** cron (`app/api/courier/enrich-tracking`, 2×/day) fills these from the per-parcel tracking timeline — but the sync overwrites them back to empty every few hours. The code already excludes `is_settled` from the sync for exactly this reason (see the line-80 comment) but forgot `last_status_date`, `attempt_count`, and `return_reason`.

**Consequences:**
- `last_status_date` is always null → in the Return Rate module, `resolutionDate()` for a returned parcel falls back to `booking_date`, so **every return is dated to the day it was booked, not the day it came back**. The "closed in the last N days" window then under/over-counts returns depending on booking timing → the rate looks wrong ("disturbed").
- `return_reason` for Leopards is always null and for PostEx is usually reset to `"-"` → the Reasons module sees almost no usable reasons → everything collapses to **"No Reason Given" / "Other"**.
- `attempt_count` always 0 → weakens Transit Aging and Stolen/Lost signals too (bonus fix).

### 3.2 Analytics fetch window too short for returns
`app/api/courier/intelligence/route.ts` fetches only `booking_date >= 45d`. Returns lag ~29 days median, so a 30-day return window needs parcels booked ~60–75 days ago — which aren't fetched. This censors late returns and biases the rate low.

### 3.3 Return-by-City: no normalization + wrong ranking
`cityRates()`:
- Groups by the **raw** city string → case variants split one city into many (and PostEx vs Leopards casing splits the "overall" view).
- Sorts by **return rate desc** then `.slice(0, 25)` → tiny towns (3 shipped, 2 returned = 66%) float to the top and bury Karachi/Lahore. This is exactly "only a few cities, all with few parcels."
- No **courier-vs-courier per city** comparison, which is what "which courier is bad in which city" needs.

### 3.4 Reasons classifier: placeholder not handled
`classifyReason("-")` → falls through to **"Other"** instead of "No Reason Given". Minor, but adds noise.

---

## 4. The fix

### Fix A — Stop the sync from clobbering enrichment  *(the big one)*
In `upsertOrders()`, **remove `return_reason`, `attempt_count`, and `last_status_date` from the upserted row** (same treatment `is_settled` already gets). Supabase upsert only writes the columns present in the payload, so omitting them leaves enrichment's values intact on existing rows; new rows simply start empty until enrichment runs (within hours).
- Net effect: once this ships and enrichment runs unimpeded, `last_status_date` + real reasons populate across the board — fixing return-rate dating **and** reasons at the source.

### Fix B — One-time backfill + faster catch-up
- Run `enrich-tracking` a few times with a raised `limit` to fill the ~1,677 existing returns quickly (instead of waiting ~2 days at the normal cadence).
- Small hardening in `enrich-tracking`: when a parcel is already `returned` and we successfully read its timeline, always persist the last movement date; if the timeline can't be parsed, stamp `last_status_date = delivery_date ?? booking_date` so a parcel can't get stuck being re-selected forever (prevents null-churn wasting the budget).

### Fix C — Return Rate module (`intelligence/route.ts` + `ReturnRateSection`)
- **Widen the analytics fetch to 90 days** (data already stored) so late returns are visible.
- **Headline = resolution-window rate** (user's choice, 2026-07-03): *"of parcels that CLOSED (delivered or returned) in the last N days, X% were returns."* This becomes reliable once `last_status_date` is backfilled by Fix A/B — the return is dated to when it actually came back, not when it was booked. Keep the booking-cohort rate + by-booking-week table as secondary context.
- Windows: 7 / 14 / 30 days, per courier + overall (unchanged UI, corrected math).

### Fix D — Return by City → "Courier × City" scoreboard (`intelligence/route.ts` + `ReturnByCitySection`)
- **Canonicalize city names** before grouping: uppercase + trim + collapse internal whitespace, plus a small alias map for obvious variants (e.g. KHI→KARACHI, ISB→ISLAMABAD). Apply everywhere city is grouped.
- **New primary view — per-city courier comparison:** one row per city showing, side by side, **PostEx** (shipped / return-rate) vs **Leopards** (shipped / return-rate), so "which courier is bad in which city" is answerable at a glance, with a "worse courier" flag when the gap is material and both have enough volume.
- **Sorting + thresholds:** default sort by **volume (shipped) desc** so the cities that matter lead; add sort toggles for **return-rate** and **COD-at-risk**. For rate-ranking, raise min-shipped (e.g. ≥10) so 1-of-3 noise can't top the chart. Show more rows (e.g. 60) and add a search/filter box.
- Keep COD-at-risk per city.

### Fix E — Return Reasons (`intelligence/route.ts` + `ReturnReasonsSection`)
- Mostly fixed for free by Fix A/B (real reasons now survive). Additionally:
  - Treat `"-"`/empty as **"No Reason Given"** in `classifyReason`.
  - Widen the reasons window to match (looks at returns in the wider window).
  - Optional: split reasons **by courier** (Leopards' high "No Reason Given" is itself a negligence signal worth isolating).

---

## 5. Acceptance criteria

- [ ] After deploy + backfill, `last_status_date` is populated for the large majority of returned parcels (spot-check: not null for >90%).
- [ ] Return Rate headline (booking-cohort) reconciles with a hand count for a chosen week (±1–2 pts), and no longer swings when a sync runs.
- [ ] Return by City default view is sorted by volume, Karachi/Lahore/Islamabad appear at/near the top, and the same city is never listed twice across couriers.
- [ ] A courier×city comparison is visible (PostEx vs Leopards return-rate per city).
- [ ] Return Reasons shows a real distribution (RFD/OPN/refused/etc.), not ~100% "No Reason Given"/"Other"; Leopards reasons populate where the courier provides them.
- [ ] Build green; deployed; no change to any courier-facing behavior.

## 6. Rollout / safety
- All changes are read-side analytics + one write-ownership correction. No new courier writes, no customer messaging, nothing destructive.
- Ship Fix A first (stops the bleeding), trigger the backfill, then ship the module UI changes. Verify on the live dashboard after each.

## 7. Task breakdown
1. **Pipeline:** remove the 3 enrichment-owned columns from `upsertOrders`; harden `enrich-tracking` return-date persistence. Build + deploy. *(Fix A, B)*
2. **Backfill:** run enrichment at raised limit until returns are populated; verify counts.
3. **Return Rate:** widen fetch to 90d, add booking-cohort headline. *(Fix C)*
4. **Return by City:** city canonicalization + courier×city comparison + sortable/thresholds/search. *(Fix D)*
5. **Reasons:** placeholder handling + optional per-courier split. *(Fix E)*
6. Final build, deploy, verify all acceptance criteria on live data.
