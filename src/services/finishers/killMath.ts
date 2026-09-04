/**
 * Stage 3 — shape × fuel × assumptions → a fraction of the table.
 *
 * The unit is the whole point. Raw damage is not comparable across shapes because shapes differ
 * in how many opponents they can reach: Craterhoof into 14 bodies is ~224 damage spread over as
 * many defenders as you have attackers, while Exsanguinate for X=9 is 9 damage at ALL THREE.
 * Ranked by raw damage Craterhoof wins by 25×, which would poison every consumer downstream.
 *
 * Three reach profiles, and keeping them distinct is what the fraction buys you:
 *  - combat (`alpha-strike`) splits across defenders, limited by whole-attacker granularity;
 *  - targeted spells (`burn-x`) hit one player and cap at 1/opponents;
 *  - drains (`drain-x`, `drain-static`) hit everyone at once and scale cleanly.
 *
 * Combat was originally lumped in with targeted spells, which capped every Craterhoof in the
 * format at 0.33 and reported the rest of the swing as "wasted" — 128 discarded damage against
 * three 20-life opponents, a partition the game would simply never make.
 */

import type {
  ScryfallCard, ShapeMatch, DeckFuel, KillEstimate, FinisherTier, DetectedCombo, ConnectMode,
} from '@/types';
import type { FinisherAssumptions } from './tuning';
import { getOracleText } from '@/services/scryfall/client';
import {
  SCALING_MAP, ALT_WIN_CONDITIONS, resolveScaling, unmodelledReason,
  altWinEnabled, altWinShortfall, parseFlatDrain, type ScalingRule,
} from './scalingMap';
import { classifyCombo } from './combos';

/** Creatures plus tokens expected to be on board at the target turn. */
export function bodiesOnBoard(fuel: DeckFuel, a: FinisherAssumptions): number {
  if (fuel.infiniteTokens) return Infinity;
  return Math.round(fuel.creatureCount * a.boardFraction)
    + Math.round(fuel.tokenMakers * a.boardFraction * a.tokensPerMaker);
}

/**
 * Mana available at the target turn.
 *
 * Lands in play is capped by the turn (one land drop per turn) and by how many you have drawn —
 * roughly 7 opening cards plus one per turn, times the deck's land ratio.
 */
export function manaCeiling(fuel: DeckFuel, a: FinisherAssumptions): number {
  if (fuel.infiniteMana) return Infinity;
  const landRatio = fuel.totalCards > 0 ? fuel.landCount / fuel.totalCards : 0;
  const landsInPlay = Math.min(a.turn, (7 + a.turn) * landRatio);
  return landsInPlay + fuel.rampCount * a.boardFraction * a.rampMultiplier;
}

/**
 * An attack → fraction of the table, splitting attackers across defenders.
 *
 * Combat is NOT single-target and modelling it that way was wrong. Attackers are declared per
 * defender, so a board of eleven 13-power tramplers against three 20-life opponents does not kill
 * one player and bin 128 damage — it kills all three and has damage left over. The old model
 * reported exactly that discarded 128 as "wasted", which is arithmetic the game never performs.
 *
 * The real limit is GRANULARITY, not a table cap: a single creature can't split its damage between
 * two players, so you spend `ceil(life / power)` whole bodies per kill and whatever is left over
 * can't finish anyone. That's what separates the overrun effects from each other — with the same
 * eleven bodies, Craterhoof's pump kills the table, End-Raze kills two, Triumph kills one — and
 * it's derived from the board rather than dialled in with a slider.
 */
export function splitStrikeFraction(
  perAttacker: number, bodies: number, connect: ConnectMode, a: FinisherAssumptions,
): { fraction: number; overkill: number; killed: number; damage: number } {
  // Unbounded bodies take the whole table: there is always another attacker to assign.
  if (!isFinite(bodies) || !isFinite(perAttacker)) {
    return { fraction: 1, overkill: 0, killed: a.opponents, damage: Infinity };
  }
  const damage = Math.round(bodies * perAttacker);
  if (bodies <= 0 || perAttacker <= 0 || a.startingLife <= 0) {
    return { fraction: 0, overkill: 0, killed: 0, damage: Math.max(0, damage) };
  }

  const blockers = Math.max(0, a.blockersPerOpponent);
  // What one opponent's blockers absorb. Blocking happens per defender, so this is paid again
  // for every player you want to kill — which is exactly why going wider is not free.
  const soak = blockers * Math.max(0, a.blockerToughness);

  // ceil, because half a creature can't be assigned to a player.
  const attackersPerKill = connect === 'unblockable'
    ? Math.ceil(a.startingLife / perAttacker)
    : connect === 'trample'
      // Blockers eat their toughness; everything above it tramples through.
      ? Math.ceil((a.startingLife + soak) / perAttacker)
      // No evasion: a blocked attacker deals nothing, so bring extras to feed the blockers.
      : Math.ceil(a.startingLife / perAttacker) + blockers;

  const killed = Math.min(a.opponents, Math.floor(bodies / attackersPerKill));

  if (killed === 0) {
    // Not lethal on even one opponent. Report progress toward the first kill so WEAK still
    // separates "one good blocker away" from "nowhere near".
    const throughput = connect === 'unblockable'
      ? damage
      : connect === 'trample'
        ? Math.max(0, damage - soak)
        : Math.max(0, bodies - blockers) * perAttacker;
    return {
      fraction: Math.min(1, throughput / a.startingLife / Math.max(1, a.opponents)),
      overkill: 0, killed: 0, damage,
    };
  }
  return {
    fraction: killed / Math.max(1, a.opponents),
    // Damage left over once the kills are paid for — it bought nothing.
    overkill: Math.max(0, damage - killed * (a.startingLife + (connect === 'unblockable' ? 0 : soak))),
    killed, damage,
  };
}

/**
 * Damage from a single targeted SPELL → fraction of the table.
 *
 * Unlike combat this really does hit one player — a Fireball is one Fireball. `overkillCredit`
 * decides whether excess counts: 0 treats it as wasted (the default, and honest for one spell),
 * 1 assumes you can spend every point, which is what recursion or a second copy buys you.
 */
export function singleTargetFraction(
  damage: number, a: FinisherAssumptions,
): { fraction: number; overkill: number } {
  // Unbounded damage has to short-circuit: at the default overkillCredit of 0 the formula below
  // evaluates (Infinity - 1) * 0, which is NaN, and a single NaN poisons the whole deck verdict.
  // One targeted spell still only hits one player, so the table cap applies as normal.
  if (!isFinite(damage)) {
    return { fraction: 1 / Math.max(1, a.opponents), overkill: Infinity };
  }
  const playersKillable = a.startingLife > 0 ? damage / a.startingLife : 0;
  const credited = playersKillable <= 1
    ? playersKillable
    : 1 + (playersKillable - 1) * a.overkillCredit;
  return {
    fraction: Math.min(1, credited / Math.max(1, a.opponents)),
    overkill: Math.max(0, damage - a.startingLife),
  };
}

/** Damage at EVERY opponent → fraction of the table. No overkill concept; it scales cleanly. */
export function allOpponentsFraction(damage: number, a: FinisherAssumptions): number {
  return a.startingLife > 0 ? Math.min(1, damage / a.startingLife) : 0;
}

/** Render a possibly-unbounded quantity for the workings column. */
function num(n: number, digits = 0): string {
  return isFinite(n) ? n.toFixed(digits) : '∞';
}

/** A printed one-shot drain, when the curated map has no entry for the card. */
function fallbackDrainRule(card: ScryfallCard): ScalingRule | null {
  const flat = parseFlatDrain(getOracleText(card));
  return flat === null ? null : { variable: 'flat', amount: flat };
}

function tierFor(fraction: number | null, a: FinisherAssumptions): FinisherTier {
  if (fraction === null) return 'UNKNOWN';
  if (fraction >= a.liveThreshold) return 'LIVE';
  if (fraction >= a.weakThreshold) return 'WEAK';
  return 'DEAD';
}

export function estimateKill(
  card: ScryfallCard,
  match: ShapeMatch,
  fuel: DeckFuel,
  a: FinisherAssumptions,
): KillEstimate {
  const base = { cardName: card.name, shape: match.shape };

  switch (match.shape) {
    case 'alpha-strike': {
      const bodies = bodiesOnBoard(fuel, a);
      // A +X/+X off something we can't measure gets no number. Guessing produced a 1091-damage
      // Blossoming Bogbeast, which is worse than admitting we don't know.
      if (match.pump?.kind === 'unknown-scaling') {
        return {
          ...base, kind: 'unknown', damage: null, tableFraction: null, overkill: 0,
          workings: `+X/+X where X is ${match.pump.basis} — not modelled`, tier: 'UNKNOWN',
        };
      }
      const pump = match.pump?.kind === 'scales-with-bodies'
        ? bodies
        : match.pump?.amount ?? 0;
      const connect = match.connect ?? 'none';
      // Split across defenders and paid through blockers — see splitStrikeFraction.
      const { fraction, overkill, killed, damage } = splitStrikeFraction(
        fuel.avgPower + pump, bodies, connect, a,
      );
      return {
        ...base, kind: 'number',
        damage,
        tableFraction: fraction, overkill,
        workings: `${num(bodies)} bodies × ${num(fuel.avgPower + pump, 1)} power, ${connect}`
          + ` vs ${a.blockersPerOpponent}×${a.blockerToughness} blockers each`
          + ` → kills ${killed} of ${a.opponents}`,
        tier: tierFor(fraction, a),
      };
    }

    case 'drain-x':
    case 'burn-x': {
      const mana = manaCeiling(fuel, a);
      const xCount = Math.max(1, match.xCount ?? 1);
      const x = isFinite(mana)
        ? Math.max(0, Math.floor((mana - (match.fixedCost ?? 0)) / xCount))
        : Infinity;
      const workings = `ceiling ${num(mana, 1)} mana → X=${num(x)}`;
      if (match.shape === 'drain-x') {
        const fraction = allOpponentsFraction(x, a);
        return {
          ...base, kind: 'number', damage: x, tableFraction: fraction, overkill: 0,
          workings: `${workings}, each opponent`, tier: tierFor(fraction, a),
        };
      }
      const { fraction, overkill } = singleTargetFraction(x, a);
      return {
        ...base, kind: 'number', damage: x, tableFraction: fraction, overkill,
        workings: `${workings}, one target`, tier: tierFor(fraction, a),
      };
    }

    case 'drain-static': {
      const rule = SCALING_MAP[card.name] ?? fallbackDrainRule(card);
      if (!rule) {
        return {
          ...base, kind: 'unknown', damage: null, tableFraction: null, overkill: 0,
          workings: 'scaling variable not in the curated map', tier: 'UNKNOWN',
        };
      }
      const value = resolveScaling(rule, fuel, a);
      if (value === null) {
        return {
          ...base, kind: 'unknown', damage: null, tableFraction: null, overkill: 0,
          workings: unmodelledReason(rule.variable), tier: 'UNKNOWN',
        };
      }
      const fraction = allOpponentsFraction(value, a);
      return {
        ...base, kind: 'number', damage: value, tableFraction: fraction, overkill: 0,
        workings: `${rule.variable} = ${num(value)}, each opponent`, tier: tierFor(fraction, a),
      };
    }

    case 'alt-win': {
      const rule = ALT_WIN_CONDITIONS[card.name];
      if (!rule) {
        return {
          ...base, kind: 'binary', damage: null, tableFraction: null, overkill: 0,
          workings: 'condition not in the curated map — not scored', tier: 'UNKNOWN',
        };
      }
      // Scoring these 1.00 on sight was the model's biggest overclaim: a lone Thassa's Oracle in a
      // pile of Islands read "REDUNDANT KILLS". Credit the win only where the deck shows the
      // setup, and stay UNKNOWN — not zero — where a decklist genuinely can't say.
      const enabled = altWinEnabled(rule, fuel);
      if (enabled === true) {
        return {
          ...base, kind: 'binary', damage: null, tableFraction: 1, overkill: 0,
          workings: `needs ${rule.condition} — this deck supports it`, tier: 'LIVE',
        };
      }
      return {
        ...base, kind: 'binary', damage: null, tableFraction: null, overkill: 0,
        workings: enabled === false
          ? `needs ${rule.condition} — ${altWinShortfall(rule.needs)}`
          : `needs ${rule.condition} — can't be checked from a decklist`,
        tier: 'UNKNOWN',
      };
    }

    // Scored in a second pass, once the best attack it could double is known — see
    // extraCombatEstimates. On its own an extra combat step has no damage of its own.
    case 'extra-combat': {
      return {
        ...base, kind: 'modifier', damage: null, tableFraction: null, overkill: 0,
        workings: 'doubles the best attack — scored against it below',
        tier: 'UNKNOWN',
      };
    }

    // Combos aren't cards, so they never arrive through classifyShapes — see comboEstimates.
    case 'combo':
      return {
        ...base, kind: 'binary', damage: null, tableFraction: 1, overkill: 0,
        workings: 'complete combo', tier: 'LIVE',
      };
  }
}

/**
 * What an extra combat step is actually worth.
 *
 * This branch returned a bare "multiplies the best alpha-strike" and scored nothing, so Aggravated
 * Assault next to a lethal board contributed exactly zero to the verdict. A second combat lets the
 * same creatures attack again — and, crucially, attack a DIFFERENT player, so it's modelled as
 * doubling the number of attacker-assignments at unchanged per-attacker power. That's precisely
 * the quantity `splitStrikeFraction` consumes, granularity and blockers included.
 *
 * With no overrun card in the deck the baseline is a plain unpumped swing, which is still a real
 * attack — an extra combat doesn't need Craterhoof to be worth something.
 */
export function extraCombatEstimates(
  cards: { name: string; connect: ConnectMode }[],
  existing: KillEstimate[],
  fuel: DeckFuel,
  a: FinisherAssumptions,
): KillEstimate[] {
  if (cards.length === 0) return [];
  const bodies = bodiesOnBoard(fuel, a);
  if (bodies <= 0) return [];

  // The strongest attack already on the table, or a plain swing if there's no pump effect.
  const best = existing
    .filter(e => e.shape === 'alpha-strike' && e.kind === 'number' && isFinite(e.damage ?? 0))
    .reduce<KillEstimate | null>((m, e) => (!m || (e.damage ?? 0) > (m.damage ?? 0) ? e : m), null);
  const perAttacker = best && isFinite(bodies) && bodies > 0
    ? (best.damage ?? 0) / bodies
    : fuel.avgPower;
  if (perAttacker <= 0) return [];

  return cards.map(({ name, connect }) => {
    const solo = splitStrikeFraction(perAttacker, bodies, connect, a);
    const doubled = splitStrikeFraction(perAttacker, bodies * 2, connect, a);
    return {
      cardName: name,
      shape: 'extra-combat' as const,
      kind: 'number' as const,
      damage: doubled.damage,
      tableFraction: doubled.fraction,
      overkill: doubled.overkill,
      workings: `two combats with ${num(bodies)} bodies × ${num(perAttacker, 1)} power`
        + ` → kills ${doubled.killed} of ${a.opponents} (${solo.killed} in one combat)`,
      tier: tierFor(doubled.fraction, a),
    };
  });
}

/**
 * Kills that come from unbounded fuel with no card to spend it on.
 *
 * An infinite token loop IS the kill — you attack with the tokens. The alpha-strike shapes only
 * ever amplified that, so a deck holding the loop but no Craterhoof scored nothing at all and read
 * "no way to actually close a game" while sitting on a lethal board. That was the mirror image of
 * the alt-win overclaim: a confident wrong answer in the other direction.
 *
 * Only tokens get this treatment. Infinite mana and infinite death triggers genuinely do NOT win
 * on their own — they need an X spell or an aristocrats drain, and if the deck has one it already
 * scored through the normal path.
 */
export function unboundedFuelEstimates(
  fuel: DeckFuel,
  existing: KillEstimate[],
  combos: DetectedCombo[],
  a: FinisherAssumptions,
): KillEstimate[] {
  if (!fuel.infiniteTokens) return [];
  // Something already says "you win" — an alpha-strike carrying the tokens, or a combo that wins
  // outright. Adding a second row for the same kill would double-count it.
  if (existing.some(e => e.shape === 'alpha-strike' || e.shape === 'combo')) return [];

  const source = combos.find(c => c.isComplete && classifyCombo(c.results).infiniteTokens);
  return [{
    cardName: source ? source.cards.join(' + ') : 'Infinite token loop',
    shape: 'alpha-strike',
    kind: 'number',
    damage: Infinity,
    tableFraction: 1,
    overkill: 0,
    workings: 'unbounded bodies from a complete combo — no pump needed, just attack',
    tier: tierFor(1, a),
  }];
}

/**
 * Kill estimates for the complete combos in the deck.
 *
 * Only combos that win on their OWN get a row. The rest already showed up as unbounded fuel on
 * the cards they enable, and listing them here as well would double-count the same kill.
 */
export function comboEstimates(
  combos: DetectedCombo[], a: FinisherAssumptions,
): KillEstimate[] {
  const out: KillEstimate[] = [];
  for (const combo of combos) {
    if (!combo.isComplete) continue;
    const cls = classifyCombo(combo.results);
    if (!cls.wins) continue;
    // A result naming one opponent takes out a player, not the table — same cap as any
    // single-target shape.
    const fraction = cls.winScope === 'single' ? 1 / Math.max(1, a.opponents) : 1;
    out.push({
      cardName: combo.cards.join(' + '),
      shape: 'combo',
      kind: 'binary',
      damage: null,
      tableFraction: fraction,
      overkill: 0,
      workings: `${combo.results.join(', ')} · ${combo.deckCount.toLocaleString()} decks`,
      tier: tierFor(fraction, a),
    });
  }
  return out;
}
