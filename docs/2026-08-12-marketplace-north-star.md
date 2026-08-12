# Marketplace, filed as an extended goal: Discogs for Pyrex

Date: 2026-08-12. The user's framing: if this really takes off, a marketplace where
collectors list what they have or want, with the app taking a small percentage of
each sale. The user's model, in their words: "Discogs for Pyrex." Recorded here so
the idea and its honest sizing survive session handoffs. Nothing below is scheduled
work.

## Why Discogs is the right model, and why the substrate is already built

Discogs works because sellers list against a canonical catalog entry rather than
writing free-form listings. That one structural choice cuts fraud and moderation
cost, makes search trivial, and turns every sale into a price-history datapoint for
that exact entry. This app is already Discogs-shaped: a canonical catalog with
community submissions and moderation flags, collection and wantlist keyed by catalog
entry, a condition scale (mint through damaged, the Goldmine grading equivalent),
and per-entry price display. The missing layer is listings and orders, nothing
structural.

The strategically largest consequence: a working marketplace generates first-party
sold-price data per catalog entry, which over time replaces the eBay and SoldComps
dependencies the price feature currently rents. The marketplace would not just earn
a percentage; it would own the data the whole app runs on.

## Staged path, smallest honest steps first

1. **Matching and interest pings (small, one or two sessions).** Opt-in only:
   "N collectors are hunting this piece you own," and an anonymous in-app ping
   between a haver and a wanter. No payments, no addresses, no listings. Fits the
   current privacy architecture (subject ID only) untouched. The price-comps eBay
   links could carry affiliate tags at the same time, which is revenue without
   becoming a marketplace at all.
2. **Classifieds (medium).** Listings with asking prices, transaction happens
   off-platform between collectors. First real moderation burden (fakes,
   reproductions, scams) and the first reputation problem, but still no money
   handling and no facilitator status.
3. **The percentage-taking marketplace (large, a different business).** Payment
   processing with seller onboarding and identity verification (Stripe Connect or
   equivalent), payouts, refunds, chargebacks, marketplace facilitator sales tax
   in most US states, 1099-K reporting, dispute resolution, and the domain's
   defining failure mode: vintage glass breaking in the mail. eBay's entire
   buyer-guarantee apparatus exists because of exactly this category of problem.
   Physical goods are exempt from Apple's in-app purchase cut, so Stripe is
   permitted on iOS; that is the one piece of good news.

## The standing conflict to resolve before stage 3

The app deliberately stores the auth provider subject ID and nothing else, and sync
deliberately carries catalog entries and counts only. A marketplace requires names,
shipping addresses, and payment identity. If stage 3 ever happens, that data must
live in a separately consented, separately stored domain so the scanning and
collection features keep their privacy promises. Do not let marketplace identity
requirements leak backward into the core app.
