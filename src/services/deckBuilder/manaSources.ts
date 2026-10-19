// src/services/deckBuilder/manaSources.ts
// Single source of truth for "what mana can this card actually make?". Shared by the
// analyzer's color-source counts and the deck view's Mana Production panel so the two
// readings can't drift apart.
import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { omnipresenceColor } from './cutRanking';

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

// Determine which colors a land produces from produced_mana + oracle text fallback
export function getLandProducedColors(card: ScryfallCard): string[] {
  const colors: Set<string> = new Set();
  const producedMana = card.produced_mana || [];
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();

  // Urborg / Yavimaya make themselves a Swamp / Forest too, so they genuinely tap
  // for their granted color even though Scryfall records no mana ability. Counted
  // as one source here — the far larger "every land becomes a source" upside is
  // conditional on drawing them, so it drives the recommendation boost instead of
  // inflating this count. Seeded before the fallback so it isn't read as colorless.
  const granted = omnipresenceColor(card.name);
  if (granted) colors.add(granted);

  for (const mana of producedMana) {
    if (WUBRG.includes(mana)) colors.add(mana);
  }

  // Fallback: check basic land types and oracle text
  if (colors.size === 0) {
    if (typeLine.includes('plains') || oracleText.includes('add {w}')) colors.add('W');
    if (typeLine.includes('island') || oracleText.includes('add {u}')) colors.add('U');
    if (typeLine.includes('swamp') || oracleText.includes('add {b}')) colors.add('B');
    if (typeLine.includes('mountain') || oracleText.includes('add {r}')) colors.add('R');
    if (typeLine.includes('forest') || oracleText.includes('add {g}')) colors.add('G');
    // "any color" / "any type" patterns
    if (oracleText.includes('any color') || oracleText.includes('any type')) {
      for (const c of WUBRG) colors.add(c);
    }
  }

  return [...colors];
}

/** Every mana symbol a card is a source of — WUBRG plus colorless 'C'.
 *
 *  Lands go through the oracle-text fallback above; non-land permanents (mana dorks,
 *  rocks, altars) count straight off `produced_mana`, since a Birds of Paradise is as
 *  much a black source as a Swamp. One-shot spells are not sources: a Dark Ritual
 *  makes mana once from a card you cast, not a standing supply, and counting rituals
 *  would make the per-color shares read as more fixing than the deck has. */
export function getProducedManaSymbols(card: ScryfallCard): string[] {
  const typeLine = (getFrontFaceTypeLine(card) || card.type_line || '').toLowerCase();
  const producedMana = card.produced_mana || [];

  if (typeLine.includes('land')) {
    const symbols = new Set(getLandProducedColors(card));
    const oracleText = (card.oracle_text || '').toLowerCase();
    if (producedMana.includes('C') || (producedMana.length === 0 && oracleText.includes('add {c}'))) {
      symbols.add('C');
    }
    return [...symbols];
  }

  if (typeLine.includes('instant') || typeLine.includes('sorcery')) return [];

  return [...new Set(producedMana.filter(m => WUBRG.includes(m) || m === 'C'))];
}
