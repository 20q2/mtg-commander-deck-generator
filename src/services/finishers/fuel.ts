/**
 * Stage 2 — what the deck brings to the table.
 *
 * All of this is computed from card data we already hold, which is what makes the lab a live
 * instrument: none of it needs a deploy to change. Two notes:
 *
 *  - Scryfall has NO token oracle tag. Verified: token, token-maker, creature-token, makes-tokens
 *    and mass-token all return nothing. Since token count is the entire question for alpha-strike,
 *    oracle-text derivation is mandatory rather than a shortcut.
 *  - Devotion is computed exactly from mana costs, which beats anything a tag could give us.
 */

import { getOracleText, isAnyLand, getFrontFaceTypeLine } from '@/services/scryfall/client';
import type { ScryfallCard, DeckFuel } from '@/types';
import type { TagMembership } from './labTags';

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

/**
 * Cards that MAKE creature tokens — the fuel for alpha-strike.
 *
 * Two traps here, both found by running real precons rather than a hand-built list. The naive
 * `/creates? .*token/i` reported 31 token makers in an 85-card Bloomburrow deck:
 *
 *  - `.*` spans the entire oracle text, so any card mentioning "create" and "token" anywhere
 *    matched — including payoffs whose text is "whenever you create a token".
 *  - Treasure, Clue, Food, Blood and Map tokens are not attackers. Requiring the literal
 *    "creature token" is what keeps Academy Manufactor and Deadly Dispute out of the body count.
 *
 * The bounded gap handles the first, the "creature token" literal the second. `created` is
 * included because doublers phrase it passively — Chatterfang is "those tokens are created plus
 * that many ... creature tokens", and a doubler genuinely does add bodies.
 *
 * Residual known false positive: a payoff reading "whenever you create a creature token".
 */
const TOKEN_MAKER = /creat(?:e|es|ed) [^.]{0,80}?creature tokens?/i;

/** Permanent types that contribute to devotion. */
function isPermanent(typeLine: string): boolean {
  return /Creature|Artifact|Enchantment|Planeswalker|Battle/i.test(typeLine);
}

export function measureFuel(cards: ScryfallCard[], tags: TagMembership): DeckFuel {
  const devotion: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let landCount = 0, creatureCount = 0, tokenMakers = 0, swampCount = 0;
  let rampCount = 0, hasteGranters = 0, trampleGranters = 0, anthems = 0, evasionGranters = 0;
  let powerSum = 0, powerCount = 0;

  for (const card of cards) {
    const typeLine = getFrontFaceTypeLine(card);
    const text = getOracleText(card);
    const name = card.name;

    if (isAnyLand(card)) {
      landCount++;
      if (/Swamp/i.test(typeLine)) swampCount++;
      continue;
    }

    if (/Creature/i.test(typeLine)) {
      creatureCount++;
      const p = parseInt(card.power ?? '', 10);
      if (!isNaN(p)) { powerSum += p; powerCount++; }
    }

    // No Scryfall tag for this — oracle text is the only source.
    if (TOKEN_MAKER.test(text)) tokenMakers++;

    if (isPermanent(typeLine)) {
      for (const m of (card.mana_cost ?? '').matchAll(/\{([^}]+)\}/g)) {
        const sym = m[1].toUpperCase();
        for (const c of COLORS) if (sym.includes(c)) devotion[c]++;
      }
    }

    if (tags.has('ramp', name) || tags.has('mana-dork', name) || tags.has('mana-rock', name)) rampCount++;
    if (tags.has('gives-haste', name)) hasteGranters++;
    if (tags.has('gives-trample', name)) trampleGranters++;
    if (tags.has('anthem', name)) anthems++;
    if (tags.has('unblockable', name)) evasionGranters++;
  }

  return {
    totalCards: cards.length,
    nonLandCount: cards.length - landCount,
    landCount,
    creatureCount,
    avgPower: powerCount > 0 ? powerSum / powerCount : 0,
    tokenMakers,
    devotion,
    swampCount,
    rampCount,
    hasteGranters,
    trampleGranters,
    anthems,
    evasionGranters,
  };
}
