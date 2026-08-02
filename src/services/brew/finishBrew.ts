import type { GeneratedDeck, ManaPhilosophy, ManaMix, ScryfallCard } from '@/types';
import { generateDeck } from '@/services/deckBuilder/deckGenerator';
import type { BrewContext, BrewState } from './engine';
import { leaningThemeResults } from './identity';
import { scoreCandidate } from './scoring';

const MANA_STYLES: ManaPhilosophy[] = ['reliable', 'greedy', 'budget', 'spelllands'];

/**
 * The non-land cards most likely to top up the deck's "remaining space" after the brew picks + lands
 * — the top-scored candidates from the SAME scored pool the generator backfills from, minus what's
 * already picked or cut (killedNames). An honest ESTIMATE for the capstone's live preview: the real
 * fill lands when generateDeck runs at finish, but this pool + ordering is what it draws from. Sorted
 * once (best first); the capstone slices however many slots the chosen land count leaves open.
 */
/**
 * A land count tuned to the deck you brewed, not a static target: the commander's EDHREC baseline
 * (ctx.landTarget), nudged DOWN for a low curve / strong ramp and UP for a high curve / sparse ramp,
 * floored at ~a third of the deck.
 */
export function recommendLandCount(ctx: BrewContext, state: BrewState): number {
  const total = ctx.nonLandTarget + ctx.landTarget;
  const nonland = state.picks.filter(p => !p.card.type_line.toLowerCase().includes('land'));
  const avgCmc = nonland.length ? nonland.reduce((s, p) => s + (p.card.cmc ?? 0), 0) / nonland.length : 3;
  const ramp = state.picks.filter(p => p.role === 'ramp').length;
  const ratio = total / 99;

  let n = ctx.landTarget;
  if (avgCmc < 2.5) n -= 2; else if (avgCmc < 3.0) n -= 1; else if (avgCmc >= 4.0) n += 2; else if (avgCmc >= 3.5) n += 1;
  if (ramp >= Math.round(10 * ratio)) n -= 2; else if (ramp >= Math.round(7 * ratio)) n -= 1; else if (ramp < Math.round(4 * ratio)) n += 1;

  return Math.max(Math.round(total * 0.33), Math.min(total - 1, n));
}

export function previewBackfill(ctx: BrewContext, state: BrewState): ScryfallCard[] {
  const used = new Set([...state.usedNames, ...state.killedNames]);
  return ctx.candidates
    .filter(c => !c.isLand && !used.has(c.name))
    .sort((a, b) => scoreCandidate(ctx, state, b, []) - scoreCandidate(ctx, state, a, []))
    .map(c => c.scryfall);
}

/** Don't let a philosophy's land delta drop a deck below this many lands. Never inflates a base the
 *  player deliberately set below it — only guards against the delta pushing an already-fine count too low. */
const LAND_FLOOR = 34;

/**
 * WS5 — how each land philosophy STRUCTURALLY reshapes the mana base, not just re-orders it. Deltas
 * are applied to the player's setup values (then clamped), so the choice visibly changes the
 * basic/nonbasic mix — and the total land count for spell-lands. The within-budget per-land boosts
 * in generateLands' manaPhilosophyBoost still steer WHICH lands fill those slots (reliable → fixing
 * duals, greedy → utility, spelllands → MDFCs, budget → cheap). These deltas are deliberately modest
 * and safe: more nonbasics = more fixing; fewer nonbasics = more basics (basics fix perfectly), so the
 * existing channel-land / Command Tower / pip-proportional-basic guardrails keep every base playable.
 */
const PHILOSOPHY_PROFILE: Record<ManaPhilosophy, { landDelta: number; nonBasicDelta: number }> = {
  reliable:   { landDelta: 0,  nonBasicDelta: 3 },   // more fixing lands (duals / triomes / fetches)
  greedy:     { landDelta: 0,  nonBasicDelta: 4 },   // more nonbasic slots → utility lands fill them
  budget:     { landDelta: 0,  nonBasicDelta: -4 },  // fewer pricey nonbasics, more (cheap) basics
  spelllands: { landDelta: -1, nonBasicDelta: 2 },   // MDFCs double as spells → one fewer pure land
};

/**
 * Finish a brew: feed every brewed pick to generateDeck as a must-include, so the
 * existing generator fills the remaining slots (incl. the mana base) around them.
 * `landMix` is the capstone wheel's blend of the four land styles — it biases land selection in the
 * generator and reshapes the count/basic split (undefined / all-zero = the standard "Balanced" base).
 */
export async function finishBrew(
  ctx: BrewContext,
  state: BrewState,
  landMix?: ManaMix,
  landCount?: number,
  onProgress?: (message: string, percent: number) => void,
): Promise<GeneratedDeck> {
  const brewedNames = state.picks.map(p => p.name);
  const mixTotal = landMix ? MANA_STYLES.reduce((s, k) => s + Math.max(0, landMix[k] ?? 0), 0) : 0;
  const customization = {
    ...ctx.customization,
    mustIncludeCards: Array.from(new Set([...(ctx.customization.mustIncludeCards ?? []), ...brewedNames])),
    tempMustIncludeCards: [],
    // The wheel's blend steers WHICH lands fill the base (resolveManaMix in the generator reads this).
    manaPhilosophy: undefined,
    manaPhilosophyMix: mixTotal > 0 ? landMix : undefined,
  };
  // The capstone's chosen land COUNT is authoritative when set (the player dialed it within the
  // recommendation's wiggle room); the mix then only steers the basic/nonbasic split, not the total.
  if (landCount != null) customization.landCount = Math.max(1, Math.round(landCount));
  // WS5: the blend reshapes the STRUCTURE too — a weight-normalized sum of each style's profile delta,
  // flowing through the generator's existing land-target math. An all-zero / absent mix ("balanced")
  // leaves it untouched.
  if (mixTotal > 0) {
    let landDelta = 0, nonBasicDelta = 0;
    for (const k of MANA_STYLES) {
      const w = Math.max(0, landMix![k] ?? 0) / mixTotal;
      landDelta += w * PHILOSOPHY_PROFILE[k].landDelta;
      nonBasicDelta += w * PHILOSOPHY_PROFILE[k].nonBasicDelta;
    }
    const floor = Math.min(customization.landCount, LAND_FLOOR);
    // The mix nudges the COUNT only when the player didn't set it explicitly (else they're authoritative);
    // the floor only catches a delta dropping lands too low, never raising a deliberately-low base.
    if (landCount == null) customization.landCount = Math.max(floor, customization.landCount + Math.round(landDelta));
    customization.nonBasicLandCount = Math.max(0, Math.min(customization.landCount, customization.nonBasicLandCount + Math.round(nonBasicDelta)));
  }
  let collectionNames: Set<string> | undefined;
  if (customization.collectionMode) {
    const { getCollectionNameSet } = await import('@/services/collection/db');
    collectionNames = await getCollectionNameSet(customization.collectionBinderIds);
  }
  const deck = await generateDeck({
    commander: ctx.commander,
    partnerCommander: ctx.partnerCommander,
    colorIdentity: ctx.colorIdentity,
    customization,
    // WS1: carry the run's revealed identity into the generator so the backfill + targets honor
    // the themes the player leaned into, instead of falling back to the commander's averages.
    selectedThemes: leaningThemeResults(ctx, state),
    collectionNames,
    onProgress,
  });
  deck.builtFromCollection = !!customization.collectionMode;
  return deck;
}
