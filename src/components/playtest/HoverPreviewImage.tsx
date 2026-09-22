import { useRef, useState, type ImgHTMLAttributes } from 'react';
import { getCardImageUrl } from '@/services/scryfall/client';
import { useMagnifyHover } from '@/components/playtest/hooks/useMagnifyHover';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import type { ScryfallCard } from '@/types';

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  card: ScryfallCard;
  size?: 'small' | 'normal' | 'large';
  faceDown?: boolean;
}

/**
 * Drop-in replacement for `<img>` that shows a magnified card preview when the
 * cursor is over the image and the magnify gesture is satisfied — Ctrl held, or
 * bare hover if the setting says so. Used inside playtest dialogs (search,
 * tokens, mulligan, scry/mill/surveil) so the same gesture works there as on
 * hand / battlefield cards.
 */
export function HoverPreviewImage({ card, size = 'small', faceDown, className, ...rest }: Props) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const magnified = useMagnifyHover(hovered);
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
      {magnified && <MagnifiedPreview card={card} anchorRef={ref} faceDown={faceDown} />}
    </>
  );
}
