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

## Commands

```bash
npm --prefix backend run dev                                        # backend on :8787
cd app && npx expo start                                            # Expo Go on a phone
cd app && npx expo start --web                                      # browser preview

npm --prefix backend run typecheck && (cd app && npx tsc --noEmit)
cd backend && node --import tsx --test "src/**/*.test.ts"           # 23
cd app     && node --import tsx --test "src/features/**/*.test.ts"  #  5
cd scripts && node --import tsx --test "*.test.ts"                  #  4
cd app && npx expo export --platform ios                            # Metro resolves @shared/@data
```

Tests need `--import tsx`: tsconfig path aliases and NodeNext `.js` imports are both
invisible to bare `node --test`. Run the Expo export after touching `shared/` or
`data/` — `tsc` reads tsconfig `paths` and Metro does not, so a green typecheck is not
evidence the app bundles.

There is no iOS Simulator on Linux. Physical phone via Expo Go, or the web preview.
