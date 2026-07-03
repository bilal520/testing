# Elyscents — Counterfeit / Impersonator Hunter (SPEC v1)

**Status: SPEC — not built.** Upgrades the existing text-only counterfeit scan
(`/api/hub/counterfeit/scan`) into a **multi-signal impersonator hunter** that
finds scammers even when they hide your name and product names, builds an
evidence pack, and drives takedowns. Grounded in two real cases (2026-07-03):
**"Elempents Pakistan"** (your logo + your videos + typosquat + Shopify COD) and
**"Flora perfume"** (your face + your videos + `elyscents.store` + your ad copy).

---

## 0. Threat model — what we're detecting

A PK perfume-COD impersonator reliably exposes ≥2 of these six signals. They
evade *one* (e.g. drop your brand from the text), never all:

1. **Stolen creative** — your exact video/image ad, re-uploaded.
2. **Stolen identity** — your **logo** or the **founder's face** as the page profile picture.
3. **Lookalike page name** — typosquat ("Elempents" ≈ Elyscents/Elements) or generic ("Flora perfume").
4. **Lookalike/abusive domain** — `elyscents.store`, `royaloud*.myshopify.com`, anything containing `elyscent`, `royaloud`, `oud`, `salsa`, `zarak`.
5. **Copied offer copy** — "2 perfumes Rs 2,999", "worth 3,700 / save 700-701", "100% money-back", "8–10 hours", "COD all over Pakistan", "gift packaging".
6. **Behavioral** — brand-new page (days old) already running multiple video ads, Shopify landing, COD.

**Rule:** score all six per page → 1 signal = *watch*, 2+ = *confirmed impersonator*.

---

## 1. Architecture (reuse what exists)

Already have: FB **Ad Library API** access (`ads_archive`, works for PK commercial
ads — used by `/api/competitors` + counterfeit scan), which returns page, ad
copy, link URL, and **creative media** (`snapshot{images{original_image_url},
videos{video_preview_image_url,video_hd_url}}`); the `counterfeit_pages` table +
Intelligence tab UI; Claude (`lib/hub/claude.ts`) for vision + synthesis; your FB
ad creatives (`getFbThumbnails`) as the reference set; WhatsApp alerting.

```
                       ┌─────────────── DISCOVERY (wide net) ───────────────┐
 brand+typosquat terms │  Ad Library API (ads_archive)  → candidate ads      │
 offer/price terms     │  + watchlist page_ids          → + page profile pic │
 domain fragments      └───────────────────────┬─────────────────────────────┘
                                                ▼
                       ┌──────────────── DETECTION (score 6 signals) ────────┐
 your creatives (ref)  │ 1 creative pHash + Claude-vision match               │
 your logo + face(ref) │ 2 profile-pic match (logo / founder face)           │
 your name/domains(ref)│ 3 name similarity  4 domain similarity              │
 your offer script(ref)│ 5 copy match       6 behavioral flags → SCAM SCORE   │
                       └───────────────────────┬─────────────────────────────┘
                                                ▼
                       ┌──────────────── HUNT + CLOSE ───────────────────────┐
                       │ counterfeit dashboard (evidence, side-by-side)       │
                       │ status workflow · evidence pack · report links       │
                       │ new-impersonator WhatsApp alert · re-appearance track │
                       └──────────────────────────────────────────────────────┘
```

---

## 2. DISCOVERY — cast the wide net

Meta has **no reverse-image search**, so we can't hand it a video. We enumerate
candidates via `ads_archive` (text + page-id) and then match visually.

- **2.1 Brand + typosquat sweep.** Auto-generate variants of "Elyscents" (edit-distance ≤2, keyboard-adjacent, char swaps, phonetic): elyscent, elyscnts, elscents, elyscents, ellyscents, elysscents, elements perfume, elempents, elyscents pk… Search each in PK.
- **2.2 Offer/script sweep.** The scam copy fingerprints: `"2 perfumes 2999"`, `"actual worth 3700"`, `"save 700"`, `"money back guarantee perfume"`, `"8 to 10 hours"`, `"COD perfume pakistan"`, `"buy 2 perfume 2999"`. These catch scammers who dropped your brand but kept your funnel copy.
- **2.3 Domain sweep.** Pull ads whose `link_url`/caption contains `elyscent`, `royaloud`, `salsa`, `zarak`, `oud`, or `*.myshopify.com` perfume stores.
- **2.4 Watchlist.** Manually-added suspect `page_id`s (seed: Elempents, Flora perfume) — pulled every run via `search_page_ids`.
- **2.5 Product sweep (existing).** "Royal Oud", "Salsa Spirit", "Zarak", "Elyscents".

Each candidate ad → normalize to `{page_id, page_name, ad_id, snapshot_url,
body, link_url, image_url, video_poster_url, start_time}`. Fetch the **page
profile picture** via Graph `/{page_id}/picture?type=large&redirect=false`.

---

## 3. DETECTION — score the six signals per page

For each candidate page (dedup its ads), compute a **scam score 0–100**:

1. **Creative match (weight 35).** pHash each candidate image + video-poster vs your reference-creative pHashes (fast pre-filter); Claude-vision confirms borderline/edited ones ("is this the same ad as any of these Elyscents creatives? robust to crop/watermark/re-encode"). Exact video reuse = top signal.
2. **Profile-pic impersonation (weight 25).** Match the page profile picture vs (a) your **logo** and (b) the **founder's face** (Claude vision / face + logo match). Catches Elempents (logo) and Flora (face).
3. **Name similarity (weight 10).** Normalized edit-distance + phonetic (Metaphone) of page name vs "Elyscents"/"Elements". Flags Elempents; Flora scores 0 (fine — other signals carry it).
4. **Domain similarity (weight 10).** Landing domain contains brand/product fragments, or is a fresh `*.myshopify.com` perfume store. `elyscents.store` → max; `royaloudperfum.myshopify.com` → high.
5. **Copy match (weight 15).** Fuzzy/Claude similarity of ad body vs your known offer script + price points (2999 / 3700 / 700 / money-back / 8–10 hrs / COD).
6. **Behavioral (weight 5).** New page (first_seen within N days) + running ≥2 video ads + Shopify + COD.

**Claude synthesizes** the final verdict + a one-line "why" ("Uses your logo,
runs 3 of your videos, lookalike name 'Elempents', Shopify COD — confirmed
impersonator, 96%"). Tiers: **≥60 confirmed · 30–59 watch · <30 ignore.** Never
flag `OFFICIAL_IDS`.

---

## 4. Reference set (what we match against)

- **Creatives:** auto-pull active ad images + **video thumbnails** from your FB ad accounts (`getFbThumbnails` + video posters); store pHash + URL. Refresh daily. Optional manual "protect this creative" uploads.
- **Identity:** your **logo** (have it: `/elyscents-logo.png`) + 1–3 **founder face** reference photos (manual upload).
- **Brand lexicon:** names (Elyscents, product names), your real domains (elyscents.pk, elyscents.store if yours — NOTE: confirm whether `elyscents.store` is yours or the scammer's), and the canonical offer script/prices.

Stored in `site_settings` / a `cf_reference` table.

---

## 5. HUNT dashboard (upgrade the counterfeit tab)

Per flagged page: profile pic, **side-by-side "your creative vs theirs"**, scam
score + Claude "why", matched signals (chips: logo/face/video/name/domain/copy),
all their ad snapshot links + Library IDs, landing domain, first/last seen, and
a **status workflow**: `new → confirmed → reported → removed → reappeared →
whitelisted`. Sort by score. Filter by signal. CSV/evidence export.

---

## 6. CLOSE — evidence pack + takedown

For a confirmed page, generate a **one-click evidence pack** (PDF/zip):
your original creative vs their stolen one (side by side), their page URL +
profile pic, every Ad Library ID + snapshot, landing domain, and the matched
signals. Then pre-filled report routes (we prepare everything; you submit,
since reports need your login):

- **Meta IP report** (primary — kills the ads): trademark + copyright infringement report for the page/ads (using your creative + logo + face). Link + pre-written text.
- **Shopify abuse/DMCA** (kills the store): the landings are Shopify (`*.myshopify.com`, `elyscents.store`). Shopify aggressively removes COD scam/counterfeit stores. Pre-filled DMCA.
- **Domain registrar** (for `elyscents.store` etc.): trademark complaint / abuse.
- **Meta impersonation report** for the profile using the founder's face.

**Alerts:** WhatsApp/dashboard ping the moment a **new confirmed impersonator**
appears (esp. using your face/logo/video). **Re-appearance tracking:** scammers
respawn under new page names — link new pages to prior ones by shared
creative/domain/copy so you see "Flora perfume is back as X."

---

## 7. Data model (additions)

Extend `counterfeit_pages` with: `scam_score`, `signals` jsonb (`{creative,
profile, name, domain, copy, behavior}` sub-scores), `profile_pic_url`,
`matched_creatives` jsonb (which of yours), `landing_domains` text[], `claude_why`
text, `status` (add `reported/removed/reappeared`), `reported_at`,
`report_refs` jsonb, `cluster_id` (respawn linkage). New `cf_reference`
(your creatives/identity + pHashes) and `cf_watchlist` (`page_id`, note).

---

## 8. Automation

Vercel crons: **discovery+detection sweep** 2–3×/day (`/api/cf/hunt`,
CRON_SECRET) → refresh scores, flag new pages, alert on new confirmed;
**reference refresh** daily (pull your latest creatives). Manual "Hunt now"
button in the tab.

---

## 9. Build phases

- **CF0** — schema + reference set (creatives pHash + logo + founder face + lexicon) + watchlist seed.
- **CF1** — discovery engine (typosquat/offer/domain/watchlist sweeps → candidates + profile pics).
- **CF2** — detection: pHash creative + profile match + name/domain/copy + scoring; Claude synth verdict.
- **CF3** — hunt dashboard (side-by-side evidence, signal chips, status workflow).
- **CF4** — evidence pack + pre-filled Meta/Shopify/registrar reports + re-appearance clustering.
- **CF5** — crons + new-impersonator WhatsApp alerts + tune thresholds.

---

## 10. Honest limitations

- **No image search on Meta** → we can only score ads we can *pull*. The typosquat + offer + domain + watchlist sweeps surface PK perfume-COD scammers well, but it's "wide net + visual match," not "scan all of Facebook." Adding pages to the watchlist as you spot them keeps it sharp.
- **Video matching** starts with the **poster frame** (cheap, catches exact reuse). Full frame-by-frame is a heavier later phase.
- **We prepare reports, you submit** — takedowns require your account/login; the system does the evidence + pre-fill (~90% of the work).
- **Claude-vision cost** is bounded by pHash pre-filtering (only borderline candidates hit Claude).
