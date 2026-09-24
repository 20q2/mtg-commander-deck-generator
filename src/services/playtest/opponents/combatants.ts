import { keywordsOf, type Combatant } from '@/services/playtest/combat';
import { botKeywords, botPower, botToughness } from '@/services/playtest/opponents/stats';
import { resolvePT } from '@/services/playtest/powerToughness';
import type { OpponentPermanent } from '@/components/playtest/opponentTypes';
import type { BattlefieldCard } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

/**
 * Flattening a permanent into the pure combat model, for both sides.
 *
 * These lived in three places — the store, the incoming preview, and nothing
 * at all for the outgoing preview, which is why the outgoing button had no
 * number on it. A preview computed one way and a resolution computed another
 * is the exact failure `incomingCombat` was written to stop, so there is one
 * copy of each now.
 */

/** One of the player's battlefield cards. Reads live P/T, so counters and stickers count. */
export function playerCombatant(b: BattlefieldCard): Combatant {
  const [p, t] = (resolvePT(b)?.modified ?? '0/0').split('/');
  const power = parseInt(p, 10);
  const toughness = parseInt(t, 10);
  return {
    instanceId: b.instanceId,
    name: b.card.name,
    power: Number.isNaN(power) ? 0 : power,
    toughness: Number.isNaN(toughness) ? 0 : toughness,
    keywords: keywordsOf(b.card, b.edit),
  };
}

/**
 * The same, for a bot's permanent. `battlefield` is the whole board it is on,
 * because its stats depend on it: counters on the card, anthems from the rest.
 */
export function botCombatant(
  p: OpponentPermanent,
  battlefield: OpponentPermanent[],
  graveyard: ScryfallCard[] = [],
): Combatant {
  return {
    instanceId: p.instanceId,
    name: p.card.name,
    power: botPower(p, battlefield, graveyard),
    toughness: botToughness(p, battlefield, graveyard),
    // Not `keywordsOf`: a bot's creature can be granted keywords by its own
    // board or graveyard, and blocking legality has to see them.
    keywords: botKeywords(p, battlefield, graveyard),
  };
}
