import { useEffect, useState } from 'react';
import { backgroundUrlForIdentity } from '@/services/spellchroma/colorBackground';

/**
 * Color-identity art behind the SpellChroma page — swaps with the active
 * identity (the loaded deck's, or the explorer's color toggle). Dimmed and
 * gradient-masked (lighter at the top, fading to near-solid at the bottom) so
 * it reads as a mood-setting backdrop without hurting card legibility.
 *
 * Layers crossfade: when the identity changes, the new art blooms in over the
 * old one, which fades out and is then pruned — no hard cut.
 */
export function SpellChromaBackdrop({ colorIdentity }: { colorIdentity: string[] }) {
  const url = backgroundUrlForIdentity(colorIdentity);
  // Stack of layers; the last is the active one fading in, earlier ones are
  // previous backdrops fading out (pruned once their fade-out finishes).
  const [layers, setLayers] = useState<string[]>([url]);

  useEffect(() => {
    setLayers(prev => (prev[prev.length - 1] === url ? prev : [...prev, url].slice(-3)));
  }, [url]);

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden>
      {layers.map((layerUrl, i) => {
        const isTop = i === layers.length - 1;
        return (
          <img
            key={layerUrl}
            src={layerUrl}
            alt=""
            onAnimationEnd={isTop ? undefined : () => setLayers(prev => prev.filter(u => u !== layerUrl))}
            className={`absolute inset-0 w-full h-full object-cover ${
              isTop ? 'animate-backdrop-in' : 'animate-backdrop-out'
            }`}
          />
        );
      })}
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/55 to-background/90" />
    </div>
  );
}
