# Backstamp — Design Spec

**Date:** 2026-08-09
**Status:** Approved for v1 implementation
**Public name:** TBD. `PyDex` is a codename only and must not ship. "Pyrex" is a live
trademark (Instant Brands, US) and this app is directly about their product; "-Dex"
draws Nintendo's attention independently. Candidates out for community input:
Opalware, Backstamp, Ovenproof, Milkglass, Grail. Ruled out: Shelfie (taken 4x),
Vitrine (live competitor), Hutch (Hutch Games holds marks in this class).

The name appears in exactly one place in code (`shared/branding.ts`). Everything else
reads from it.

---

## 1. What it is

An iOS and Android app for vintage Pyrex collectors. Photograph a dish, the app
identifies it, shows what comparable pieces sell for, and tracks what you own and what
you're hunting.

Three user actions, in order of how often they happen:

1. **Scan** a dish and find out what it is
2. **Mark** it owned or wanted, with a count
3. **Check** what it's worth

Everything else is in service of those.

---

## 2. Data model

The load-bearing decision: **a pattern is not an item.**

Butterprint on a 444 Cinderella bowl and Butterprint on a 501 refrigerator dish are
different collectibles with different values, different rarity, and different eBay
queries. Conflating them breaks pricing and breaks have/want counts.

```
pattern          butterprint
                 name, years_start, years_end, colorway, rarity, notes

form             444-cinderella
                 model_no, family, shape, capacity_qt, dimensions

item             butterprint-444          <- pattern x form
                 slug (stable, canonical), pattern_id, form_id,
                 rarity_override, ebay_query

user_item        user_id, item_slug, status (have|want), quantity,
                 condition, notes

scan             id, user_id, photo_ref, guesses[], confirmed_item_slug,
                 llm_was_right, consented_to_training, created_at

photo            id, item_slug, uploader_id, visibility
                 (attributed|anonymous|private), approved, is_ai_placeholder

price_quote      item_slug, source (sold|active), low, median, high,
                 sample_size, fetched_at
```

`item.slug` is the join key across everything: book-derived catalog records, LLM
guesses, eBay queries, user collections, uploaded photos. It is generated once as
`{pattern-slug}-{form-model-no}` and never changes.

**Not every pattern×form combination exists.** Items are created from known
production records, not by cross-product. An item that isn't in the catalog can be
created by a user at scan time (see §5).

---

## 3. Screens

Three, plus settings.

### Scan (default tab)
Camera viewfinder. **Burst capture of multiple angles without leaving the
viewfinder** — the app prompts for a pattern shot and then a base shot, because the
embossed model number on the base is a far more reliable identification signal than
pattern vision alone.

Results: top 3 candidates with confidence, tap to confirm. "None of these" opens
catalog browse plus a free-text field to name a pattern that isn't catalogued yet.

Offline: scans queue in local SQLite and fire when connectivity returns. This is not
optional — the primary scanning environments are antique malls and thrift stores with
bad signal.

### Collection
Your shelf. Have/want toggle, quantity stepper, and a **total estimated value**
computed as `sum(median_price × quantity)` across items marked *have*, with a separate
want-list total. Both labeled with which price source they came from, because sold
prices and asking prices are different claims and collectors know it.

### Item detail
Photos, pattern history and production years, current price range with source and
sample size, and where the piece sits in your collection.

### Settings
Sign-in state, training-data opt-in toggle, photo visibility default, export.

**There is no admin mode.** The labeling flow *is* the scan flow: scan, see the guess,
confirm or correct. A separate admin build means two UIs to keep in sync forever and
labeling data that flows from only one of them. The three capabilities a cataloguer
needs (burst capture, add-unknown-pattern, offline queue) are the same three a
collector at an antique mall needs. Everyone gets them.

---

## 4. Identification

```
burst photos -> backend -> vision model, catalog list in prompt
             -> top 3 {item_slug, confidence, reasoning}
             -> user confirms or corrects
             -> scan logged (if opted in)
```

The prompt instructs the model to weight the base model number above pattern
appearance when a base shot is present, and to return catalog slugs, never free text.
A guess that doesn't resolve to a known slug is dropped rather than shown.

Fallback when confidence is low across all three: go straight to catalog browse.

---

## 5. Unknown patterns and the AI placeholder

When a user scans something not in the catalog, they name it and a catalog entry is
created immediately with a **generated placeholder image, badged "AI approximation"
in the UI**.

**The placeholder is generated from a written description, never image-to-image from
the user's photo.** If that photo was marked private, image-to-image would launder a
private photo into a public catalog image. The vision model describes the pattern in
words; the image model works only from that description.

Cost is roughly 2–5 cents per pattern, one time, cached permanently. This scales with
the number of patterns that exist, not with users.

The first approved real photo upload replaces the placeholder.

---

## 6. Pricing

**eBay sold data is effectively closed to solo developers.** `findCompletedItems` was
decommissioned Feb 2025; the replacement Marketplace Insights API is Limited Release,
requires Business-level approval, and is reported not open to new users.

Design accordingly:

```
PriceSource interface
  |- SoldCompsSource     third-party sold comps, free tier ~50 req/month
  |- EbayBrowseSource    eBay Browse API, active listings, open access
```

Ship SoldComps for sold data, fall back to Browse (active listings) when quota is
exhausted or an item has no comps. **The app always labels which it is showing**:
"sold, last 90 days" vs "currently listed".

**Aggressive server-side caching is what makes the free tier viable.** Prices attach
to items, not users. There are a few thousand distinct items in existence. One fetch
per item per week serves every user. 50 requests/month is genuinely enough to start,
and makes a paid tier cheap later.

Apply for eBay Marketplace Insights on day one anyway. If access ever opens it drops
into the same interface with no other changes.

---

## 7. Accounts and privacy

**Sign in with Google and Sign in with Apple.** Both, not either — App Store guideline
4.8 requires an equivalent privacy-preserving login whenever a third-party one is
offered, so shipping Google alone gets rejected.

**We store the provider's subject ID and nothing else.** No email, no name, no
profile. Apple's private relay works by default because we never ask for the address.

Collection syncs, but only slugs:

```
user_id  item_slug        status  qty
a3f9..   butterprint-444  have    2
a3f9..   snowflake-045    want    0
```

That is the entire record. Nothing a breach could use to identify anyone. Sync exists
so a phone upgrade doesn't destroy a collection.

### Photo handling

Three visibility states per upload:

- **attributed** — published with the uploader's handle
- **anonymous** — published, no attribution
- **private** — never published; used only for the owner's collection, and for
  training if they opted in

**EXIF is stripped server-side on ingest, before anything touches disk.** This is not
optional. Phone photos carry GPS coordinates, and a public photo of a four-figure
piece with the owner's home address in the metadata defeats the entire point of the
anonymous option.

Public uploads enter a manual review queue. Volume will be small for a long time;
automated moderation is not worth building yet.

---

## 8. Training data

Every confirmed scan writes `(photo_ref, item_slug, llm_was_right)` when the user has
opted in.

**The corrections are worth more than the confirmations.** A rejected top-3 is a
labeled example of precisely what the current model cannot do.

User photos are also the *right* distribution: kitchen lighting, bad angles, half a
dish in frame. A model trained on clean catalog images degrades badly on those.

**Nothing is trained in v1.** This is logging, so the dataset exists when it's wanted.
Rough threshold before a fine-tune is worth attempting: 50–200 images per pattern,
which realistically means the top ~20 common patterns land long before the long tail.

---

## 9. Catalog seeding from books

Facts are extractable, expression is not.

**In:** pattern names, production years, model numbers, colorways, form dimensions,
capacities.
**Out:** the books' photographs and prose, both as catalog images and as training
images. Also out: reproducing a rarity guide's selection and arrangement wholesale, since
a compilation can carry its own protection even when the individual facts do not.

The digitizer is a **one-off script outside the app**: page photos → vision model →
structured JSON → human review → seeds `data/catalog.json`.

---

## 10. Stack

| Layer | Choice | Why |
|---|---|---|
| App | Expo + React Native + TypeScript, expo-router | One codebase, both platforms |
| Camera | expo-camera | First-party, no dev client needed |
| Local DB | expo-sqlite | Offline queue + local collection |
| iOS build | EAS Build | Dev machine is Linux. No Xcode, no iOS Simulator. Hosted macOS runners are the only path. |
| Backend | Hono on Node, SQLite | Thin and stateless-ish; SQLite is enough at this size |
| Hosting | MRDockBox + Cloudflare Tunnel | Docker host already exists, costs nothing. Swap to a VPS when uptime matters. |
| Testing | Expo Go on physical iPhone + Android over LAN | Both devices on hand; no emulator install |

A backend is not optional: eBay credentials, the vision API key, and the image
generation key cannot ship inside a mobile app.

---

## 11. Repo layout

```
shared/types.ts        single source of truth for Item, Pattern, Form,
                       UserItem, Scan, PriceQuote, ApiResponse shapes
shared/branding.ts     app name in exactly one place

app/                   Expo app
  app/(tabs)/          scan, collection, settings
  app/item/[slug].tsx  item detail
  src/theme.ts         design tokens
  src/db.ts            expo-sqlite schema + queries
  src/api.ts           backend client

backend/
  src/index.ts         Hono app
  src/db.ts            SQLite schema
  src/routes/          identify, price, catalog, scans, auth, photos
  src/pricing/         source.ts interface + soldcomps.ts + ebay-browse.ts

data/catalog.json      seeded patterns, forms, items
scripts/digitize-book.ts
```

---

## 12. Out of scope for v1

No marketplace, no social feed, no following, no price alerts, no barcode scanning, no
trade matching, no automated moderation, no model training pipeline, no web app.

Add when there are users asking, not before.

---

## 13. Open items

1. **Public name** — pending community input. Codename does not block implementation.
2. **eBay Marketplace Insights application** — submit before writing final pricing
   copy. If denied, valuation framing changes from "worth" to "currently listed",
   and that must be visible in the UI rather than hidden behind the abstraction.
3. **Trademark search on the chosen name** before any store submission.
