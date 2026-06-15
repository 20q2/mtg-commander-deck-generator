import { useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, Flame } from 'lucide-react';
import { getCardImageUrl } from '@/services/scryfall/client';
import { operationTheme, routeKey, BrewGlyph } from '@/components/brew/brewVisuals';
import type { BrewOption } from '@/services/brew/engine';

export function BrewNode({ onFinish }: { onFinish: () => void }) {
  const { brewNode, applyBrewOption, backToBrewFork, rerollBrew } = useStore();
  const [chosenId, setChosenId] = useState<string | null>(null);
  if (!brewNode) return null;

  const op = operationTheme(brewNode.type, routeKey(brewNode.routeId));

  const exiting = chosenId !== null;
  const allShown = brewNode.options.flatMap(o => o.cards.map(c => c.name));
  // Packaged choices (a bundle, the lightning five, a multi-piece combo) render as a group of
  // smaller card images; a single-card choice renders one large "hero" card, Slay-the-Spire style.
  // Combos always use the compact grouped layout so 1- and 2-piece combos line up uniformly.
  const packaged = brewNode.type === 'bundle' || brewNode.type === 'lightning' || brewNode.type === 'combo'
    || (brewNode.options[0]?.cards.length ?? 0) > 1;
  const cardW = packaged ? 'w-[108px]' : 'w-[164px]';
  const imgSize = packaged ? 'small' : 'normal';

  function choose(option: BrewOption) {
    if (exiting) return;                          // ignore clicks once a card is on its way out
    const taken = new Set(option.cards.map(c => c.name));
    const passed = allShown.filter(n => !taken.has(n));
    setChosenId(option.id);                        // play the fly-to-deck / melt-away animation…
    window.setTimeout(() => applyBrewOption(option, passed), 380); // …then commit the pick
  }

  return (
    <div className="text-center" style={{ ['--op' as string]: `hsl(${op.color})`, ['--op-soft' as string]: `hsl(${op.color} / 0.5)` }}>
      {/* The operation's sigil, in its own colour, presiding over the prompt. */}
      <span
        className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full border-2 backdrop-blur-sm"
        style={{
          color: `hsl(${op.color})`,
          borderColor: `hsl(${op.color} / 0.6)`,
          background: `hsl(${op.color} / 0.12)`,
          boxShadow: `0 0 28px hsl(${op.color} / 0.35)`,
        }}
      >
        <BrewGlyph sym={op.glyph} className="text-[22px] w-6 h-6" />
      </span>
      <h2 className="font-display text-2xl font-semibold tracking-tight mb-1" style={{ textShadow: `0 2px 22px hsl(${op.color} / 0.35)` }}>
        {brewNode.prompt}
      </h2>
      <p className="text-xs text-muted-foreground mb-7">
        {brewNode.type === 'bundle' ? 'Pick one package.'
          : brewNode.type === 'gamble' ? 'Take the bomb or pass.'
          : brewNode.type === 'combo' ? 'Pick a combo to finish, or pass.'
          : brewNode.type === 'lightning' ? 'Add all five cards at once.'
          : 'Take one card.'}
      </p>

      {/* Remount on open AND reroll so the deal-in animation replays. */}
      <div
        key={`${brewNode.routeId}|${allShown.join(',')}`}
        className="flex flex-wrap items-start justify-center gap-x-5 gap-y-7"
        style={{ perspective: '1200px' }}
      >
        {brewNode.options.map((option, idx) => (
          <button
            key={option.id}
            onClick={() => choose(option)}
            disabled={exiting}
            style={exiting ? undefined : { animationDelay: `${idx * 70}ms` }}
            className={`group flex flex-col items-center gap-2.5 rounded-2xl p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--op)] ${
              exiting
                ? (option.id === chosenId ? 'animate-brew-to-deck' : 'animate-brew-dismiss')
                : 'animate-brew-card-in'
            }`}
          >
            {option.label && (
              <div className="text-sm font-semibold text-violet-200">{option.label}</div>
            )}
            {option.spicy && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                <Flame className="w-3 h-3" /> Spicy
              </span>
            )}
            <div className="flex items-end justify-center gap-2.5">
              {option.cards.map((c, i) => (
                <div key={c.name} className={`${cardW} flex flex-col`}>
                  <img
                    src={getCardImageUrl(c.scryfall, imgSize)}
                    alt={c.name}
                    loading="lazy"
                    className="block w-full h-auto rounded-[4.8%] shadow-md ring-1 ring-black/50 transition-transform duration-150 ease-out group-hover:-translate-y-2.5 group-hover:scale-[1.07] group-hover:shadow-[0_16px_40px_var(--op-soft)] group-hover:ring-[color:var(--op)]"
                  />
                  {(option.reasons[i] ?? []).length > 0 && (
                    <div
                      className="mt-1.5 w-full truncate text-[10px] leading-tight text-violet-300/90"
                      title={(option.reasons[i] ?? []).map(r => r.label).join(' · ')}
                    >
                      {(option.reasons[i] ?? []).map(r => r.label).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </button>
        ))}
        {brewNode.options.length === 0 && (
          <div className="text-sm text-muted-foreground py-10">
            No cards left for this route.{' '}
            <button className="text-violet-300 underline" onClick={onFinish}>Finish the deck</button> or go back.
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 mt-9 text-muted-foreground">
        <Button variant="ghost" size="sm" disabled={exiting} onClick={backToBrewFork}><ArrowLeft className="w-4 h-4 mr-1.5" /> Back</Button>
        <span className="w-1 h-1 rotate-45 bg-border" />
        <Button variant="ghost" size="sm" disabled={exiting} onClick={rerollBrew}><RefreshCw className="w-4 h-4 mr-1.5" /> Show different</Button>
        {brewNode.canPass && (<><span className="w-1 h-1 rotate-45 bg-border" /><Button variant="ghost" size="sm" disabled={exiting} onClick={backToBrewFork}>Pass</Button></>)}
      </div>
    </div>
  );
}
