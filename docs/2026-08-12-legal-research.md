# Backstamp: legal and policy obligations for an App Store launch

Research dated 2026-08-12. **This is not legal advice.** I am not a lawyer. This is
research to prepare the questions you take to one, and to prepare the artifacts (a
document, a screen, an endpoint) that you have to build either way. Every load-bearing
claim carries the URL I actually opened. Anything I could not fetch is marked `verify`.

Scope assumed: launch is a **collection tracker** (scan, identify, price context, have/want),
free, no payments, no ads, US developer in **Massachusetts**, data on the developer's own
server. Marketplace is a year out and lives in LATER.

---

## BLUF: the ranked lists

### BLOCKING before App Store submission

| # | Item | What the implementation actually is |
|---|---|---|
| B1 | **Privacy policy, publicly hosted and linked in-app** | One HTML page on a URL you control, plus a `Row` in the Settings "About" group that opens it, plus the App Store Connect privacy policy URL field. Apple 5.1.1(i) requires both the metadata link and an in-app link. |
| B2 | **In-app account deletion** | A destructive `Row` in Settings, and a `DELETE /account` route with `requireAuth` in `backend/src/app.ts`. There is no such route today (routes end at `POST /auth/session`). Must delete `collection`, `scans` + `scan_photos`, `photos` where `uploader_id` matches, and the JPEG files on disk. |
| B3 | **Sign in with Apple token revocation on deletion** | The `DELETE /account` handler must call Apple's revoke endpoint. Today `/auth/session` only *verifies* an identity token (`backend/src/app.ts:575`), so there is no refresh token to revoke; this needs an authorization-code exchange added at sign-in. |
| B4 | **Confirm the Gemini key is a paid, billing-enabled project** | An operational check, not code. `backend/.env.example` already says the free tier lets Google train on submissions. If production runs an unpaid key, the privacy policy's core claim is false, not just missing. |
| B5 | **Privacy nutrition labels filled in App Store Connect** | A form, filled honestly. At minimum: Identifiers (User ID) and User Content (Photos) linked to the user, because your own server writes the JPEG to `options.photoDir` and a `scan_photos` row whenever a user shares or opts in to training. That is first-party retention, so the "Data Not Collected" carve-out is unavailable. Decide the `photoHandle` question too (see section 2). |
| B6 | **UGC report mechanism, block, and published contact** | An in-app "Report" action, a `POST /photos/:id/report` route (and the same for user-submitted catalog entries), a block list, and a support email in Settings and on the App Store listing. Apple 1.2 lists four required elements and you currently have one (the `approved` gate). **This is unconditional**: even with every photo defaulted to private, `POST /patterns/unknown` publishes user-submitted catalog entries with `approved = 1`, so 1.2 attaches regardless. Gating that path too is the only way out, and gating it means the unknown-pattern feature does not ship. |
| B7 | **iOS privacy manifest entries** | `expo.ios.privacyManifests` in `app/app.json`. Not present today. Expo does not auto-generate it; you declare required-reason API categories yourself. |
| B8 | **Terms of service including a photo license grant** | One HTML page, linked from Settings next to the privacy policy. Without the license grant you have no right to display a user's photo in the community catalog at all. |

### SHOULD have at launch

- S1. Photo-upload consent screen that names Google as the processor at the moment of the first scan, not only in the policy.
- S2. Reword the training toggle to name the recipient and say what happens to already-kept scans when it goes off (`app/src/app/settings.tsx:442-448`).
- S3. Decide and state once, consistently in both documents, whether an already-published community photo survives account deletion.
- S4. Drop `android.permission.RECORD_AUDIO` from `app/app.json`. Nothing in the app records audio; it is an `expo-camera` default. Apple 5.1.1(iv) and Google Play Data Safety both penalise unnecessary permission requests.
- S5. Age rating 12+ or 17+ in App Store Connect if UGC ships, and a "not for under 13" line in the ToS.
- S6. Massachusetts WISP: a short written information security program. Probably not legally required at launch (see MA section) but it is one page and it is the cheapest thing on this list.
- S7. DMCA designated agent registration with the Copyright Office (only if user photo sharing ships at launch).
- S8. A written source-and-credit statement for CMoG, PyrexLove, and period ads, in the ToS or an About page.
- S9. Decide the App Store territory question: ship US-only at launch and GDPR does not attach.

### LATER (marketplace era, or when thresholds are crossed)

- L1. CCPA/CPRA compliance (you are two orders of magnitude below every threshold).
- L2. Massachusetts Consumer Data Privacy Act (still in conference committee as of June 2026; earliest effective date 2027; thresholds 60,000 to 100,000 consumers).
- L3. California AB 2013 training-data disclosure, if you ever fine-tune your own model on collected photos.
- L4. Marketplace-triggered: ROSCA and state auto-renew laws, FTC fake-review rule, 1099-K and marketplace-facilitator sales tax, escrow and payments (Apple 3.1.5(a) physical goods are exempt from IAP), buyer/seller dispute policy, and a much heavier UGC moderation surface.
- L5. EU release: GDPR Art. 13 notice, Art. 15/17 rights, Art. 27 EU representative, and DSA notice-and-action if the community catalog counts as an online platform.

---

## The single biggest gap

**Account deletion.** It is the one item on this list where Apple's requirement is
mechanical, review checks it, and the code does not exist in any form. It is also the
item with a hidden second half: Apple's own guidance says apps supporting Sign in with
Apple "should use the Sign in with Apple REST API to revoke user tokens," and your
`/auth/session` handler never obtains a token that can be revoked. B2 is a day; B3 is
the part that surprises people.

---

## 1. Privacy policy

### Is one legally required?

Yes, on three independent grounds, and the App Store ground bites first.

**Apple, App Review Guideline 5.1.1(i):** "All apps must include a link to their privacy
policy in the App Store Connect metadata field and within the app in an easily accessible
manner." The policy must "Identify what data, if any, the app/service collects, how it
collects that data, and all uses of that data," confirm that third parties receiving user
data give equal protection, and "Explain its data retention/deletion policies and describe
how a user can revoke consent and/or request deletion of the user's data."
(https://developer.apple.com/app-store/review/guidelines/)

**CalOPPA, Cal. Bus. & Prof. Code § 22575:** applies to "an operator of a commercial Web
site or online service that collects personally identifiable information through the
Internet about individual consumers residing in California." A free app distributed
commercially through the App Store is an online service; the statute has no revenue or
user-count threshold. It requires the policy to list categories of PII collected and third
parties it is shared with, describe the review/change process, describe how material
changes are notified, state an effective date, and disclose how the operator responds to
Do Not Track signals.
(https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22575)

Note the Do Not Track clause. It is a one-sentence disclosure ("we do not track users
across third-party sites, and we do not respond to DNT signals because we do not track")
that people routinely omit and it is the cheapest sentence in the document.

**CCPA/CPRA: does not apply.** Cal. Civ. Code § 1798.140(d) defines a covered "business"
as one meeting at least one of: annual gross revenue over $25,000,000 (inflation-adjusted
to $26,625,000 effective 2025-01-01), buying/selling/sharing the personal information of
100,000 or more consumers or households, or deriving 50% or more of annual revenue from
selling or sharing personal information. A free solo app clears none of them.
(https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140,
https://www.cppa.ca.gov/regulations/cpi_adjustment.html)

**GDPR: avoidable entirely at launch.** App Store Connect availability is a per-territory
selection. Shipping US-only removes Art. 13 notice, Art. 15/17 rights machinery, and the
Art. 27 EU-representative question in one field. This is the "do not collect it" strategy
applied to jurisdictions. If you do ship to the EU, the offering of goods/services test in
Art. 3(2) is met by a free App Store listing available there. `verify` the exact Art. 3
wording against https://gdpr-info.eu/art-3-gdpr/ before relying on it.

### Disclosures this app's specific facts demand

Ranked by how badly it hurts if omitted.

1. **Photos are transmitted to Google.** Apple 5.1.2(i): "You must clearly disclose where
   personal data will be shared with third parties, **including with third-party AI**, and
   obtain explicit permission before doing so." That phrase is in the current guidelines
   and it is aimed exactly at this. Name Google, name the product (Gemini API), say that
   the paid tier does not train on submissions, and link Google's terms.
2. **What Google does with them.** Google's Gemini API Additional Terms distinguish the
   tiers explicitly. Paid: "Google doesn't use your prompts (including associated system
   instructions, cached content, and files such as images, videos, or documents) or
   responses to improve our products," and logs are kept "for a limited period of time,
   solely for detecting and preventing violations of the Prohibited Use Policy." Unpaid:
   "Google uses the content you submit to the Services and any generated responses to
   provide, improve, and develop Google products and services," and "human reviewers may
   read, annotate, and process your API input and output."
   (https://ai.google.dev/gemini-api/terms) This is why B4 is blocking.
3. **EXIF and GPS are stripped server-side before the image touches disk.** This is a
   favourable fact and it is also the sentence that lets you truthfully say you never
   collect location. Say it plainly. It is enforced in `backend/src/app.ts` via
   `stripExif()` on every write path.
4. **What is stored against an account: an opaque provider subject ID and nothing else.**
   Your session user id is literally `` `${provider}:${subject}` `` (`backend/src/auth.ts:79`)
   and there is no `users` table. No email, no name, no profile. State it as a fact with
   the negative list attached, because the negative list is the whole product claim.
5. **Sync carries slugs, statuses and counts only.** `condition` and `notes` stay on the
   device. Say so; it is the difference between "we hold your notes" and "we cannot read them."
6. **Price data comes from eBay/marketplace APIs, per item, cached and shared.** No user
   identifier leaves with a price query. Confirm this against `backend/src/pricing.ts`
   before writing the sentence.
7. **Opt-in training data.** Default off, what is retained (confirmed scans and their
   photos), who it is retained by (you, on your server), and what happens when the toggle
   goes off.
8. **Opt-in photo sharing.** Three visibility states (`attributed`, `anonymous`, `private`,
   `shared/types.ts:186`), a manual approval gate before public display, and the chosen
   display name that appears with attributed photos.
9. **Retention and deletion.** Required by 5.1.1(i) in those words. Point at the in-app
   delete control.
10. **Do Not Track response.** Required by CalOPPA § 22575(b)(5).
11. **Contact.** An email address. Required by Apple 1.2's "Published contact information"
    if UGC ships, and by CalOPPA's change-notification mechanics in practice.

**What you can honestly say you do not collect:** name, email, phone, address, contacts,
location (stripped), precise device identifiers for advertising, browsing history, payment
information. Every one of those is an obligation avoided rather than an obligation met.
That is the correct strategy and it is worth writing the policy around the negative list.

---

## 2. Apple-specific gates

### 5.1.1(v) account deletion

"If your app supports account creation, you must also offer account deletion within the
app." (https://developer.apple.com/app-store/review/guidelines/)

Apple's support page is the operative document
(https://developer.apple.com/support/offering-account-deletion-in-your-app/):

- **In-app initiation is mandatory.** "Starting June 30, 2022, apps submitted to the App
  Store that support account creation must also let users initiate deletion of their
  account within the app." A web link alone does not satisfy it, and Apple's own FAQ
  addresses the case where signup happens in a browser: "Yes," deletion must still be
  offered in-app.
- **Scope of deletion.** "Deleting an account removes the account from the developer's
  records, along with any data associated with the account that the developer isn't
  legally required to maintain."
- **Shared UGC is explicitly in scope.** "People expect that all data associated with their
  account will be deleted when the account is deleted. This includes user-generated content
  that's shared with others, such as photos, video, text posts, and reviews."
- **Sign in with Apple:** "Apps that support Sign in with Apple should use the Sign in with
  Apple REST API to revoke user tokens."
- Deletion does not have to be instantaneous: "If your process for account deletion is
  manual or otherwise takes time to complete, this is acceptable."
- It applies worldwide: "All users should be allowed to delete their accounts, regardless
  of where they're located."

**What deletion must reach in your schema** (from `backend/src/db.ts:136-220`):

| Table / store | Key | Note |
|---|---|---|
| `collection` | `user_id` | Straight delete. |
| `scans` | `user_id` | Including rows with `consented_to_training = 1`. |
| `scan_photos` | via `scan_id` | Plus the JPEG files under `options.photoDir`. |
| `photos` | `uploader_id` | Including rows with `approved = 1` that are already public, per Apple's UGC sentence above. Also clear `uploader_handle`. |
| on-disk JPEGs | `file_ref` | The DB delete is not the file delete. |
| session token | n/a | Sessions are stateless signed claims (`backend/src/auth.ts:72-82`), so an outstanding token stays valid until `exp`. Either accept that window or add a revocation check. |

There is **no `users` table**, which is convenient: "the account record" is the set of rows
above. Note that a deleted user who signs in again with the same Apple ID gets the same
`apple:<subject>` string and therefore a fresh empty account. That is fine, but say so in
the ToS so it does not look like the deletion failed.

The Apple-revoke half is the real work. Revocation needs a refresh or access token from
Apple's token endpoint, obtained by exchanging the authorization code at sign-in.
`backend/src/app.ts:575-597` only verifies the identity token and stores nothing, so today
there is nothing to revoke. `verify` the exact revoke request parameters against
https://developer.apple.com/documentation/signinwithapple/revoke_tokens before implementing.

### 4.8 Login Services

You are compliant as built, and you should confirm rather than change anything. 4.8
requires that an app using a third-party login (Google) also offer "another login service"
that limits data collection to name and email, lets users keep their email private, and
does not collect in-app interactions for advertising. Sign in with Apple satisfies all
three and you already offer it (`app.json` sets `"usesAppleSignIn": true`).
(https://developer.apple.com/app-store/review/guidelines/)

Also relevant, 5.1.1(v): "If your app doesn't include significant account-based features,
let people use it without a login." Scanning and browsing the catalog work without an
account today. Keep it that way; it is both a guideline-compliance point and the reason
most users never create a record at all.

### Privacy nutrition labels

Apple's definition of "collect" is the constraint that decides your labels: "'Collect'
refers to transmitting data off the device in a way that allows you and/or your third-party
partners to access it for a period longer than what is necessary to service the transmitted
request in real time." Data "processed only on the device and never sent to a server" or
"used solely for real-time request servicing without retention" is Data Not Collected.
(https://developer.apple.com/app-store/app-privacy-details/)

Applied to Backstamp:

- **User Content > Photos or Videos: collected, Linked to You.** Not a close call and not
  a judgement about Google. Your own server writes the JPEG to `options.photoDir` and
  inserts `photos` or `scan_photos` rows whenever a user shares a photo or opts in to
  training (`backend/src/app.ts:460`, `:360`). That is first-party retention beyond the
  real-time request, which is exactly what the definition of "collect" describes. The
  carve-out is unavailable, so declare it.
  - Separately worth knowing, not the reason: even on the paid tier Google "logs prompts
    and responses for a limited period of time, solely for detecting and preventing
    violations of the Prohibited Use Policy," and Apple asks you to identify data "you **or
    your third-party partners** collect." A scan photo that were truly never written to
    your disk would be a genuinely arguable carve-out case. That is not the app you built.
- **Identifiers > User ID: collected, Linked to You.** The provider subject ID.
- **Contact Info > Name: decide this one.** `photoHandle` is a display name the user types
  in Settings, stored in `photos.uploader_handle`, and shown publicly next to attributed
  photos. It is user-provided in your UI, optional, not used for tracking or advertising,
  and shown to the user, so it is a candidate for the four-criteria optional-disclosure
  exception Apple lists. But criterion 3 requires collection "in cases not part of the
  app's primary functionality," and criterion 4 requires the user to "affirmatively choose
  to provide it each time," whereas yours is a persistent setting applied automatically to
  every attributed upload. My reading is that it fails both, so declare it. It costs you
  one checkbox and it removes a discrepancy a reviewer can see by opening Settings.
- **Data Used to Track You: none.** No ads, no ad SDK, no ATT prompt needed.
- **Precise/Coarse Location: not collected**, because EXIF is stripped before write. This
  is a real product benefit and the label is where it shows.

This matches what the closest comparable declares (see section 8), except that CollX also
declares email and physical address, which you do not hold.

### 1.2 User-generated content

Apple lists four required elements verbatim:

> - A method for filtering objectionable material from being posted to the app
> - A mechanism to report offensive content and timely responses to concerns
> - The ability to block abusive users from the service
> - Published contact information so users can easily reach you

(https://developer.apple.com/app-store/review/guidelines/)

Against the code: you have element 1 (the manual approval gate, `photos.approved` defaults
to `0` at `backend/src/app.ts:489`, and `db.photoFile` correctly refuses unapproved and
private files to unauthenticated callers, `backend/src/db.ts:507-528`). You have none of
elements 2, 3, or 4. Build them. That is B6.

**Defaulting photos to private does not escape 1.2.** There are two UGC surfaces, not one.
User-submitted *catalog entries* (`POST /patterns/unknown`) are text plus an optional photo,
and they publish immediately: the entry is created and its AI placeholder is written with
`approved = 1` (`backend/src/app.ts:518-570`). So even a build where every user photo is
private still lets one user put text in front of every other user, with no approval gate at
all. 1.2 attaches on that path alone.

That leaves three honest configurations:

- **Photo sharing on, unknown-pattern submission on:** build all of B6 (report on photos
  and on entries, block, contact), register the DMCA agent (S7), and write the full ToS
  licence grant.
- **Photo sharing off, unknown-pattern submission on:** still build report, block, and
  contact. You avoid only the DMCA agent question and the wide photo licence grant. Also
  consider putting the unknown-pattern path behind the same `approved` gate the photos use,
  which is a two-line change and gives you Apple's element 1 on that surface too.
- **Both off for v1:** 1.2 does not attach, B6 drops off the blocking list, and the ToS
  shrinks to a paragraph. This is the genuinely lazy path for a v1 collection tracker and
  it is defensible, but it costs you the catalog-growth mechanism, so it is a product
  decision rather than a legal one.

---

## 3. AI-specific disclosure

Short answer: **no current statute requires anything of this app beyond honest disclosure.**
The two California AI laws people cite both miss you on the definition, not on the merits.

**California AB 2013 (Generative AI: Training Data Transparency)**, operative 2026-01-01
for systems released after 2022-01-01, applies to a "developer," defined as "a person,
partnership, state or local government agency, or corporation that designs, codes,
produces, or substantially modifies an artificial intelligence system or service for use by
members of the public." Backstamp calls Gemini's API; it does not design, code, produce, or
substantially modify a generative system. Prompt engineering is not substantial
modification. **Not applicable today.**
(https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB2013)

The trigger to watch: if you ever fine-tune a model on the opt-in training corpus and ship
it to users, you plausibly become a developer of a substantially modified system and owe a
posted training-data summary (sources, counts, whether personal information is included,
collection timeframes). That is L3 and it is a real consequence of the training toggle, so
it is worth knowing before the corpus gets big.

**California SB 942 (AI Transparency Act)**, as amended by AB 853 (signed 2025-10-13),
applies to a "covered provider": "a person that creates, codes, or otherwise produces a
generative artificial intelligence system that has over 1,000,000 monthly visitors or users
and is publicly accessible within the geographic boundaries of the state." Two independent
misses: you do not produce a GenAI system, and you will not have a million monthly users.
AB 853 delayed the operative date to 2026-08-02 and extended scope to capture-device
manufacturers, GenAI hosting platforms, and "large online platforms" (over two million
unique monthly users). None of those describe Backstamp.
(https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240SB942,
https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260AB853,
https://www.troutmanprivacy.com/2025/10/california-ai-transparency-act-amendments-signed-into-law/)

**(a) AI-generated placeholder images.** Already badged in-app. No statute compels the
badge for you; keep it anyway, because it is the honest-labelling principle the app already
applies to prices and colorway swatches, and because an unbadged synthetic photo in a
*collectibles identification* context is exactly the sort of thing an FTC Section 5
deception theory would reach. Keeping it costs nothing.

**(b) Photos used for training with consent.** Governed by consent quality, not by a
training statute. Apple 5.1.2(ii) is the sharp edge: "Data collected for one purpose may
not be repurposed without further consent unless otherwise explicitly permitted by law." A
photo collected to identify a dish, later used to train a model, is repurposing. Your
separate opt-in toggle is the right structure. The wording is what needs work.

**Is the current toggle wording adequate? No, it is under-specified on two points.**

Current (`app/src/app/settings.tsx:442-448`):

> Help improve identification
> "When on, confirmed scans and photos are kept to improve identification later. Default is off."

What is missing:

1. **The recipient.** "Kept" does not say by whom. A user cannot tell whether this means
   kept on your server or handed to Google. Apple 5.1.2(i) wants the third-party AI
   recipient named. If the corpus stays on your server and is never sent to Google, say
   that, because it is the reassuring answer.
2. **Revocation effect.** Apple 5.1.1(ii) requires "an easily accessible and understandable
   way to withdraw consent," and there is no code path today for what happens to
   already-retained scans when the toggle flips off. Pick one and state it: turning it off
   stops future retention only, or turning it off deletes what was retained. The second is
   more honest and it is a `DELETE FROM scans WHERE user_id = ? AND consented_to_training = 1`
   plus the file unlinks, which you need for B2 anyway.

Suggested replacement, same length:

> "When on, we keep confirmed scans and their photos on our own server to improve
> identification later. They are not sent to Google for training. Turning this off deletes
> what we kept. Default is off."

Only ship that second sentence if B4 confirms a paid Gemini key, and only ship the third
if you implement the delete.

---

## 4. UGC and copyright

### DMCA safe harbour: worth it, but only if photo sharing ships

17 U.S.C. § 512(c) immunity for user-stored material is conditioned on designating an agent
and publishing the contact information. The Copyright Office is explicit that "Certain kinds
of service providers, for example, those that allow users to post or store material on their
systems ... must designate an agent," and that designation happens through the online system
at dmca.copyright.gov, with the same information also published on your own site.
(https://www.copyright.gov/dmca-directory/)

The fee and the three-year renewal period were not stated on the page I fetched; `verify`
at https://www.copyright.gov/dmca-directory/ before budgeting. Industry practice treats it
as a low two-figure fee and a three-year renewal, which is trivial against the exposure of
hosting other people's photographs without safe harbour.

Recommendation: register the agent **if and only if** users can share photos at launch. If
every photo is private in v1, you host no third-party material publicly and the designation
can wait. If sharing ships, the ToS needs a DMCA section with the agent's address and the
repeat-infringer policy that § 512(i) also conditions the safe harbour on.

### Third-party content you already use

Your existing stance is stronger than most apps' and it mostly needs to be written down
rather than changed:

- **CMoG:** facts restated in your own words, with attribution and a link, per their written
  reply. Their photographs are excluded and you never fetched them. Their reply does not
  cover the Pyrex pattern artwork, which belongs to Corning or Instant Brands. Nothing here
  needs a ToS clause; it needs the credit you already render in Settings, plus one line in
  an About or Sources page saying facts are restated under their permission and photographs
  are not used.
- **PyrexLove:** same shape, per your source survey.
- **Period advertisements:** public domain by age/renewal analysis. Keep the per-item
  provenance note that already exists in the catalog so the claim is auditable later.
- **Pyrex, Corelle, and Corning are live trademarks.** The ToS should carry a one-line
  nominative-fair-use statement: Backstamp is an independent collector tool, not affiliated
  with or endorsed by Corning or Instant Brands, and those marks are used only to identify
  the goods. This is cheap and it is the single most likely source of a letter.

---

## 5. COPPA

Not child-directed, and the standard treatment is one sentence plus an age rating.

COPPA (15 U.S.C. § 6501 et seq., 16 C.F.R. Part 312) applies to operators of sites or
services "directed to children" under 13, or to general-audience services with **actual
knowledge** that they are collecting personal information from a child under 13. A vintage
Pyrex identification and collection tracker is not directed to children under any of the
FTC's factors (subject matter, visual content, use of animated characters, music, child
celebrities, advertising directed to children, audience-composition evidence). I could not
fetch the FTC's pages directly (403 on ftc.gov and a redirect on ecfr.gov); `verify` the
factor list at https://www.ecfr.gov/current/title-16/part-312/section-312.2 and the FTC's
COPPA FAQ at https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions.
Note also that the FTC amended the COPPA Rule in 2025 with staged compliance dates;
`verify` those dates if the answer ever stops being "not applicable."

**What is standard:**

- One sentence in the privacy policy: "Backstamp is not directed to children under 13, and
  we do not knowingly collect personal information from children under 13. If we learn we
  have, we delete it."
- An App Store age rating of 12+ or 17+ if UGC ships. A 4+ rating on an app with unmoderated
  user photos is a review problem independent of COPPA.
- No age gate screen. A gate is only standard for age-restricted content, and adding one
  would mean collecting a birthdate, which is collecting personal data you currently do not
  have. Do not add it.

Note the comparable: CollX sets the bar at 18 rather than 13 ("The Services are not
intended for users under 18 years of age"), which sidesteps the question entirely at the
cost of nothing. (https://www.collx.app/privacy)

---

## 6. Terms of service: the minimum honest set

Nine clauses. Anything beyond this at launch is decoration.

1. **Photo licence grant from user to app.** The one clause you cannot ship the community
   catalog without. Needs to be non-exclusive, worldwide, royalty-free, and sublicensable
   (to your CDN or host), for the purpose of displaying the photo in the catalog. Decide
   consciously whether it is perpetual/irrevocable. CollX takes perpetual and irrevocable
   (see section 8). That conflicts with Apple's expectation that shared UGC dies with the
   account, so a narrower grant that terminates on deletion is both more honest and easier
   to keep consistent. **Pick one and make the privacy policy, the ToS, and the delete
   endpoint agree.** A mismatch between those three is the failure mode.
2. **Training licence, if the toggle is on.** Separate sentence, separate consent, naming
   the retention and the deletion effect. Vivino's terms are the template for wording this
   without weasel language (section 8).
3. **Price disclaimer.** Figures are market observations from third-party listing data, not
   appraisals, not offers, not a guarantee of value. Sold and asking prices are different
   claims. Your app already labels every figure with its source; the ToS just has to say
   the same thing once in legal register.
4. **Identification disclaimer.** Identification is produced by an AI model and can be
   wrong. Do not rely on it for purchase, sale, insurance, or authentication decisions.
   This one matters more than it looks, because a wrong Lucky in Love call is a four-figure
   mistake for the user.
5. **Collection data disclaimer.** No warranty against data loss. Note that `condition` and
   `notes` are device-local and therefore not recoverable from your server if the phone is
   lost, and point at the existing JSON export in Settings as the user's own backup.
6. **Acceptable use / community standards.** Short: real photos of real pieces, no
   infringing images, no harassment. This is the "terms of service or community standards"
   Apple 1.2 refers to when it says removal is your responsibility.
7. **Termination.** You may suspend or terminate accounts for violations; the user may
   delete at any time from Settings.
8. **DMCA notice and takedown**, with the designated agent, if sharing ships.
9. **Trademark and source attribution.** No affiliation with Corning or Instant Brands;
   pattern facts restated from CMoG and PyrexLove with permission and credit.

Explicitly **not** needed at launch: arbitration clause, class-action waiver, payment terms,
refund policy, subscription terms, seller terms, escrow, dispute resolution between users.
All of those are marketplace-era (L4).

---

## 7. Massachusetts

**201 CMR 17.00 (Standards for the Protection of Personal Information of Residents of the
Commonwealth):** the regulation applies to persons who own or license "personal information"
about a Massachusetts resident, and requires a comprehensive Written Information Security
Program with administrative, technical, and physical safeguards, a designated maintainer, a
risk assessment, encryption of personal information transmitted across public networks and
stored on portable devices, and documented breach response.
(https://www.mass.gov/regulations/201-CMR-1700-standards-for-the-protection-of-personal-information-of-residents-of-the-commonwealth)

The load-bearing question is the definition of "personal information," which is narrow.
201 CMR 17.02 takes its definition from M.G.L. c. 93H § 1, which I did fetch:

> "a resident's first name and last name or first initial and last name in combination with
> any 1 or more of the following data elements"

and enumerates Social Security number, driver's licence or state ID number, and financial
account number or credit/debit card number with any required security or access code.
(https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXV/Chapter93H/Section1)

**Massachusetts has no credential-based trigger.** Several states extended their breach
statutes to cover a username or email address paired with a password or security answer.
Massachusetts did not: the § 1 list is closed at those three data elements. That matters
here because an account system holding only credentials would otherwise be caught by such a
trigger even with no name on file.

**Applied to Backstamp: you hold none of those elements.** No name, no SSN, no licence
number, no financial account. An opaque `apple:<subject>` string is not personal information
under 201 CMR 17.02, and a user-chosen display name is not a legal name paired with an
identifier. **On the facts as built, neither 201 CMR 17.00 nor the c. 93H notification duty
attaches.** This is the clearest example in the whole report of the "do not collect it"
strategy paying a dividend: the regulation is avoided by the schema, not by a document.

One caveat: the moment the marketplace ships and you touch payment card or bank account
numbers, 201 CMR 17.00 attaches immediately, the WISP becomes mandatory, and the c. 93H
notification duty comes with it. Using a payment processor that holds those numbers instead
of you is how to keep avoiding both.

Write the one-page WISP anyway (S6). It is not required, it takes an hour, and it is the
document you hand over if anything ever goes wrong.

**Massachusetts Consumer Data Privacy Act: not law yet.** The Senate passed S.2619 on
2025-09-25 (40-0) and the House passed H.5479 on 2026-06-04 (146-0); the Senate did not
concur in a House amendment, and a six-member conference committee was appointed on
2026-06-11. Proposed effective dates are 2027-01-01 (Senate) and 2027-07-01 (House).
Thresholds are 60,000 consumers (Senate) or 100,000 consumers (House), or revenue-linked
alternatives, plus sensitive-data triggers. Backstamp is far below either. Enforcement is
AG-only with a cure period.
(https://foleyhoag.com/news-and-insights/blogs/state-ag-insights/2026/june/one-step-closer-to-a-massachusetts-data-privacy-law-comparing-the-current-house-and-senate-bills/,
https://malegislature.gov/Bills/194/H80)

Watch the sensitive-data trigger in the House version, which applies regardless of user
count. Nothing Backstamp collects is sensitive data under the usual definitions, but that
is the clause to re-check when the conference report lands.

---

## 8. What comparable apps actually do

The most useful finding in this report: **the category has converged, and Backstamp is
ahead of it on substance and behind it on paperwork.**

### CollX (Sports Card Scanner): the closest analog

Photograph a card, AI identifies it, market prices shown, collection tracked. iOS app since
2021. What they do:

**Privacy policy** (https://www.collx.app/privacy):
- Discloses camera/photo access in generic terms: "Certain aspects of the Services may also
  access certain features of your mobile device, including its camera, location services
  (GPS), microphone, or contacts, and may collect information from those features, such as
  photographs, videos, your precise location, audio recordings, and contact information."
- **Contains no mention of AI, machine learning, or model training at all**, despite
  marketing AI recognition as a Pro feature.
- Names Google Analytics as a third party.
- Deletion is by email: "You may request access to your Personal Information by sending an
  email to support@collx.app," and content deletion carries the caveat "Removal of your
  posted content may not ensure complete or comprehensive removal from our computer systems."
- Children: "The Services are not intended for users under 18 years of age."
- Has California, Nevada, and Canada sections, and states the service is "not currently
  subject to the CCPA."

**Terms** (https://collx.app/terms):
- User content licence: users retain ownership, CollX takes a "royalty-free, worldwide
  license to use, host, store, reproduce, modify, create derivative works ... publicly
  perform, publicly display and distribute Your Content," perpetual ("continues even if you
  stop using our Services"), irrevocable, and sublicensable to "those we work with,"
  including use "in ads and other commercial content."
- **No price-accuracy or identification-accuracy disclaimer**, only a generic as-is clause.
- DMCA agent named with a physical address and email, plus a repeat-infringer policy.
- Termination at will, without notice or liability.
- **No AI/ML training clause.**

**Nutrition labels** (https://apps.apple.com/us/app/collx-sports-card-scanner/id1581164444):
Data Used to Track You: Usage Data. Data Linked to You: Contact Info (name, address, email),
User Content (photos or videos), Identifiers (user ID, device ID), Usage Data. Data Not
Linked to You: Contacts, Advertising Data, Crash Data. Age rating 4+.

**Moderation** (https://collx.app/community-guidelines): in-app report button ("you may let
us know by using the report function on any listing or user"), a block feature, published
support email, and stated enforcement including permanent suspension.

### Vivino (photo-scan plus community): the AI-training template

Vivino's terms grant a "non-exclusive, worldwide, royalty-free, and sublicensable" licence
over user content expressly "for purposes including developing, training, testing, and
improving analytics, recommendation systems, algorithms, and machine-learning models," with
a corresponding clause that models trained on the content may continue operating on derived
information "in a form that does not permit the identification of any individual."
(https://www.vivino.com/legal/terms-of-service, via search summary; direct fetch returned
403, so `verify` the exact wording before copying the structure)

This is the clause Backstamp needs for the training toggle, except that Vivino takes it by
default in the terms and you take it by opt-in toggle. Yours is the better position.

### Discogs, Numista, Colnect (collector catalogs with user submissions)

Both discogs.com and numista.com returned 403 to direct fetches, so I have no quotable text.
`verify` at https://support.discogs.com/hc/en-us/articles/360004050453-Terms-of-Service and
https://en.numista.com/aide/. What is well known and worth checking rather than asserting:
Discogs licenses its database contributions under CC0 and its images under a separate grant,
and Numista validates catalogue submissions through a volunteer moderator queue before
publication, which is structurally the same as your `approved` flag.

### The converged pattern, and where Backstamp sits

| Practice | CollX | Vivino | Backstamp today |
|---|---|---|---|
| Published privacy policy | yes | yes | **no** |
| Published terms with UGC licence | yes | yes | **no** |
| Names AI/ML in the legal documents | **no** | yes | n/a |
| Separate opt-in for training | no (taken by default) | no (taken by default) | **yes, default off** |
| Declares User Content > Photos in nutrition labels | yes | yes | **not yet filled** |
| In-app report button | yes | yes | **no** |
| Block users | yes | yes | **no** |
| Published support contact | yes | yes | **no** |
| DMCA agent named in terms | yes | yes | **no** |
| Pre-publication approval gate | no | no | **yes** |
| In-app account deletion (Apple 5.1.1(v)) | email-based, likely non-compliant | in-app | **no** |
| Price/identification accuracy disclaimer | **no** | not found | app labels every figure, no ToS clause |
| EXIF/GPS stripped before storage | not stated | not stated | **yes** |
| Stores name and email | yes | yes | **no, subject ID only** |

**What they all do that you do not:** publish a privacy policy, publish terms containing a
user-content licence, expose an in-app report control, publish a contact address, name a
DMCA agent, and fill in the nutrition labels. That is precisely the BLOCKING list, which is
a good sign that the list is neither paranoid nor short.

**What you do that they do not:** opt-in rather than default training consent, a
pre-publication approval gate, EXIF stripping, and storing no name or email. Those are
product differentiators and they should be stated in the privacy policy as claims, not
buried as implementation details.

**Where the category is weak and you should not copy it:** CollX's privacy policy says
nothing about AI even though AI is the product, and its terms carry no accuracy disclaimer
for card identification or value. Both are gaps that Apple 5.1.2(i) has since closed
("including with third-party AI") and that a wrong four-figure valuation would expose.
Follow the category on structure, not on those two omissions.

---

## 9. Debunk or confirm: the viral checklist

| Claim | Verdict for Backstamp |
|---|---|
| No privacy policy | **Real and blocking.** Apple 5.1.1(i) plus CalOPPA § 22575. Not a lawsuit risk so much as a rejection certainty. |
| No "we collect user data" disclosure | **Real.** Same requirement. Apple 5.1.1(i) demands the collect/use/retain description explicitly. |
| No AI mention in the privacy policy | **Real, and newly sharpened.** Apple 5.1.2(i) now says you must disclose sharing "including with third-party AI" and get explicit permission. The closest comparable (CollX) omits it, which makes it a common failure, not a safe one. |
| No third-party data collectors listed | **Real but small.** Apple 5.1.1(i) requires naming third parties with data access, and nutrition labels require declaring what "you or your third-party partners collect." Your list is short: Google (Gemini), the price API vendors, Apple/Google identity. Naming three companies is the whole fix. |
| Not deleting user uploads | **Real and blocking.** Apple's account-deletion page names shared photos specifically. This is B2. |
| Public storage buckets | **Not applicable, verified in code.** There is no bucket; photos live on local disk and are served through `GET /photo-files/:id`, which delegates to `db.photoFile(id, sessionUserId)`. That query returns a row only when the caller is the uploader, or the photo is non-private **and** (approved or an AI placeholder) (`backend/src/db.ts:507-528`). An unauthenticated caller guessing a UUID cannot retrieve a private or unapproved file. Cache-Control is `private, no-store` for non-public files. This one is already done correctly. |
| Fake testimonials | **Not applicable.** No testimonials, no reviews, no ratings in the app. The FTC's Rule on Fake Reviews and Testimonials (16 C.F.R. Part 465) has nothing to bite on. Becomes live if the marketplace adds seller ratings. |
| Cancellation friction | **Not applicable.** Nothing to cancel. |
| Auto-renew without reminder | **Not applicable.** No subscriptions. For the record, the FTC's "click to cancel" Negative Option Rule was vacated in full by the Eighth Circuit on 2025-07-08 and the FTC restarted rulemaking in January 2026; ROSCA, FTC Act § 5, and state auto-renew laws still apply to anyone who does sell subscriptions. (https://www.gibsondunn.com/ftc-restarts-negative-option-rulemaking-after-eighth-circuit-vacatur-enforcement-under-rosca-continues/) |
| AI with no self-harm response | **Not applicable.** California SB 243 (effective 2026-01-01) regulates "companion chatbots," AI systems providing adaptive human-like social interaction that sustain relationships across interactions. A single-turn image classifier that returns pattern IDs is not one, and the statute carves out narrow-purpose bots. (https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243) Do not add a crisis-line banner to a dish scanner. |

Five of ten are real for this app, and four of those five are the same document problem
seen from different angles: **write the privacy policy and the terms, and build deletion.**

---

## 10. Repo findings that drove the rankings

Read-only inspection, nothing modified.

- `backend/src/app.ts` route list ends at `POST /auth/session`. **No account deletion
  endpoint, no report endpoint, no block endpoint.**
- `backend/src/auth.ts:79` sets `userId: ` `` `${provider}:${subject}` `` and the session is a
  stateless signed claim set. There is no `users` table in `backend/src/db.ts`, so the
  "account" is the union of rows keyed by that string. Deletion cannot invalidate an
  outstanding token without a new revocation check.
- `backend/src/app.ts:575-597` verifies the Apple identity token and stores nothing, so
  there is no refresh token available for Apple's revoke endpoint. B3 needs a sign-in change,
  not just a delete handler.
- `backend/src/db.ts:507-528` (`photoFile`) correctly gates private and unapproved photos
  against unauthenticated callers. The "public bucket" item is already handled.
- `backend/.env.example` already documents the Gemini tier problem: "Gemini's free tier
  permits Google to use submitted content to improve their products and the paid tier does
  not, so shipping on the free tier contradicts this app's own privacy design. Use a paid
  key in production." Confirmed against Google's terms. Verify the production key.
- `app/app.json` has good `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`
  purpose strings and `ITSAppUsesNonExemptEncryption: false`. It has **no
  `expo.ios.privacyManifests` block** (B7) and it requests
  **`android.permission.RECORD_AUDIO`** with no audio feature in the app (S4).
- `app/src/app/settings.tsx:442-448` is the training toggle; the wording gap is analysed in
  section 3. Settings already renders CMoG and PyrexLove source credits with links, and a
  collection JSON export.
- `shared/types.ts:186` defines the three visibility states; `backend/src/app.ts:489` sets
  `approved: false` on user uploads while `:552-561` sets `approved: true` on AI placeholders.

---

## Questions to take to a lawyer

1. Does the perpetual/irrevocable photo licence that the category uses survive Apple's
   requirement that shared UGC be deleted with the account, or do I have to choose?
2. If I never publish user photos in v1, do I still want the DMCA agent registered?
3. Is an opaque provider subject ID "personally identifiable information" under CalOPPA
   § 22579's definition, even though it is not "personal information" under 201 CMR 17.02?
   (My reading is yes for CalOPPA, which is why the policy is required regardless.)
4. Does the opt-in training corpus, if I later fine-tune on it, make me a "developer" under
   AB 2013?
5. How much accuracy disclaiming actually helps if a user buys a $900 dish on a wrong
   identification?
6. Is US-only distribution at launch worth the market it forgoes, given what GDPR compliance
   would cost a solo developer?

---

## Sources

Apple:
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Offering account deletion in your app: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- App privacy details on the App Store: https://developer.apple.com/app-store/app-privacy-details/
- Sign in with Apple, revoke tokens (`verify`): https://developer.apple.com/documentation/signinwithapple/revoke_tokens
- Privacy manifest files (`verify`, page returned no body): https://developer.apple.com/documentation/BundleResources/privacy-manifest-files
- Expo privacy manifests guide: https://docs.expo.dev/guides/apple-privacy/

Google:
- Gemini API Additional Terms of Service: https://ai.google.dev/gemini-api/terms

California:
- CalOPPA, Bus. & Prof. Code § 22575: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22575
- CCPA "business" definition, Civ. Code § 1798.140: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140
- CPPA inflation adjustment: https://www.cppa.ca.gov/regulations/cpi_adjustment.html
- AB 2013, Generative AI Training Data Transparency: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB2013
- SB 942, California AI Transparency Act: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240SB942
- AB 853, amending SB 942: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260AB853
- SB 243, companion chatbots: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243
- Troutman analysis of AB 853: https://www.troutmanprivacy.com/2025/10/california-ai-transparency-act-amendments-signed-into-law/

Massachusetts:
- M.G.L. c. 93H § 1, definitions of "personal information" and "breach of security" (fetched): https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXV/Chapter93H/Section1
- 201 CMR 17.00: https://www.mass.gov/regulations/201-CMR-1700-standards-for-the-protection-of-personal-information-of-residents-of-the-commonwealth (403 to automated fetch; the WISP and encryption requirements in 17.03 and 17.04 are `verify`, the 17.02 definition is confirmed via c. 93H § 1 above)
- Secondary summaries of the WISP requirements: https://www.upguard.com/blog/mass-data-security-law, https://www.morse.law/news/wisp-written-information-security-program/
- H.80 / Massachusetts Consumer Data Privacy Act: https://malegislature.gov/Bills/194/H80
- Foley Hoag comparison of House and Senate bills, June 2026: https://foleyhoag.com/news-and-insights/blogs/state-ag-insights/2026/june/one-step-closer-to-a-massachusetts-data-privacy-law-comparing-the-current-house-and-senate-bills/

Federal:
- DMCA designated agent directory: https://www.copyright.gov/dmca-directory/
- COPPA Rule, 16 C.F.R. Part 312 (`verify`): https://www.ecfr.gov/current/title-16/part-312
- FTC COPPA FAQ (`verify`, 403 to automated fetch): https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- Negative Option Rule vacatur and current rulemaking: https://www.gibsondunn.com/ftc-restarts-negative-option-rulemaking-after-eighth-circuit-vacatur-enforcement-under-rosca-continues/

Comparable apps:
- CollX privacy policy: https://www.collx.app/privacy
- CollX user agreement: https://collx.app/terms
- CollX community guidelines: https://collx.app/community-guidelines
- CollX App Store listing and privacy labels: https://apps.apple.com/us/app/collx-sports-card-scanner/id1581164444
- Vivino terms of service (`verify`, 403 to automated fetch): https://www.vivino.com/legal/terms-of-service
- Discogs terms (`verify`, 403): https://support.discogs.com/hc/en-us/articles/360004050453-Terms-of-Service
- Numista terms (`verify`, 403): https://en.numista.com/aide/
