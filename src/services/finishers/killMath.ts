/**
 * Stage 3 — shape × fuel × assumptions → a fraction of the table.
 *
 * The unit is the whole point. Raw damage is not comparable across shapes because shapes differ
 * in how many opponents they hit: Craterhoof into 14 bodies is ~224 damage at ONE player, while
 * Exsanguinate for X=9 is 9 damage at ALL THREE. Ranked by raw damage Craterhoof wins by 25×,
 * which would poison every consumer downstream.
 *
 * Expressed as table fraction, the structural fact appears: single-target shapes are hard-capped
 * at 1/opponents. Craterhoof can never beat 0.33 no matter how wide the board gets — its 185th
 * point of damage is worth exactly nothing. Exsanguinate has no such ceiling.
 */

import type {
  ScryfallCard, ShapeMatch, DeckFuel, KillEstimate, FinisherTier, DetectedCombo,
} from '@/types';
import type { FinisherAssumptions } from './tuning';
import { SCALING_MAP, ALT_WIN_CONDITIONS, resolveScaling, unmodelledReason } from './scalingMap';
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
 * Damage at ONE opponent → fraction of the table.
 *
 * Beyond one player's worth, `overkillCredit` decides whether the excess counts. At 0 it is pure
 * waste (the default, and the honest read for a single unblocked alpha strike). At 1 every point
 * is assumed spendable across the table, which is what extra combats actually buy you.
 */
export function singleTargetFraction(
  damage: number, a: FinisherAssumptions,
): { fraction: number; overkill: number } {
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
      const connect = match.grantsConnect ? 1 : a.unblockedFraction;
      const damage = bodies * (fuel.avgPower + pump) * connect;
      // Unbounded bodies take the whole table, not one player: attackers are declared per
      // defender, so an infinite board is split across every opponent rather than overkilling one.
      const { fraction, overkill } = isFinite(damage)
        ? singleTargetFraction(Math.round(damage), a)
        : { fraction: 1, overkill: 0 };
      return {
        ...base, kind: 'number',
        damage: isFinite(damage) ? Math.round(damage) : Infinity,
        tableFraction: fraction, overkill,
        workings: `${num(bodies)} bodies × (${fuel.avgPower.toFixed(1)} + ${num(pump)})`
          + (match.grantsConnect ? ', trample' : ` × ${connect} connect`),
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
      const rule = SCALING_MAP[card.name];
      if (!rule) {
        return {
          ...base, kind: 'unknown', damage: null, tableFraction: null, overkill: 0,
          workings: 'scaling variable not in the curated map', tier: 'UNKNOWN',
        };
      }
      const value = resolveScaling(rule, fuel);
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
      const condition = ALT_WIN_CONDITIONS[card.name] ?? 'condition not in the curated map';
      return {
        ...base, kind: 'binary', damage: null, tableFraction: 1, overkill: 0,
        workings: `binary — needs ${condition}`, tier: 'LIVE',
      };
    }

    case 'extra-combat': {
      return {
        ...base, kind: 'modifier', damage: null, tableFraction: null, overkill: 0,
        workings: 'multiplies the best alpha-strike; buys back its overkill',
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
