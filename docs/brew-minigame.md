# The Brew Minigame — Intentions & Implementation

A write-up of the interactive brewing mode: a Slay-the-Spire-style guided deckbuilder that
lives at `/brew`. It pairs the *why* (design intent, drawn from the specs in
`docs/superpowers/specs/`) with the *how* (the actual code under `src/services/brew/` and
`src/components/brew/`).

> **Status (2026-06-17, branch `feature/brew-engine`):** the engine and screen flow are
> built and tested; the bundle/elite-draft loop has landed. The most recent design
> direction — the **Hybrid Stakes** spec — is only *partially* implemented. Where intent
> and code currently disagree, this doc says so explicitly (see
> [§10 Intent vs. reality](#10-intent-vs-reality-whats-not-yet-true)).

---

## 1. The thesis

Generating a Commander deck is normally one click: pick a commander, get 99 cards. The brew
minigame keeps that engine but wraps it in a **navigable path of ~20–25 meaningful choices**
instead of one button. The player makes routing decisions — "open this pack," "chase this
combo," "commit to this theme" — and the deck takes shape around them.

The guiding feeling, from the Hybrid Stakes spec: **the player should feel the weight and
reward of their own choices, and finish thinking "I built this deck"** — while still getting
the benefit of the recommendation engine underneath.

Three principles hold the whole thing together:

1. **Presentation layer, not a new generator.** Brew never reimplements deckbuilding logic.
   It feeds the player's picks into the *existing* `generateDeck()` as must-includes and lets
   it top the deck to a legal 99 + mana base. The brew engine is pure and testable in
   isolation; it shares `prepareBrewContext()` with the standard generator so the two can't
   drift.
2. **Steering, never blocking.** Budget, power level, and role targets are soft gauges. The
   engine biases what it *offers* toward balance, but every pick the player makes is honored —
   even a lopsided 15-ramp / 0-removal brew. You always end with a playable deck.
3. **Honest framing.** Every recommendation names its lineage. Discovery cards say "High lift
   with Korvold" or "Plays with X (48%)". This is the project's data-driven brand — we're the
   lens on aggregate data, not an authority issuing verdicts.

Explicit non-goals: no meta-progression / unlocks / achievements, no separate brew generator,
no railroading. Questions and themes *nudge*; they never gate.

---

## 2. The shape of a run

```
Landing → Setup → Intro animation → [ pack · pack · pack · MOMENT ] × N → Mana base → Recap → Deck view
```

The core rhythm is set by `STEER_EVERY = 4` in [flow.ts](../src/services/brew/flow.ts): three
packs, then one **moment** (a steering fork, an event, a relic, or a question). `isSteerIndex`
fires the moment on the last node of each four-node cycle (history lengths 3, 7, 11, …).
`advanceAfterPick(ctx, state)` is the heart of the loop — after every pick it returns either
the next pack node, or `null` to mean "surface a moment instead."

A run targets ~20–25 *decisions*, not 99 picks, because bundles fill 3–5 slots at once. The
session is biased toward multi-slot nodes as the deck fills so it lands inside that target
without decision fatigue, and **"Finish for me" is always one click away** at the fork.

---

## 3. State model: immutable context + event-sourced state

Defined in [brewTypes.ts](../src/services/brew/brewTypes.ts). Two objects drive everything.

### `BrewContext` — immutable, built once
Created by `prepareBrewContext()` at session start and never mutated. Holds the commander(s),
color identity, customization, the full `candidates: BrewCandidate[]` pool, and all the
**targets** the deck is steered toward:

- `roleTargets` — ramp / removal / boardwipe / cardDraw counts
- `typeTargets` — creature / instant / sorcery / artifact / … counts
- `curveTargets` — CMC-bucket counts
- `landTarget`, `nonLandTarget`
- `combos`, `themeNames`, `themeSignatures` (top ~16 cards per theme, by synergy)

### `BrewState` — immutable, event-sourced
Every transition returns a *new* state. Key fields:

- `picks: BrewPick[]` — cards chosen, each with role/subtype/inclusion and the `reasons` that
  justified it
- `usedNames` — prevents re-offering
- `themeAffinity: Record<slug, number>` — the invisible feedback loop (see §4)
- `phase` — `'nonland' → 'lands' → 'done'`
- `history` — append-only log of decisions; powers undo and the recap
- `discovered` — cards pulled in by card-driven discovery (§6)
- `relics`, `comboWatch`, `firedEventIds`, `lastMomentPick`, `moments` — the "game layer"

Because everything is pure and deterministic, the session survives a reload: state is written
to `sessionStorage` on every change and rehydrated from a `?b={id}` URL param.
[persistCodec.ts](../src/services/brew/persistCodec.ts) is a small JSON shim that survives
`Set`/`Map` fields across `stringify`/`parse` — so adding a new `Set` to state "just works"
across resume.

---

## 4. Emerging identity: theme affinity as a feedback loop

**Intent (Strategic Identity spec):** routes used to be purely functional ("Add Removal"). The
deck's *personality* should emerge from the player's choices, not be assigned. Pick token-makers
and later packs should drift token-flavored. Identity is discovered, not imposed.

**Implementation:**
- Each candidate is tagged at prep time with the EDHREC theme slugs it appears on
  (`themeTags`).
- When a card is picked, [picks.ts](../src/services/brew/picks.ts) adds
  `AFFINITY_PER_PICK = 10` to `themeAffinity[tag]` for each of its tags.
- [scoring.ts](../src/services/brew/scoring.ts) `scoreCandidate()` adds
  `affinity[tag] * AFFINITY_WEIGHT (0.5)` on top of the base score, so cards sharing your
  revealed themes float to the top of future packs.
- [identity.ts](../src/services/brew/identity.ts) `leaningThemes()` reads affinity ≥
  `LEANING_THRESHOLD (20)` and surfaces the top 2 as a one-line readout
  ("Your deck is becoming **Tokens · Sacrifice**").

Affinity is a *scoring boost, never a constraint* — multiple themes coexist, and the player can
always pick against the lean. `undoLast()` rewinds affinity precisely, subtracting only the tags
of cards actually removed (clamped at 0).

---

## 5. Scoring: how a pack is built

`scoreCandidate()` in [scoring.ts](../src/services/brew/scoring.ts) reuses the standard
`deckAnalyzer` scoring (role/type/curve/combo deficits) so brew and the normal generator agree
on "what's good," then layers brew-specific signals:

| Signal | Weight | Source |
|---|---|---|
| Base (role/type/curve deficit) | — | shared `scoreRecommendation()` |
| Theme affinity | `× AFFINITY_WEIGHT 0.5` | your past picks |
| Discovery co-synergy | `× DISCOVERY_WEIGHT 0.3` | card-to-card relations |
| Lift bonus | `+ LIFT_BONUS 8` | high-lift discoveries |
| Combo watch | `+ COMBO_WATCH_BONUS 30` | pieces you chose to chase |

[nodes.ts](../src/services/brew/nodes.ts) `clusterBundles()` then turns the scored pool into
**2–3 coherent sub-strategy bundles** (`BUNDLE_MIN 2`, `BUNDLE_MAX 4`):

1. A **steering bundle** for the single largest deficit (flavor `need`, top priority).
2. **Theme bundles** for each leaning theme with ≥2 draftable cards (flavor `theme`).
3. A **discovery bundle** for lift/co-play finds (flavor `discovery`).

Cards are claimed greedily — **a card appears in only one bundle**, so picking a bundle really
does forfeit the others. If the pool can't form two coherent clusters, it falls back to generic
"Top Picks" / "More Options" so the player always sees a real choice.

`deriveReasons()` attaches up to `REASON_CAP = 5` ranked rationales per card — combo finishers
and Game Changers first (value 100), then role deficits, then discovery, then theme, then flags
(extra-turn, tutor, …). These render as the chips under each card.

[routes.ts](../src/services/brew/routes.ts) `nextRoutes()` computes the fork: it finds deficits,
detects near-miss combos, and offers up to three routes — a combo route when one is in reach, an
"open a pack" bundle route, and an **elite draft** on alternating forks
(`isEliteFork`, `ELITE_EVERY = 2`, `ELITE_PICKS = 4`: pick 1 of 4 strong cards, lose the rest).

---

## 6. Card-driven discovery

**Intent (Card-Driven Discovery spec):** the candidate pool is otherwise frozen at setup from
the commander's *averaged* EDHREC page. Discovery lets the deck diverge based on *your* specific
picks and surfaces pleasant surprises — with honest provenance.

**Implementation** ([discovery.ts](../src/services/brew/discovery.ts)): after major forks the
store fires `discoverFrom(seedNames, …)` (fire-and-forget). It takes your most important picks,
fetches their EDHREC relations, dedupes keeping the strongest source
(`lift < coplay < similar`), filters to color identity / format / non-land / budget, and injects
the survivors into the pool tagged with `discoveredVia` and `coSynergy`. Scoring then boosts them
and `clusterBundles` can group them into a discovery bundle.

---

## 7. The game layer: questions, events, relics

These are the "it's alive" beats between picks. All are **moments**, not picks — most don't go in
`history` and can't be undone.

- **Questions** ([questions.ts](../src/services/brew/questions.ts)) — the opening beat shows a
  grid of real signature cards ("Which speaks to you?"); picking one *leans* a theme by
  `OPENING_COMMIT_LEAN 24` (over the threshold, so it immediately shows). Up to
  `MAX_QUESTIONS 2` mid-build personality prompts nudge by `QUESTION_LEAN 12`. They steer
  affinity through the same lever picks use — never gating.
- **Events** ([events.ts](../src/services/brew/events.ts)) — three kinds, surfaced at most one at
  a time with a `MIN_MOMENT_GAP 5`:
  - **Strange Signal** — a high-lift card the engine thinks belongs; *Trust* applies it as a
    **locked** (un-undoable) pick.
  - **Combo Fragment** — a near-miss combo; *Investigate* adds the missing pieces to
    `comboWatch` (boosting them in later packs), *Exploit* grabs the cheapest piece now.
  - **Crossroads** — multiple themes leaning; *Commit* adds `CROSSROADS_COMMIT 40` affinity.
- **Relics** ([relics.ts](../src/services/brew/relics.ts)) — persistent modifiers offered 1-of-3,
  first at pick 10 then every `RELIC_EVERY 12`. Effects multiply through scoring
  (`themeWeight`, `discoveryRate`, `spiceRate`, `comboBias`, `packBonus`, `budgetCap`). **See the
  status note in §9 — the current design intends to remove these.**

Combos themselves come from [combos.ts](../src/services/brew/combos.ts)
`detectNearMissCombos()`: combos the deck is 1–2 cards short of, where ≥1 piece is already owned
and all missing pieces are reachable in the pool, sorted by fewest-missing then popularity.

---

## 8. Watching the deck take shape

**Intent (Living Stats Panel + Role Badges specs):** players want to *see* the deck forming, but
the pick screen should stay focused. Use one visual language across charts and cards.

**Implementation:**
- [health.ts](../src/services/brew/health.ts) `buildHealth()` gives the always-on
  [BrewHealthStrip](../src/components/brew/BrewHealthStrip.tsx): deck score, card count, est.
  cost, relic tray. `isComplete()` (nonland phase finishable at
  `NONLAND_COMPLETE_RATIO 0.95`) gates the transition to the mana base.
- [stats.ts](../src/services/brew/stats.ts) `computeDeckStats()` feeds the
  [BrewStatsPanel](../src/components/brew/BrewStatsPanel.tsx) — a six-axis role radar (Ramp,
  Removal, Wipes, Draw, Tutors, Protection), a type radar, and a mana curve vs. EDHREC target.
  Shown only on wide screens once you have ≥3 picks.
- [RoleBadges.tsx](../src/components/brew/RoleBadges.tsx) puts the **same icons and colors** as
  the radar on each card in a pack, so "this card fills my removal hole" is visible, not just
  math. The shared source of truth is `ROLE_AXES` in
  [brewVisuals.tsx](../src/components/brew/brewVisuals.tsx).
- [BrewBackdrop.tsx](../src/components/brew/BrewBackdrop.tsx) tints the aurora toward the colors
  you've actually drafted and swells it as the deck fills, with an operation-colored wash while
  inside a node.
- [BrewTrack.tsx](../src/components/brew/BrewTrack.tsx) is the "up next" rail showing your
  position in the pack-pack-pack-moment cadence.

### Screens & routing
[App.tsx](../src/App.tsx) routes `/brew` → `BrewLandingPage` and
`/brew/:commanderName/:partnerName?` → [BrewPage](../src/pages/BrewPage.tsx), the orchestrator.
BrewPage reads all session state from the Zustand store and renders exactly one primary screen,
keyed to avoid flashes:

```
!sessionActive            → BrewSetup        (customization + Start)
intro                     → BrewIntro        (button → home-node morph)
recap                     → BrewRunRecap     (end-of-run story)
brewRelicOffer            → BrewRelicScreen
brewEvent                 → BrewEventScreen
brewQuestion              → BrewQuestionScreen
brewNode                  → BrewNode         (the pack / draft / combo pick screen)
else                      → BrewPath         (the steering fork)
```

The store actions are the seam between UI and engine: `startBrewSession`, `applyBrewOption`,
`answerBrewQuestion`, `chooseBrewEvent`, `chooseBrewRelic`, `openBrewRoute`, `backToBrewFork`,
`undoBrewPick`, `rerollBrew`, `expandBrewDiscoveries`, and `finishBrew`. After each pick the
store calls `advanceAfterPick`; at a moment it tries relic → event → question → fork in order.

---

## 9. Finishing the run

When the nonland phase completes, the fork offers the mana-base route. `onFinish` calls
[finishBrew.ts](../src/services/brew/finishBrew.ts) `finishBrew()`, which merges every picked
card name into `customization.mustIncludeCards` and calls the standard `generateDeck()` — the
generator fills remaining slots and the mana base. [brewDeckToList.ts](../src/services/brew/brewDeckToList.ts)
flattens the result into a named, summarized `UserCardList` ("*Commander* (Brewed)"), the list is
saved, and [BrewRunRecap](../src/components/brew/BrewRunRecap.tsx) plays the story timeline of
your moments before handing off to the deck view.

This is the payoff of principle #1: the player chose the path, but the *same generator* that
powers one-click mode produces the final legal 99.

---

## 10. Intent vs. reality — what's *not* yet true

The most recent spec, **Hybrid Stakes (2026-06-17)**, is the current design direction but is only
partly built on `feature/brew-engine`. Don't describe the following as shipped:

| Hybrid Stakes intent | Current code reality |
|---|---|
| **Coherent synergy-tag bundles** with visible sacrifice | ✅ **Done.** `clusterBundles()` builds them; recent commits rebuilt packs into sub-strategy bundles. |
| **Cut the lightning round** | ✅ **Done.** The lightning UI/round was removed (recent commits); only a stray `lightning` reroll comment remains. |
| **Elite single-card draft beat** | ✅ **Done.** `isEliteFork` / `ELITE_PICKS`. |
| **Delete relics end-to-end** | ❌ **Not done.** Relics are still fully wired — `shouldOfferRelic` / `offerRelics` / `applyRelic` run in the store and `BrewRelicScreen` still renders. |
| **Mana base as a real choice** (1 of 3 land styles + utility sub-pick) | ❌ **Not done.** The mana base is still an automatic `generateDeck()` fill, not a player-facing choice screen. |
| **Guaranteed event in first ~3 picks**; Crossroads "Commit" perceptibly swings the deck | ⚠️ **Partial.** Events exist with a `MIN_MOMENT_GAP`; no early-event guarantee is enforced, and Commit adds affinity but doesn't (yet) inject a themed bundle. |
| **Pick → "+N" reward sequencing, SFX + mute toggle, reduced-motion variants** | ⚠️ **Partial.** Card-to-deck animation and the `StatPop` "+N" exist; there is no sound layer. |

When iterating, treat the Hybrid Stakes spec as the target and this table as the punch list.

---

## Quick file map

| Concern | File |
|---|---|
| Run cadence / advance | `src/services/brew/flow.ts` |
| Types (context + state) | `src/services/brew/brewTypes.ts` |
| One-time context build | `src/services/brew/prepareBrewContext.ts` |
| Fork routes | `src/services/brew/routes.ts` |
| Pack / draft / combo nodes | `src/services/brew/nodes.ts` |
| Scoring | `src/services/brew/scoring.ts` |
| Pick / undo transitions | `src/services/brew/picks.ts` |
| Discovery | `src/services/brew/discovery.ts` |
| Events / questions / relics | `src/services/brew/{events,questions,relics}.ts` |
| Combos / health / identity / stats | `src/services/brew/{combos,health,identity,stats}.ts` |
| Finish → deck | `src/services/brew/{finishBrew,brewDeckToList}.ts` |
| Orchestrator page | `src/pages/BrewPage.tsx` |
| Screens | `src/components/brew/Brew*.tsx` |
| Shared visual language | `src/components/brew/brewVisuals.tsx` |
| Store session slice | `src/store/index.ts` (search `brew`) |
</content>
</invoke>
