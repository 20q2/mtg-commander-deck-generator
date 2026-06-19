import { Swords, Sparkles, Route } from 'lucide-react';
import { CommanderSearch } from '@/components/commander/CommanderSearch';

/**
 * Landing for the interactive brewing flow (bare `/brew`). Pick a commander and we drop you into
 * the guided, Slay-the-Spire-style draft. Reuses CommanderSearch, pointed at the brew route.
 */
export function BrewLandingPage() {
  return (
    <main className="flex-1 container mx-auto px-4 py-6 relative">
      {/* Hero */}
      <div className="text-center py-8 mb-6 animate-fade-in">
        <div className="inline-flex items-center gap-1.5 mb-4 px-3 py-1 rounded-full border border-violet-400/40 bg-violet-500/10 text-[11px] uppercase tracking-[0.18em] text-violet-200">
          <Sparkles className="w-3.5 h-3.5" /> Interactive · Guided
        </div>
        <h2 className="text-4xl font-bold mb-4">
          Brew a <span className="gradient-text">Deck</span>
        </h2>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          Pick a commander and draft your deck one choice at a time — we deal the cards,
          you steer the direction.
        </p>
      </div>

      {/* Commander selection → straight into the brew */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
            1
          </div>
          <h2 className="text-lg font-semibold">Choose your commander</h2>
        </div>
        <CommanderSearch destination="brew" />
      </section>

      {/* What to expect — three quiet beats, matching the brew's vocabulary. */}
      <div className="max-w-lg mx-auto grid grid-cols-3 gap-3 text-center text-xs text-muted-foreground/80 animate-fade-in">
        <div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm px-3 py-4">
          <Swords className="w-5 h-5 mx-auto mb-2 text-violet-300/80" />
          Pick a signature card to set your direction
        </div>
        <div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm px-3 py-4">
          <Route className="w-5 h-5 mx-auto mb-2 text-violet-300/80" />
          Choose routes &amp; draft cards, a few at a time
        </div>
        <div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm px-3 py-4">
          <Sparkles className="w-5 h-5 mx-auto mb-2 text-violet-300/80" />
          Watch your deck round out, then finish
        </div>
      </div>
    </main>
  );
}
