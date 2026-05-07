import { useRef, useState, type ImgHTMLAttributes } from 'react';
import { getCardImageUrl } from '@/services/scryfall/client';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import type { ScryfallCard } from '@/types';

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  card: ScryfallCard;
  size?: 'small' | 'normal' | 'large';
  faceDown?: boolean;
}

/**
 * Drop-in replacement for `<img>` that shows a magnified card preview while
 * the magnify key is held and the cursor is over the image. Used inside
 * playtest dialogs (search, tokens, mulligan, scry/mill/surveil) so the same
 * hover-magnify gesture works there as on hand / battlefield cards.
 */
export function HoverPreviewImage({ card, size = 'small', faceDown, className, ...rest }: Props) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const magnify = useMagnifyKey();
  return (
    <>
      <img
        ref={ref}
        src={faceDown ? `${import.meta.env.BASE_URL}card-back.png` : getCardImageUrl(card, size)}
        alt={card.name}
        draggable={false}
        className={className}
        {...rest}
        onMouseEnter={(e) => { setHovered(true); rest.onMouseEnter?.(e); }}
        onMouseLeave={(e) => { setHovered(false); rest.onMouseLeave?.(e); }}
      />
      {magnify && hovered && <MagnifiedPreview card={card} anchorRef={ref} faceDown={faceDown} />}
    </>
  );
}
