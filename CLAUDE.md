# Backstamp

Vintage Pyrex identification and collection tracking. Photograph a dish, identify it,
see comparable sale prices, track have/want.

Read `AGENTS.md` for file ownership and the build contract, and
`docs/superpowers/specs/2026-08-09-backstamp-design.md` for the design spec and the
reasoning behind each decision. `README.md` has run commands and honest status.

## Rules that are easy to break by accident

**The app name lives only in `shared/branding.ts`.** Never hardcode it. It is
**Backstamp** as of 2026-08-10 (`isCodename: false`). The repo directory is still
`Projects/PyDex` — that is deliberate, do not rename it.

**Pinned to Expo SDK 56. Do not upgrade to 57.** The App Store build of Expo Go refuses
a project newer than itself, so SDK 57 cannot be tested on a phone. Before any SDK bump,
check `npm view expo dist-tags` — when `latest` and `next` point at the same version,
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
nothing scales. One family, Rubik, at 400/700/900. Tokens carry roles — the accent is
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
photo still arrives wearing its real colors. It must always be labelled as a swatch —
same reasoning as never rendering a bare price.

**Do not ingest the Corning Museum Pyrex Pattern Library.** `pyrex.cmog.org` is the
obvious place to fix the catalog and it is off limits as a source: its robots.txt
disallows ClaudeBot and declares `ai-train=no, use=reference`, its terms restrict
commercial use, and it carries no model numbers anyway, so it cannot produce items.
Read it as a reference and restate facts in our own words. A permission request was
drafted 2026-08-10 and had not been answered.

## Commands

```bash
npm --prefix backend run dev                                        # backend on :8787
cd app && npx expo start                                            # Expo Go on a phone
cd app && npx expo start --web                                      # browser preview

npm --prefix backend run typecheck && (cd app && npx tsc --noEmit)
cd backend && node --import tsx --test "src/**/*.test.ts"           # 23
cd app     && node --import tsx --test "src/**/*.test.ts"           # 13
cd scripts && node --import tsx --test "*.test.ts"                  #  4
cd app && npx expo export --platform ios                            # Metro resolves @shared/@data
```

Tests need `--import tsx`: tsconfig path aliases and NodeNext `.js` imports are both
invisible to bare `node --test`. Run the Expo export after touching `shared/` or
`data/` — `tsc` reads tsconfig `paths` and Metro does not, so a green typecheck is not
evidence the app bundles.

There is no iOS Simulator on Linux. Physical phone via Expo Go, or the web preview.

The web preview only routes tab screens, so `/item/[slug]` silently falls back to Scan —
confirmed, not folklore. To see that screen in a browser, add a temporary fourth
`TabTrigger` for it in `app-tabs.web.tsx`, shoot it, then revert. Check dark mode the
same way (`page.emulateMedia({ colorScheme: 'dark' })`); the hairline rules that carry
the whole design are the first thing that would fail there.

Git has no configured identity in this repo. History is authored `Claude
<noreply@anthropic.com>` via `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars on the commit
command. Match that rather than writing a global git config.
