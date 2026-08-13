# PROJECT CONTINUATION DOCUMENT
## Session 1 — 10 August 2026

### 1. PROJECT IDENTITY

- **Project Name:** Backstamp (repo directory is still `~/Documents/Projects/PyDex` — deliberately not renamed)
- **What This Project Is:** An iOS and Android app for vintage Pyrex collectors. Photograph a dish, the app identifies the pattern and form, shows what comparable pieces sell for, and tracks what you own and what you're hunting.
- **Primary Objective:** A collector can scan a dish in a thrift store, get a correct identification, see a real price range, and add it to a have/want list — offline-tolerant, because that is where scanning actually happens.
- **Strategic Intent:** Every confirmed or corrected scan is a labeled training example. The LLM-vision identifier is not a stopgap around a custom model — it is the mechanism that builds the dataset for one. Nothing is trained yet; the logging exists so the option is real later.
- **Hard Constraints:**
  - The name lives **only** in `shared/branding.ts`. Never hardcode it.
  - **Pinned to Expo SDK 56.** The App Store build of Expo Go refuses a project newer than itself, so SDK 57 cannot be tested on a phone.
  - **`item = pattern × form`.** Price and ownership attach to the item, never the pattern.
  - **Never render a bare price** — sold and asking prices are different claims and always carry a source label.
  - EXIF stripped server-side before bytes touch disk; auth stores the provider subject ID and nothing else; sync carries slugs and counts only; AI placeholder images are generated from a written description, never image-to-image from a user photo.
  - No iOS Simulator exists on Linux. Physical phone via Expo Go, or the web preview.

---

### 2. WHAT EXISTS RIGHT NOW

**What is built and working** (verified this session — typechecks, 32 tests pass, iOS bundles, backend boots and serves live requests):

- **Backend** (Hono on Node 26, built-in `node:sqlite`): `/identify`, `/catalog`, `/items/:slug`, `/price/:slug`, `/price/batch`, `/scans`, `/collection` (GET/PUT), `/photos`, `/patterns/unknown`, `/auth/session`. Verified live: `GET /catalog` returns all 379 items, `GET /items/:slug` returns the joined shape, `/collection` correctly refuses unauthenticated requests.
- **EXIF stripping** — hand-written JPEG segment walker, no image dependency. Two tests, one proving an APP1 EXIF segment is actually removed.
- **Pricing** — `PriceSource` interface with SoldComps (sold comps) primary and eBay Browse (active listings) fallback, weekly per-item caching, concurrent-request coalescing, transient failures deliberately not cached.
- **App** (Expo SDK 56, expo-router): scan screen with burst capture and offline queue, collection with have/want and value totals, item detail, settings.
- **Catalog** — 379 items across 33 patterns and 30 forms, with a validator script.
- **Book digitizer** — one-off script, page photos → structured JSON for human review.
- **Web preview** — the app runs in a browser at `npx expo start --web`; screenshots in `docs/previews/`.

**What is partially built:**

- **Identification and pricing have never run against a real key.** Structurally correct, empirically unproven. No Anthropic, SoldComps, or eBay credential has been exercised.
- **Attributed photo uploads** queue with `uploaderHandle: null` — auth deliberately stores no profile, so there is no handle to attribute to. Needs a display name decoupled from identity.
- **Public photo approval** exists as a SQLite column with no review tool.
- **Google sign-in** renders "Not configured" — no `GOOGLE_CLIENT_ID` yet. Apple needs no server-side secret.

**What is broken or blocked:**

- **Nothing has run on a phone.** The whole camera path — burst capture, base-shot prompt, identification round trip — is unvalidated on a device. This is the app's core.
- **Item detail does not render in the web preview.** The web tab shell only routes tab screens, so `item/[slug]` falls back to Scan. `collection.tsx` does `router.push({pathname: '/item/[slug]', ...})`, which should be correct on native — but that is unproven.
- **Image generation provider undecided.** Anthropic has no image API. The code assumes OpenAI `gpt-image-2` behind an interface with a null fallback; unconfigured, catalog entries are created without art.

**What has NOT been started:**

- Any design polish. **This is the next session's entire job.**
- Real tab bar icons (currently the Expo template's two PNGs copied into three slots).
- Rate limiting. `/identify` costs money per call and has no gateway in front of it.
- EAS build configuration; no store submission path exercised.
- Model training (deliberate — logging only).
- A real trademark search on "Backstamp".

---

### 3. ARCHITECTURE & TECHNICAL MAP

**Tech stack:** Expo SDK 56 / React Native 0.85.3 / expo-router / TypeScript strict. Backend: Hono on Node 26 with built-in `node:sqlite` (no ORM, no better-sqlite3). Vision: `claude-opus-5` via `@anthropic-ai/sdk`. Dev host is Linux (CachyOS), so iOS is Expo Go or EAS only.

**Key files:**

```
shared/types.ts        single source of truth, both sides import @shared/types
shared/branding.ts     the app name, in exactly one place
app/src/db.ts          local SQLite: catalog cache, collection, offline scan queue
app/src/api.ts         backend client — every network call goes through it
app/src/bootstrap.ts   seeds the bundled catalog on first launch
app/src/constants/theme.ts   design tokens (see §6 for the direction)
backend/src/app.ts     all routes
backend/src/photos/strip-exif.ts   security-critical, has the test that matters most
data/catalog.json      379 items; bundled into the app via @data alias
```

**End-to-end flow:**

1. App launches → `bootstrap()` seeds the local catalog from the **bundled** `data/catalog.json` if the local version is 0, then refreshes from `/catalog` in the background. A failed refresh is not an error.
2. User photographs the pattern, then (prompted) the model number on the base.
3. Online: `api.identify()` base64-encodes at send time and POSTs to `/identify`. Offline: the scan queues in SQLite as **file URIs, never base64**, and drains when connectivity returns.
4. Backend prompts `claude-opus-5` with the catalog list, instructing it to weight the base model number above pattern appearance and to return catalog slugs only. Guesses that don't resolve to a known item are dropped rather than shown.
5. App shows top 3 with confidence. User confirms or picks "none of these" → catalog browse (works offline) or names an uncatalogued pattern.
6. Confirmation calls `logScan` with `llmWasRight` derived from whether the confirmed slug was the top guess. Photos are sent **only** if the user opted into training.
7. Collection totals batch-fetch quotes via `/price/batch` (chunked at 100 in `api.ts`), each labeled sold vs currently-listed.

**Naming conventions:** `item.slug` = `{patternId}-{form.modelNo}`, e.g. `butterprint-444`. Routes flat in `app/src/app/`. Path aliases `@/` → `app/src/`, `@shared/` → `shared/`, `@data/` → `data/` — configured in **both** tsconfig and `metro.config.js`.

**External dependencies:** Anthropic API (identification), SoldComps (sold comps, ~50 free req/month), eBay Browse (active listings), an undecided image-generation provider, Google + Apple identity providers.

---

### 4. RECENT WORK — WHAT JUST HAPPENED (HIGH PRIORITY)

**Worked on:** everything. This session went from an empty directory to a running, verified draft.

Sequence: brainstormed requirements → wrote the spec → scaffolded Expo + backend → authored the shared contracts myself (`types.ts`, `db.ts`, `api.ts`, `theme.ts`) → dispatched **5 Codex `gpt-5.6-sol` agents in parallel** on disjoint file sets → integrated and verified → named the app → committed.

**Decisions and why — do not undo these without reading the reasoning:**

- **Contracts before agents.** The five agents worked against `shared/types.ts`, `db.ts`, `api.ts`, and `theme.ts`, which existed before they started. That is why their output composed instead of colliding. `AGENTS.md` records the file-ownership table.
- **LLM vision now, custom model later.** These were presented as alternatives; they aren't. Option 1 generates the training set for option 3.
- **No admin mode.** The user asked for a separate labeling app for his wife. The labeling flow *is* the scan flow, so the three things a cataloguer needs (burst capture, add-unknown-pattern, offline queue) shipped to everyone instead of building a second UI to keep in sync.
- **`PriceSource` interface.** eBay decommissioned `findCompletedItems` in Feb 2025 and Marketplace Insights is Limited Release, reported closed to new developers. Verified this session by search — do not assume sold comps are available.
- **Aggressive price caching.** Prices attach to items, not users; a few thousand items exist; one fetch per item per week serves everyone. This is what makes a 50-request/month free tier viable.
- **Catalog bundled into the app.** Found late: `syncCatalog` only ran from a Settings button, so a fresh install had an empty catalog and confirming a guess would fail — the app would look broken to the first person who opened it. 108KB of JSON now ships in the bundle.
- **Downgraded SDK 57 → 56.** Not cosmetic: `react-native`, `expo-router`, and every Expo package moved. Forced by Expo Go refusing a project newer than itself.
- **Named Backstamp.** A backstamp is the mark on a piece's underside that identifies it — literally what the app reads. Shelfie/Vitrine/Hutch were each ruled out for specific verified reasons (see §5).

**What changed in the system:** repo went 0 → 2 commits, ~70 source files. Two commits: `02420e3` (everything) and `9bc0e2b` (project CLAUDE.md).

**Discussed but NOT implemented:** a Reddit post asking r/PyrexLove for name suggestions was drafted and given to the user; the name came back as Backstamp. Model training discussed at length, deliberately deferred to logging only.

**Open threads:**

- Image generation provider (OpenAI / Google / Flux via fal).
- Whether `item/[slug]` navigation actually works on device.
- Attributed-upload handle: where does a display name live if auth stores no profile?
- eBay Marketplace Insights application — worth submitting; approval latency is weeks.

---

### 5. WHAT COULD GO WRONG

**Known bugs/issues:**

- Item detail unreachable in the web preview (web tab shell limitation, not a broken screen).
- Tab icons are placeholders and look wrong on purpose.
- No rate limiting on `/identify` — a loop or a leaked URL costs real money.

**Edge cases to watch:**

- Collections over 100 items: `/price/batch` caps at 100 server-side; `api.ts` chunks. If a caller bypasses `fetchPrices`, that cap returns.
- Partial price-batch failure fails the whole total deliberately — a silently-low collection value is worse than one that says it failed.
- Unpriced items are excluded from totals, not counted as zero, and the UI must say so.
- Offline scan queue retries; `bumpScanAttempts` exists but the retry ceiling should be reviewed against real flaky-network behavior.

**Technical debt / shortcuts (all marked `// ponytail:` or documented):**

- Tab icons copied from the template.
- `backend/README.md` lists six honest limitations under "Unfinished or constrained" — read it.
- Auth provider JWKS verification is implemented but has never run against a real token.
- The web preview needed `.wasm` in Metro `assetExts` and COOP/COEP headers for `expo-sqlite`; `expo-secure-store` has no web implementation, so web runs signed out by design rather than falling back to `localStorage`.

**Assumptions that could be wrong — flag these before relying on them:**

- **That `item/[slug]` navigates on device.** Unproven.
- **That the identification prompt actually produces good top-3 results.** Never run against a real key. The whole product rests on this.
- **That SoldComps' free tier and response shape match what the code expects.** Written from documentation, not from a live response.
- **That Expo Go still can't run SDK 57.** True on 2026-08-09. Re-check `npm view expo dist-tags` before assuming.
- **That the catalog's 379 items are accurate.** Web-sourced production data; uncertain fields were deliberately left null, but nothing has been checked against the user's reference books.

---

### 6. HOW TO THINK ABOUT THIS PROJECT

**1. Core pattern and why.** `item = pattern × form` is the spine, and everything joins on `item.slug`. Collectors don't own "Butterprint" — they own a Butterprint 444 Cinderella bowl, which is a different object at a different price from a Butterprint 501 refrigerator dish. Conflating them breaks pricing, the eBay query, and have/want counts simultaneously. The second pattern is **honest labeling**: the app never shows a number without saying what kind of claim it is, because eBay closed sold data and asking prices are a weaker claim that collectors would otherwise be misled by.

**2. Most common mistake a new person would make.** Treating a passing `tsc` as evidence the app works. `tsc` reads tsconfig `paths`; Metro does not. Run `npx expo export --platform ios` after touching `shared/` or `data/`. The parallel mistake is trusting green tests over having actually run something — three real bugs this session (empty first-run catalog, file URIs sent where base64 was needed, the 100-slug cap) all survived a fully green suite and were caught by reading integration points and booting the server.

**3. What looks refactorable but should NOT be touched.** The four privacy measures look like over-engineering for an app with no users: EXIF stripping, storing only the provider subject ID, sync carrying slugs and counts only, and generating placeholder images from a written description instead of image-to-image. Each is load-bearing. Rare Pyrex runs to four figures, and owners reasonably don't want it known they have one — that is what the anonymous and private options are *for*, and every one of those four measures is what makes them true rather than decorative. A photo with GPS in it defeats "anonymous" entirely. Also do not "simplify" `PriceSource` down to one implementation; the fallback exists because the primary source is a free tier that will run out.

---

### 7. DO NOT TOUCH LIST

- Do NOT refactor stable, working systems without being asked.
- Do NOT redesign architecture unless explicitly instructed.
- Preserve existing naming conventions (`item.slug` = `{patternId}-{modelNo}`).
- Maintain previously chosen tradeoffs — they were chosen for reasons documented above.
- Ask before introducing new frameworks, libraries, or dependencies.
- **Do NOT upgrade Expo past SDK 56** without checking `npm view expo dist-tags`. It breaks phone testing.
- **Do NOT hardcode the app name** anywhere but `shared/branding.ts`.
- **Do NOT weaken the four privacy measures** in §6.3.
- **Do NOT render a price without its source label.**
- **Do NOT rename the repo directory** (`Projects/PyDex`) — deliberate.
- Do NOT redeclare a type that lives in `shared/types.ts`.
- Do NOT commit `.env`. `.env.example` is the committed template.

---

### 8. CONFIDENCE & FRESHNESS

| Section | Confidence | Note |
|---|---|---|
| 1. Project identity | ✅ HIGH | Name decided by user this session; constraints verified |
| 2. What exists — "working" | ✅ HIGH | Typechecks, 32 tests, iOS bundle, live HTTP all run this session |
| 2. What exists — "blocked" | ✅ HIGH | Failures observed directly, not inferred |
| 3. Architecture | ✅ HIGH | Written and verified this session |
| 4. Recent work | ✅ HIGH | This session |
| 5. Known bugs | ✅ HIGH | Each observed |
| 5. Assumptions | ❓ LOW | **Explicitly the unverified list — validate before relying on any of it** |
| 6. Design philosophy | ✅ HIGH | Decisions made and reasoned this session |
| Catalog data accuracy | ⚠️ MEDIUM | Web-sourced, validator passes structurally, contents unchecked against books |
| Identification quality | ❓ LOW | Never run against a real API key |
| Pricing integration | ❓ LOW | Written from docs, never run against a live response |

---

## Next session: design polish

The user's directive: *"backstamp is the name now, next session is going to be a polish pass to make this more like a modern app, it's pretty ugly right now."*

**Where the design currently stands.** `app/src/constants/theme.ts` holds a complete token set — warm-neutral palette, type scale, 4pt spacing, radii, per-platform elevation, rarity rank colors. Every screen already reads from it, so a palette or scale change propagates. The stated direction: vintage Pyrex is turquoise, pink, orange and gold on milk-white glass and it is *loud*, so the chrome recedes to warm neutrals with a single accent and lets the dishes carry the color. Rarity is the one place loud color is correct, because it's a rank read at a glance.

**Honest assessment of why it looks unfinished:** correct tokens, no craft. Flat cards, no visual hierarchy beyond font size, no motion, no empty-state illustration, placeholder tab icons, and — most importantly — **no photography anywhere**, which is fatal for an app about beautiful objects. There is also no real type personality; it's system fonts at different sizes.

**Suggested order:** tab icons → item detail (the screen that should sell the app) → collection density and hierarchy → scan flow polish → motion last. Look at `docs/previews/` for where it started.

**Practical notes for that work:** the web preview (`npx expo start --web`) gives fast iteration and screenshots, but cannot judge the camera flow, native tab bar, or `item/[slug]`. Verify on a phone. The `refero-design` skill is the project's default for UI work and was deliberately not invoked this session — the build had to exist first.
