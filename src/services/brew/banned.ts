import type { Customization } from '@/types';

/**
 * The player's exclude list as a lookup set, including DFC front faces. The deck generator bans both
 * the full "A // B" name and the "A" front face (deckGenerator markBanned), so brew matches that — a
 * card banned by its full name is still excluded when the pool lists it by front face and vice-versa.
 * Empty set when nothing is banned. Consumed by the candidate pool build and both discovery paths so
 * a banned card never enters an offer, a windfall, or a discovery find.
 */
export function bannedNameSet(customization: Pick<Customization, 'bannedCards'>): Set<string> {
  const out = new Set<string>();
  for (const n of customization.bannedCards ?? []) {
    out.add(n);
    if (n.includes(' // ')) out.add(n.split(' // ')[0]);
  }
  return out;
}
