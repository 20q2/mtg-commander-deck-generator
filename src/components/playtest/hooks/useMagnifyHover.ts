import { useEffect, useState } from 'react';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';

/**
 * How long the cursor has to sit on a card before its preview opens.
 *
 * Only on the hover setting. Hover is not a deliberate gesture — you cross a
 * dozen cards on the way to the one you want — and with no dwell every one of
 * them threw a full-size card over the board on the way past. Long enough that
 * crossing a row is quiet, short enough that stopping on a card feels like the
 * preview was already there.
 */
const DWELL_MS = 250;

/**
 * Whether the card under the cursor should be showing its magnified preview.
 *
 * Every preview site used to ask the raw key hook and hard-code "Ctrl plus
 * hover", which left no room for the setting — and the opponent-side sites
 * that did honour one each spelled the same three-way choice out by hand.
 * This owns that decision instead: callers supply the hover, this answers
 * whether the preview is open.
 *
 *     const magnified = useMagnifyHover(hovered);
 *     const showPreview = magnified && !isDragging;
 *
 * `hovered` is required rather than defaulted so a site that forgets it is a
 * compile error rather than a preview that silently never opens.
 */
export function useMagnifyHover(hovered: boolean, scope: 'own' | 'opponent' = 'own'): boolean {
  const ctrlHeld = useMagnifyKey();
  /*
   * One choice for the table unless you deliberately split it: the bots' side
   * is normally `follow`, which is this same setting read through their scope.
   */
  const mode = usePlaytestSettings(s => {
    if (scope !== 'opponent') return s.cardPreview;
    return s.opponentPreview === 'follow' ? s.cardPreview : s.opponentPreview;
  });
  const [dwelled, setDwelled] = useState(false);

  /**
   * The timer is per card — every preview site runs its own copy of this hook —
   * so sweeping across a row restarts nothing: each card's clock starts when
   * the cursor arrives and is thrown away when it leaves.
   *
   * Leaving is instant on purpose. A delay on the way out would leave the
   * preview hanging over the card you moved to.
   */
  useEffect(() => {
    if (!hovered || mode !== 'hover') { setDwelled(false); return; }
    const t = setTimeout(() => setDwelled(true), DWELL_MS);
    return () => clearTimeout(t);
  }, [hovered, mode]);

  if (mode === 'off') return false;
  // Ctrl is a deliberate ask, so it opens on the frame you press it.
  if (mode === 'ctrl') return ctrlHeld && hovered;
  return hovered && dwelled;
}
