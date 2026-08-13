# PROJECT CONTINUATION DOCUMENT
## Session 3, 10 August 2026

### 1. PROJECT IDENTITY

- **Project Name:** Backstamp (repo directory is still `~/Documents/Projects/PyDex`, deliberately not renamed)
- **What This Project Is:** An iOS and Android app for vintage Pyrex collectors. Photograph a dish, the app identifies the pattern and form, shows what comparable pieces sell for, and tracks what you own and what you're hunting.
- **Primary Objective:** A collector can scan a dish in a thrift store, get a correct identification, see a real price range, and add it to a have/want list. Offline-tolerant, because that is where scanning actually happens.
- **Strategic Intent:** Every confirmed or corrected scan is a labeled training example. The LLM-vision identifier is the mechanism that builds the dataset for a custom model later. Nothing is trained yet; the logging exists so the option stays real.
- **Business model (refined this session):** free app with one advert, plus a one-off payment. Session 2 recorded "$3 removes the ad". Session 3 established that this is structurally inverted and the user chose a new shape: **$3 buys ad removal AND a scan allowance, with consumable top-ups, plus a monthly free scan quota for everyone.** Ad removal and scan capacity must stay **separate SKUs** even when bundled, so scan pricing can move without breaking the ad promise.
- **Hard Constraints:**
  - The name lives **only** in `shared/branding.ts`. Never hardcode it.
  - **Pinned to Expo SDK 56.** The App Store build of Expo Go refuses a project newer than itself.
  - **`item = pattern × form`.** Price and ownership attach to the item, never the pattern.
  - **Never render a bare price.** `PriceFigure` exists to make it structurally impossible.
  - **A colorway swatch is not a photograph** and must always carry its mark, at every tile size.
  - EXIF stripped server-side; auth stores the provider subject ID only; sync carries slugs and counts only; AI placeholder images come from a written description, never image-to-image.
  - **The design reference lock** in the header of `app/src/constants/theme.ts`. It was replaced this session. Read it before any visual change.
  - **An invented item slug must never reach the caller.** Two layers enforce this and both were proven this session, not assumed.
  - No iOS Simulator on Linux. Physical phone via Expo Go, or the web preview.
  - **No em dashes anywhere**, including code comments, UI copy, commit messages and anything drafted for the user to send.

---

### 2. WHAT EXISTS RIGHT NOW

**Built and working** (all verified this session: both typechecks clean, 26 backend + 18 app + 4 script tests pass, iOS bundle exports, both themes confirmed in a browser by reading computed styles):

- **Backend** (Hono on Node 26, built-in `node:sqlite`): `/identify`, `/catalog`, `/items/:slug`, `/price/:slug`, `/price/batch`, `/scans`, `/collection`, `/photos`, `/patterns/unknown`, `/auth/session`.
- **Identification now runs on Gemini.** `gemini-3.1-flash-lite` over REST with global `fetch`, no new dependency. `describePattern` and the image generator stay on `claude-opus-5`.
- **The whole app rebuilt against the Harvest File direction.** Scan flow (permission, two-step viewfinder, reading, result, filed, browse-by-hand, already-owned sheet), Collection (tabbed card file, want list, first launch), Item detail (single raised card, offline and no-comps states), Settings (grouped cards, toggles).
- **Design token layer** rewritten: `theme.ts` carries the new lock plus `CameraChrome`, `OnAccent`, scheme-keyed `Elevation`, `SplashGround`.
- **Shared primitives** in `collection-ui.tsx`: `Card`, `PressButton`, `CircleButton`, `HeaderBar`, `FileTabs`, `SpecChip`, `SpecimenTile`, `PriceFigure`, `RarityBadge`, `RarityPill`, `Label`, `Divider`, `PhotoPlaceholder`, `useElevation`.
- **Rubik** instanced from the variable font at 400/700/900, subset, 116KB, with its OFL. Oswald removed.
- **Tab icons** redrawn as three primitives, one PNG set serving both platforms via `renderingMode: 'template'`. The iOS/Android icon split is gone.
- **Catalog**: 379 items, 33 patterns, 30 forms. `snowflake-turquoise` colorway corrected.
- **Repo**: https://github.com/Mattressburn/BackStamp, branch `master`, pushed through `7883603`.

**Partially built:**

- **Pricing has never run against a real key.** No SoldComps or eBay credential exercised.
- **Identification has now run for real, but only on test images.** See §4 for what those runs showed.
- **Attributed photo uploads** still queue with `uploaderHandle: null`.
- **Public photo approval** exists as a SQLite column with no review tool.
- **Google sign-in** renders as an honest "not configured in this build" row.

**Broken or blocked:**

- **Nothing has run on a phone.** The camera path, native tab bar and all motion remain unvalidated on a device. Three sessions have now not reduced this.
- **Populated collection screens could not be QA'd in the browser this session** because the backend was not running and the preview reaches `/catalog` at the MRDockBox address. Rows, tiles, file tabs and the small swatch mark are **typechecked and unit-tested but not visually confirmed**.
- **`item/[slug]` still cannot be seen in the web preview** without the temporary fourth `TabTrigger` trick.
- **`gemini-2.5-flash-lite` is unusable.** It appears in the models list and 404s on `generateContent` for a new key.

**Not started:**

- Rate limiting on `/identify`. Still the single thing standing between the project and an unpayable bill.
- Image downscaling before upload. Full-resolution phone photos are still sent.
- Prompt caching on the catalog block.
- Batch collection import (designed this session, nothing built).
- EAS build configuration; no store submission path exercised.
- Model training (deliberate, logging only).
- A real trademark search on "Backstamp".

---

### 3. ARCHITECTURE & TECHNICAL MAP

**Tech stack:** Expo SDK 56 / React Native 0.85.3 / expo-router / TypeScript strict. Backend Hono on Node 26 with built-in `node:sqlite`. Identification `gemini-3.1-flash-lite` over REST; description and image generation `claude-opus-5` via `@anthropic-ai/sdk`. Dev host is Linux.

**Key files:**

```
shared/types.ts                       single source of truth, both sides
shared/branding.ts                    the app name, in exactly one place
app/src/constants/theme.ts            tokens AND the reference lock, read the header
app/src/constants/colorways.ts        prose colorway -> figure/ground hex; imports nothing
app/src/features/collection/collection-ui.tsx   the shared primitives
app/src/features/collection/card-position.ts    "card n of m", offline notice
app/src/features/scan/scan-screen.tsx           container: state, effects, phase switch
app/src/features/scan/scan-camera.tsx           camera-ground screens (CameraChrome)
app/src/features/scan/scan-results.tsx          app-ground screens
backend/src/identify.ts               identifyPrompt + geminiGuesses/anthropicGuesses
data/catalog.json                     379 items
```

**End-to-end flow:**

1. Bootstrap seeds the bundled catalog into local SQLite, then refreshes from `/catalog` in the background. A failed refresh is not an error.
2. User photographs the pattern, then the base. Offline queues **file URIs, never base64**.
3. `identify()` posts base64 at send time. The backend builds one prompt (catalog JSON plus instructions) and calls Gemini with a `responseSchema` whose `itemSlug` is an enum of all 379 slugs.
4. `resolveGuesses` filters the result against the slug set as a second layer, then a `CONFIDENCE_FLOOR` of 0.5 drops weak guesses.
5. App shows the top 3. Confirmation calls `logScan` and `setOwnership`.
6. Collection batch-fetches quotes, chunked at 100.

**Naming:** `item.slug` = `{patternId}-{form.modelNo}`. Routes flat in `app/src/app/`. Aliases `@/`, `@shared/`, `@data/` in both tsconfig and `metro.config.js`.

**External dependencies:** Gemini API, Anthropic API, SoldComps, eBay Browse, an undecided image provider, Google and Apple identity.

---

### 4. RECENT WORK: WHAT JUST HAPPENED (HIGH PRIORITY)

**Worked on:** the second design pass (Harvest File), the Gemini port, and two product conversations that produced decisions rather than code.

#### The design pass

A handoff arrived as a zip: a README, three HTML prototypes and a `theme.harvest.ts`. It **replaces** the session 2 lock rather than working inside it. The user was asked and chose replacement, all thirteen screens, subagents authorised.

Sequence: read the handoff and prototype source -> wrote the shared contracts myself (`theme.ts`, `collection-ui.tsx`, tab icons, fonts, `app.json`) -> typechecked the foundation -> dispatched four agents on disjoint files -> integrated, verified, committed.

**Decisions and why, do not undo without reading the reasoning:**

- **Contracts before agents, third session running.** The foundation typechecked before any screen agent started. That is why four screens composed instead of colliding.
- **Two values in the lock are derivations, marked as such.** The handoff shipped no dark shadow colors (its tan offset would smear on `#231D14`) and specified iOS shadow props with an Android border fallback, which would leave the browser preview with no separation at all now that hairlines are gone. So `Elevation` is scheme-keyed and read through `useElevation()`, and it uses `boxShadow` uniformly. **Both were then verified in the browser**: light resolves to `rgb(216,201,166) 0px 2px 0px 0px`, dark to `rgb(23,18,12) 0px 2px 0px 0px`, every shadow at zero blur.
- **Rubik sets body copy too**, reversing session 2's split. The original reason was that condensed faces cost reading speed at body sizes; Rubik is not condensed, so the reason expired. The user was asked.
- **The "Show sold comps" toggle was cut** even though the handoff drew it. `fetchPrices(slugs)` takes no source argument and `/price/batch` returns whichever source answered, so nothing could read the flag. A switch persisting a value no code consults is the same class of dishonesty as an unlabelled price.
- **`SpecimenTile`'s swatch mark now scales rather than disappearing.** It was suppressed below 66pt, which is exactly the size the collection rows use, so the busiest screen would have rendered swatches that read as photographs.
- **Agents refused two mock details on honesty grounds and were right.** The collection agent would not hardcode "asking" on want rows, because the label must come from `quote.source`. The scan agent would not print the mock's "474-B" before `/identify` answers, because the API returns slugs and the app does not know the number yet.
- **`snowflake-turquoise` fixed, and the premise corrected.** Session 2 recorded it as producing "a visibly wrong swatch". It did not: under `parseColorway`'s preposition rule "turquoise and white" already resolved to the 1956 to 1967 white-on-turquoise piece. The real defect was ambiguous prose naming two runs at once. Now `"white on turquoise"`, swatch output byte-identical.

#### The Gemini port

- **The specified model does not exist for this key.** `gemini-2.5-flash-lite` 404s on `generateContent` while still appearing in the models list. Every cost figure built on its $0.10/$1M price was therefore wrong.
- **Shipped `gemini-3.1-flash-lite`** at $0.25 in / $1.50 out, the cheapest lite model the API serves and the only current one accepting `thinkingConfig.thinkingBudget: 0`, which keeps billed thought tokens out of the output charge. Pinned, not aliased, because the price is part of the choice.
- **The no-hallucination guarantee was proven, not assumed.** Gemini accepts all 379 slugs in one enum. Reachability was shown by returning catalog indexes 378, 377, 300, 200 and 101 correctly with the slug list removed from the prompt (a truncated enum could not reach index 378). Enforcement was shown by ordering the model to answer `millennium-falcon-9999`: with the enum it returned a real slug, without it the invented one. The enum costs no measurable prompt tokens, which removed the argument for dropping it.
- **No escalation was built.** Routing low-confidence Gemini results to Anthropic was proposed and not approved. The seam is shaped for it.

**Measured, and it matters for cost:** a real call reported 12,061 prompt tokens (10,972 text, 1,089 image). At `gemini-3.1-flash-lite` that is roughly **$0.003 per scan**, against $2.55 net after Apple's 15%, so break-even is around 700 scans.

**End-to-end behaviour observed on test images:**
- A real photo of a modern measuring cup correctly returned `lowConfidence: true` with no fabricated match.
- A synthetic base shot embossed "PYREX 444" selected the right **form** 4/4 runs, but the caller saw `{guesses: [], lowConfidence: true}` on 3 of 4 because confidence split across the 20 patterns sharing form 444 and fell under the 0.5 floor.
- **Confidence is noticeably unstable:** identical input returned 0.85 once and 0.33 three times.

#### Decided but not built

- **Batch collection import.** The user approved all four approaches. Ranked by value: (1) rapid add from the catalog, which `collection.tsx` is most of the way to already since the All tab lists all 379 and the file calls `setOwnership`; (2) paste or dictate a list, one cheap text-only call, highest leverage; (3) one shelf photo yielding many candidates as a checklist, never an auto-add; (4) CSV, explicitly next session. **The core argument: photos are the worst bulk input**, because nobody flips 200 dishes and the prompt says the model number outranks appearance, so bulk photo import feeds the identifier its weakest signal at full cost.
- **Batch import must not consume scans.** A photo identification costs a scan; typed, pasted or imported entry is free and unlimited. Otherwise a new user burns their allowance importing what they already own and churns.
- **Three things must never consume a scan:** a failed identification, a confirmation or correction (that is the training data), and a re-scan after a blurry shot.
- **Cost fixes identified, none applied:** no image downscale before upload (`CAPTURE_QUALITY = 0.8`, no resize), no prompt caching on the ~11k-token catalog block, no rate limiting on `/identify`.

**Open threads:**

- The eval set. 40 labeled photo pairs from the user's wife's collection would settle whether Flash-Lite is good enough and become the regression suite.
- Whether `CONFIDENCE_FLOOR` should apply to base-only scans.
- The have/want exclusivity in `UserItem`.
- Image generation provider.

---

### 5. WHAT COULD GO WRONG

**Known bugs and issues:**

- **`UserItem` carries one `status`, so have and want are mutually exclusive.** Starring an owned piece moves it off the have list and drops its quantity. The new item-detail footer draws both controls side by side, which exposes it. Fixing it is a schema change in `shared/types.ts` and `db.ts`.
- **The NEW tag re-fires on quantity change.** `user_items` has `updated_at` and no `created_at`, so a row counts as newly filed within a ten-minute window and raising a count re-tags it.
- **Confidence is unstable run to run** (0.85 vs 0.33 on identical input).
- **The catalog collapses colorway variants CMoG splits.** `butterprint` maps to four CMoG entries, `dots` to four. `Pattern.colorway` holds one string, so this is a modelling question before a data one.
- **Five patterns disagree with CMoG on dates**: `primary-colors`, `sandalwood`, `dots`, `butterfly-gold`, `atomic-eyes`. Two of ours have null end dates CMoG can fill: `snowflake-blue`, `old-town-blue`. **These are now unblocked** by the CMoG data permission.
- No rate limiting on `/identify`.
- Screen 3's footer gradient is native-only; `react-native-web` 0.21 does not implement `experimental_backgroundImage`, so the browser shows a hard edge.
- Bottom-sheet elevation does not exist in the token set, so the already-owned sheet has no offset.

**Edge cases:**

- Collections over 100 items: `/price/batch` caps server-side, `api.ts` chunks.
- Partial price-batch failure fails the whole total deliberately, and the UI says so.
- Unpriced items are excluded from totals rather than counted as zero.
- `parseColorway` returns null for anything unrecognised so callers fall back to neutral. The test "every pattern shipped in the catalog parses" is the guard.
- The tab bar is a native bar the scan screens cannot reach, so every pinned footer clears it by hand via `TAB_BAR_CLEARANCE`. **If the route is later made to hide the bar, drop that constant to 0 or the screens gain 78pt of dead space.**

**Technical debt:**

- Populated collection screens are unverified visually (backend was down during QA).
- The temporary `TabTrigger` technique for `item/[slug]` is documented, not built in. Deliberate.
- Auth provider JWKS verification has never run against a real token.
- `backend/README.md` lists six honest limitations, unchanged.

**Assumptions that could be wrong:**

- **That the design works on a phone.** Everything verified in a desktop browser at a phone viewport. The camera surface, native tab bar, SF-Symbol-free icons and all motion are unproven on a device. Motion has never been seen running.
- **That `boxShadow` renders on iOS and Android.** Confirmed on web and in the RN type definitions. Not confirmed on a device.
- **That Flash-Lite is accurate enough.** Two test images is not an evaluation.
- **That the catalog's 379 items are accurate.** 33 pattern rows partially checked against CMoG; item rows and all form data unverified.
- **That Expo Go still cannot run SDK 57.** True 2026-08-09. Re-check `npm view expo dist-tags`.

---

### 6. HOW TO THINK ABOUT THIS PROJECT

**1. Core pattern.** `item = pattern × form` is the spine and everything joins on `item.slug`. The second pattern is **honest labelling**: the app never shows a figure or an image without saying what kind of claim it is. That principle now has four enforcers in code, not three: `PriceFigure` for prices, the swatch mark for colorway art (at every size, as of this session), `AiApproximationBadge` for generated images, and the slug enum plus `resolveGuesses` for identifications. When you add a new kind of claim, add its label in the same breath.

The design's contribution is **tokens carry roles**. A token used outside its role is the failure mode that quietly dissolves the direction back into generic app design.

**2. Most common mistake.** Treating a green typecheck as evidence the app works. `tsc` reads tsconfig `paths`; Metro does not. Run `npx expo export --platform ios` after touching `shared/` or `data/`. The design-specific version: treating a screenshot as evidence. Two sessions have now lost time to it, so read computed styles with `page.evaluate` instead, walk `*` rather than `div` (React Native Web maps `Pressable` to `<button>`), and check both themes. The economics version, new this session: treating a published price as a purchasable one.

**3. What looks refactorable but is not.** The four privacy measures. `PriceSource`'s two implementations, because the primary is a free tier that will run out. The reference lock comment in `theme.ts`, which is the only thing standing between this design and the next session averaging it back toward defaults. And **the slug enum in `identify.ts`**, which looks like redundant belt-and-braces next to `resolveGuesses` and is not: it was measured to cost no prompt tokens, and removing it was demonstrated to produce an invented slug.

---

### 7. DO NOT TOUCH LIST

- Do NOT refactor stable, working systems without being asked.
- Do NOT redesign architecture unless explicitly instructed.
- Preserve `item.slug` = `{patternId}-{modelNo}`.
- **Do NOT upgrade Expo past SDK 56** without checking `npm view expo dist-tags`.
- **Do NOT hardcode the app name** anywhere but `shared/branding.ts`.
- **Do NOT weaken the four privacy measures.**
- **Do NOT render a price without its source label**, a colorway swatch without its mark, or a generated image without its badge.
- **Do NOT remove the slug enum from the identify schema**, and do not remove `resolveGuesses`. Both were proven necessary.
- **Do NOT move a design token outside its role.** Read the lock first.
- **Do NOT put a blur radius on any shadow.**
- **Do NOT ship on Gemini's free tier.** It permits Google to use submitted content to improve their products; the paid tier does not.
- **Do NOT paste API keys into chat.** They go in `backend/.env`, which is gitignored.
- Do NOT copy CMoG photographs or crawl the site. The data permission does not extend to images.
- Do NOT rename the repo directory (`Projects/PyDex`).
- Do NOT redeclare a type that lives in `shared/types.ts`.
- Do NOT commit `.env`.
- Do NOT use em dashes.
- Do NOT write a global git config; author with env vars matching existing history.

---

### 8. CONFIDENCE & FRESHNESS

| Section | Confidence | Note |
|---|---|---|
| 1. Project identity | ✅ HIGH | Business model refined with the user this session |
| 2. Built and working | ✅ HIGH | Typechecks, 48 tests, iOS export, browser verification all run this session |
| 2. Populated screens render correctly | ❓ LOW | **Backend was down during QA; rows, tiles and file tabs are unverified visually** |
| 3. Architecture | ✅ HIGH | Written and verified this session |
| 4. Design pass | ✅ HIGH | This session |
| 4. Gemini port and its proofs | ✅ HIGH | Enum reachability and enforcement both demonstrated |
| 4. Cost per scan (~$0.003) | ⚠️ MEDIUM | From one real call's token counts and a published price |
| 4. Identification accuracy | ❓ LOW | **Two test images is not an evaluation** |
| 5. Known bugs | ✅ HIGH | Each observed or traced to a specific line this session |
| CMoG data permission | ⚠️ MEDIUM | **User reports it; Claude has not read the wording. Images not covered.** |
| Design on a real phone | ❓ LOW | **Never run on a device. Motion never seen running.** |
| `boxShadow` on device | ⚠️ MEDIUM | Confirmed on web and in RN types, not on hardware |
| Pricing integration | ❓ LOW | Never run against a live response |
| Catalog accuracy | ⚠️ MEDIUM | 33 pattern rows partially checked; 379 item rows unchecked |

---

## Next session

Three tracks are open. Recommended order:

1. **The eval set.** 40 labeled photo pairs, run through Flash-Lite, top-1 and top-3 accuracy. It settles whether the cheap model is good enough, decides whether escalation to Anthropic is needed, and becomes the regression suite. Everything else is guessing until this exists.
2. **The cost fixes**, which are small and independently valuable: resize to ~1024px before upload (`expo-image-manipulator` is already a dependency and unused in that path), add `cache_control` to the catalog block, and put rate limiting on `/identify`.
3. **Batch import**, starting with rapid add from the All tab and the paste-a-list path. CSV was explicitly deferred to next session by the user.

Two smaller things worth folding in: start the backend and finish the browser QA of the populated collection screens, and get this onto a physical phone. The phone gap has survived three sessions and is now the largest unknown in the project.
