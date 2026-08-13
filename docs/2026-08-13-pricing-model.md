# Backstamp pricing model, decided 2026-08-13

**BLUF:** No consumer subscription at launch. Free tier of 25 scans/month, scan
credits as consumable IAP ($1.99/50, $4.99/200, never expire), one photo = one
credit regardless of pieces identified, eBay Partner Network affiliate on the
existing listing link-outs, and a dealer subscription tier parked as a later
epic. The $19.99/yr Pro sub from `2026-08-12-unit-economics.md` is shelved, not
dead: the owner's judgment is the product is not worth a yearly price *yet*, and
credits are the model that only requires one scan to be worth its price once.

## The model

| Piece | Decision |
|---|---|
| Free tier | 25 scans/month, refreshing, no rollover |
| Credits | $1.99 for 50, $4.99 for 200. Consumable IAP, never expire. Two SKUs only. |
| Consumption | One photo = one credit, whether it identifies 1 piece or 8 |
| Error rule | Errored call (network, server) consumes nothing; a completed identify consumes the credit even on no-match |
| Free forever | Collection tracking, browsing, price context. Only the scan is metered, because only the scan costs money per use. |
| Affiliate | eBay Partner Network tags on listing link-outs. Requires an application and a check of their in-app link rules first. Network work belongs to the orchestrator, not Codex. |
| Dealer tier | Later epic. $49 to $99/yr subscription for dealers and estate-sale companies, gated on bulk import, CSV export, sold-comps history. This is where subscriptions return, priced against a business need (the Untappd pattern: the B2B tier dwarfs the consumer sub). |

## Arithmetic (inputs from 2026-08-12-unit-economics.md, post-doubling scaled)

- Scan cost: $0.00253 warm, $0.0077 cold ceiling, $0.00343 set scan.
- Free tier worst case: 25 x $0.00253 = $0.063/user/month, $0.76/user/year.
- $1.99/50 nets $1.69 after Apple 15%; $0.0338 net per credit against at most
  $0.0077 API, margin 4.4x cold, ~13x warm.
- $4.99/200 nets $4.24; $0.0212 net per credit, margin 2.8x even all-cold.
- Fixed costs $171 to $255/yr need roughly 100 to 150 small packs or 40 to 60
  large packs per year before affiliate revenue. That is the trade against the
  10 to 15 subscribers a $19.99 sub needed, accepted knowingly.

## Why one photo = one credit

A set scan costs 1.4x a single scan ($0.00343 vs $0.00253): the catalog prompt
dominates and extra pieces are only output tokens. Charging per piece would be
an 8x markup on a 1.4x cost, plus a "that photo cost 6 credits" surprise this
audience punishes in reviews. Gaming is self-limiting: the shelf-photo probe
(`docs/2026-08-10-shelf-photo-probe.md`) measured that cramming a shelf into one
frame yields about four tiles of detail across forty dishes and hallucinated
nesting sets, and the set-review flow caps at 8 pieces per photo. Worst honest
case: 8 identifications for one credit, $0.0034 cost against ~$0.034 net.

## Rejected, and why

- **$19.99/yr consumer Pro (the unit-economics recommendation):** shelved. A
  subscription claims ongoing value; at launch with zero reviews and an
  unverified phone build, the only honest claim is per-use. Strictly upgradeable
  later (CollX added Pro after launch); the reverse direction reads as a price
  collapse.
- **$3 one-time:** killed by the unit-economics doc (unbounded lifetime
  liability, cannot fund fixed costs). A capped one-time was viable but credits
  dominate it: same bounded liability, recurring purchases.
- **BYOK (user brings a Gemini key):** dead for this demographic.
- **Ads:** dead at this scale.
- **Per-piece credit consumption:** see above.
- **Marketplace now:** right long-run engine, wrong scope for launch. Affiliate
  is the marketplace-shaped revenue that ships without building one.

## Revisit triggers

- At launch: re-run every price in unit-economics section 1 (snapshot of
  2026-08-12) and re-measure identify tokens against catalog v6 (nobody has
  since the doubling; the handoff flags it).
- When reviews and sold-comps history exist: reconsider the consumer Pro sub.
- When bulk import + CSV export + sold comps all ship: start the dealer epic.
- If SoldComps needs its paid tier: price it then.
