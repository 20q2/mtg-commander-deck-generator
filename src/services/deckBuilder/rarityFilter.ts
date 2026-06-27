import type { Rarity } from '@/types';

/** True if the card's rarity is permitted. null/empty allow-list = unrestricted. */
export function rarityAllowed(rarity: string, allowed: Rarity[] | null): boolean {
  if (allowed === null || allowed.length === 0) return true;
  return (allowed as readonly string[]).includes(rarity);
}

/** Scryfall query fragment (leading space) for the allow-list, or '' when unrestricted. */
export function buildRarityQueryFragment(allowed: Rarity[] | null): string {
  if (!allowed || allowed.length === 0) return '';
  return ` (${allowed.map((r) => `r:${r}`).join(' or ')})`;
}
