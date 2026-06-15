import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { BrewOption } from '@/services/brew/engine';

export function BrewNode({ onFinish }: { onFinish: () => void }) {
  const { brewNode, applyBrewOption, backToBrewFork, rerollBrew } = useStore();
  if (!brewNode) return null;

  const allShown = brewNode.options.flatMap(o => o.cards.map(c => c.name));

  function choose(option: BrewOption) {
    const taken = new Set(option.cards.map(c => c.name));
    const passed = allShown.filter(n => !taken.has(n));
    applyBrewOption(option, passed);
  }

  return (
    <div className="text-center">
      <h2 className="text-xl font-semibold mb-1">{brewNode.prompt}</h2>
      <p className="text-xs text-muted-foreground mb-5">
        {brewNode.type === 'bundle' ? 'Pick one package.'
          : brewNode.type === 'gamble' ? 'Take the bomb or pass.'
          : brewNode.type === 'combo' ? 'Add these pieces to complete the combo, or pass.'
          : brewNode.type === 'lightning' ? 'Add all five cards at once.'
          : 'Take one card.'}
      </p>

      <div className={`grid gap-4 ${brewNode.type === 'bundle' ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
        {brewNode.options.map(option => (
          <button
            key={option.id}
            onClick={() => choose(option)}
            className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-4 text-left transition hover:-translate-y-1 hover:border-violet-400 hover:shadow-[0_0_22px_hsl(var(--primary)/0.25)]"
          >
            {option.label && <div className="text-sm font-semibold text-violet-200 mb-2">{option.label}</div>}
            {option.cards.map((c, i) => (
              <div key={c.name} className="py-1 border-t border-white/5 first:border-t-0">
                <div className="text-[13px] font-medium truncate">{c.name}</div>
                <div className="text-[11px] text-muted-foreground">{c.scryfall.cmc} MV</div>
                <div className="text-[11px] text-violet-300 mt-0.5">
                  {(option.reasons[i] ?? []).map(r => r.label).join(' · ')}
                </div>
              </div>
            ))}
          </button>
        ))}
        {brewNode.options.length === 0 && (
          <div className="col-span-full text-sm text-muted-foreground py-8">
            No cards left for this route. <button className="text-violet-300 underline" onClick={onFinish}>Finish the deck</button> or go back.
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-1 mt-6">
        <Button variant="ghost" size="sm" onClick={backToBrewFork}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
        <span className="w-px h-4 bg-border" />
        <Button variant="ghost" size="sm" onClick={rerollBrew}><RefreshCw className="w-4 h-4 mr-1" /> Show different</Button>
        {brewNode.canPass && (<><span className="w-px h-4 bg-border" /><Button variant="ghost" size="sm" onClick={backToBrewFork}>Pass</Button></>)}
      </div>
    </div>
  );
}
