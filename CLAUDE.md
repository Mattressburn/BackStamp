# Backstamp

Vintage Pyrex identification and collection tracking. Photograph a dish, identify it,
see comparable sale prices, track have/want.

Read `AGENTS.md` for file ownership and the build contract, and
`docs/superpowers/specs/2026-08-09-backstamp-design.md` for the design spec and the
reasoning behind each decision. `README.md` has run commands and honest status.

## Rules that are easy to break by accident

**The app name lives only in `shared/branding.ts`.** Never hardcode it. It is
**Backstamp** as of 2026-08-10 (`isCodename: false`). The repo directory is still
`Projects/PyDex`, that is deliberate, do not rename it.

**Pinned to Expo SDK 56. Do not upgrade to 57.** The App Store build of Expo Go refuses
a project newer than itself, so SDK 57 cannot be tested on a phone. Before any SDK bump,
check `npm view expo dist-tags`, when `latest` and `next` point at the same version,
that SDK is too new for Expo Go.

**`shared/types.ts` is the single source of truth for both sides.** Never redeclare a
type that lives there; add to it instead.

**`item = pattern × form`.** Butterprint on a 444 Cinderella bowl and on a 501
refrigerator dish are different collectibles at different prices. `item.slug` joins
catalog rows, identification guesses, eBay queries, collections, photos, and prices.
Price and ownership attach to the item, never the pattern.

**Never render a bare price.** Sold prices and asking prices are different claims and
collectors know the difference. Every figure carries its source label.

**Do not weaken these, they are deliberate:** EXIF is stripped server-side before bytes
touch disk; auth stores the provider subject ID and nothing else; sync carries slugs and
counts only, so `condition`/`notes` stay device-local; AI placeholder images are
generated from a written description, never image-to-image from a user photo.

**The design has a reference lock, and it lives in the header of
`app/src/constants/theme.ts`.** Read it before changing anything visual. It has been
replaced once, on 2026-08-10, and the header records the old direction and why it went.
The short version of the current one: the reference is a 1970s card file, so separation
is a solid offset shadow with no blur, in a darker tone of the ground beneath. A blur
radius anywhere in the app is a bug. Buttons press 3px down and lose that offset;
nothing scales. One family, Rubik, at 400/700/900. Tokens carry roles, the accent is
the header band and primary actions but never a page ground, rarity colors are only
ever rank, colorway hex is only ever a swatch, and `CameraChrome` belongs to the scan
flow alone because it sits over a live camera feed and does not follow the app theme.
Moving a token outside its role is the specific failure mode to avoid.

**Read elevation through `useElevation()`, never `Elevation.card`.** It is keyed by
scheme, because the offset colors are palette values and a light tan offset reads as a
pale smear on the dark ground. It is expressed as `boxShadow`, the one shadow API that
renders on iOS, Android and web alike, so the browser preview shows what the phone
will. The bundled fonts are OFL and `app/assets/fonts/OFL.txt` ships with them.

**A colorway swatch is not a photograph.** `app/src/constants/colorways.ts` turns a
pattern's documented prose colorway into the two colors it names, so a piece with no
photo still arrives wearing its real colors. It must always be labelled as a swatch,
same reasoning as never rendering a bare price.

**Do not raise the 1024px upload bound expecting better accuracy.** Measured on
2026-08-10: Gemini reported exactly 1064 image input tokens for the same photo sent at
5712px, 2048px and 1024px. It downsamples to the same tile budget regardless, so a bigger
upload buys nothing the model can see and only costs bytes and battery. The same
measurement is why a shelf photo can never carry a whole collection: about four tiles of
detail spread across forty dishes. See `docs/2026-08-10-shelf-photo-probe.md`, which also
records that the model answers a wide frame by emitting canonical nesting sets
(441/442/443/444) at 0.80 to 1.00 confidence while its own evidence field contradicts the
slug in the same row.

**Do not crawl the Corning Museum Pyrex Pattern Library, and do not touch its
photographs.** CMoG confirms that factual information may be restated without a
license. Screenshots and direct quotations of chunks of its text are expressly carved
out. Its photographs remain separately copyrighted, and its reply does not cover the
Pyrex pattern artwork, which belongs to Corning or Instant Brands rather than CMoG.
CMoG requested source recognition and a link; Settings now provides both for pattern
names and production dates. The site carries no model numbers, so it cannot produce
items on its own.

**Launch obligation:** Send the live app link to Suzanne Abrams Rebillard, Managing
Editor, Publications, at CMoG.

## Commands

```bash
npm --prefix backend run dev                                        # backend on :8787
cd app && npx expo start                                            # Expo Go on a phone
cd app && npx expo start --web                                      # browser preview

npm --prefix backend run typecheck && (cd app && npx tsc --noEmit)
cd backend && node --import tsx --test "src/**/*.test.ts"           # 26
cd app     && node --import tsx --test "src/**/*.test.ts"           # 18
cd scripts && node --import tsx --test "*.test.ts"                  #  4
cd app && npx expo export --platform ios                            # Metro resolves @shared/@data
```

Tests need `--import tsx`: tsconfig path aliases and NodeNext `.js` imports are both
invisible to bare `node --test`. Run the Expo export after touching `shared/` or
`data/`, `tsc` reads tsconfig `paths` and Metro does not, so a green typecheck is not
evidence the app bundles.

There is no iOS Simulator on Linux. Physical phone via Expo Go, or the web preview.

**Verify the browser preview by reading computed styles, not by looking at a screenshot.**
This has now cost two sessions. Session 2 misread a screenshot taken mid hot-reload;
session 3 could not locate the file Playwright claimed to write. `page.evaluate` against
`getComputedStyle` is the reliable check and it is what proved the offset shadows render.
Two traps in that query: walk `*`, not `div`, because React Native Web maps `Pressable`
to a `<button>` and a div-only sweep reports zero shadows on a page full of them; and
switch themes with `page.emulateMedia({ colorScheme })` rather than trusting a default.

**Populated screens need the backend running.** `bootstrap()` seeds from the bundled
catalog, but the browser preview reaches `/catalog` at the MRDockBox address and with the
backend down the collection screens sit in their empty state, so rows, tiles, file tabs
and swatch marks cannot be QA'd. Start `npm --prefix backend run dev` first, or accept
that only the empty and settings screens are verifiable.

The web preview only routes tab screens, so `/item/[slug]` silently falls back to Scan,
confirmed, not folklore. To see that screen in a browser, add a temporary fourth
`TabTrigger` for it in `app-tabs.web.tsx`, shoot it, then revert. Check dark mode every
time: the offset shadows now carry the whole design, and their dark colors are a
derivation this project made rather than a value the handoff supplied, so they are the
first thing that would fail there.

Git has no configured identity in this repo. History is authored `Claude
<noreply@anthropic.com>` via `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars on the commit
command. Match that rather than writing a global git config.
