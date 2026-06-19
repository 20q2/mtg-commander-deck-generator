import { useMemo, useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Undo2, RefreshCw, Play, MapPin } from 'lucide-react';
import { openNode, leaningThemes, isLastPickLocked, type BrewRoute } from '@/services/brew/engine';
import { symbolFor, SymbolGlyph } from '@/components/brew/brewVisuals';
import type { ScryfallCard } from '@/types';

/** Per-tone styling. `need` (deck-needs-this) is the boldest — it reads as the recommended path. */
type ToneStyle = { medallion: string; tag: string; accent: string; color: string; soft: string };
const TONE: Record<string, ToneStyle> = {
  need: {
    medallion: 'border-[#f4a3a3]/70 text-[#fca5a5] bg-destructive/20',
    tag: 'border-destructive/50 text-[#fca5a5] bg-destructive/15',
    accent: 'text-[#fca5a5]',
    color: 'hsl(0 72% 70%)',
    soft: 'hsl(0 62% 50% / 0.34)',
  },
  theme: {
    medallion: 'border-[hsl(var(--success))]/60 text-emerald-300 bg-[hsl(var(--success))]/18',
    tag: 'border-[hsl(var(--success))]/50 text-emerald-300 bg-[hsl(var(--success))]/12',
    accent: 'text-emerald-300',
    color: 'hsl(152 62% 58%)',
    soft: 'hsl(142 71% 45% / 0.32)',
  },
  neutral: {
    medallion: 'border-violet-400/60 text-violet-200 bg-violet-500/18',
    tag: 'border-violet-400/45 text-violet-200 bg-violet-500/12',
    accent: 'text-violet-200',
    color: 'hsl(262 84% 72%)',
    soft: 'hsl(262 83% 58% / 0.32)',
  },
};
const toneOf = (t: string): ToneStyle => TONE[t] ?? TONE.neutral;

/** Scryfall art-crop URL for a card (front face for DFCs). */
function artUrl(card?: ScryfallCard): string | undefined {
  if (!card) return undefined;
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop;
}

export function BrewPath({ onFinish, onManaBase }: { onFinish: () => void; onManaBase: () => void }) {
  const { brewContext, brewState, brewRoutes, openBrewRoute, undoBrewPick, rerollBrew } = useStore();
  const [hovered, setHovered] = useState<number | null>(null);

  // A representative card per route — exactly the top card that route would present (so the combo
  // route wears its missing piece's art, "Add Creatures" the top creature, etc.). Reuses openNode.
  const repArt = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    if (brewContext && brewState) {
      for (const r of brewRoutes) {
        if (r.type === 'manabase') continue;
        map[r.id] = artUrl(openNode(brewContext, brewState, r).options[0]?.cards[0]?.scryfall);
      }
    }
    return map;
  }, [brewRoutes, brewContext, brewState]);

  if (!brewState) return null;

  const leaning = brewContext ? leaningThemes(brewContext, brewState) : [];
  // A committed (event-sourced) last pick locks undo — the "accept fate" beat.
  const locked = isLastPickLocked(brewState);
  const canUndo = brewState.history.length > 0 && !locked;
  const n = brewRoutes.length;

  // Keep the trail to a single, readable lane — show the most recent steps, hint at the rest.
  const MAX_TRAIL = 16;
  const trail = brewState.history;
  const shownTrail = trail.slice(-MAX_TRAIL);
  const hiddenCount = trail.length - shownTrail.length;

  return (
    <div className="text-center">
      {/* ── The trail you've walked ───────────────────────────────────────── */}
      {trail.length > 0 && (
        <div className="flex justify-center mb-6">
          <div className="relative inline-flex items-center gap-2 max-w-full overflow-x-auto px-3 py-1 no-scrollbar">
            <span className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            {hiddenCount > 0 && (
              <span className="relative z-10 text-[10px] font-medium text-muted-foreground/70 tabular-nums pr-1">+{hiddenCount}</span>
            )}
            {shownTrail.map((h, i) => {
              const key = h.routeId.includes(':') ? h.routeId.split(':')[1] : null;
              const sym = symbolFor(h.routeType, key);
              return (
                <span
                  key={hiddenCount + i}
                  title={h.added.join(', ')}
                  className="relative z-10 shrink-0 w-6 h-6 rounded-full border border-border bg-card grid place-items-center text-muted-foreground/80"
                >
                  <SymbolGlyph sym={sym} size="sm" />
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Heading: editorial kicker + engraved title ────────────────────── */}
      <h2 className="font-display text-3xl sm:text-4xl font-semibold text-foreground/95 mb-2 drop-shadow-[0_2px_18px_hsl(var(--primary)/0.35)]">
        Where to next?
      </h2>
      {leaning.length > 0 ? (
        <div className="mb-7 flex flex-col items-center gap-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-violet-300/70">Your deck is becoming</span>
          <span className="font-display text-xl font-semibold text-violet-100 drop-shadow-[0_2px_14px_hsl(262_83%_58%/0.45)]">
            {leaning.join(' · ')}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/70 mb-7">Every choice shapes what this deck becomes.</p>
      )}

      {/* The fork node, its branches, and the route cards share ONE centered, n-sized container so
          the SVG branch math (x = (i+0.5)/n) lands on each card's centre — and a 2-route fork reads
          as centred rather than left-anchored in a fixed 3-up grid. */}
      <div className={`mx-auto ${n <= 1 ? 'sm:max-w-xs' : n === 2 ? 'sm:max-w-2xl' : 'sm:max-w-5xl'}`}>
      {/* ── "You are here" node + the fork splaying into each route ───────── */}
      <div className="relative flex flex-col items-center">
        <span className="brew-node-pulse relative z-10 w-9 h-9 rounded-full border border-violet-300/80 bg-primary/25 grid place-items-center text-violet-100">
          <MapPin className="w-4 h-4" />
        </span>
        {n > 1 && (
          <svg
            key={brewRoutes.map((r) => r.id).join('|')}
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="hidden sm:block w-full h-10 -mt-1 mb-1"
          >
            {brewRoutes.map((_, i) => {
              const x = ((i + 0.5) / n) * 100;
              // Axis-aligned "circuit" route: down the trunk, across the bus, down to the card.
              // Only horizontal/vertical segments → no warping under the non-uniform stretch.
              return (
                <path
                  key={i}
                  d={`M 50 0 V 14 H ${x} V 40`}
                  pathLength={1}
                  style={{ animationDelay: `${i * 90 + 80}ms` }}
                  className={`brew-branch ${hovered === i ? 'is-live' : ''}`}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        )}
        {n <= 1 && <span className="h-5" />}
      </div>

      {/* ── The routes, dealt like a hand of cards ────────────────────────── */}
      <div className={`grid grid-cols-1 gap-4 ${n === 1 ? 'sm:grid-cols-1' : n === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
        {brewRoutes.map((route: BrewRoute, i: number) => {
          const sym = symbolFor(route.type, route.targetRole ?? route.targetType ?? null);
          const art = repArt[route.id];
          const tone = toneOf(route.tone);
          return (
            <button
              key={route.id}
              onClick={() => (route.type === 'manabase' ? onManaBase() : openBrewRoute(route))}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered((h) => (h === i ? null : h))}
              style={{
                ['--tone' as string]: tone.color,
                ['--tone-soft' as string]: tone.soft,
              }}
              className="group relative flex min-h-[284px] flex-col justify-end overflow-hidden rounded-2xl border border-border/60 bg-card text-center transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-2 hover:border-[color:var(--tone)] hover:shadow-[0_28px_64px_-16px_var(--tone-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tone)]"
            >
              {/* Full-bleed art — the route wears the art of the card it'd deal. */}
              {art ? (
                <img
                  src={art}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover object-center opacity-[0.52] transition duration-[600ms] ease-out group-hover:opacity-[0.72] group-hover:scale-105"
                />
              ) : (
                <div
                  className="absolute inset-0 opacity-40"
                  style={{ background: 'radial-gradient(120% 80% at 50% 0%, var(--tone), transparent 62%)' }}
                />
              )}
              {/* Scrim: art breathes up top, the lower third reads as a solid plate for the text. */}
              <div className="absolute inset-0 bg-gradient-to-t from-card via-card/92 to-card/5" />
              {/* Tone glow blooms from the top on hover. */}
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: 'radial-gradient(95% 55% at 50% -8%, var(--tone-soft), transparent 60%)' }}
              />

              {/* Top accent edge — the route's color signature. */}
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 h-[3px] w-full opacity-75 transition-opacity duration-200 group-hover:opacity-100"
                style={{ background: 'linear-gradient(90deg, transparent, var(--tone), transparent)' }}
              />

              {/* Medallion riding the art. */}
              <span
                className={`absolute left-1/2 top-7 z-10 -translate-x-1/2 w-16 h-16 rounded-full grid place-items-center border-2 backdrop-blur-sm shadow-lg transition-[transform,box-shadow] duration-300 group-hover:scale-110 group-hover:-rotate-6 group-hover:shadow-[0_0_30px_-2px_var(--tone-soft)] ${tone.medallion}`}
              >
                <SymbolGlyph sym={sym} size="lg" />
              </span>

              {/* Engraved title, flavor-text description, route tag — anchored at the bottom over the scrim. */}
              <div className="relative z-10 flex flex-col items-center px-5 pb-5 pt-4">
                <h3 className="font-display text-lg font-semibold leading-tight text-foreground mb-1.5">{route.title}</h3>
                <p className="font-flavor text-[15px] italic leading-snug text-muted-foreground/90 mb-3.5 max-w-[26ch]">{route.description}</p>
                {route.tag && (
                  <span className={`inline-block text-[10px] font-semibold uppercase tracking-[0.14em] px-3 py-1 rounded-full border ${tone.tag}`}>
                    {route.tag}
                  </span>
                )}
              </div>

              {/* Hairline corner ticks — a touch of card-frame craft. */}
              <span aria-hidden className="pointer-events-none absolute top-2.5 left-2.5 z-10 w-3.5 h-3.5 border-t border-l border-foreground/20 rounded-tl transition-colors duration-200 group-hover:border-[color:var(--tone)]" />
              <span aria-hidden className="pointer-events-none absolute top-2.5 right-2.5 z-10 w-3.5 h-3.5 border-t border-r border-foreground/20 rounded-tr transition-colors duration-200 group-hover:border-[color:var(--tone)]" />
              <span aria-hidden className="pointer-events-none absolute bottom-2.5 left-2.5 z-10 w-3.5 h-3.5 border-b border-l border-foreground/20 rounded-bl transition-colors duration-200 group-hover:border-[color:var(--tone)]" />
              <span aria-hidden className="pointer-events-none absolute bottom-2.5 right-2.5 z-10 w-3.5 h-3.5 border-b border-r border-foreground/20 rounded-br transition-colors duration-200 group-hover:border-[color:var(--tone)]" />
            </button>
          );
        })}
      </div>
      </div>

      {/* ── Wayfinding controls ───────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-2 mt-9 text-muted-foreground">
        <Button variant="ghost" size="sm" disabled={!canUndo} onClick={undoBrewPick}
          title={locked ? 'That choice is locked in — no take-backs.' : undefined}>
          <Undo2 className="w-4 h-4 mr-1.5" /> {locked ? 'Locked in' : 'Undo'}
        </Button>
        <span className="w-1 h-1 rotate-45 bg-border" />
        <Button variant="ghost" size="sm" onClick={rerollBrew}><RefreshCw className="w-4 h-4 mr-1.5" /> Reroll routes</Button>
        <span className="w-1 h-1 rotate-45 bg-border" />
        <Button variant="ghost" size="sm" className="text-violet-300 hover:text-violet-200" onClick={onFinish}><Play className="w-4 h-4 mr-1.5" /> Finish for me</Button>
      </div>
    </div>
  );
}
