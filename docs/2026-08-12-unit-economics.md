# Backstamp Unit Economics (as of 2026-08-12)

**BLUF:** A scan costs a quarter of a cent. The worst persona (power/dealer, 300 scans/month) costs $0.76/month in API fees. A $3 one-time price nets $2.55 after Apple's 15% and survives a casual user for ~8 years, an active user ~14 months, and a power user ~3.4 months, but it cannot fund the fixed costs ($170 to $260/year) without ~70 to 100 sales per year, and it gives every buyer an unbounded lifetime API liability. The category's no-marketplace survivors all charge recurring subscriptions. Recommended shape: generous free tier (50 scans/month), Backstamp Pro at $19.99/year or $2.99/month gating bulk import, unlimited scans, and sold-comps history. The one-year marketplace ambition is the real revenue plan, not a nice-to-have.

**API prices change without notice. Re-run every number in this file against live pricing pages at launch.**

---

## 1. Verified prices (all checked 2026-08-12)

| Item | Price | Source |
|---|---|---|
| Gemini flash-lite input (text/image), paid standard | $0.25 / 1M tokens | https://ai.google.dev/gemini-api/docs/pricing |
| Gemini flash-lite cached input | $0.025 / 1M tokens | same |
| Gemini flash-lite output | $1.50 / 1M tokens | same |
| Gemini flash-lite Batch tier (async) | half of all the above | same |
| claude-opus-5 input / output | $5 / $25 per 1M tokens | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-opus-5 image OUTPUT | **no per-image SKU listed** (see 3.4) | same |
| Apple commission, Small Business Program | 15% (under $1M/yr proceeds; new developers eligible day one; annual re-enroll) | https://developer.apple.com/app-store/small-business-program/ |
| Apple Developer Program | $99/year | (known, unchanged) |
| eBay Browse API | free, ~5,000 calls/day default; active listings only | https://developer.ebay.com/api-docs/buy/browse/overview.html |
| eBay Marketplace Insights (sold data) | Limited Release, "restricted and not open to new users" | https://apis.io/apis/ebay/marketplace-insights-api/ |
| SoldComps (project's comps provider) | free tier ~50 req/month per project spec; paid tiers **unverified** | repo: docs/superpowers/specs/2026-08-09-backstamp-design.md |
| EAS (Expo) Free plan | $0: 15 Android + 15 iOS builds/month, 1K MAU updates | https://expo.dev/pricing |
| EAS paid | Starter $19/mo, Production $199/mo; overage $1-2 Android, $2-4 iOS per build | same |
| Small VPS at launch | ~$5 to $12/month (Hetzner/DO class), assumed | assumption |

Fixed annual cost at launch: $99 (Apple) + $60 to $144 (VPS) + ~$12 (domain) = **$171 to $255/year**. EAS free tier suffices: JS hot-reloads to the dev client, only native changes need builds, and 15 iOS builds/month is far above the observed cadence.

---

## 2. Token model per identify call

Measured base (project instrumentation): 17,050 total input tokens, 13,406 served from Gemini's implicit prefix cache on the second call, exactly 1,064 image tokens per photo at any resolution, output a few hundred tokens of JSON.

Catalog grew ~70%. Scaling the text portion proportionally:

| Component | Base | After +70% catalog | Note |
|---|---:|---:|---|
| Image tokens (1 photo) | 1,064 | 1,064 | resolution-independent, does not scale |
| Text tokens (prompt + catalog) | 15,986 | 27,176 | 15,986 x 1.7 |
| Total input | 17,050 | 28,240 | |
| Cached portion (warm) | 13,406 | 22,790 | 13,406 x 1.7 |
| Uncached portion (warm) | 3,644 | 5,450 | includes the 1,064 image tokens |

Output assumptions: single scan ~400 tokens, set scan (up to 8 pieces) ~1,000 tokens.

---

## 3. Per-unit costs

### 3.1 Single scan (1 photo, warm cache)

| Line | Arithmetic | Cost |
|---|---|---:|
| Uncached input | 5,450 x $0.25 / 1M | $0.00136 |
| Cached input | 22,790 x $0.025 / 1M | $0.00057 |
| Output (400 tok) | 400 x $1.50 / 1M | $0.00060 |
| **Total** | | **$0.00253** |

Two-photo scan adds 1,064 x $0.25/1M = $0.00027, total **$0.0028**. Cold cache (first call, nothing cached): 28,240 x $0.25/1M + $0.0006 = **$0.0077**. The prefix cache cuts per-scan cost 3x ($0.0077 to $0.0025); implicit caching is best-effort, so treat $0.0077 as the per-scan ceiling.

### 3.2 Set scan (1 photo, up to 8 pieces, warm)

| Line | Arithmetic | Cost |
|---|---|---:|
| Input (warm) | as above | $0.00193 |
| Output (1,000 tok) | 1,000 x $1.50 / 1M | $0.00150 |
| **Total** | | **$0.00343** |

### 3.3 100-photo bulk import (100 sequential set-scan calls)

| Line | Arithmetic | Cost |
|---|---|---:|
| First call (cold) | $0.00706 + $0.00150 | $0.0086 |
| 99 warm calls | 99 x $0.00343 | $0.3397 |
| **Total** | | **$0.348 ≈ $0.35** |

Worst case (every call cold, no cache hits): 100 x $0.0086 = **$0.86**. On the Gemini Batch tier (half price, async), the same import is **~$0.17**. Even the "cost bomb" is under a dollar per hundred photos.

### 3.4 Placeholder image (claude-opus-5)

Anthropic's pricing page lists no image-output SKU as of 2026-08-12, so this is modeled as output tokens at $25/1M with an assumed 1,300 to 4,800 tokens per generated image (bracketed by Gemini's ~1,290-token image outputs and Claude's 4,784-token high-res image ceiling). **Verify against the `usage` field of an actual generation call; this is the least certain number in this file.**

| Line | Arithmetic | Cost |
|---|---|---:|
| Input (~500 tok description) | 500 x $5 / 1M | $0.0025 |
| Image output, low | 1,300 x $25 / 1M | $0.033 |
| Image output, high | 4,800 x $25 / 1M | $0.120 |
| **Per placeholder** | | **$0.03 to $0.12** |
| All 236 patterns, worst case | 236 x $0.122 | **$28.90 one-time** |

At most once per pattern, and community photos replace placeholders over time, so this is a bounded one-time cost under ~$30 total. It is not a unit-economics driver.

### 3.5 Price context

eBay Browse is free (5,000 calls/day). SoldComps free tier is ~50 requests/month with weekly per-item caching, so comps calls scale with distinct items viewed per week, not with scans. **SoldComps paid-tier pricing was not verifiable and is the real unknown cost center at scale; re-check before launch.** Falling back to Browse when quota is exhausted (already implemented) caps this cost at zero.

---

## 4. Persona monthly API cost

| Persona | Usage | Arithmetic | Monthly cost |
|---|---|---|---:|
| Casual | 10 scans/mo | 10 x $0.00253 | **$0.025** |
| Active, month 1 | 60 scans + one 100-photo import | 60 x $0.00253 + $0.348 | **$0.50** |
| Active, ongoing | 60 scans/mo | 60 x $0.00253 | **$0.15** |
| Power/dealer | 300 scans/mo | 300 x $0.00253 | **$0.76** |
| Power + monthly 100-photo import | 300 scans + import | $0.76 + $0.35 | **$1.11** |

---

## 5. The $3 test

Net of Apple's 15% Small Business rate: $3.00 x 0.85 = **$2.55 per sale** (one-time or first subscription payment alike; the program applies from day one for new developers).

### $3 one-time: months until the margin is gone

| Persona | Arithmetic | Months funded |
|---|---|---:|
| Casual | $2.55 / $0.025 | **102 (~8.5 years)** |
| Active | ($2.55 - $0.50 month 1) / $0.152 + 1 | **~14.5** |
| Power | $2.55 / $0.756 | **~3.4** |

### $3/month subscription (net $2.55/mo)

| Persona | Monthly margin |
|---|---:|
| Casual | $2.53 |
| Active | $2.40 |
| Power | $1.79 |

Positive for every persona, forever. Overkill relative to costs.

### $12/year subscription (net $10.20/yr)

| Persona | Annual API cost | Annual margin |
|---|---:|---:|
| Casual | $0.30 | $9.90 |
| Active (yr 1, with import) | $2.17 | $8.03 |
| Power | $9.07 | **$1.13** |

Power users nearly eat a $12/year price. $19.99/year (net $17.00) leaves a $7.93 margin even on power users.

### What $3 one-time can and cannot fund

It CAN fund the median (casual) user's API costs essentially forever, and an active user for over a year. It CANNOT fund: (a) fixed costs, which need 67 to 100 sales per year at $2.55 net just to break even before any API spend; (b) the power tail, where a single $2.55 sale is exhausted in 3.4 months and every month after that is a loss; (c) any future cost growth (SoldComps paid tier, bigger catalog, retries), because one-time revenue is fixed while the liability is lifetime. If a one-time price is wanted at all, the number that survives an active user for 5 years plus a fixed-cost share is **$10 to $15 one-time**, not $3.

---

## 6. How the comparables actually make money (owner follow-up)

The pricing sticker and the revenue engine are different things. Classification, with what collectors pay:

| App | What collectors pay | Real revenue engine | Class |
|---|---|---|---|
| Discogs | $0 (collection tracking free) | **9% seller fee** on item + shipping, min $0.10, max $150 (https://support.discogs.com/hc/en-us/articles/360007521674, confirmed current 2026) | Marketplace commission |
| Vivino | Premium ~$2 to $8/mo by country | **15% commission on wine sales** described as the bulk of revenue; Premium and ads are secondary (https://productmint.com/vivino-business-model-how-does-vivino-make-money/) | Marketplace commission |
| eBay | $0 to browse | **~13.6% final value fee** + $0.30-0.40/order (https://taxomate.com/blog/ebay-seller-fees) | Marketplace commission |
| CollX | Pro $10/mo or $100/yr (https://collx.app/collx-pro) | Premium subscription, plus marketplace/checkout features layered on | Premium subscription |
| Untappd | Insiders $5.99/mo or $54.99/yr (help.untappd.com) | **Untappd for Business: $899 to $1,199/year per venue** SaaS (https://utfb.untappd.com/get-pricing/). The B2B tier prices at 16 to 22x the consumer tier, which is consistent with the claim that B2B is the real revenue; the consumer sub is pocket change next to it | B2B SaaS, consumer sub secondary |
| PSA app | $0, unlimited scanning | **Grading fees** (bulk service from roughly $20/card); the free scanner exists to originate grading submissions and eBay listings | Services funnel |
| Numista | Premium ~55 to 60 EUR/yr | Ads + eBay Partner Network affiliate + premium; catalog explicitly free forever (https://en.numista.com/) | Ads/affiliate + premium |
| Colnect | Premium 9.99 EUR/mo or 99 EUR/2yr | Premium memberships + ads | Premium + ads |

**Free-vs-premium boundary norms in the category:** scanning/identification is almost never the gate (CollX and PSA give it away because the scan IS the funnel). The common gates are: advanced pricing data and price history (CollX Pro), bulk operations, collection size caps (CLZ trial caps at 100 items, Sortly free caps at 100 items), and ad removal (Numista, Colnect).

### The no-marketplace survivors

| App | Model | Pricing | Age |
|---|---|---|---|
| CLZ / Collectorz | Pure paid subscription, per vertical, no marketplace, no ads | $1.99/mo or ~$19.99/yr **per app** (Comics, Movies, Books, Music, Games are separate subs; all five ~$75 to $100/yr); free trial capped at 100 items (https://clz.com/, app store listings) | 20+ years in business |
| Sortly | Freemium B2B inventory SaaS | Free capped at 100 items; paid $49 to $299/mo (https://www.sortly.com/pricing/) | Long-lived, but B2B |
| Numista / Colnect | Free catalog + premium + ads/affiliate | See above | 15+ years each, run lean, community-cataloged content (no per-use AI cost) |

**The honest pattern:** free collection trackers are funnels for something else (marketplace commission, grading fees, B2B SaaS), and standalone no-marketplace trackers are paid recurring subscriptions with hard free-tier caps. Numista and Colnect survive free-ish only because their marginal cost per user is ~zero (static community catalogs, no AI calls) and they still charge premium members. **No example was found of a free-forever tracker with per-use AI costs funded by a small one-time price.** This frames the one-year marketplace timeline as the revenue plan, not a nice-to-have: Backstamp's long-run shape is Discogs (free tracking, take a cut of sales), and the subscription bridges the year until the marketplace exists.

---

## 7. Cost-control levers, quantified

| Lever | Effect | Status |
|---|---|---|
| Prefix cache (catalog block byte-stable, first in prompt) | $0.0077 to $0.0025 per scan, a 67% cut; saves ~$1.55 per 1,000 warm scans | Already working (13,406 tokens measured cached); protect it, any byte change in the catalog block invalidates it |
| Free-tier scan cap | 50 scans/month caps a free user at $0.13/mo ($1.52/yr) worst case; 10/day burst cap stops abuse scripts | Recommend at launch |
| Bulk import as premium-only | It is the only feature that lets one user spend real money in a day (500-photo import = $1.75, or $4.30 all-cold); gating it puts the cost bomb behind revenue | Recommend; also run imports on the Gemini Batch tier for half price ($0.17/100) since bulk is already async by nature |
| Community photos replace placeholders | Eliminates the claude-opus-5 spend entirely; bounded at ~$30 one-time regardless | Passive |
| Self-hosted / cheaper model for the easy 80% | Weak as a COST lever: flash-lite is already near the price floor, so a free self-hosted model saves at most $0.0025/scan (~$150/mo only at ~60,000 scans/mo, roughly 1,000 active-persona users). The accumulating labeled training data is worth pursuing for accuracy, latency, offline mode, and rate-limit independence, not for cost at launch scale | Later |
| SoldComps quota | Weekly per-item cache + Browse fallback already caps this at $0; if paid tier is ever needed, price it then | Watch item |

---

## 8. Marketplace-era revenue references (LATER)

Discogs takes 9%, eBay ~13.6%, Vivino 15%. A Pyrex-niche marketplace at a Discogs-like 9% on a typical $40 vintage piece yields **$3.60 per transaction**, which exceeds a full YEAR of power-user API cost ($9.07/yr covers 2.5 sales). A realistic take for a trusted niche marketplace is 8 to 10%; below eBay's 13.6% is itself a seller pitch. Even 20 transactions/month at $40 average is $864/year, several times the fixed cost base.

---

## 9. Recommendation

**Launch shape:**

- **Free tier:** unlimited collection tracking, 50 identify scans/month (10/day burst cap), active-listing price context, community photos. Worst-case free user costs $1.52/year; the scan is the acquisition funnel, per category norm.
- **Backstamp Pro: $19.99/year or $2.99/month.** Gates: bulk camera-roll import, unlimited scans, sold-comps price history, CSV export. This sits mid-category: same as one CLZ vertical ($19.99/yr), a fifth of CollX Pro ($100/yr), a third of Untappd Insiders ($54.99/yr).

**Break-even at $19.99/yr (net $17.00):**

| Question | Arithmetic | Answer |
|---|---|---:|
| Pro subs to cover fixed costs ($171 to $255/yr) | $255 / $17 | **10 to 15 subscribers** |
| Margin per Pro power user | $17.00 - $9.07 | $7.93/yr |
| Margin per Pro active user | $17.00 - $2.17 | $14.83/yr |

**$3 one-time verdict, plainly:** it is not killed by per-user API margin (the median user costs 2.5 cents a month), it is killed by shape. It needs 67 to 100 sales/year just to pay Apple and the VPS, it loses money on every power user after month 4, and it books zero recurring revenue against a lifetime recurring liability. The number that works one-time is $10 to $15; the number that works, period, is a $19.99/year subscription, with the 9% marketplace as the long-run engine the category says it must become.

**Re-run this model at launch. Every API price in section 1 is a snapshot of 2026-08-12.**
