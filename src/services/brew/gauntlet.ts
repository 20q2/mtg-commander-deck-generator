import type { BrewContext, BrewState } from './brewTypes';
import { buildHealth, typeKey } from './health';

/**
 * The Gauntlet — the run's climax. Between the deck being built and the recap, the finished deck
 * faces three archetypal trials, each a question every Commander game eventually asks. Verdicts are
 * computed ONLY from stats the engine already tracks (role counts, curve, combos) — this file reads,
 * it never mutates, and generateDeck is untouched. There is no fail state: a shaky verdict is an
 * honest reading plus a pointer at the Inspector, never a game-over.
 */

export type TrialVerdict = 'strong' | 'pass' | 'shaky';

export interface GauntletTrial {
  id: 'boardwipe' | 'archenemy' | 'longgame';
  title: string;      // "The Board Wipe"
  question: string;   // "Can you rebuild?"
  verdict: TrialVerdict;
  statLine: string;   // the honest data lineage, e.g. "9 removal + 2 wipes — above the 10-card target"
  flavor: string;     // per-verdict dramatic copy
}

// Verdict bands on the ratio of what-you-have vs what-the-targets-expect.
const STRONG_AT = 1.0;
const PASS_AT = 0.6;

function verdictFor(r: number): TrialVerdict {
  return r >= STRONG_AT ? 'strong' : r >= PASS_AT ? 'pass' : 'shaky';
}

/** current/target with a satisfied-when-untargeted guard (a 0 target can't be failed). */
function ratio(current: number, target: number): number {
  return target <= 0 ? 1 : current / target;
}

const FLAVOR: Record<GauntletTrial['id'], Record<TrialVerdict, string>> = {
  boardwipe: {
    strong: 'The table sweeps the board — and you rebuild before anyone else finds their footing.',
    pass: 'You take the hit, regroup, and claw your way back into the game.',
    shaky: 'The wrath resolves and your hand is empty. The rebuild will be slow.',
  },
  archenemy: {
    strong: 'One player runs away with the game — until you dismantle their board piece by piece.',
    pass: 'You have answers, if you draw them at the right time.',
    shaky: 'The archenemy assembles their engine and you can only watch it happen.',
  },
  longgame: {
    strong: 'Hour two. The table is exhausted — and that is exactly when your finisher lands.',
    pass: 'You can go the distance, though the win may take some finding.',
    shaky: 'The game grinds long, and your deck runs out of things to do with it.',
  },
};

/** Add a name + its front face (DFC) — combo lists sometimes cite the front face only. */
function addName(set: Set<string>, name: string): void {
  set.add(name);
  if (name.includes(' // ')) set.add(name.split(' // ')[0]);
}

/** Distinct combos fully assembled by the run (commander/partner + picks own every piece). */
export function completedCombos(ctx: BrewContext, state: BrewState): { cards: string[]; results: string[] }[] {
  const owned = new Set<string>();
  addName(owned, ctx.commander.name);
  if (ctx.partnerCommander) addName(owned, ctx.partnerCommander.name);
  for (const p of state.picks) addName(owned, p.name);
  const seen = new Set<string>();
  const out: { cards: string[]; results: string[] }[] = [];
  for (const combo of ctx.combos) {
    if (!combo.cards.every(c => owned.has(c.name))) continue;
    const key = combo.cards.map(c => c.name).sort().join('|');
    if (seen.has(key)) continue;   // same piece-set listed as several lines is ONE assembled engine
    seen.add(key);
    out.push({ cards: combo.cards.map(c => c.name), results: combo.results });
  }
  return out;
}

/** Sum of curve-target slots within a CMC band — what the archetype expects at that cost. */
function curveBand(curveTargets: Record<number, number>, match: (cmc: number) => boolean): number {
  return Object.entries(curveTargets).reduce((s, [cmc, n]) => (match(Number(cmc)) ? s + n : s), 0);
}

/** The three trials. Pure; reads (ctx, state) and nothing else. */
export function runGauntlet(ctx: BrewContext, state: BrewState): GauntletTrial[] {
  const health = buildHealth(ctx, state);
  const nonland = state.picks.filter(p => typeKey(p.card.type_line) !== 'land');

  // — The Board Wipe: can you rebuild? Card draw refuels the hand; a cheap bottom of the curve
  //   redeploys it. Score = the mean of both, so one axis can carry a weak other partway.
  const draw = health.roleCounts.cardDraw ?? 0;
  const drawTarget = ctx.roleTargets.cardDraw ?? 0;
  const cheap = nonland.filter(p => (p.card.cmc ?? 0) <= 3).length;
  const cheapTarget = curveBand(ctx.curveTargets, cmc => cmc <= 3);
  const rebuild = (ratio(draw, drawTarget) + ratio(cheap, cheapTarget)) / 2;
  const boardwipe: GauntletTrial = {
    id: 'boardwipe', title: 'The Board Wipe', question: 'Can you rebuild?',
    verdict: verdictFor(rebuild),
    statLine: `${draw} card-draw piece${draw === 1 ? '' : 's'} (target ${drawTarget}) · ${cheap} picks at ≤3 mana (${cheapTarget} expected)`,
    flavor: '',
  };

  // — The Archenemy: can you interact? Spot removal + wipes vs their combined targets.
  const removal = health.roleCounts.removal ?? 0;
  const wipes = health.roleCounts.boardwipe ?? 0;
  const interactTarget = (ctx.roleTargets.removal ?? 0) + (ctx.roleTargets.boardwipe ?? 0);
  const interact = ratio(removal + wipes, interactTarget);
  const archenemy: GauntletTrial = {
    id: 'archenemy', title: 'The Archenemy', question: 'Can you interact?',
    verdict: verdictFor(interact),
    statLine: `${removal} removal + ${wipes} wipe${wipes === 1 ? '' : 's'} — ${removal + wipes >= interactTarget ? 'meets' : 'under'} the ${interactTarget}-card target`,
    flavor: '',
  };

  // — The Long Game: can you close? An assembled combo is an automatic strong (the engine IS the
  //   finisher); otherwise the top of the curve carries it.
  const combos = completedCombos(ctx, state);
  const top = nonland.filter(p => (p.card.cmc ?? 0) >= 5).length;
  const topTarget = curveBand(ctx.curveTargets, cmc => cmc >= 5);
  const longgame: GauntletTrial = combos.length > 0
    ? {
        id: 'longgame', title: 'The Long Game', question: 'Can you close?', verdict: 'strong',
        statLine: `${combos.length} combo${combos.length === 1 ? '' : 's'} assembled — ${combos[0].cards.join(' + ')}`,
        flavor: '',
      }
    : {
        id: 'longgame', title: 'The Long Game', question: 'Can you close?', verdict: verdictFor(ratio(top, topTarget)),
        statLine: `${top} top-end threat${top === 1 ? '' : 's'} at 5+ mana (${topTarget} expected)`,
        flavor: '',
      };

  const trials = [boardwipe, archenemy, longgame];
  for (const t of trials) t.flavor = FLAVOR[t.id][t.verdict];
  return trials;
}
