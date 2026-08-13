# PROJECT CONTINUATION DOCUMENT
## Session 4, 11 August 2026

### 1. PROJECT IDENTITY

- **Project Name:** Backstamp (repo directory is still `~/Documents/Projects/PyDex`, deliberately not renamed)
- **What This Project Is:** An iOS and Android app for vintage Pyrex collectors. Photograph a dish, the app identifies pattern and form, shows what comparable pieces sell for, and tracks what you own and what you are hunting.
- **Primary Objective:** A collector can scan a dish in a thrift store, get a correct identification, see a real price range, and add it to a have/want list. Offline tolerant, because that is where scanning happens.
- **Strategic Intent:** Every confirmed or corrected scan is a labeled training example. The LLM identifier is the mechanism that builds the dataset for a custom model later. Nothing is trained yet; the logging exists so the option stays real. **As of this session the storage side of that is finally complete and replayable.**
- **Business model:** free app with one advert plus a one off payment. $3 buys ad removal AND a scan allowance, with consumable top ups, plus a monthly free scan quota for everyone. Ad removal and scan capacity stay **separate SKUs** even when bundled.
- **Hard Constraints:**
  - The name lives **only** in `shared/branding.ts`.
  - **Pinned to Expo SDK 56.** The App Store build of Expo Go refuses a newer project.
  - **`item = pattern x form`.** Price and ownership attach to the item, never the pattern.
  - **Never render a bare price**, a colorway swatch without its mark, or a generated image without its badge.
  - EXIF stripped server side; auth stores the provider subject ID only; sync carries slugs and counts only; AI placeholders come from a written description, never image to image.
  - **The design reference lock** in the header of `app/src/constants/theme.ts`. A blur radius anywhere is a bug.
  - **An invented item slug must never reach the caller.** Two layers, both proven by measurement.
  - No iOS Simulator on Linux. Physical phone via Expo Go, or the web preview.
  - **No em dashes anywhere.**

---

### 2. WHAT EXISTS RIGHT NOW

**Built and working** (verified this session: both typechecks clean, backend 40 + app 18 + scripts 17 tests pass, iOS export green, all committed and pushed through `fe48212`):

- **Backend** (Hono on Node 26, built in `node:sqlite`): `/identify`, `/catalog`, `/items/:slug`, `/price/:slug`, `/price/batch`, `/scans`, `/collection`, `/photos`, `/patterns/unknown`, `/auth/session`.
- **Identification on `gemini-3.1-flash-lite`** over REST. `describePattern` and image generation stay on `claude-opus-5`.
- **All thirteen screens** rebuilt against the Harvest File lock in session 3, plus a new Sources group in Settings.
- **Image downscaling, at the choke point.** All four base64 encode sites in `app/src/api.ts` route through one `encodeForUpload(uri, maxWidth)`. Model inputs 1024px, contributed catalog photos 2048px.
- **Rate limiting** on the three paid routes.
- **Replayable scan storage**: `scan_photos` table, `has_base_shot` column, whole burst stored instead of `photos[0]`.
- **`scripts/eval-scans.ts`**, the replay harness.
- **`scripts/shelf-probe.ts`**, the throwaway multi detect experiment. It has served its purpose.
- **CMoG attribution** in Settings with a verified link, and six date corrections.
- **Catalog**: 379 items, 33 patterns, 30 forms, `catalogVersion` now 2.

**Partially built:**

- **Pricing has never run against a real key.** No SoldComps or eBay credential exercised.
- **Identification has run for real** on a handful of test images and one shelf photo. Still not an evaluation.
- **The eval set has a collector and a replayer but no data.** Zero labeled scans exist.
- **Attributed photo uploads** still queue with `uploaderHandle: null`.
- **Google sign in** renders as an honest "not configured in this build" row.

**Broken or blocked:**

- **Nothing has ever run on a phone.** Camera path, native tab bar, all motion unvalidated on a device. This has now survived four sessions and is the largest unknown in the project.
- **Populated collection screens still not visually confirmed.** The backend was down again during this session's work; nobody has seen rows, tiles, file tabs or the small swatch mark rendered.
- **`item/[slug]` still cannot be seen in the web preview** without the temporary fourth `TabTrigger` trick.
- **Shelf photo bulk import does not work.** Measured, documented, see section 4.

**Not started:**

- Batch collection import of any kind. Rapid add from the All tab and the paste a list path are both still unbuilt.
- CSV import.
- Bulk CMoG data ingestion (this is a named directive for next session).
- EAS build configuration; no store submission path exercised.
- Model training (deliberate, logging only).
- A real trademark search on "Backstamp".

---

### 3. ARCHITECTURE & TECHNICAL MAP

**Tech stack:** Expo SDK 56 / React Native 0.85.3 / expo-router / TypeScript strict. Backend Hono on Node 26 with built in `node:sqlite`. Identification `gemini-3.1-flash-lite` over REST; description and image generation `claude-opus-5` via `@anthropic-ai/sdk`. Dev host is Linux.

**Key files:**

```
shared/types.ts                       single source of truth, both sides
shared/branding.ts                    the app name, in exactly one place
app/src/constants/theme.ts            tokens AND the reference lock, read the header
app/src/constants/colorways.ts        prose colorway -> figure/ground hex
app/src/api.ts                        every network call, and encodeForUpload
app/src/features/collection/collection-ui.tsx   shared primitives
app/src/features/scan/scan-screen.tsx           container: state, effects, phase switch
backend/src/identify.ts               identifyPrompt + geminiGuesses/anthropicGuesses
backend/src/rate-limit.ts             abuse control, NOT the scan quota
backend/src/db.ts                     schema, scans + scan_photos
scripts/eval-scans.ts                 replay harness
scripts/shelf-probe.ts                the failed experiment, kept as evidence
docs/2026-08-10-shelf-photo-probe.md  why the shelf idea died
```

**End to end flow:**

1. Bootstrap seeds the bundled catalog into local SQLite, then refreshes from `/catalog`. A failed refresh is not an error.
2. User photographs the pattern, then the base. Offline queues **file URIs, never base64**.
3. `identify()` resizes to 1024px and posts base64 at send time. The backend builds one prompt and calls Gemini with a `responseSchema` whose `itemSlug` is an enum of all 379 slugs.
4. `resolveGuesses` filters against the slug set as a second layer, then a `CONFIDENCE_FLOOR` of 0.5 drops weak guesses.
5. App shows the top 3. Confirmation calls `logScan` and `setOwnership`.
6. `logScan` posts every photo in the burst plus `hasBaseShot`. With consent, the backend writes each photo and a `scan_photos` row per ordinal.
7. `scripts/eval-scans.ts` can later replay any stored scan under the exact conditions it ran.

**Naming:** `item.slug` = `{patternId}-{form.modelNo}`. Routes flat in `app/src/app/`. Aliases `@/`, `@shared/`, `@data/` in both tsconfig and `metro.config.js`.

**External dependencies:** Gemini API, Anthropic API, SoldComps, eBay Browse, an undecided image provider, Google and Apple identity.

---

### 4. RECENT WORK, WHAT JUST HAPPENED (HIGH PRIORITY)

**Method:** the user directed mid session that Claude must **orchestrate Codex agents in visible terminals and never implement directly**. Eight Codex agents were dispatched via `codex exec` into Ghostty windows, on disjoint files, with the shared contract written into each prompt before dispatch. No two agents collided. Prompts and logs live in the session scratchpad.

#### Cost and safety work

- **Image downscaling was put at the choke point, not the capture sites.** All four base64 encodes in `api.ts` now go through one `encodeForUpload`. This caught a third capture path in `item/[slug].tsx` that was passing no options at all and would have been missed by fixing only the scan screen. Two bounds: 1024px for model inputs, 2048px for contributed catalog photos, because a catalog photo is the artifact itself rather than a model input. Scans kept for training use the model bound deliberately, so a replayed scan is what the model actually saw.
- **`identifyPrompt` was reordered.** A variable `hasBaseShot` sentence sat in front of the roughly 11,000 token catalog block, so no prefix cache could ever hit. Catalog and fixed instructions now form the prefix, variable text last.
- **Gemini caching researched properly.** The handoff's instruction to "add `cache_control`" was provider mismatched, since that is Anthropic's parameter. Gemini implicit caching is automatic, needs no `cachedContents` call, and bills cached text at $0.025/M against $0.25/M, a 90% discount. Explicit caching adds $1.00 per million tokens per hour of storage, which is why implicit is right. The minimum token threshold is genuinely UNKNOWN for this endpoint (Google Cloud says 4,096 for Gemini 3, Firebase says 1,024 for Flash) but does not gate us, since the catalog block clears both.
- **Rate limiting on the three paid routes.** `/identify` 30/min, `/scans` 12/min, `/patterns/unknown` **2/hour** because it makes two Opus calls including image generation. Fixed window with lazy eviction. **Client identity is a trust boundary:** socket remote address by default, `X-Forwarded-For` trusted only when `TRUST_PROXY_HEADER=true`, with a test asserting two different spoofed headers from one socket share a bucket. A limiter that trusts a forgeable header is worse than none, because it still looks like it works.
- **This is abuse control, NOT the scan quota.** Nothing here is named quota, allowance or credits, deliberately, so a later agent does not confuse the two.

#### The eval set became possible

- `/scans` was discarding all but `photos[0]` and not recording `hasBaseShot`. Both are now fixed: a `scan_photos(scan_id, ordinal, file_ref)` table, a `has_base_shot` column, an **additive guarded `ALTER TABLE`** so an existing dev database keeps its rows, and `listTrainingScans()`.
- `scripts/eval-scans.ts` replays stored scans read only and reports top-1, top-3, the no guess miss rate, mean confidence on hits and misses separately, and run to run agreement against what was stored.
- **The scan flow's confirm/correct step was already a labeling tool.** The user spotted this before Claude did. Nothing new had to be built for labeling, only for storage and replay.

#### CMoG, resolved

- The actual reply was read this session, ending three sessions of hedging. Verbatim: recognition as a source and a link would be appreciated, "but as the information is not copyrighted material (unless you were including screenshots of pages or direct quotations of chunks of the website text that we wrote), no license or permission is necessary." **This is stronger than a grant and cannot be revoked, because they are saying no license was ever needed.**
- **Carved out and still not permitted:** screenshots of their pages, and direct quotations of chunks of their text. **Not covered at all:** their photographs, and the Pyrex pattern artwork, which is Corning's or Instant Brands' rather than CMoG's to license.
- **Outstanding obligation:** Suzanne Abrams Rebillard asked to be sent the link once the app is live.
- Settings now has a Sources group crediting the Pattern Library, scoped to **pattern names and production dates**, not the whole catalog, because CMoG's library carries no model numbers and an overstated attribution breaks the same honesty rule as an unlabelled price.
- **Six date corrections landed and one was deliberately reverted.** An audit agent checked every colorway page rather than one, which confirmed `primary-colors` (1945 to 1949 across all four colorways) and `atomic-eyes` (CMoG's "Eyes" is the same Hot N Cold 401/403 pattern). **`dots` was reverted to 1968**, because CMoG contradicts itself: its structured manufactured date field says 1969 while its page text says the first bowls shipped in 1968. Our original value already matched their prose, so there was no positive reason to change it.

#### The shelf photo experiment, and it failed

The user asked for bulk import from one shelf photo. One real photo of the collection, 5712x4284, EXIF and GPS stripped before it went anywhere near Google. Three calls, about two cents total.

- **The model does not read the shelf. It emits canonical nesting sets.** Every stack came back as a complete 441/442/443/444 or 401/402/403/404 set regardless of how many pieces were there.
- **The `visibleEvidence` field caught it.** Requiring the model to say what it saw, in the same row as the slug, exposed rows where `spring-blossom-green-444` carried the evidence "extra large round bowl, **solid orange**". Spring Blossom Green is green and white. It contradicted itself inside one row at 0.80 to 1.00 confidence.
- **High confidence, wrong, and self refuting is the worst combination** for a workflow whose premise is that a human corrects the misses. A wrong answer that looks right never gets corrected.
- Roughly 40 to 50 pieces visible, best run returned 24, most of those template artifacts. The entire right half of the shelf produced nothing.
- **Zero false positives on non Pyrex.** Figurines, owl shakers, stoneware plates, camera, magazine files all left alone. Abstention held.
- **The measurement that matters most: image input tokens were 1064 at 5712px, 2048px and 1024px alike.** Gemini downsamples to the same tile budget regardless. So the 24/17/12 detection spread was run to run noise, not a resolution effect, and the 1024px downscale costs nothing in what the model sees. This is now a rule in CLAUDE.md so nobody raises the bound expecting accuracy.

#### Discussed but not implemented

- **Move `visibleEvidence` into the real `/identify` path as a self check.** `colorways.ts` already parses a pattern's prose colorway into the colors it names, so "solid orange" against a slug whose colorway parses to green and white is a detectable contradiction, droppable before the user sees it. This would be a fifth enforcer alongside `PriceFigure`, the swatch mark, the AI badge, and the slug enum. **This is the single highest value idea to come out of this session and it costs one output field.**
- Batch import by rapid add and by pasted list, both still unbuilt.

**Open threads:**

- Whether `CONFIDENCE_FLOOR` should apply to base only scans.
- The have/want exclusivity in `UserItem`.
- Image generation provider.
- Whether the catalog needs a per row provenance field. It has none, so there is nowhere to record that CMoG disputes itself on Dots. An agent was explicitly told not to invent one.

---

### 5. WHAT COULD GO WRONG

**Known bugs and issues:**

- **`UserItem` carries one `status`, so have and want are mutually exclusive.** Starring an owned piece moves it off the have list and drops its quantity. The item detail footer draws both controls side by side, which exposes it. Fixing it is a schema change in `shared/types.ts` and `db.ts`.
- **The NEW tag re-fires on quantity change.** `user_items` has `updated_at` and no `created_at`.
- **Confidence is unstable run to run** (0.85 vs 0.33 on identical input, and the 24/17/12 spread this session).
- **The catalog collapses colorway variants CMoG splits.** `butterprint` maps to four CMoG entries, `dots` to four. `Pattern.colorway` holds one string, so this is a modelling question before a data one. It nearly caused a bad date correction this session.
- Screen 3's footer gradient is native only; `react-native-web` 0.21 does not implement `experimental_backgroundImage`.
- Bottom sheet elevation does not exist in the token set, so the already owned sheet has no offset.

**Edge cases:**

- Collections over 100 items: `/price/batch` caps server side, `api.ts` chunks.
- Partial price batch failure fails the whole total deliberately, and the UI says so.
- Unpriced items are excluded from totals rather than counted as zero.
- `parseColorway` returns null for anything unrecognised. The test "every pattern shipped in the catalog parses" is the guard, and it must never be weakened to make a data change pass.
- The tab bar is native and the scan screens cannot reach it, so every pinned footer clears it by hand via `TAB_BAR_CLEARANCE`. **If the route is later made to hide the bar, drop that constant to 0 or the screens gain 78pt of dead space.**
- `encodeForUpload` has no guard against upscaling a source narrower than the bound. Marked with a `ponytail:` comment. Every source today is a camera capture at several megapixels, so it cannot happen; add the guard if a gallery picker lands.

**Technical debt:**

- Populated collection screens are still unverified visually, now for two sessions running.
- `scans.photo_ref` is a dead legacy column. New writes leave it NULL. Commented.
- `scripts/` is not covered by any typecheck. `backend/tsconfig.json` includes only `backend/src` and `shared`.
- Auth provider JWKS verification has never run against a real token.
- `scripts/shelf-probe.ts` is a throwaway that has served its purpose. Keeping it is deliberate, as evidence, but it is not product code and should not be wired into anything.

**Assumptions that could be wrong:**

- **That the design works on a phone.** Everything verified in a desktop browser at a phone viewport. Motion has never been seen running.
- **That `boxShadow` renders on iOS and Android.** Confirmed on web and in RN types, not on hardware.
- **That Flash-Lite is accurate enough.** Still not evaluated. The harness exists, the data does not.
- **That the catalog's 379 items are accurate.** 33 pattern rows partially checked against CMoG; item rows and all form data unverified.
- **That implicit caching is actually hitting.** The prompt was reordered to make it possible. Nobody has confirmed a cache hit in a real response.
- **That Expo Go still cannot run SDK 57.** Re-check `npm view expo dist-tags`.

---

### 6. HOW TO THINK ABOUT THIS PROJECT

**1. Core pattern.** `item = pattern x form` is the spine and everything joins on `item.slug`. The second pattern is **honest labelling**: the app never shows a figure or an image without saying what kind of claim it is. That principle has four enforcers in code, and this session found the shape of a fifth. `PriceFigure` for prices, the swatch mark for colorway art, `AiApproximationBadge` for generated images, the slug enum plus `resolveGuesses` for identifications, and the proposed evidence-versus-colorway check. When you add a new kind of claim, add its label in the same breath. The design's contribution is that **tokens carry roles**, and a token used outside its role dissolves the direction back into generic app design.

**2. Most common mistake.** Treating a green typecheck as evidence the app works. `tsc` reads tsconfig `paths`; Metro does not, so run `npx expo export --platform ios` after touching `shared/` or `data/`. The design version: treating a screenshot as evidence, so read computed styles with `page.evaluate`, walk `*` not `div`, check both themes. **The new version, from this session: treating a plausible number as a measured one.** Three widths produced three different detection counts and it looked like a resolution effect. The image token count said all three were the same input. Check `usageMetadata` before believing any conclusion about images.

**3. What looks refactorable but is not.** The four privacy measures. `PriceSource`'s two implementations. The reference lock comment in `theme.ts`. **The slug enum in `identify.ts`**, which looks like redundant belt and braces next to `resolveGuesses` and was measured to cost no prompt tokens while removing it produced an invented slug. And now **the two separate bounds in `encodeForUpload`**, which look like one constant wanting to be shared and are not: a model input and a catalog photograph are different things with different right answers.

---

### 7. DO NOT TOUCH LIST

- Do NOT refactor stable, working systems without being asked.
- Do NOT redesign architecture unless explicitly instructed.
- Preserve `item.slug` = `{patternId}-{modelNo}`.
- **Do NOT upgrade Expo past SDK 56** without checking `npm view expo dist-tags`.
- **Do NOT hardcode the app name** anywhere but `shared/branding.ts`.
- **Do NOT weaken the four privacy measures.**
- **Do NOT render a price without its source label**, a colorway swatch without its mark, or a generated image without its badge.
- **Do NOT remove the slug enum from the identify schema**, and do not remove `resolveGuesses`.
- **Do NOT move a design token outside its role.** Read the lock first.
- **Do NOT put a blur radius on any shadow.**
- **Do NOT raise the 1024px upload bound expecting accuracy.** Measured: 1064 image tokens at 5712px, 2048px and 1024px alike.
- **Do NOT move the catalog block out of the prompt prefix** or put a variable string in front of it. That kills prefix caching.
- **Do NOT conflate the rate limiter with the scan quota.** One is abuse control, the other is metering, and three things must never consume a scan: a failed identification, a confirmation or correction, and a re-scan after a blurry shot.
- **Do NOT ship on Gemini's free tier.** It permits Google to use submitted content to improve their products.
- **Do NOT paste API keys into chat.** They live in `backend/.env`, gitignored.
- Do NOT copy CMoG photographs, screenshot their pages, or quote chunks of their prose. Facts, restated, with the credit that is already in Settings.
- Do NOT weaken the colorway parse test to make a data change pass.
- Do NOT rename the repo directory (`Projects/PyDex`).
- Do NOT redeclare a type that lives in `shared/types.ts`.
- Do NOT use em dashes.
- Do NOT write a global git config; author with env vars matching existing history.

---

### 8. CONFIDENCE & FRESHNESS

| Section | Confidence | Note |
|---|---|---|
| 1. Project identity | ✅ HIGH | Unchanged this session |
| 2. Built and working | ✅ HIGH | 75 tests, both typechecks, iOS export, all run by Claude not just reported by agents |
| 2. Populated screens render correctly | ❓ LOW | **Still never seen rendered. Two sessions running.** |
| 3. Architecture | ✅ HIGH | Verified this session |
| 4. Cost and safety work | ✅ HIGH | Built and tested this session |
| 4. Gemini caching research | ⚠️ MEDIUM | Sources cited, but the token threshold is genuinely unknown and no cache hit has been observed |
| 4. Scan storage and replay | ✅ HIGH | Tested, though never exercised against real labeled data |
| 4. Shelf photo failure | ✅ HIGH | One real photo, three calls, token counts from the API |
| 4. CMoG permission | ✅ HIGH | **Full reply read this session. No longer hearsay.** |
| 4. Date corrections | ✅ HIGH | Every colorway page checked, one deliberately reverted |
| 5. Known bugs | ⚠️ MEDIUM | Carried from session 3, not re-verified |
| Identification accuracy | ❓ LOW | **Still not evaluated. Harness exists, data does not.** |
| Design on a real phone | ❓ LOW | **Never run on a device. Four sessions.** |
| Pricing integration | ❓ LOW | Never run against a live response |
| Catalog accuracy | ⚠️ MEDIUM | 33 pattern rows partially checked; 379 item rows unchecked |

---

## Next session

The user's directive is two things, and the first one needs careful reading.

**1. One photo, one set at a time.** This is NOT the shelf import that failed. The shelf failed partly because Gemini spreads about four tiles of detail across the whole frame, which gave forty dishes a few hundred pixels each. **One nested set filling the frame gets the same tile budget over four pieces instead of forty, roughly ten times the detail per dish.** That case is untested and the measurement actively supports trying it. Build the multi detect path scoped to one set per photo, keep the `visibleEvidence` field, and reject any detection whose evidence contradicts the slug's parsed colorway. That last part is the fifth enforcer described in section 4 and it is what would have caught every bad row in the shelf run.

**2. Bulk CMoG ingestion, restated in our own words.** Now unblocked and the constraints are precise: facts yes, their prose no, their photographs no, credit already in Settings. Their library carries no model numbers, so it can enrich patterns but can never produce items on its own. Decide how to ingest respectfully; CLAUDE.md still says do not crawl, and that rule was written before the permission was clear, so the shape of "not crawling" is a judgment call worth making explicitly rather than by accident.

Two things worth folding in regardless: **start the backend and finally QA the populated collection screens**, which is the one LOW confidence item that can be closed in ten minutes, and **get this onto a physical phone**. The phone gap has now survived four sessions.
