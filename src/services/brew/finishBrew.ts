import type { GeneratedDeck, ManaPhilosophy } from '@/types';
import { generateDeck } from '@/services/deckBuilder/deckGenerator';
import type { BrewContext, BrewState } from './engine';
import { leaningThemeResults } from './identity';

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
 * `landStyle` is the capstone mana-base choice — it biases land selection in the generator
 * (undefined = the standard "Balanced" selection).
 */
export async function finishBrew(
  ctx: BrewContext,
  state: BrewState,
  landStyle?: ManaPhilosophy,
  onProgress?: (message: string, percent: number) => void,
): Promise<GeneratedDeck> {
  const brewedNames = state.picks.map(p => p.name);
  const customization = {
    ...ctx.customization,
    mustIncludeCards: Array.from(new Set([...(ctx.customization.mustIncludeCards ?? []), ...brewedNames])),
    tempMustIncludeCards: [],
    manaPhilosophy: landStyle,
  };
  // WS5: a chosen land style reshapes the structure (count + basic/nonbasic split), flowing through
  // the generator's existing land-target math. "Keep it balanced" (undefined) leaves it untouched.
  if (landStyle) {
    const profile = PHILOSOPHY_PROFILE[landStyle];
    // The floor only catches the delta dropping lands too low; it never raises a base the player set
    // below it (so picking a delta-0 style on a deliberately-low land count is a no-op, as intended).
    const floor = Math.min(customization.landCount, LAND_FLOOR);
    customization.landCount = Math.max(floor, customization.landCount + profile.landDelta);
    customization.nonBasicLandCount = Math.max(0, Math.min(customization.landCount, customization.nonBasicLandCount + profile.nonBasicDelta));
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
