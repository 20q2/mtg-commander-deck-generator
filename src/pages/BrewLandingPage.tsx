import { MapPin, Star, Route, Hammer } from 'lucide-react';
import { CommanderSearch } from '@/components/commander/CommanderSearch';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * Landing for the interactive brewing flow (bare `/brew`). Pick a commander and we drop you into
 * the guided, Slay-the-Spire-style draft. Reuses CommanderSearch, pointed at the brew route.
 *
 * Wears the same Industrial Foundry skin as the rest of the brew flow: the `.brew-foundry` scope
 * recolors panels/accents to steel + molten-orange and swaps in the condensed-caps typography, while
 * the shared BrewBackdrop (mounted by App for /brew) lays the steel + blueprint-grid + ember base
 * behind it — so arriving here already feels like standing in the forge.
 */

// The three beats of a run, in the Foundry's instrument-panel voice. Steps 1-2 are "structure"
// (blueprint cyan); the finish is the "weld" (molten orange) — the deck coming off the forge.
const BEATS = [
  { n: '01', Icon: Star, label: 'Signature', desc: 'Pick a signature card to set your direction', weld: false },
  { n: '02', Icon: Route, label: 'Routes', desc: 'Choose routes and draft packs, a few cards at a time', weld: false },
  { n: '03', Icon: Hammer, label: 'Forge', desc: 'Watch your deck take shape, then forge the finish', weld: true },
];

export function BrewLandingPage() {
  usePageTitle('Brew');
  return (
    <main className="brew-foundry flex-1 container mx-auto px-4 py-8 relative">
      {/* Hero */}
      <div className="text-center py-8 mb-8 animate-fade-in">
        <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight mb-4 drop-shadow-[0_2px_18px_hsl(var(--primary)/0.4)]">
          Brew a <span className="gradient-text">Deck</span>
        </h1>
        <p className="font-flavor text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto">
          Pick a commander and forge your deck one choice at a time — we deal the cards,
          you steer the direction.
        </p>
      </div>

      {/* Commander selection → straight into the brew. The "you are here" node marks the start of the
          path, echoing the home node the run itself opens on. */}
      <section className="mb-12 max-w-3xl mx-auto">
        <div className="flex items-center justify-center gap-2.5 mb-5">
          <span className="brew-node-pulse relative z-10 grid place-items-center w-8 h-8 rounded-full border border-violet-300/80 bg-primary/25 text-violet-100">
            <MapPin className="w-4 h-4" />
          </span>
          <h2 className="font-display text-lg tracking-wide text-foreground/90">Choose your commander</h2>
        </div>
        <CommanderSearch destination="brew" />
      </section>

      {/* What to expect — three stamped-steel plates reading as a blueprint sequence. */}
      <div className="max-w-2xl mx-auto grid grid-cols-3 gap-3 sm:gap-4 animate-fade-in">
        {BEATS.map(({ n, Icon, label, desc, weld }) => (
          <div
            key={n}
            className="foundry-bevel flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3 py-4 text-center"
          >
            <span className={`tabular-nums text-[10px] tracking-[0.25em] ${weld ? 'text-primary/80' : 'text-violet-300/70'}`}>{n}</span>
            <span className="grid place-items-center w-9 h-9 rounded-full border border-border/60 bg-background/40">
              <Icon className={`w-4 h-4 ${weld ? 'text-primary' : 'text-violet-300/90'}`} />
            </span>
            <div className="font-display text-[12px] tracking-wide text-foreground/90">{label}</div>
            <div className="text-[11px] leading-snug text-muted-foreground/80">{desc}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
