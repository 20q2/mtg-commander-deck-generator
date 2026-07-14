# The Brew Minigame — Intentions & Implementation

A write-up of the interactive brewing mode: a guided deckbuilder that lives at `/brew`,
pairing the *why* (design intent) with the *how* (the code under `src/services/brew/` and
`src/components/brew/`).

> **Status (2026-07-12, main):** the **crack-a-pack loop** is the shipped core: sealed,
> blind booster packs → crack one → a fan of cards → keep what you like. The 2026-07-08
> Treasure/Fate/Trial fun-layer spec is fully built. A tone-and-clutter cull is in progress
> (see [§11 Punch list](#11-punch-list--known-seams)) — several systems built during the
> feature sprees have been removed from the UI or are queued for removal.

---

## 1. The thesis

Generating a Commander deck is normally one click: pick a commander, get 99 cards. Brew keeps
that engine but wraps it in a run of **~20–25 meaningful choices**. The player cracks packs,
chases combos, and commits to themes — and the deck takes shape around them. The goal feeling:
finish thinking **"I built this deck"** while still getting the recommendation engine's floor.

Three principles hold the whole thing together:

1. **Presentation layer, not a new generator.** Brew never reimplements deckbuilding. Picks
   feed the existing `generateDeck()` as must-includes; it tops the deck to a legal 99 + mana
   base. The engine (`src/services/brew/`) is pure functions over `(BrewContext, BrewState)` —
   no store imports, no React, testable in isolation.
2. **Steering, never blocking.** Targets are soft gauges. The engine biases what it *offers*;
   every pick is honored, even a lopsided one. You always end with a playable deck.
3. **Honest framing.** Every recommendation names its data lineage ("3 of your cards want
   this", "Hidden synergy with X"). Every tease is real (a glinting pack really holds gold);
   every forecast on the fate-map is only as specific as the engine can actually promise.

Non-goals: no meta-*power* (the Journal/Treasury remember runs, they never buff them), no
separate brew generator, no railroading.

### What playtesting taught us (the design lessons that now govern brew)

- **Blind cracks are the fun.** Packs are sealed: the face carries only a small indication of
  the theme (title + a "feat. «hallmark»" kicker painted on the wrapper), never the contents.
  Cracking blind and discovering the fan is the core dopamine beat. Earlier face-up "pick 1 of
  3 crates, all cards visible" versions read as homework.
- **Cut the words.** Wordy labels, flavor copy with an inconsistent voice, and HUD chrome that
  narrates instead of plays ("Goal", "On a roll" streak chips, act numerals, reassurance
  captions) actively made the game worse and have been cut. Every surface gets one voice and
  the minimum copy that carries it.
- **Ship one beat at a time and play it.** The 2026-07 feature spree produced a coherent spec
  but an incoherent game; systems now land only after being played end-to-end.

---

## 2. The shape of a run

```
/brew landing (+ Treasury shelf) → Setup → Intro morph
  → [ pack · pack · pack · MOMENT ] × N
  → Mana-base capstone (or "Finish for me" at any fork)
  → finishBrew → Run recap → Deck view
```

The rhythm is `STEER_EVERY = 4` in [flow.ts](../src/services/brew/flow.ts): three packs, then
one **moment** (a fork, an event, a philosophy offer, or a question), landing on history
indices 3, 7, 11… `advanceAfterPick(ctx, state)` returns either the next pack node or `null`
("surface a moment"). The store's `brewAdvancePatch` resolves what the moment is, in strict
priority: **philosophy offer → event → question → bare fork**.

A first-ever visit shows a one-time splash (`mtg-brew-splash-seen`); resuming a `?b=<id>`
session replays the last two moments as a "Previously, on your brew…" cliffhanger. **"Finish
for me" is always one click away** at the fork — it picks a sensible land style from the setup
(budget pool → budget fixing) and builds immediately.

---

## 3. The crack-a-pack loop (the core)

Built in [nodes.ts](../src/services/brew/nodes.ts) (`clusterBundles` → `buildPackNode`) and
played in [BrewPackCrack.tsx](../src/components/brew/BrewPackCrack.tsx).

**Offer:** each pack round deals `BUNDLE_COUNT 3` sealed boosters. Each pack is a coherent
cluster of `BUNDLE_MIN 3`–`BUNDLE_MAX 5` cards sharing a subject — but the player only sees
the wrapper: theme title, a "feat. «hallmark»" line, card count, and (sometimes) a golden
glint. Cards are claimed greedily across packs, so taking one really does forfeit the others.

**Crack:** picking a pack is a commitment — the other packs fall away, Back/"Show different"
disappear (contents are hidden, so backing out after a peek would be an info leak), the
ceremony plays (see §9), and the cards erupt into a fan.

**Keep:** the player keeps any of the fan, minimum 1; the rest are passed. An opt-in
"Suggested" toggle (persisted, `mtg-brew-suggest`) highlights the engine's top-scored card or
two. Passed cards are held out of the next round so they never bounce straight back.

**How the 3 packs are chosen** (priority order, with a 2-round rotation window so the same
packs don't cycle):

1. **Need pack** — the biggest role/type deficit, only once the deck is past its
   identity-building opening (`deckFill ≥ IDENTITY_PHASE_FILL 0.3`). Early rounds are all
   themes: direction first, holes later.
2. **Theme packs** — one per commander theme with stock, leaning themes weighted up. Composed
   **signature-first** from `themeSignatures` (the cards that *define* the theme on EDHREC,
   not staples merely played in it); each carries a `hallmarkName` so a "Drain the Table"
   pack provably contains a drain. Board-wipe-likes never appear in a theme pack (oracle-text
   regex catches untagged wipes); ramp/removal only when they're that theme's own signature.
3. **Cluster pack** ("Plays With Your Deck") — cards the whole-deck lift web found alongside
   many of your picks (`connectionCount ≥ 2`).
4. **Discovery pack** — single-seed lift/co-play finds.
5. **Exploration slot** — a seeded under-shown theme so runs don't converge on the same 1–2
   themes (skipped when a cluster pack is present).

Thin-pool fallbacks (generic "Top Picks"/"More Options" splits, then a single pack) guarantee
the round never dead-ends while draftable cards remain.

### Windfalls — the treasure layer

Theme packs may secretly hide the theme's defining payoff as a free bonus card, revealed as a
**foil in the fan**. Everything is seeded (per-run `state.seed` + a stable key), so a pack
either has it or it doesn't — stable across undo/resume, no save-scumming:

| Lever | Value | Meaning |
|---|---|---|
| `WINDFALL_CHANCE` | 0.12 | ~1-in-8 theme packs hide gold |
| `RAINBOW_SHARE` | 0.16 of hits | ≈2% absolute: a Game Changer / the theme's top payoff, prismatic reveal |
| Pity ramp | pick 15, +0.06/pack, cap 0.6 | every run gets a treasure moment; resets once one fires |
| `GODPACK_CHANCE` | 0.007/round | every theme pack pays out; all crates glow |
| `TEASE_SHARE` | 0.5 | half of windfall packs *advertise* (a glinting seam) — temptation vs. need. Never lies. |
| Seal the Pack | fork wager | skip a round → next theme pack is guaranteed gold (once/run) |

---

## 4. State model: immutable context + pure transitions

Defined in [brewTypes.ts](../src/services/brew/brewTypes.ts) — read it first; it's the domain
glossary.

- **`BrewContext`** — built once by
  [prepareBrewContext.ts](../src/services/brew/prepareBrewContext.ts) (the single network
  fan-out: EDHREC commander/partner/combos + top-8 theme pages, Scryfall batch resolve, tagger
  roles). Holds the scored candidate pool, role/type/curve/land targets, combos +
  `comboPieceCounts`, `themeNames`/`themeSignatures`, `gameChangerNames`.
- **`BrewState`** — every transition returns a new state. Picks, `usedNames`, `themeAffinity`
  (§5), undo `history`, `discovered` (§7), `moments` (the story log, decoupled from undo),
  windfall latches, pack-rotation memory, and the per-run jitter `seed`.
- **Randomness:** all of it goes through [jitter.ts](../src/services/brew/jitter.ts)
  (`seededJitter/seededChance/seededPick` — pure hashes of `(seed, key)`). Runs differ; a
  given run is byte-stable across resume and undo.
- **Persistence:** sessionStorage `brewctx:<id>` / `brewstate:<id>` via
  [persistCodec.ts](../src/services/brew/persistCodec.ts) (survives `Set`/`Map`); hydrated
  from the `?b=` param. Cross-run: [journal.ts](../src/services/brew/journal.ts) —
  localStorage `mtg-brew-journal-v1`, 50-run cap, feeds the landing page's Journal + Treasury
  shelf. Meta-memory, never meta-power.

---

## 5. Emerging identity: theme affinity as a feedback loop

- Each candidate carries the EDHREC theme slugs it belongs to (`themeTags`).
- Every pick adds `AFFINITY_PER_PICK 10` per tag ([picks.ts](../src/services/brew/picks.ts));
  undo subtracts precisely.
- [scoring.ts](../src/services/brew/scoring.ts) feeds affinity back **concavely**
  (`6·√affinity`, weight ramping 0.4 → 0.9 with deck fill) so a lean compounds without
  monopolizing.
- [identity.ts](../src/services/brew/identity.ts) surfaces leans ≥ `LEANING_THRESHOLD 20` as
  the readout ("Leaning **Tokens · Sacrifice**") and, at the end, `leaningThemeResults` hands
  the identity to `generateDeck` so the fill respects what the run became.
- A Crossroads **commit** (§8) adds `CROSSROADS_COMMIT 40`, injects the theme's signature
  cards into the pool via discovery, and soft-suppresses off-theme non-urgent candidates
  (`OFF_THEME_PENALTY 60` — broken only by `isUrgentFill`).

Affinity is a scoring boost, never a constraint. The **exploration slot** (§3) is the
deliberate counter-force so identity converges by choice, not by echo chamber.

---

## 6. Scoring: what floats up

`scoreCandidate()` reuses the deckBuilder's `scoreRecommendation` (role/type/curve/combo
deficits — brew and one-click mode agree on "good"), then layers brew signals: theme affinity,
discovery co-synergy (`×0.3`, lift +8), cluster connections (+6 each, cap 6), combo-piece glue
(+4 per combo, cap 6), pinned-for-later (+25), deep-cut spice (fades by 0.5 fill), and the
commit penalty. **Offer ordering** adds seeded per-run jitter (`JITTER_AMPLITUDE 15` in
nodes.ts) — big enough that runs surface different-but-comparable cards, small enough that a
worse card never leapfrogs a clearly better one. Jitter applies to offers only, never health
or event math.

`deriveReasons()` attaches up to 5 ranked rationales per card (combo finisher / Game Changer
first, then role deficit, discovery provenance, theme, utility flags) — the chips under each
fan card.

---

## 7. Card-driven discovery

The pool would otherwise be frozen at setup from the commander's *averaged* EDHREC page.
[discovery.ts](../src/services/brew/discovery.ts) makes it diverge based on *your* picks, with
honest provenance:

- **Per-pick seeds** (`discoverFrom`): after each steer the store seeds recent picks (cap
  scales with the Spicy philosophy), fetches their EDHREC card relations, dedupes keeping the
  strongest source (`lift < coplay < similar`), and injects survivors tagged `discoveredVia` +
  `coSynergy`.
- **Whole-deck cluster scan** (`discoverClustersFrom`): past 0.4 fill (rescanned every 5
  picks), the lift web finds cards connected to *many* of your picks — these carry
  `connectionCount` ("3 of your cards want this") and power the cluster pack.
- A Crossroads commit seeds the committed theme's top signatures immediately.

---

## 8. Moments: questions, events, philosophies

Surfaced one at a time at steer indices, throttled by `MIN_MOMENT_GAP 5` picks. Event-granted
picks are **locked from undo** (accept fate).

- **Questions** ([questions.ts](../src/services/brew/questions.ts)) — playstyle prompts that
  lean a theme by `QUESTION_LEAN 12` (below the leaning threshold: a nudge, not a commit).
  Max 2 per run, second eligible from pick 8. Skippable.
- **Events** ([events.ts](../src/services/brew/events.ts)) — generated from data the engine
  already holds, no new network calls. Priority: **Combo Fragment** (a near-miss combo — take
  the missing piece) → **Signature Pick** → **Strange Signal** (a surprising high-lift card;
  trusting it is a locked pick) → **Crossroads** (competing themes; commit or stay open) →
  **Gamble** (a deep cut almost no one runs; the leap seeds fresh discoveries).
- **Philosophies** ([relics.ts](../src/services/brew/relics.ts) — "relic" in the code) — a
  single 1-of-3 stance offered once, from pick `FIRST_PHILOSOPHY_AT 6`: **Efficient** (favor
  proven staples ×2), **Spicy** (discovery rate ×1.8), **Combo Brew** (combo bias ×1.8). One
  scoring lever each, worn in the health strip's tray.

Near-miss combo detection ([combos.ts](../src/services/brew/combos.ts)): combos the deck is
1–2 cards short of with ≥1 piece owned and all missing pieces in the pool, ranked by payoff
tier (win/infinite first, "draw the game" deprioritized), then fewest-missing, then
popularity.

### The fork (every 4th node)

[routes.ts](../src/services/brew/routes.ts) `nextRoutes()` deals up to three **specials** —
Complete a Combo, Headliner (four standouts, take any), Hidden Synergy (draft one graph
find), Take a Gamble (from pick 8), Seal the Pack (rare seeded wager, once/run) — rotated per
fork so the menu stays fresh. Opening a pack is the run's normal fare, so it rides along as a
quiet "…or just open a pack" pill under the specials, never as a peer card. Specials are
sealed too: each is one route-colored booster with **generated abstract art**
([specialPackArt.ts](../src/components/brew/specialPackArt.ts) — seeded canvas painting per
motif; no featured card), cracked with the same ceremony before its choice screen appears.

---

## 9. The pack ceremony (3D)

[packScene.ts](../src/components/brew/packScene.ts) renders real 3D boosters with three.js —
**lazy-loaded as its own chunk**; instant CSS packs render first and crossfade to WebGL when
ready (and remain the full fallback for reduced-motion / no-WebGL / load failure).

- Packs are displaced-box "pillow" geometry split into two welded pieces at the seam (crimp
  strip + body), wrapped in a canvas-painted texture — hue gradient, full-bleed art, foil
  crimps, and the **set block printed on the wrapper** (title in the Pocket-style outlined
  treatment, "FEAT. «HALLMARK»" kicker, card count, amber tease line). No DOM text floats
  over the 3D packs.
- Look: `MeshPhysicalMaterial` with the texture doubling as an emissive map (product-shot
  richness), PMREM room environment with the **light rig rotated** so faces reflect the dark
  floor instead of a milky ceiling, one faint raking key light, spring-simulated pointer tilt
  and an idle hover.
- Crack beats (`burst()`): a spark sweeps the seam (tear) → the strip **pops** off with a
  flash and a burst of hue-tinted sparks → the body recoils and sheds while the **fan erupts
  at mouth-open** (the scene's promise resolves exactly then — that's the DOM's cue).
  `playPackCrack()` stretches a synthesized noise sweep to land the pop on the release.
- Sound/haptics ([brewSound.ts](../src/services/brew/brewSound.ts)) are Web-Audio-synthesized
  (no assets), gated by a persisted mute toggle in the health strip.

Gotchas that will bite again: Scryfall art drawn to canvas/WebGL needs the cache-busting
param (browser serves the non-CORS cache entry otherwise → tainted canvas); data:/blob: URLs
must *skip* that param; generated wrapper art stays a ≤448px JPEG (Chrome's ~2MB data-URL
cap); `HEADROOM_PX`/`FOCUS_PX` in packScene must match the canvas classes in BrewPackCrack.

---

## 10. Watching the deck take shape

Post-cull, the HUD is deliberately two quiet bars plus opt-in panels:

- **[BrewHealthStrip](../src/components/brew/BrewHealthStrip.tsx)** — commander portrait,
  leaning readout, philosophy tray, cards/cost, mute toggle. `StatPop` pops "+N" deltas as
  numbers rise. (The Deck Score readout was cut 2026-07-12 — an abstract number serving no
  in-run decision.)
- **[BrewTrack](../src/components/brew/BrewTrack.tsx)** — the fate-map: `peekHorizon` in
  flow.ts forecasts the next 5 nodes (pack icons, a moment's category when it's *provably*
  stable, a "?" rune when it genuinely depends on future picks — a wrong icon is worse than a
  rune), over a quiet progress fill. The Goal chip, streak chip, and act numeral that used to
  crowd this bar were cut (wordy, tonally off, not fun).
- **Stats** — [BrewStatsPanel](../src/components/brew/BrewStatsPanel.tsx) docks as a rail on
  ≥1560px screens; [BrewStatsButton](../src/components/brew/BrewStatsButton.tsx) opens the
  same [BrewStatsContent](../src/components/brew/BrewStatsContent.tsx) (identity radar, role
  radar, type radar, curve) in a drawer below that.
- **Deck so far** — [BrewDeckListButton](../src/components/brew/BrewDeckListButton.tsx):
  a real side column on ≥1024px, a drawer below.
- **[BrewBackdrop](../src/components/brew/BrewBackdrop.tsx)** (mounted by Layout for all
  `/brew*`) — the foundry backdrop plus an aurora that tints toward the colors you've drafted
  and swells with fill.
- Shared visual language lives in [brewVisuals.tsx](../src/components/brew/brewVisuals.tsx)
  (`ROLE_AXES` is the single source for radar spokes *and* card role badges).

### Screens & routing

[App.tsx](../src/App.tsx): `/brew` → BrewLandingPage, `/brew/:commanderName/:partnerName?` →
[BrewPage](../src/pages/BrewPage.tsx) (both eager; only three.js + pack art are deferred).
BrewPage renders exactly one primary screen — `brewRelicOffer → brewEvent → brewQuestion →
brewNode → BrewPath` — plus overlays (Intro, Previously, Recap, ManaCapstone,
CommitFlash, Celebration). Store actions are the UI↔engine seam: `startBrewSession`,
`openBrewRoute`, `applyBrewOption`, `answerBrewQuestion`, `chooseBrewEvent`,
`chooseBrewRelic`, `undoBrewPick`, `rerollBrew`, `pinBrewCard`, `backToBrewFork`,
`expandBrewDiscoveries`/`expandBrewClusters`.

---

## 11. Finishing the run

The nonland phase is finishable at `NONLAND_COMPLETE_RATIO 0.85` — the tail is the
generator's job. The deliberate path opens the **mana-base capstone**
([BrewManaCapstone](../src/components/brew/BrewManaCapstone.tsx)): Reliable / Greedy /
Budget / Spell Lands, each a structural delta on the base
([finishBrew.ts](../src/services/brew/finishBrew.ts), floor 34 lands). "Finish for me"
skips the quiz with an inferred style.

`finishBrew` merges picks as must-includes into the standard `generateDeck()`, carrying the
run's leaned themes. Then:

1. **The run recap** ([BrewRunRecap](../src/components/brew/BrewRunRecap.tsx)) — the single
   end-of-run screen: a generated run title, the moment timeline, Treasury additions, and the
   Rival divergence tally (the engine's private ranking vs. your actual takes — logged, never
   judged: "you built this deck, your way"). Its footer carries **View your deck** plus a quiet
   secondary **Open in Inspector** (`/analyze/<id>`) — the one-click-fix bridge, always
   available, no deck-health framing.
2. The run is recorded to the Journal, the session tears down, and the deck opens in the
   normal deck view.

> The **Gauntlet** — a separate pre-recap screen that put the deck through three "trials"
> (Board Wipe / Archenemy / Long Game) with epic per-verdict flavor — was **cut 2026-07-14**:
> too wordy, a tone reaching past what the moment earned, and a redundant second dialogue
> stacked before the recap. The honest deck-health read it offered lives on in the Inspector;
> the Inspector bridge the player liked survives as the recap's secondary button.

---

## 12. Punch list — known seams

Kept honest so nobody describes these as working. The wordy/tonal cull (2026-07-11→) removed
the Goal HUD label, streak chip, act interstitials + numeral, goal/streak celebration toasts,
the stats-rail reassurance caption, and the end-of-run **Gauntlet** (2026-07-14 — its trials
folded away, its Inspector bridge kept on the recap). Still standing:

| Seam | Reality |
|---|---|
| `state.comboWatch` | **Never written.** Scoring reads it (`COMBO_WATCH_BONUS 30`) and Combo Brew amplifies it, but the Investigate beat that was to populate it doesn't exist — the philosophy's advertised lever is a no-op. Add the beat or cull the lever. |
| Double-or-nothing wager | Dead on the pack path: `BrewPackCrack` strips `wagerTrade` on commit, while nodes.ts still attaches trades and **claims 2 signature cards from the pool** per gold roll — a silent cost with no payoff surface. Cut or re-home. |
| Goal system remnants | goals.ts, `synergyStreak`, recap/journal/Treasury goal surfaces, 'goal'/'streak' celebration kinds + sounds — orphaned-ish after the HUD cull; next cull pass decides if the system is dead or just its label. |
| Dead exports | `philosophyPromoted` (scoring), `openingThemeQuestion` (questions), `relicPackBonus` (relics); `relicThemeMult`/`relicBudgetCap` wired but no live philosophy emits those effects. `BrewIdentityMeter variant="strip"` is unreachable. |
| Constant mirrors | Deliberate anti-import-cycle duplicates — keep in sync by hand: `LEANING_THRESHOLD 20` (identity + questions), `GAMBLE_MIN_PICKS`/`GAMBLE_FORK_MIN 8` (events/routes), `QUESTION_AT`/`SECOND_QUESTION_AT 8` (flow/store). |

---

## Quick file map

| Concern | File |
|---|---|
| Types (the domain glossary) | `src/services/brew/brewTypes.ts` |
| Run cadence / fate-map | `src/services/brew/flow.ts` |
| One-time context build | `src/services/brew/prepareBrewContext.ts` |
| Fork routes / deficits | `src/services/brew/routes.ts` |
| Pack building / windfalls / reasons | `src/services/brew/nodes.ts` |
| Scoring | `src/services/brew/scoring.ts` |
| Pick / undo transitions | `src/services/brew/picks.ts` |
| Discovery (seeds + clusters) | `src/services/brew/discovery.ts` |
| Events / questions / philosophies | `src/services/brew/{events,questions,relics}.ts` |
| Combos / health / identity / stats / goals | `src/services/brew/{combos,health,identity,stats,goals}.ts` |
| Seeded randomness | `src/services/brew/jitter.ts` |
| Journal / sound / persistence | `src/services/brew/{journal,brewSound,persistCodec}.ts` |
| Finish → deck | `src/services/brew/{finishBrew,brewDeckToList}.ts` |
| Engine barrel | `src/services/brew/engine.ts` |
| Orchestrator page | `src/pages/BrewPage.tsx` |
| Pack crack / special packs / 3D scene | `src/components/brew/{BrewPackCrack,BrewSpecialPack,packScene,specialPackArt}.*` |
| Screens & HUD | `src/components/brew/Brew*.tsx` |
| Shared visual language | `src/components/brew/brewVisuals.tsx` |
| Store session slice | `src/store/index.ts` (search `brew`) |
