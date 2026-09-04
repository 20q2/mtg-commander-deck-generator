/**
 * Stage 1 — which finisher shapes a card carries.
 *
 * The oracle tag supplies the CANDIDATE; mana-cost and oracle-text parsing decide the rest. Two
 * places where that refinement is load-bearing:
 *
 *  - `otag:burn` is 3023 cards. Shock and Fireball are the same tag, so without an X filter the
 *    shape means nothing. Requiring {X} reduces it to spells that actually scale into a kill.
 *  - `otag:lifedrain` splits into drain-x and drain-static on the same test.
 */

import { getOracleText } from '@/services/scryfall/client';
import type { ScryfallCard, ShapeMatch, FinisherPump, ConnectMode } from '@/types';
import type { TagMembership } from './labTags';

/**
 * Split a mana cost into {X} count and fixed mana value.
 *
 * `{X}{B}{B}` → { xCount: 1, fixedCost: 2 }
 * `{5}{G}{G}{G}` → { xCount: 0, fixedCost: 8 }
 *
 * X multiplicity is parsed rather than assumed to be 1: `{X}{X}` cards halve the payoff for the
 * same mana, and hardcoding a single X would overrate them by 2×.
 */
export function parseXCost(manaCost: string | undefined): { xCount: number; fixedCost: number } {
  // Split and modal-DFC cards print BOTH faces: "{2}{B} // {X}{B}{B}". Summing the whole string
  // charges the finisher for the other half — Stensian Sanguinist // Exsanguinate read as fixed 4
  // instead of 2. Take the face that actually carries the X, since that's where the shape lives.
  const faces = (manaCost ?? '').split('//');
  const face = faces.find(f => /\{X\}/i.test(f)) ?? faces[0] ?? '';

  let xCount = 0;
  let fixedCost = 0;
  for (const m of face.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1].toUpperCase();
    if (sym === 'X') { xCount++; continue; }
    const n = parseInt(sym, 10);
    if (!isNaN(n)) { fixedCost += n; continue; }
    fixedCost += 1; // colored, hybrid, phyrexian — all mana value 1
  }
  return { xCount, fixedCost };
}

/**
 * How an overrun-style card pumps.
 *
 * `+X/+X` does NOT reliably mean "X = your creature count". Craterhoof spells that out; Blossoming
 * Bogbeast is "+X/+X where X is the amount of life you gained this turn", and assuming Craterhoof
 * semantics scored it at 32 bodies × (2.1 + 32) = 1091 damage on a real precon.
 *
 * So the `where X is` clause is read, and anything that isn't creature count is reported as
 * unknown scaling rather than given a fabricated number — the same rule the drain-static map follows.
 */
export function parsePump(oracleText: string): FinisherPump {
  if (/\+X\/\+X/i.test(oracleText)) {
    if (/where X is the number of creatures you control/i.test(oracleText)) {
      return { kind: 'scales-with-bodies' };
    }
    const clause = oracleText.match(/where X is ([^.]{0,60})/i);
    return { kind: 'unknown-scaling', basis: clause ? clause[1].trim() : 'unstated X' };
  }
  const flat = oracleText.match(/\+(\d+)\/\+\d+/);
  if (flat) return { kind: 'flat', amount: parseInt(flat[1], 10) };
  return { kind: 'flat', amount: 0 };
}

/**
 * How the card gets its team through blockers.
 *
 * Unblockable outranks trample because it's strictly better: a trampling attacker still loses its
 * blocker's toughness, an unblockable one loses nothing. These were one boolean until blockers
 * were modelled, at which point the difference stopped being cosmetic.
 */
export function connectMode(oracleText: string): ConnectMode {
  if (/can't be blocked/i.test(oracleText)) return 'unblockable';
  if (/trample/i.test(oracleText)) return 'trample';
  return 'none';
}

/**
 * Every shape a card carries. Zero matches is the common case and is not an error.
 *
 * `tags` keys are vocabulary keys (`overrun`, `lifedrain`, …), not raw otag queries.
 */
export function classifyShapes(card: ScryfallCard, tags: TagMembership): ShapeMatch[] {
  const out: ShapeMatch[] = [];
  const name = card.name;
  const text = getOracleText(card);
  const { xCount, fixedCost } = parseXCost(card.mana_cost);

  if (tags.has('overrun', name)) {
    const pump = parsePump(text);
    out.push({
      shape: 'alpha-strike',
      basis: pump.kind === 'scales-with-bodies'
        ? 'otag:overrun, +X/+X per creature'
        : pump.kind === 'unknown-scaling'
          ? `otag:overrun, +X/+X where X is ${pump.basis}`
          : `otag:overrun, +${pump.amount}/+${pump.amount}`,
      pump,
      connect: connectMode(text),
    });
  }

  if (tags.has('lifedrain', name)) {
    if (xCount > 0) {
      out.push({
        shape: 'drain-x',
        basis: `otag:lifedrain, ${xCount}×{X} + ${fixedCost}`,
        xCount, fixedCost,
      });
    } else {
      out.push({ shape: 'drain-static', basis: 'otag:lifedrain, no X' });
    }
  }

  // The X filter is what rescues burn from 3023 cards.
  if (tags.has('burn', name) && xCount > 0) {
    out.push({
      shape: 'burn-x',
      basis: `otag:burn, ${xCount}×{X} + ${fixedCost}`,
      xCount, fixedCost,
    });
  }

  if (tags.has('win-condition', name)) {
    out.push({ shape: 'alt-win', basis: 'otag:win-condition' });
  }

  if (tags.has('extra-combat', name)) {
    out.push({ shape: 'extra-combat', basis: 'otag:extra-combat' });
  }

  return out;
}
