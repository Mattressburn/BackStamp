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

**Pinned to Expo SDK 56. Do not upgrade to 57.** The old reasoning here is dead,
measured 2026-08-11 on a real iPhone: the App Store build of Expo Go is 54.0.2 and runs
SDK 54 only, so this project was never testable in Expo Go on an iPhone at any SDK, and
the `npm view expo dist-tags` heuristic that used to live in this paragraph predicted
nothing about Expo Go. expo.dev/go serves Expo Go builds for SDK 54 through 57, but
only as Android APKs and iOS simulator images. Phone testing on iPhone goes through an
EAS development build with `expo-dev-client` (profile in `app/eas.json`), which carries
its own runtime and makes Expo Go compatibility irrelevant. The SDK 56 pin stays until
hardware testing passes on a dev build; after that an SDK bump is a normal upgrade
decision, one variable at a time.

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

**Do not touch CMoG's photographs, and do not re-fetch their site.** The pattern
library was read once, politely, on 2026-08-11: all 174 pattern pages, sequential,
about 1.2s apart, through a real browser, text fields only, no image downloads. The
raw fields live in `data/cmog-cache/` (gitignored, because their prose is copyrighted
and must never ship or be committed; only facts restated in our own words go into the
catalog). One page, `gooseberry-white-pink`, is broken on their end with a redirect
loop; `gooseberry-pink-white` is the working entry. There is no reason to fetch the
site again; work from the cache. CMoG confirms that factual information may be
restated without a license. Screenshots and direct quotations of chunks of its text are expressly carved
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

Two path traps measured on 2026-08-12. The dev backend (tsx watch) reloads on source
changes but NOT on `data/catalog.json`; after a catalog rebuild, restart the backend or
phones keep receiving the old version. And the live database is `backend/data/pydex.db`
via `DATABASE_PATH` in `backend/.env`; `scripts/eval-scans.ts` defaults to
`catalog.sqlite` (wrong, near-empty), so harness runs must export `DATABASE_PATH` or
they will replay nothing and report it as an empty pile.

There is no iOS Simulator on Linux. Physical phone via an EAS development build (NOT
Expo Go; see the SDK pin note above), or the web preview. The phone path, all cached
and working since 2026-08-12: Expo account `mattressburns-team` (log in with
`npx eas-cli@latest login`, browser flow, the account has no password because it uses
Sign in with Apple), Apple Developer team KD5M56J9BM, bundle id `com.backstamp.app`,
the user's iPhone registered for ad hoc builds. Rebuild with
`npx eas-cli@latest build --platform ios --profile development` from `app/`, run it in
a visible terminal because Apple periodically re-asks for sign-in and two-factor.
JavaScript changes hot-reload to the connected dev client; only native assets (icon,
splash) and native config need a rebuild. Backend sign-in needs `APPLE_CLIENT_ID` in
`backend/.env` (see .env.example). Start the dev server with
`EXPO_PUBLIC_API_URL=http://192.168.69.221:8787` so the phone reaches the LRPC
backend; the baked-in default points at MRDockBox where nothing listens.

**Verify the browser preview by reading computed styles, not by looking at a screenshot.**
This has now cost two sessions. Session 2 misread a screenshot taken mid hot-reload;
session 3 could not locate the file Playwright claimed to write. `page.evaluate` against
`getComputedStyle` is the reliable check and it is what proved the offset shadows render.
Three traps: walk `*`, not `div`, because React Native Web maps `Pressable` to a
`<button>` and a div-only sweep reports zero shadows on a page full of them; switch
themes with `page.emulateMedia({ colorScheme })` AND reload, the palette is read at
mount; and drive taps with Playwright's real click (`force: true` when the fixed tab
bar intercepts the hit test), because Pressable ignores synthetic `element.click()`
from page scripts and the tap silently does nothing.

**Populated screens need the backend running.** `bootstrap()` seeds from the bundled
catalog, but the browser preview reaches `/catalog` at the MRDockBox address and with the
backend down the collection screens sit in their empty state, so rows, tiles, file tabs
and swatch marks cannot be QA'd. Start `npm --prefix backend run dev` first, or accept
that only the empty and settings screens are verifiable.

`/item/[slug]` routes everywhere since 2026-08-13: the route tree is a root Stack over
a `(tabs)` group (the piece page used to be an unregistered tab route that rendered
nothing when pushed on device, and needed a temporary fourth `TabTrigger` on web; both
workarounds are dead, and `app-tabs.test.ts` guards the tree). Check dark mode every
time: the offset shadows now carry the whole design, and their dark colors are a
derivation this project made rather than a value the handoff supplied, so they are the
first thing that would fail there.

Git has no configured identity in this repo. History is authored `Claude
<noreply@anthropic.com>` via `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars on the commit
command. Match that rather than writing a global git config.
