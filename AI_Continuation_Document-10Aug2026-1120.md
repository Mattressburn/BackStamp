# PROJECT CONTINUATION DOCUMENT
## Session 2 — 10 August 2026

### 1. PROJECT IDENTITY

- **Project Name:** Backstamp (repo directory is still `~/Documents/Projects/PyDex` — deliberately not renamed)
- **What This Project Is:** An iOS and Android app for vintage Pyrex collectors. Photograph a dish, the app identifies the pattern and form, shows what comparable pieces sell for, and tracks what you own and what you're hunting.
- **Primary Objective:** A collector can scan a dish in a thrift store, get a correct identification, see a real price range, and add it to a have/want list — offline-tolerant, because that is where scanning actually happens.
- **Strategic Intent:** Every confirmed or corrected scan is a labeled training example. The LLM-vision identifier is not a stopgap around a custom model — it is the mechanism that builds the dataset for one. Nothing is trained yet; the logging exists so the option is real later.
- **Business model (stated by the user this session):** a free app carrying one small advert, with a single one-off payment to remove it. Not a subscription. This matters legally: it is commercial, so noncommercial-educational fair-use carve-outs do not apply to us.
- **Hard Constraints:**
  - The name lives **only** in `shared/branding.ts`. Never hardcode it.
  - **Pinned to Expo SDK 56.** The App Store build of Expo Go refuses a project newer than itself.
  - **`item = pattern × form`.** Price and ownership attach to the item, never the pattern.
  - **Never render a bare price** — sold and asking prices are different claims and always carry a source label. `PriceFigure` in `collection-ui.tsx` exists to make this structurally impossible.
  - **A colorway swatch is not a photograph** and must always be labelled as one. Same reasoning as the price rule.
  - EXIF stripped server-side; auth stores the provider subject ID and nothing else; sync carries slugs and counts only; AI placeholder images are generated from a written description, never image-to-image.
  - **The design reference lock** in the header of `app/src/constants/theme.ts` is now a hard constraint. Read it before any visual change.
  - No iOS Simulator on Linux. Physical phone via Expo Go, or the web preview.

---

### 2. WHAT EXISTS RIGHT NOW

**What is built and working** (verified this session — both typechecks clean, 40 tests pass, iOS bundle exports, all four screens rendered in a browser in light and dark):

- **Backend** (Hono on Node 26, built-in `node:sqlite`): `/identify`, `/catalog`, `/items/:slug`, `/price/:slug`, `/price/batch`, `/scans`, `/collection`, `/photos`, `/patterns/unknown`, `/auth/session`. Unchanged this session.
- **EXIF stripping** — hand-written JPEG segment walker. Unchanged.
- **Pricing** — `PriceSource` interface, SoldComps primary and eBay Browse fallback, weekly caching. Unchanged.
- **App** — all four screens rebuilt this session against the design lock. Scan (permission, viewfinder, staged wait, results, browse, uncatalogued), Collection (two-column specimen grid, ledger), Item detail (hero, placard, spec table), Settings (archive index of privacy terms).
- **Design token layer** — `app/src/constants/theme.ts`, rewritten. Carries the reference lock, role rules, `Rule` hairline, `Motion`, `FontAssets`.
- **Colorway swatches** — `app/src/constants/colorways.ts`. All 33 catalog patterns resolve, so all 379 items render in real color with no photography.
- **Catalog** — 379 items across 33 patterns and 30 forms. Data unchanged this session.
- **Repo is on GitHub** — https://github.com/Mattressburn/BackStamp, branch `master`.

**What is partially built:**

- **Identification and pricing have never run against a real key.** Structurally correct, empirically unproven. No Anthropic, SoldComps, or eBay credential has been exercised.
- **Attributed photo uploads** queue with `uploaderHandle: null`.
- **Public photo approval** exists as a SQLite column with no review tool.
- **Google sign-in** renders as an honest "not configured in this build" fact row rather than a dead button. Still no `GOOGLE_CLIENT_ID`.

**What is broken or blocked:**

- **Nothing has run on a phone.** The entire camera path is unvalidated on a device. This is still the app's biggest risk and session 2 did not reduce it.
- **`item/[slug]` cannot be seen in the web preview.** Confirmed empirically this session, not assumed: the web tab shell only routes tab screens, so the route falls back to Scan. It was QA'd behind a temporary fourth `TabTrigger` in `app-tabs.web.tsx` which has been reverted.
- **Image generation provider undecided.** Anthropic has no image API. Less urgent now that swatches fill the gap.
- **CMoG permission request drafted but not sent.** Draft lives in the session scratchpad, not the repo.

**What has NOT been started:**

- Rate limiting on `/identify`.
- EAS build configuration; no store submission path exercised.
- Model training (deliberate — logging only).
- A real trademark search on "Backstamp".
- Any fix to the catalog's known data defects (see §5).

---

### 3. ARCHITECTURE & TECHNICAL MAP

**Tech stack:** Expo SDK 56 / React Native 0.85.3 / expo-router / TypeScript strict. Backend: Hono on Node 26 with built-in `node:sqlite`. Vision: `claude-opus-5` via `@anthropic-ai/sdk`. Dev host is Linux, so iOS is Expo Go or EAS only.

**Key files:**

```
shared/types.ts                      single source of truth, both sides import @shared/types
shared/branding.ts                   the app name, in exactly one place
app/src/constants/theme.ts           design tokens AND the reference lock — read the header
app/src/constants/colorways.ts       prose colorway -> figure/ground hex; pure, no RN imports
app/src/constants/colorways.test.ts  8 tests, incl. "every catalog pattern parses"
app/src/features/collection/collection-ui.tsx   shared primitives every screen uses
app/src/db.ts                        local SQLite
app/src/api.ts                       backend client
backend/src/app.ts                   all routes
data/catalog.json                    379 items
```

**The design system, in brief.** Primary reference is Fonts In Use, an archival type-specimen index. Backstamp genuinely is one, so the structure is honest rather than decorative: condensed display face (Oswald, subset and instanced to two static weights, 47KB total) for titles/labels/numerals only; the platform face for all body copy so Dynamic Type is untouched; hairline `Rule` and surface tint instead of drop shadows; low radius. Borrowed narrowly: Palmer for the warm ground and "the object casts the only shadow"; Franco Maria Ricci for the accent being ceremonial, at most one solid fill per screen.

**Token roles are load-bearing.** Moving a token outside its role is the specific failure mode: the display face never sets body copy, the accent is never a background field, rarity colors are only ever rank, colorway hex is only ever a swatch.

**End-to-end flow:** unchanged from session 1. Bootstrap seeds the bundled catalog, user photographs pattern then base, `identify()` posts base64 at send time (offline queues file URIs, never base64), backend prompts the model with catalog slugs, app shows top 3, confirmation calls `logScan`, collection batch-fetches quotes chunked at 100.

**Naming conventions:** `item.slug` = `{patternId}-{form.modelNo}`. Routes flat in `app/src/app/`. Aliases `@/`, `@shared/`, `@data/` in both tsconfig and `metro.config.js`.

**External dependencies:** Anthropic API, SoldComps, eBay Browse, an undecided image provider, Google + Apple identity.

---

### 4. RECENT WORK — WHAT JUST HAPPENED (HIGH PRIORITY)

**Worked on:** the design polish pass, plus research into the Corning Museum of Glass as a data source.

Sequence: pushed the repo to GitHub → invoked `refero-design` and researched with the live Refero MCP (5 style searches, 4 full style references, iOS screen searches, one capture-to-result flow) → wrote the shared contracts myself → dispatched 4 agents in parallel on disjoint screens → integrated, QA'd in a browser in both themes, committed → researched CMoG → drafted a permission email.

**Decisions and why — do not undo these without reading the reasoning:**

- **Contracts before agents, again.** `theme.ts`, `colorways.ts`, `collection-ui.tsx`, tab icons and font loading were finished and typechecking before any agent started. That is why four screens composed instead of colliding. Same discipline as session 1.
- **Fonts In Use as the primary reference, not an averaged blend.** Three references conflicted. The skill's rule is to pick one dominant direction and preserve its sharp traits rather than average to a safe middle. The archive won because Backstamp *is* a specimen index, so the structure earns its place.
- **Falsifiable token commitments.** The lock was written as specific numbers before any screen changed: `Radius.lg` 16→8, `md` 12→4, `Elevation.card` deleted. The test was whether a new screenshot would be mistakable for the old one. It is not.
- **A bundled display face, reversing a documented decision.** `theme.ts` previously argued for system fonts on accessibility and bundle grounds. The user was asked and chose to bundle. The reversal is scoped to display roles only; body copy still uses the platform face, so the original reasoning is preserved where it actually mattered.
- **Colorway swatches as the answer to "no photography".** The catalog documents every pattern's colorway in prose. Parsing it gives 379 items real color for ~90 lines of code and no assets. Word order is load-bearing: "white on pink" and "pink and white" are different pieces, so the preposition decides figure from ground.
- **The swatch is labelled, always.** A generated stand-in that reads as a photo of the dish is a claim the catalog cannot support. Same principle as the bare-price rule.
- **`colorways.ts` imports nothing.** Its neutral fallback hexes are written out rather than read from `theme.ts`, so the module stays free of `react-native` and is testable under plain node.
- **The stamp ink is contrast-aware.** Grounds run from ivory to near-black ("black with brown rings"), so a fixed ink disappears at one end. It follows the ground's luma.
- **The ledger does not use `PriceFigure`.** A collection total is a sum of medians that can span both price sources; `PriceFigure` renders a quoted low–high from one. Forcing it would have printed a fabricated sample size. The local replacement takes `source` as a required prop, so the never-bare-price rule still holds.
- **CMoG is a reference, not a source.** Decided on evidence, not caution: it has no model numbers, so it cannot produce items under `item = pattern × form`. Its robots.txt disallows ClaudeBot and declares `ai-train=no`. Its terms restrict commercial use and its fair-use carve-out is noncommercial-educational, which does not cover us.
- **Did not install the suggested `agent-reach` tool.** It was not needed, and installing bot-challenge-evasion tooling against a site whose robots.txt names ClaudeBot would have been indefensible.

**What changed in the system:** 71 files. Three commits: `f2bc6e7` (the design pass), `e2ae193` (dark-mode previews), `17edea7` (docs). Deleted five unused Expo-template components that shipped a hardcoded blue, the Expo logo and splash, and the template icon bundle.

**Discussed but NOT implemented:**

- The CMoG permission email is drafted and unsent. It lives in the session scratchpad deliberately, since it carries the user's contact details and the repo is public.
- The Snowflake colorway defect was identified and not fixed.
- Applying CMoG's two null-filling end dates was deliberately deferred pending permission.

**Open threads:**

- Send the CMoG email; expect weeks.
- The Snowflake row (see §5). Needs no permission, is our bug.
- Image generation provider.
- Attributed-upload handle.
- Whether the design survives contact with a real phone.

---

### 5. WHAT COULD GO WRONG

**Known bugs/issues:**

- **`snowflake-turquoise` conflates two patterns.** Our row says colorway "turquoise and white", years 1956 to 1967. Per CMoG, white-on-turquoise ran to 1967 but turquoise-on-white stopped in 1963. Those are different pieces. This now matters more than it did, because `colorways.ts` renders the dish from that field, so a wrong colorway is a visibly wrong swatch.
- **The catalog collapses colorway variants CMoG splits.** Our single `butterprint` row maps to four CMoG entries; `dots` to four. `Pattern.colorway` holds one string, so this is a modelling question before it is a data question.
- **Five patterns have date disagreements** with CMoG beyond the two explained above: `primary-colors`, `sandalwood`, `dots`, `butterfly-gold`, `atomic-eyes`. Two of ours have null end dates CMoG could fill: `snowflake-blue`, `old-town-blue`.
- No rate limiting on `/identify`.
- Pre-existing `props.pointerEvents is deprecated` warning on web, carried over, untouched.

**Edge cases to watch:**

- Collections over 100 items: `/price/batch` caps server-side; `api.ts` chunks.
- Partial price-batch failure fails the whole total deliberately.
- Unpriced items are excluded from totals, not counted as zero, and the UI says so.
- `parseColorway` returns null for anything unrecognised so callers fall back to neutral rather than invent a palette. If catalog data grows new color words, add them to `INK` or swatches silently go grey. The test "every pattern shipped in the catalog parses" is the guard.

**Technical debt / shortcuts:**

- The temporary QA `TabTrigger` technique for `item/[slug]` is documented in `CLAUDE.md` rather than built into the app. That is deliberate; it is a QA affordance, not a feature.
- `backend/README.md` lists six honest limitations. Unchanged.
- Auth provider JWKS verification has never run against a real token.

**Assumptions that could be wrong:**

- **That the design works on a phone.** Everything was verified in a desktop browser at a phone viewport. The native tab bar, SF Symbols, the camera surface, and `item/[slug]` navigation are all unproven on device. Motion was never seen running; only its code was reviewed.
- **That the identification prompt produces good top-3 results.** Never run against a real key. The whole product rests on this.
- **That SoldComps' free tier matches what the code expects.**
- **That the catalog's 379 items are accurate.** Now partially checked against CMoG for the 33 pattern rows; the 379 item rows and all form data remain unverified.
- **That Expo Go still cannot run SDK 57.** True on 2026-08-09. Re-check `npm view expo dist-tags`.

---

### 6. HOW TO THINK ABOUT THIS PROJECT

**1. Core pattern and why.** `item = pattern × form` is the spine and everything joins on `item.slug`. Collectors do not own "Butterprint", they own a Butterprint 444 Cinderella bowl, a different object at a different price from a Butterprint 501 refrigerator dish. The second pattern is **honest labelling**: the app never shows a figure without saying what kind of claim it is. That principle now has three enforcers in code — `PriceFigure` for prices, the swatch mark for colorway art, and the `AiApproximationBadge` for generated images. When you add a new kind of claim, add its label in the same breath.

The design has a third pattern now: **tokens carry roles**. A token used outside its role is the failure mode that would quietly dissolve the whole direction back into generic app design, which is exactly where it started.

**2. Most common mistake a new person would make.** Treating a passing `tsc` as evidence the app works. `tsc` reads tsconfig `paths`; Metro does not. Run `npx expo export --platform ios` after touching `shared/` or `data/`. The design-specific version of this mistake: treating a light-mode screenshot as evidence the design works. Hairline rules carry the entire visual system and they are the first thing that would vanish on a dark ground. Check both, always. A screenshot taken during a Metro hot reload also lies — one was misread this session before the DOM was queried directly.

**3. What looks refactorable but should NOT be touched.** The four privacy measures, for the reasons in session 1's document — they are what make the anonymous option true rather than decorative. Do not simplify `PriceSource` to one implementation; the fallback exists because the primary is a free tier that will run out. And do not "clean up" the reference lock comment in `theme.ts` into something shorter. It is the only thing standing between this design and the next session averaging it back toward defaults, which is the specific way research-led design dies.

---

### 7. DO NOT TOUCH LIST

- Do NOT refactor stable, working systems without being asked.
- Do NOT redesign architecture unless explicitly instructed.
- Preserve existing naming conventions (`item.slug` = `{patternId}-{modelNo}`).
- Maintain previously chosen tradeoffs — they were chosen for reasons documented above.
- **Do NOT upgrade Expo past SDK 56** without checking `npm view expo dist-tags`.
- **Do NOT hardcode the app name** anywhere but `shared/branding.ts`.
- **Do NOT weaken the four privacy measures.**
- **Do NOT render a price without its source label**, or a colorway swatch without its mark.
- **Do NOT move a design token outside its role.** Read the lock in `theme.ts` first.
- **Do NOT ingest pyrex.cmog.org.** Read it as a reference, restate facts in our own words, never crawl it, never store their compiled index, never copy prose or photographs.
- Do NOT rename the repo directory (`Projects/PyDex`).
- Do NOT redeclare a type that lives in `shared/types.ts`.
- Do NOT commit `.env`.
- Do NOT write a global git config; author with env vars matching existing history.

---

### 8. CONFIDENCE & FRESHNESS

| Section | Confidence | Note |
|---|---|---|
| 1. Project identity | ✅ HIGH | Business model stated by user this session |
| 2. What exists — "working" | ✅ HIGH | Typechecks, 40 tests, iOS export, browser render in both themes, all run this session |
| 2. What exists — "blocked" | ✅ HIGH | `item/[slug]` web fallback confirmed empirically, not inferred |
| 3. Architecture | ✅ HIGH | Design layer written and verified this session |
| 4. Recent work | ✅ HIGH | This session |
| 5. Known bugs — Snowflake and date deltas | ✅ HIGH | Derived from CMoG comparison this session |
| 5. Assumptions | ❓ LOW | **Explicitly the unverified list** |
| CMoG constraints | ✅ HIGH | robots.txt verified directly; terms quoted from source |
| Design on a real phone | ❓ LOW | **Never run on a device. Motion never seen running.** |
| Catalog data accuracy | ⚠️ MEDIUM | 33 pattern rows partially checked; 379 item rows and all form data unchecked |
| Identification quality | ❓ LOW | Never run against a real API key |
| Pricing integration | ❓ LOW | Written from docs, never run against a live response |

---

## Next session: a second polish pass

The user's directive: *"next session another polish pass I had claude design come up with a new twist on it that will follow in the next session."*

A new visual direction from Claude Design is expected to arrive at the start of that session. Two things to hold when it does:

**Read the reference lock in `theme.ts` before applying anything.** The current design is not a set of arbitrary preferences; it is a documented synthesis with role rules, and every screen was built against it. A new twist should either replace the lock deliberately, with its own reasoning recorded in the same place, or work within it. What must not happen is a partial application that leaves half the app on one direction and half on another, or that softens the sharp traits back toward generic defaults. If the new direction conflicts with the lock, say so explicitly and get a decision rather than splitting the difference.

**The token layer is the lever.** Every screen reads from `theme.ts` and the shared primitives in `collection-ui.tsx`. A palette, type-scale or radius change propagates without touching a screen. Prefer changing tokens over editing screens, and if a change cannot be expressed as a token, that is a signal worth surfacing.

**Practical notes.** Verify in both light and dark, every time. `/item/[slug]` needs the temporary `TabTrigger` trick to be seen at all. Nothing has run on a phone, so the camera surface, the native tab bar and all motion remain unverified by anyone. If there is an opportunity to get this onto a device before more polish lands, that is worth more than another visual pass.

**One free win available with no permission needed:** the `snowflake-turquoise` colorway defect in §5. It is our own bug, it now produces a visibly wrong swatch, and fixing it touches `data/`, so remember the `expo export` gate.
