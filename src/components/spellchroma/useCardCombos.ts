import { useEffect, useState } from 'react';
import type { ScryfallCard, DetectedCombo } from '@/types';
import { fetchColorIdentityCombos } from '@/services/edhrec/client';
import { buildCardComboMap } from '@/services/spellchroma/combos';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Resolves the combos to show for a previewed card in SpellChroma.
 *
 * The page already builds a combo map from the active color filter / loaded
 * deck (`baseMap`) — that's the best source, since it's keyed on the colors the
 * user is actually building in. But in the tag-only exploration flow there's no
 * deck and no colors set, so `baseMap` is empty. In that case we lazily fetch
 * the *previewed card's own* color-identity combo page so combos still surface.
 *
 * Front-name keyed to match `buildCardComboMap` (DFCs collapse to their front).
 */
export function useCardCombos(
  card: ScryfallCard | null,
  deckNames: Set<string> = EMPTY as Set<string>,
  baseMap?: Map<string, DetectedCombo[]>,
): DetectedCombo[] | undefined {
  const frontName = card
    ? (card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name)
    : null;
  const fromBase = frontName ? baseMap?.get(frontName) : undefined;

  const [fetched, setFetched] = useState<DetectedCombo[] | undefined>(undefined);
  const colorKey = (card?.color_identity ?? []).join('');

  useEffect(() => {
    let cancelled = false;
    setFetched(undefined);
    // Base map already covers this card — no extra fetch needed.
    if (!card || fromBase) return;
    void fetchColorIdentityCombos(card.color_identity ?? [])
      .then(combos => {
        if (cancelled) return;
        const map = buildCardComboMap(combos, deckNames);
        setFetched(frontName ? map.get(frontName) ?? [] : []);
      })
      .catch(err => {
        if (!cancelled) setFetched(undefined);
        console.warn('[SpellChroma] combo fetch failed for', frontName, err);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontName, colorKey, !!fromBase]);

  return fromBase ?? fetched;
}
