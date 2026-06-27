import { HelpCircle } from 'lucide-react';
import { CommanderSearch } from '@/components/commander/CommanderSearch';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export function HomePage() {
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
          Choose a commander and we'll help assemble a complete deck
          optimized for your strategy
        </p>
      </div>

      {/* Commander Selection */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
            1
          </div>
          <h2 className="text-lg font-semibold">Choose Your Commander</h2>
        </div>
        <CommanderSearch />
      </section>
    </main>
  );
}
