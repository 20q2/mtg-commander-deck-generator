import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Sparkles, PiggyBank, Layers, Landmark, type LucideIcon } from 'lucide-react';
import type { ManaPhilosophy } from '@/types';

/**
 * The run's capstone: the final, deliberate choice of how the mana base is built. Each style
 * re-weights land selection in the generator (see manaPhilosophyBoost). "Keep it balanced" skips
 * the bias and uses the standard selection. After this, the deck is revealed.
 */
const STYLES: { id: ManaPhilosophy; name: string; blurb: string; Icon: LucideIcon }[] = [
  { id: 'reliable', name: 'Reliable', blurb: 'Best fixing available — duals, fetches, triomes.', Icon: ShieldCheck },
  { id: 'greedy', name: 'Greedy', blurb: 'Lean on utility lands; accept slightly shakier fixing.', Icon: Sparkles },
  { id: 'budget', name: 'Budget', blurb: 'The cheapest functional mana base.', Icon: PiggyBank },
  { id: 'spelllands', name: 'Spell Lands', blurb: 'Favor MDFCs and flex lands that double as spells.', Icon: Layers },
];

const HSL = '40 92% 62%'; // mana-base gold

export function BrewManaCapstone({ onChoose, onSkip }: { onChoose: (style: ManaPhilosophy) => void; onSkip: () => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const exiting = chosen !== null;

  function pick(style: ManaPhilosophy) {
    if (exiting) return;
    setChosen(style);
    window.setTimeout(() => onChoose(style), 360);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/85 backdrop-blur-md p-4 animate-brew-view-in">
      <div className="w-full max-w-2xl rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] p-6 sm:p-8 text-center"
        style={{ ['--op' as string]: `hsl(${HSL})` }}>
        <span className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full border-2 brew-node-pulse"
          style={{ color: `hsl(${HSL})`, borderColor: `hsl(${HSL} / 0.6)`, background: `hsl(${HSL} / 0.12)`, boxShadow: `0 0 30px hsl(${HSL} / 0.4)` }}>
          <Landmark className="w-6 h-6" />
        </span>
        <div className="flex items-center justify-center gap-3 mb-2" style={{ color: `hsl(${HSL} / 0.85)` }}>
          <span className="h-px w-10" style={{ background: `linear-gradient(to right, transparent, hsl(${HSL} / 0.5))` }} />
          <span className="text-[10px] uppercase tracking-[0.32em] whitespace-nowrap">The final call</span>
          <span className="h-px w-10" style={{ background: `linear-gradient(to left, transparent, hsl(${HSL} / 0.5))` }} />
        </div>
        <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-1">Shape your mana base</h2>
        <p className="text-xs text-muted-foreground mb-7">One last decision — how should the lands come together?</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {STYLES.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => pick(s.id)}
              disabled={exiting}
              style={exiting ? undefined : { animationDelay: `${idx * 70}ms` }}
              className={`group relative flex items-start gap-3 rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm px-4 py-4 text-left shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-[transform,border-color,background-color] duration-200 hover:-translate-y-1 hover:border-[color:var(--op)] hover:bg-card/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--op)] ${
                exiting ? (s.id === chosen ? 'animate-brew-to-deck' : 'animate-brew-dismiss') : 'animate-brew-card-in'
              }`}
            >
              <span className="mt-0.5 grid place-items-center w-9 h-9 shrink-0 rounded-full border"
                style={{ color: `hsl(${HSL})`, borderColor: `hsl(${HSL} / 0.5)`, background: `hsl(${HSL} / 0.1)` }}>
                <s.Icon className="w-5 h-5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-base font-semibold text-foreground">{s.name}</span>
                <span className="block text-[13px] leading-snug text-foreground/75">{s.blurb}</span>
              </span>
            </button>
          ))}
        </div>

        <Button variant="ghost" size="sm" className="mt-6 text-muted-foreground" disabled={exiting} onClick={onSkip}>
          Keep it balanced
        </Button>
      </div>
    </div>
  );
}
