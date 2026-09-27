# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary user: a Magic: The Gathering Commander (EDH) player.** Not a store, not a judge, not a content creator — the person who will sleeve the deck up and play it. There are no accounts, no roles, and no permission tiers; everyone who loads the site is the same anonymous player.

That player arrives in one of two situations, and the product deliberately **splits by surface** rather than averaging the two into one compromised experience:

- **"I have a commander and limited time."** They want a complete, legal, playable 100 now, and will tune later or not at all. Served by Home and the Foundry (`/`, `/build/:commander`). Strong defaults and automation get the benefit of the doubt here; the override controls exist for whoever reaches for them, but nothing waits on a decision the player hasn't asked to make.
- **"I have a deck and I want it better."** An enfranchised brewer who enjoys building and wants a co-pilot, not an autopilot. Served by the Inspector, Lists/Decks, and Collection (`/analyze`, `/build-from-deck`, `/decks`, `/lists`, `/collection`). Here the human makes the calls; the product's job is to surface evidence, rank options, and make overrides cheap and reversible.

Each surface commits to one of these users. A surface that tries to serve both at once is a design failure, not a feature.

Secondary context, not a separate audience: the player's **pod** — the three-to-five people they actually play against. Bracket, budget, and power-level framing exists because the deck has to survive a conversation at that table.

## Product Purpose

ManaFoundry generates and repairs Commander decks from real aggregate play data.

It does two things:

1. **Generate** — from a chosen commander (or from a set of cards the player wants to build around), assemble a complete 100-card deck with a coherent mana curve, type distribution, functional role balance, and color-correct mana base.
2. **Fix** — take a deck that already exists (generated, pasted, imported, or hand-built) and tell the player what is weak in it and what to swap, with the reasoning attached.

**Success is retention.** With no revenue metric, the north star is repeat use: the same player returning to re-tune decks as the format, their collection, and the card pool change. "Your decks change on their own" is the hook — the product's job is to still be worth opening six months after the deck was built. First-visit payoff and shareability matter, but they are in service of the return visit, not instead of it.

## Positioning

**One click to generate, one click to fix.** Competing tools either produce a list and stop, or gate their good features behind an account. ManaFoundry's claim is that a player goes from a commander name to a complete, explained, playable deck without creating an account, paying anything, or making a single configuration decision they didn't ask to make — and then can keep returning to that deck to improve it.

Three things a neighboring product could not truthfully copy without rebuilding:

- **Every recommendation cites its aggregate-data lineage.** Inclusion rates, theme strength, role targets, and curve targets come from EDHREC / Scryfall / Commander Spellbook aggregates, and the number that drove a decision is shown next to the decision.
- **Deterministic, not probabilistic.** Role counts, inclusion percentages, curve targets, and combo detection are countable and reproducible. The product does not ship an LLM opinion layer (see Capabilities and Constraints).
- **Zero auth, zero cost, local-first.** The full product works on first load with no account. User data lives in the browser.

## Operating Context

- **Where it is used:** at a desk while building, and on a phone at the LGS between rounds. Mobile is a real usage scene, not a fallback — deck lists get browsed and decks get shown to other players on a phone screen.
- **What it hands off to:** exports in copy-ready format for **Moxfield, Archidekt, and MTGO**. A generated deck is frequently not the end state — it is the starting point that leaves for another tool, then comes back.
- **How it is shared:** pasted links, notably in **Discord** (link-preview / OG tags are maintained deliberately for this; see `docs/seo-and-link-embeds.md`) and on Reddit / r/EDH, where self-promotional framing is a known hazard (`docs/reddit-launch-playbook.md`).
- **What the player brings:** a commander, a pile of cards they want to build around, a decklist to paste, or a collection CSV.
- **The rituals it sits inside:** rule-zero / bracket conversations with a pod, budget limits, "what do I add since I last touched this deck," and goldfishing a list before taking it to a table.

## Capabilities and Constraints

**Core shipped surfaces** (confirmed first-class; future design work must treat these as product, not experiments):

| Surface | Routes | Job |
|---|---|---|
| Home + Foundry | `/`, `/build/:commander/:partner?` | Commander and card-group search, EDHREC theme selection (max 2), budget / bracket / rarity / format customization, generation |
| Inspector | `/analyze`, `/analyze/:id`, `/build-from-deck/:listId` | Deck score, inclusion %, swap candidates, role and curve lanes, combo detection, archetype cross-reference |
| Decks / Lists / Collection | `/decks`, `/lists`, `/collection` | User-managed lists, deck view, enrichment, export / share, collection import |
| Playtest | `/playtest`, `/playtest/*` | Goldfish and bot-seat playtesting. Bots are desktop-only by deliberate decision; phone playtest is goldfish only. |

**Also publicly shipped and indexed,** though its first-class status was not confirmed in this round: **SpellChroma** (`/spellchroma`) — present in both the desktop and mobile primary navigation and in `sitemap.xml`.

**Explicitly not public product:** `/brew`, `/lab`, `/metrics`, `/migrate`, `/community-poll/admin` are in-development or internal, disallowed in `robots.txt`, and in some cases URL-only with no navigation entry. Design work must not promote them to the navigation without a decision to ship.

**Durable constraints:**

- **Zero-cost / local-first.** No ads, no paid tiers, no gated features. The domain is the largest recurring expense. Backend is limited to free-tier scheduled jobs writing static artifacts to S3. Any proposal that scales cost with usage must flag the cost and ask before proceeding.
- **One commercial surface: TCGplayer affiliate purchase links.** The single exception to "no revenue," added deliberately. It is bound by rules that are part of the constraint, not decoration: commerce never outranks the product's own actions in visual weight; a purchase link always names the vendor in its own label rather than relying on a tooltip or hover; prices already on screen stay inert text, because a commercial link disguised as body text is what a no-ads product cannot afford to ship; and the affiliate relationship is disclosed in the footer and at the link. Adding a second affiliate partner, or promoting commerce into the generate-and-go flow, is a decision to make explicitly — not to inherit.
- **No account, ever, as a precondition.** Every feature that can work without auth works without auth. User state lives in `localStorage` (settings, banned and must-include cards, currency, toggles, lists) and IndexedDB (collections, caches). Nothing requires a server round-trip to a user record.
- **No LLM opinion layer in the product.** Analysis is deterministic and explainable by policy, not by accident — an in-product AI chat / advice feature was built, reviewed hands-on, and rejected. Transparent formulas beat magical output because they can be verified and argued with.
- **Upstream data is rate-limited and must be respected.** Scryfall: 100ms between requests, batches of 75. EDHREC: 100ms, cached in memory and persisted to IndexedDB. Precomputed artifacts (tagger data, combo closures) are fetched artifact-first with a live-page fallback.
- **Two deploy targets.** `manafoundry.gg` (S3 + CloudFront, base path `/`, deep links served `index.html` at HTTP 200) is canonical; the GitHub Pages mirror at `/mtg-commander-deck-generator/` genuinely 404s deep links and falls back to `public/404.html`.
- **`UX_PRINCIPLES.md` is committed and binding.** Its eight principles — value before friction, explain don't just recommend, deterministic over probabilistic, progressive disclosure, respect the puzzle, fast beats perfect, mobile is not an afterthought, persist user intent — are product law, not suggestions.

**Terminology the product owes to the game, not to itself** — use it exactly as players do: commander, partner, color identity, mana curve, CMC / mana value, ramp, draw, removal, interaction, wincon, archetype, theme, bracket, precon, goldfish, pod, rule zero, LGS.

**Undecided / not established:**

- Whether SpellChroma is first-class core product alongside the four surfaces above.
- Whether `/brew` (the crack-a-pack minigame) ever graduates to public navigation.

## Brand Commitments

- **Name: ManaFoundry**, one word, capital M and capital F. The live site, page titles, OG tags, and in-app copy all use this casing. `README.md` uses "Manafoundry" in several places and is out of step — treat `ManaFoundry` as correct.
- **Canonical domain: `manafoundry.gg`.** Formerly "EDH Deck Builder"; the GitHub repo is still `mtg-commander-deck-generator` and the npm package is still `mtg-deck-builder`. Those are legacy identifiers, not the brand.
- **Committed assets:** `public/logo.png`, `public/logo.ico`, `public/inspector-logo.png`, `public/spellchroma-logo.png`, `public/og-banner.png` (1200×630), `public/card-back.png`.
- **Licensed third-party identity:** mana-font for mana symbols and card-type iconography. Card art and card data come from Scryfall.
- **Attribution is non-negotiable.** Scryfall, EDHREC, Commander Spellbook, and mana-font are credited; the product's entire positioning rests on citing its sources.
- **MIT licensed, open source.**
- **Voice** (derived from shipped copy, not separately confirmed): plain, specific, and explanatory. It states what it did and why — "Pull the candidate pool," "Detect combos & analyze" — with no hype, no exclamation marks, and no mascot. It never claims more certainty than the data supports.

## Evidence on Hand

**Real data sources (live, in production):**

- **Scryfall** — card database, images, legality, pricing, oracle tags.
- **EDHREC** — commander archetypes, themes, inclusion rates, curve and type averages, color pages, tag pages.
- **Commander Spellbook** — combo index, precomputed weekly into 32 per-color-identity closure files on the tagger S3 bucket, with live-page fallback.
- **Tagger artifacts** — 18 oracle tags mapped to functional roles, served from S3.

**Real content in the repo:**

- `docs/seo-and-link-embeds.md`, `docs/share-links.md`, `docs/brew-minigame.md`, `docs/reddit-launch-playbook.md`
- `src/data/patchNotes.json` — the real, user-facing release history
- `sample-collection-500.csv`, `sample-share-links.txt` — real fixtures for collection import and share links

**Absences future work must not fabricate:** there are no testimonials, no named users or customers, no user counts or traffic figures, no press coverage, no benchmarks against competing tools, no pricing or licensing tiers, and no case studies. The product has a launch playbook, not a launch record. Do not invent social proof, "trusted by N players," star ratings, or quoted endorsements for any surface.

## Product Principles

1. **The full value arrives before the first decision.** No account, no wizard, no wall. A player who lands and does the minimum still leaves with a complete deck. Anything that delays the payoff has to earn its place against this.
2. **Every number shows its work.** A recommendation without its lineage is noise. Inclusion %, role fit, curve gap, combo evidence — the reason travels with the result, because the reason is what the player takes to their pod.
3. **Countable beats clever.** Deterministic, reproducible metrics over black-box opinion, permanently. When a measurement and an impressive-sounding judgment conflict, ship the measurement.
4. **The surface picks its user.** Generate-and-go and brew-with-me are different jobs; a screen serves one of them well rather than both adequately.
5. **Build for the sixth month, not the first minute.** Retention is the constraint. The deck a player made in March has to be worth reopening in September — so the product remembers their intent, notices what changed, and gives them a reason to come back.

## Accessibility & Inclusion

- **Mobile parity is a product requirement, not a responsive courtesy.** Every feature works on a phone: toolbars collapse into overflow menus, labels fall back to icons, touch targets stay generous. The established exception is bot playtesting, which is desktop-only by deliberate decision (phone playtest is goldfish only).
- **Persisted user intent is an accessibility affordance too** — settings, currency, display toggles, banned and must-include cards survive across sessions so nobody re-configures the app on every visit.
- **No formal conformance target has been adopted.** No WCAG level is currently committed to. Recorded as undecided rather than assumed; do not claim a level the project has not adopted.
