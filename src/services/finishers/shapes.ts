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
import type { ScryfallCard, ShapeMatch, FinisherPump } from '@/types';
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
  let xCount = 0;
  let fixedCost = 0;
  for (const m of (manaCost ?? '').matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1].toUpperCase();
    if (sym === 'X') { xCount++; continue; }
    const n = parseInt(sym, 10);
    if (!isNaN(n)) { fixedCost += n; continue; }
    fixedCost += 1; // colored, hybrid, phyrexian — all mana value 1
  }
  return { xCount, fixedCost };
}

/** How an overrun-style card pumps. `+X/+X` scales with the board; `+3/+3` is flat. */
export function parsePump(oracleText: string): FinisherPump {
  if (/\+X\/\+X/i.test(oracleText)) return { kind: 'scales-with-bodies' };
  const flat = oracleText.match(/\+(\d+)\/\+\d+/);
  if (flat) return { kind: 'flat', amount: parseInt(flat[1], 10) };
  return { kind: 'flat', amount: 0 };
}

/** Whether the card makes its team connect — trample or unblockability. */
export function grantsConnect(oracleText: string): boolean {
  return /trample/i.test(oracleText) || /can't be blocked/i.test(oracleText);
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
        ? 'otag:overrun, +X/+X'
        : `otag:overrun, +${pump.amount}/+${pump.amount}`,
      pump,
      grantsConnect: grantsConnect(text),
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
