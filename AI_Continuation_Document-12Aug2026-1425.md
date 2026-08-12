# PROJECT CONTINUATION DOCUMENT
## Session 5, 12 August 2026

### 1. PROJECT IDENTITY

- **Project Name:** Backstamp (repo directory is still `~/Documents/Projects/PyDex`, deliberately not renamed)
- **What This Project Is:** An iOS and Android app for vintage Pyrex collectors. Photograph a dish or a whole nested set, the app identifies pattern and form, shows what comparable pieces sell for, and tracks what you own and want.
- **Primary Objective:** A collector scans a dish in a thrift store, gets a correct identification, sees a real price range, files it. Offline tolerant.
- **Strategic Intent:** Every confirmed or corrected scan is a labeled training example toward a custom model. THIS SESSION THE PIPELINE WENT LIVE: the app runs on a real iPhone and the user is producing labeled corrections daily. Long-term north star, filed in the user's words: Discogs for Pyrex (docs/2026-08-12-marketplace-north-star.md).
- **Hard Constraints:**
  - The name lives only in `shared/branding.ts`.
  - Expo SDK 56, and the pin's reason CHANGED this session: Expo Go is irrelevant now (App Store Expo Go runs SDK 54 only, measured on the user's iPhone; the dist-tags heuristic predicted nothing). Phone testing goes through an EAS development build, so an SDK bump is now an ordinary upgrade decision, deliberately not taken mid-hardware-bringup.
  - `item = pattern x form`; price and ownership attach to the item.
  - Honest labelling everywhere: never a bare price, a swatch without its mark, a generated image without its badge, and NEW this session, never a catalog entry without its provenance label, and never the word "slug" (or "provenance") rendered to a human.
  - The four privacy measures stand (EXIF stripped server-side, subject ID only, sync carries entries and counts only, placeholders never image-to-image).
  - The Harvest File design lock in `app/src/constants/theme.ts`. A blur radius anywhere is a bug.
  - No em dashes anywhere, including UI copy; the ledger placeholder now says "Unavailable" for exactly this reason.

### 2. WHAT EXISTS RIGHT NOW

**Built, working, and verified on hardware (the big change):**

- **The app runs on the user's physical iPhone** via an EAS development build. Apple Developer enrollment done (team KD5M56J9BM), device registered, bundle id `com.backstamp.app`, the whole path recorded in CLAUDE.md. Two builds shipped; the second carries the final icon.
- **Set scanning end to end:** one photo of one nested set, up to 8 detections with `location` and `visibleEvidence`, the colorway-contradiction guard (fifth honest-output enforcer, `colorsContradict` in `shared/colorways.ts`), grouped prunable results, per-row Wrong-then-replace correction that merges duplicates, tap-a-row for the read-only pattern facts card, batch filing. Field results so far: 3 of 4 on a mixed stack, 3 of 3 on a Terra set.
- **Provenance through the whole stack** (user approved the shape this session): `Provenance` enum on `Item` (published-reference, period-ad, museum-library, collector-attested), all 379 seeded rows stamped published-reference, validator enforces it, catalog v4, quiet fact label on detail surfaces.
- **Add-a-known-combination:** POST /items joins an existing pattern to an existing form as a collector-attested entry; browse flow walks pattern then form and says plainly it adds to the shared catalog for everyone.
- **The icon:** circular BACKSTAMP maker's mark, four plain nesting bowls with white lips in the fall colorway, daisies, Varela Round lettering (the wife's pick), all six production slots rendered from SVG sources in `app/assets/icon-source/` with fonts and licenses, rebuildable with one script. No PYREX anywhere.
- **CMoG corpus:** all 174 pattern pages fetched once politely into gitignored `data/cmog-cache/`; 28 pattern notes restated in our own words (zero five-gram overlap with their prose, verified); date rulings from session 4 preserved.
- **Fixed-on-hardware list:** the bare-text crash (PressButton array children), the clipped header glyph (iOS applies tracking after the last letter; token-sized padding compensates), Apple sign-in (backend had no APPLE_CLIENT_ID to check audience against; now in .env and .env.example), collection removal (minus at one now confirms then removes; want rows too), "Slugs and counts" jargon (now "Pieces and counts"), backend CORS (was silently blocking ALL browser-preview fetches forever), collection header piece count (counts quantities now).
- **Prefix caching confirmed live:** cachedContentTokenCount 13,406 of 17,050 on the second set-scan call.
- Suites at session end, all run by the orchestrator: backend 50, app 37, scripts 17, both typechecks, catalog validator v4, Metro export.

**Partially built:**

- **Sign-in:** the configuration fix landed and the backend restarted, but the user has NOT yet confirmed a successful sign-in after the fix. First unverified thing to check next session.
- **Set scans produce no training scans** (Scan is single-slug shaped) and do not queue offline. Both marked with ponytail comments.
- **Pricing has never run against a real key.** Unchanged for three sessions.
- **The eval harness still has no labeled data in it,** even though the user is now generating corrections on the phone; nobody has pulled the stored scans through `scripts/eval-scans.ts` yet.

**Broken or blocked:**

- Nothing known-broken on the phone right now. The populated-screen and hardware unknowns of four sessions all resolved this session.

**Not started:**

- Creating a brand-new Form (unknown model number) from the app; deferred half of add-a-combination.
- Period-ad mining and any non-CMoG source ingestion (docs/2026-08-12-catalog-growth.md has the constraints and order).
- Marketplace stages (docs/2026-08-12-marketplace-north-star.md).
- Store submission path (EAS production profile exists, never exercised). Trademark search on "Backstamp". The CMoG launch email to Suzanne Abrams Rebillard remains owed.

### 3. ARCHITECTURE & TECHNICAL MAP

- **Stack:** Expo SDK 56 / React Native 0.85.3 / expo-router / TypeScript strict; Hono on Node 26 with node:sqlite; identification on `gemini-3.1-flash-lite` over REST; `describePattern` and image generation on `claude-opus-5`. Dev host Linux; phone via EAS dev build.
- **Key files:** everything session 4 listed, plus `shared/colorways.ts` (moved from app so the backend runs the same parse; app re-exports), `Provenance` in `shared/types.ts`, `identifySet` and `submitKnownCombination` in `app/src/api.ts`, `identifySetPrompt`/`resolveSetDetections` in `backend/src/identify.ts`, `/identify/set` and `/items` in `backend/src/app.ts`, the icon sources in `app/assets/icon-source/`, and three probe or planning docs dated 2026-08-11 and 2026-08-12.
- **End-to-end flow additions:** set scan posts one photo to `/identify/set` (shared rate bucket with `/identify`), rows survive slug-enum, confidence floor, and colorway contradiction in that order; the app groups, the user prunes or repairs, filing loops setOwnership; catalog v4 refresh delivers provenance to phones on bootstrap.
- **Naming:** unchanged; `item.slug` stays the internal join key and is never rendered.
- **External dependencies:** unchanged, plus the Expo/EAS account (`mattressburns-team`, passwordless, Sign in with Apple) and the Apple Developer team.

### 4. RECENT WORK, WHAT JUST HAPPENED (HIGH PRIORITY)

Two calendar days, one arc: everything the app claimed finally met glass.

- **Method held:** the orchestrator dispatched fifteen-plus Codex agents in visible Ghostty windows across the two days, contracts written in full before dispatch, one file one owner, every result verified by the orchestrator running the suites personally. Two launch incidents: a window that never spawned and a near-collision from a blind relaunch (procedure now in memory). One integration seam was fixed directly (scripts/tsconfig.json) and network steps (CMoG fetch, font downloads, live probes, EAS) ran orchestrator-side per the sandbox exception.
- **Decisions and why:**
  - Set scan over shelf scan, because the tile-budget measurement supports one set filling the frame; live probes then forced two prompt sentences (per-piece judgment, pictorial evidence with pattern names banned from the evidence field) after the model showed family-substitution and name-echo failures.
  - EAS dev build over Expo Go, forced by measurement (store Expo Go is SDK 54); the pin heuristic in CLAUDE.md was rewritten to the measured facts.
  - Provenance as one enum, approved by the user in-session, because a catalog mixing factory records with collector attestations without labels breaks the honesty rule; anything fancier waits for measurement.
  - Icon: no PYREX word, no blue trade dress, genre-matched OFL lettering instead (Varela Round, chosen by the wife over the orchestrator's Titan One recommendation; the user's household outranks the design opinion).
  - "Wrong" repairs a set row instead of just Remove, because 3-of-4 with no repair path loses the fourth.
- **Discussed, not implemented:** set-scan training logs (needs a scans schema change), new-Form creation, other-source ingestion, marketplace stages, the interest-ping feature.
- **Open threads:** sign-in confirmation after the audience fix; the running set-scan tally the user was asked to keep; whether the dev client's dev-server discovery survives network changes; `CONFIDENCE_FLOOR` for base-only scans and the `UserItem` have/want exclusivity, both still open from session 4.

### 5. WHAT COULD GO WRONG

- **Known bugs:** none currently visible on device, but the NEW-tag re-fire on quantity change survives (user_items has no created_at), and have/want exclusivity still drops quantity when starring an owned piece.
- **Edge cases:** the set flow's Wrong-mode browse shares state with normal browse; regressions there would be subtle, exercise both paths after touching scan-screen. The additive migrations (backend and app both) treat missing provenance as published-reference; a future migration must not reinterpret that default.
- **Technical debt:** set scans invisible to training storage; scripts tsconfig exists only for path resolution, scripts still have no typecheck; the icon build script depends on system-installed fonts (they live in icon-source/fonts, install before rebuilding art); Apple sessions in the keychain expire and re-prompt, so EAS builds run in a visible terminal.
- **Wrong-assumption flags:** confidence numbers remain unstable run to run, treat abstention counts as noise and evidence quality as the stable signal (measured twice); "3 of 4" and "3 of 3" are anecdotes, not the harness; the browser preview now needs the backend CORS-enabled and reachable, which it is, but only on LRPC's address.

### 6. HOW TO THINK ABOUT THIS PROJECT

1. **Core pattern:** honest labelling, now with six enforcers (PriceFigure, swatch mark, AI badge, slug enum plus resolveGuesses, colorway-contradiction guard, provenance label). Every new claim type gets its label in the same breath. The strategic loop closed this session: real user corrections now exist; the eval harness is waiting for them.
2. **Most common mistake:** trusting a surface that is not the phone. This session alone, hardware caught a crash, a glyph clip, a dead auth path, and jargon that three browser QA passes sailed past. The browser preview is for layout; the phone is for truth. And read `usageMetadata` before believing anything about model inputs.
3. **Looks refactorable, is not:** everything in session 4's list, plus the switch-push-switch git dance (the username pin was measured dead), the two prompt sentences in `identifySetPrompt` (measured against live failures), and the identify prompts' catalog blocks not carrying provenance (cache guard, commented in code).

### 7. DO NOT TOUCH LIST

Everything from session 4 carries forward (privacy measures, slug enum, resolveGuesses, prompt prefix ordering, rate limiter versus quota, paid Gemini tier, no CMoG prose or photos, colorway parse test, repo directory name, no em dashes, env-var git identity), plus:

- Do NOT put the provenance field into the identify prompts' catalog JSON; the cached prefix is measured and guarded by comment and test.
- Do NOT render "slug" or "provenance" to a user; the display copy lives in `provenanceLabel`.
- Do NOT re-fetch CMoG; work from `data/cmog-cache/`. One page (`gooseberry-white-pink`) is broken on their end; its twin is the record.
- Do NOT retry the gh username pin; only switch-push-switch works, and always restore `jraburm_jcplc` as active afterward.
- Do NOT redesign the icon without the wife's sign-off; Varela Round was her call and the sources in `icon-source/` are the record.
- Do NOT bump the SDK mid-polish; it is now an ordinary decision but it is not a polish item.
- Do NOT weaken the additive migrations' published-reference default.

### 8. CONFIDENCE & FRESHNESS

| Section | Confidence | Note |
|---|---|---|
| 1. Identity and constraints | ✅ HIGH | Pin rationale rewritten from measurement this session |
| 2. Runs on hardware | ✅ HIGH | Two builds installed and used by the user |
| 2. Set scan behavior | ✅ HIGH | Live-probed twice, then field-used by the user |
| 2. Provenance stack | ✅ HIGH | Built and verified this session, suites green |
| 2. Sign-in after the fix | ❓ LOW | Fix landed, user confirmation never arrived |
| 2. Icon on homescreen | ⚠️ MEDIUM | Build succeeded and install link delivered; not visually confirmed on device |
| 3. Architecture | ✅ HIGH | Verified this session |
| 4. Accuracy anecdotes | ⚠️ MEDIUM | User-reported, not harness-measured |
| 5. Known bugs carried | ⚠️ MEDIUM | From session 4, not re-verified |
| Pricing integration | ❓ LOW | Still never run against a live key |
| Eval harness with real data | ❓ LOW | Corrections exist on device; never replayed |

---

## Next session

The user's directive: **a polish pass that will probably grow into more features.** The honest polish list, in value order: confirm sign-in works and exercise sync both directions; pull the phone's accumulated corrections through the eval harness for the first real accuracy number; give set scans training storage (the scans schema change) so the richest scan type stops being invisible to the dataset; the NEW-tag and have/want-exclusivity bugs; and a pass over the phone-found paper cuts the user reports next. The growth vectors it will probably reach: interest pings (marketplace stage 1), period-ad mining for promotional pieces, and new-Form creation. Whatever it becomes, the phone is the QA surface now, and the user's wife knows the patterns by heart; she is the accuracy oracle the harness cannot replace.
