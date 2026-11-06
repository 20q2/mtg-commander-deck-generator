import { useEffect, useState } from 'react';
import { getCachedCard, getCardByName } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';

const artCropCache = new Map<string, string | null>();

const artOf = (card: ScryfallCard) =>
  card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop ?? null;

/** Already known without a fetch: resolved before, or the card is in the in-memory card cache. */
function knownArt(name: string): string | null | undefined {
  const hit = artCropCache.get(name);
  if (hit !== undefined) return hit;
  const card = getCachedCard(name);
  if (!card) return undefined;
  const art = artOf(card);
  artCropCache.set(name, art);
  return art;
}

/**
 * Lazy-fetch the Scryfall `art_crop` URL for any card name (front-face for DFCs).
 * Returns `null` while loading or if the card can't be fetched.
 */
export function useCommanderArt(name: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (name ? knownArt(name) ?? null : null));

  useEffect(() => {
    if (!name) {
      setUrl(null);
      return;
    }
    const known = knownArt(name);
    if (known !== undefined) {
      setUrl(known);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const art = artOf(await getCardByName(name));
        artCropCache.set(name, art);
        if (!cancelled) setUrl(art);
      } catch {
        artCropCache.set(name, null);
        if (!cancelled) setUrl(null);
      }
    })();

    return () => { cancelled = true; };
  }, [name]);

  return url;
}
