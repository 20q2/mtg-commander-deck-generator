import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpCircle, ChevronDown, Check } from 'lucide-react';
import { CommanderSearch } from '@/components/commander/CommanderSearch';
import { CardGroupSearch } from '@/components/commander/CardGroupSearch';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useStore } from '@/store';
import { getCardByName } from '@/services/scryfall/client';
import { trackEvent } from '@/services/analytics';

/** How step 1 starts: pick a commander, or work backwards from a group of cards. */
type Step1Mode = 'commander' | 'cards';
const MODE_KEY = 'mtg-step1-mode';

export function HomePage() {
  usePageTitle();
  const navigate = useNavigate();
  const { setCommander } = useStore();

  const [mode, setMode] = useState<Step1Mode>(
    () => (localStorage.getItem(MODE_KEY) === 'cards' ? 'cards' : 'commander')
  );
  useEffect(() => { localStorage.setItem(MODE_KEY, mode); }, [mode]);

  // A commander chosen from the card group. The seeds ride along on the URL as `?seeds=` so
  // the builder can lock them in as must-includes across refresh and regenerate.
  const handleSelectCardGroupCommander = async (name: string, seeds: string[]) => {
    try {
      const card = await getCardByName(name);
      trackEvent('card_group_commander_selected', { commanderName: name, seedCount: seeds.length });
      setCommander(card);
      navigate(`/build/${encodeURIComponent(card.name)}?seeds=${encodeURIComponent(seeds.join('|'))}`);
    } catch (error) {
      console.error('Failed to fetch commander:', error);
    }
  };

  return (
    <main className="flex-1 container mx-auto px-4 py-6 relative">
      <div className="absolute top-4 right-4 z-20">
        <Popover>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/80 hover:text-foreground transition-colors px-2.5 py-1 rounded-md hover:bg-accent">
              <HelpCircle className="w-3.5 h-3.5" />
              How does this work?
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-96 max-h-[28rem] overflow-y-auto p-4 text-xs text-left">
            <p className="font-semibold text-sm text-foreground mb-2">How ManaFoundry builds your deck</p>
            <ol className="space-y-2 text-muted-foreground list-decimal list-inside leading-relaxed">
              <li>
                <span className="text-foreground/90 font-medium">Pull the candidate pool.</span> We
                fetch every card EDHREC players run with your commander, plus any themes you
                selected, and filter by color identity, budget, rarity, and ban lists. Type and
                mana-curve targets are derived from EDHREC's averages for this commander.
              </li>
              <li>
                <span className="text-foreground/90 font-medium">Score each card.</span> Each
                candidate gets a relevance score combining EDHREC inclusion %, synergy with the
                commander, theme fit, role coverage (ramp / removal / draw / wipes), and curve fit.
              </li>
              <li>
                <span className="text-foreground/90 font-medium">Fill the 99.</span> We pick the
                top-scoring cards while honoring composition targets — enough ramp, removal,
                board wipes, and card draw — then build a mana base from the lands EDHREC players
                actually run with this commander.
              </li>
              <li>
                <span className="text-foreground/90 font-medium">Detect combos &amp; analyze.</span> We
                flag complete and near-miss combos, compute a deck score and bracket estimate, and
                generate swap suggestions so you can tune the result.
              </li>
            </ol>
            <p className="mt-3 text-[11px] text-muted-foreground/80 leading-relaxed">
              Card data comes from <span className="text-foreground/80">Scryfall</span>; deck
              statistics come from <span className="text-foreground/80">EDHREC</span>. You can
              customize budget, bracket, themes, banned cards, and more before generating.
            </p>
          </PopoverContent>
        </Popover>
      </div>

      {/* Hero Section */}
      <div className="text-center py-8 mb-6 animate-fade-in">
        <h2 className="text-4xl font-bold mb-4">
          Build Your{' '}
          <span className="gradient-text">Perfect Deck</span>
        </h2>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
          {mode === 'cards'
            ? "Drop in the cards you want to build around and we'll find the commanders that play them"
            : "Choose a commander and we'll help assemble a complete deck optimized for your strategy"}
        </p>
      </div>

      {/* Step 1 — the heading itself picks how you start */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
            1
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button className="group inline-flex items-center gap-1 text-lg font-semibold border-b border-dashed border-violet-400/70 text-violet-300 hover:text-violet-200 hover:border-violet-300 transition-colors">
                {mode === 'cards' ? 'Search by a Group of Cards' : 'Choose Your Commander'}
                <ChevronDown className="w-4 h-4 opacity-90 group-hover:opacity-100 transition-opacity" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1">
              <PopoverClose asChild>
                <button
                  onClick={() => setMode('commander')}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-sm text-left transition-colors ${mode === 'commander' ? 'bg-violet-500/15 text-violet-200 font-medium' : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground'}`}
                >
                  Choose Your Commander
                  {mode === 'commander' && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              </PopoverClose>
              <PopoverClose asChild>
                <button
                  onClick={() => setMode('cards')}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-sm text-left transition-colors ${mode === 'cards' ? 'bg-violet-500/15 text-violet-200 font-medium' : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground'}`}
                >
                  Search by a Group of Cards
                  {mode === 'cards' && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              </PopoverClose>
            </PopoverContent>
          </Popover>
        </div>
        {mode === 'cards'
          ? <CardGroupSearch onSelectCommander={handleSelectCardGroupCommander} />
          : <CommanderSearch />}
      </section>
    </main>
  );
}
