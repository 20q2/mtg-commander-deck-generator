import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Button } from '@/components/ui/button';
import { Sparkles, Infinity as InfinityIcon, GitFork, Crown, Dices, SkipForward, type LucideIcon } from 'lucide-react';
import { getCardImageUrl } from '@/services/scryfall/client';
import { PASS_CHOICE, type BrewEventKind } from '@/services/brew/engine';
import { BrewComboDetails } from '@/components/brew/BrewComboDetails';

/**
 * A "moment" — a framed, emotional decision the engine surfaces from runtime data (a Strange
 * Signal lift discovery, a Combo Fragment, a Crossroads). Distinct from the card-draft node: it's
 * a beat in the run's story, with its own mystery palette and dramatic framing.
 */

// Each moment owns a mood: signal = arcane magenta, combo = teal, crossroads = gold.
const MOMENT: Record<BrewEventKind, { color: string; Icon: LucideIcon; eyebrow: string }> = {
  strangeSignal: { color: '292 76% 64%', Icon: Sparkles, eyebrow: 'A curious discovery' },
  comboFragment: { color: '172 70% 50%', Icon: InfinityIcon, eyebrow: 'Near-miss combo' },
  crossroads: { color: '43 92% 60%', Icon: GitFork, eyebrow: 'A pattern is emerging' },
  signaturePick: { color: '268 84% 72%', Icon: Crown, eyebrow: 'A centerpiece emerges' },
  gamble: { color: '25 88% 58%', Icon: Dices, eyebrow: 'Off the map' },
};

// A few gold glints that "surface" behind the Combo Fragment sigil on mount (left across the sigil,
// size, stagger, horizontal drift, spin). Deterministic so the entrance reads the same every time.
const TREASURE_BITS: { left: string; size: string; delay: string; drift: string; rot: string }[] = [
  { left: '50%', size: '10px', delay: '0ms',   drift: '0px',   rot: '14deg' },
  { left: '33%', size: '8px',  delay: '90ms',  drift: '-14px', rot: '-22deg' },
  { left: '67%', size: '8px',  delay: '120ms', drift: '16px',  rot: '24deg' },
  { left: '23%', size: '6px',  delay: '220ms', drift: '-22px', rot: '-30deg' },
  { left: '77%', size: '6px',  delay: '260ms', drift: '24px',  rot: '30deg' },
  { left: '43%', size: '7px',  delay: '340ms', drift: '-8px',  rot: '-12deg' },
  { left: '60%', size: '9px',  delay: '400ms', drift: '10px',  rot: '18deg' },
];

export function BrewEventScreen() {
  const { brewEvent, chooseBrewEvent } = useStore();
  const [chosen, setChosen] = useState<string | null>(null);
  // Strange Signal inherits the windfall reveal ritual: the card arrives face-down ("the data found
  // something…") and flips to reveal itself a beat later, so trusting it feels like uncovering a find.
  const [signalRevealed, setSignalRevealed] = useState(false);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const isSignal = brewEvent?.kind === 'strangeSignal';
  useEffect(() => {
    if (!isSignal) return;
    if (reduceMotion) { setSignalRevealed(true); return; }
    const t = window.setTimeout(() => setSignalRevealed(true), 900);
    return () => window.clearTimeout(t);
  }, [isSignal, reduceMotion]);
  if (!brewEvent) return null;

  const mood = MOMENT[brewEvent.kind];
  const exiting = chosen !== null;

  function choose(choiceId: string) {
    if (exiting) return;
    setChosen(choiceId);
    window.setTimeout(() => chooseBrewEvent(choiceId), 360);
  }

  const accent = { ['--op' as string]: `hsl(${mood.color})`, ['--op-soft' as string]: `hsl(${mood.color} / 0.5)` };

  return (
    <div className="text-center" style={accent}>
      {/* Sigil — pulses in the moment's colour to mark this as something other than a normal pick. */}
      <div className="relative mx-auto mb-3 w-12 h-12">
        {/* Combo Fragment only: gold treasure glints surface from behind the sigil on mount. */}
        {brewEvent.kind === 'comboFragment' && (
          <div aria-hidden className="pointer-events-none absolute left-1/2 bottom-0 z-0 h-[110px] w-[160px] -translate-x-1/2">
            <span className="brew-treasure-glow" />
            {TREASURE_BITS.map((b, i) => (
              <span
                key={i}
                className="brew-treasure"
                style={{ left: b.left, width: b.size, height: b.size, animationDelay: b.delay,
                  ['--drift' as string]: b.drift, ['--rot' as string]: b.rot }}
              />
            ))}
          </div>
        )}
        <span
          className="relative z-10 grid place-items-center w-12 h-12 rounded-full border-2 backdrop-blur-sm brew-node-pulse"
          style={{ color: `hsl(${mood.color})`, borderColor: `hsl(${mood.color} / 0.6)`,
            background: `hsl(${mood.color} / 0.12)`, boxShadow: `0 0 30px hsl(${mood.color} / 0.4)` }}
        >
          <mood.Icon className="w-6 h-6" />
        </span>
      </div>
      <div className="flex items-center justify-center gap-3 mb-2" style={{ color: `hsl(${mood.color} / 0.85)` }}>
        <span className="h-px w-8 sm:w-14" style={{ background: `linear-gradient(to right, transparent, hsl(${mood.color} / 0.5))` }} />
        <span className="text-[10px] uppercase tracking-[0.32em] whitespace-nowrap">{mood.eyebrow}</span>
        <span className="h-px w-8 sm:w-14" style={{ background: `linear-gradient(to left, transparent, hsl(${mood.color} / 0.5))` }} />
      </div>
      <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-2" style={{ textShadow: `0 2px 22px hsl(${mood.color} / 0.4)` }}>
        {brewEvent.title}
      </h2>
      <p className="font-flavor text-[15px] italic leading-snug text-muted-foreground max-w-xl mx-auto mb-7">{brewEvent.flavor}</p>

      <div className={exiting ? 'animate-brew-dismiss' : 'animate-brew-card-in'}>
        {/* Strange Signal: a face-down card that shimmers, then flips to reveal the find. */}
        {brewEvent.kind === 'strangeSignal' && brewEvent.card && (
          <div className="flex justify-center" style={{ perspective: '1300px' }}>
            <div
              className={`brew-flip relative ${signalRevealed ? 'is-flipped' : ''} ${chosen === 'trust' ? 'animate-brew-to-deck' : ''}`}
              style={{ width: 210, height: 293 }}
            >
              <div
                className="brew-flip-face brew-shimmer absolute inset-0 grid place-items-center rounded-[4.8%]"
                style={{ background: `radial-gradient(circle at 50% 38%, hsl(${mood.color} / 0.5), #180a20 72%, #0b0511)`, outline: `2px solid hsl(${mood.color} / 0.7)`, outlineOffset: '-1px', boxShadow: `0 10px 40px hsl(${mood.color} / 0.5)` }}
              >
                <mood.Icon className="w-12 h-12" style={{ color: `hsl(${mood.color})`, filter: `drop-shadow(0 0 12px hsl(${mood.color} / 0.8))` }} />
              </div>
              <img
                src={getCardImageUrl(brewEvent.card.scryfall, 'normal')}
                alt={brewEvent.card.name}
                loading="lazy"
                className="brew-flip-face brew-flip-back absolute inset-0 w-full h-full object-cover rounded-[4.8%] ring-1 ring-black/60"
                style={{ boxShadow: `0 10px 40px hsl(${mood.color} / 0.5)` }}
              />
            </div>
          </div>
        )}

        {(brewEvent.kind === 'signaturePick' || brewEvent.kind === 'gamble') && brewEvent.card && (
          <div className="flex justify-center" style={{ perspective: '1200px' }}>
            <img
              src={getCardImageUrl(brewEvent.card.scryfall, 'normal')}
              alt={brewEvent.card.name}
              loading="lazy"
              className={`block w-[210px] h-auto rounded-[4.8%] shadow-[0_10px_40px_var(--op-soft)] ring-1 ring-black/60 ${
                chosen === 'build' || chosen === 'leap' ? 'animate-brew-to-deck' : ''
              }`}
            />
          </div>
        )}

        {brewEvent.kind === 'comboFragment' && brewEvent.combo && (
          <ComboBody combo={brewEvent.combo} color={mood.color} />
        )}

        {brewEvent.kind === 'crossroads' && brewEvent.paths && (
          <div className="flex flex-wrap items-stretch justify-center gap-4" style={{ perspective: '1200px' }}>
            {brewEvent.paths.map(path => (
              <button
                key={path.slug}
                onClick={() => choose(`commit:${path.slug}`)}
                disabled={exiting}
                className={`group relative flex w-[200px] flex-col items-center gap-2 rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm p-3 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-[transform,border-color,background-color] duration-200 hover:-translate-y-1.5 hover:bg-card/60 focus:outline-none focus-visible:ring-2 ${
                  chosen === `commit:${path.slug}` ? 'animate-brew-to-deck' : exiting ? 'animate-brew-dismiss' : ''
                }`}
              >
                <span className="font-display text-base font-semibold text-foreground">{path.name}</span>
                <div className="flex justify-center -space-x-6">
                  {path.sampleCards.map((c, i) => (
                    <img
                      key={c.name}
                      src={getCardImageUrl(c.scryfall, 'small')}
                      alt={c.name}
                      loading="lazy"
                      className="block w-[68px] h-auto rounded-[6%] shadow-md ring-1 ring-black/60 transition-transform duration-150 group-hover:-translate-y-1"
                      style={{ transform: `rotate(${(i - 1) * 6}deg)`, zIndex: 3 - i }}
                    />
                  ))}
                </div>
                <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: `hsl(${mood.color})` }}>
                  Commit
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Primary choices (signal / combo render their buttons here; crossroads paths are the buttons themselves). */}
      {brewEvent.kind !== 'crossroads' && (
        <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
          {brewEvent.choices.map(c => (
            <Button
              key={c.id}
              size="lg"
              disabled={exiting}
              onClick={() => choose(c.id)}
              className="btn-shimmer h-auto flex-col gap-0.5 py-2.5 whitespace-normal"
              style={{ background: `hsl(${mood.color} / 0.18)`, borderColor: `hsl(${mood.color} / 0.6)`, color: `hsl(${mood.color})` }}
              variant="outline"
            >
              <span className="text-sm font-semibold leading-tight">{c.label}</span>
              {c.blurb && <span className="text-[11px] font-normal leading-snug opacity-75">{c.blurb}</span>}
            </Button>
          ))}
        </div>
      )}

      {brewEvent.canPass && (
        <div className="flex items-center justify-center mt-5 text-muted-foreground">
          <Button variant="ghost" size="sm" disabled={exiting} onClick={() => choose(PASS_CHOICE)}>
            <SkipForward className="w-4 h-4 mr-1.5" /> {brewEvent.passLabel ?? 'Pass'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Combo Fragment body: the payoff, the pieces you own (dimmed), and the pieces you still need. */
function ComboBody({ combo, color }: { combo: NonNullable<import('@/services/brew/engine').BrewEvent['combo']>; color: string }) {
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex flex-wrap items-end justify-center gap-3" style={{ perspective: '1200px' }}>
        {combo.have.map(p => (
          <Piece key={`have:${p.name}`} name={p.name} img={getCardImageUrl(p.scryfall, 'small')} label="Have" dim />
        ))}
        {combo.have.length > 0 && <span aria-hidden className="self-center pb-7 text-2xl font-light text-muted-foreground/50">+</span>}
        {combo.missing.map(c => (
          <Piece key={`miss:${c.name}`} name={c.name} img={getCardImageUrl(c.scryfall, 'small')} label="Need" color={color} />
        ))}
      </div>
      {/* Reuse the app-wide combo walkthrough (Results / Prerequisites / Steps) instead of a flat payoff list. */}
      <div
        className="rounded-xl border bg-card/40 backdrop-blur-sm shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)]"
        style={{ borderColor: `hsl(${color} / 0.3)` }}
      >
        <BrewComboDetails comboId={combo.comboId} results={combo.results} />
      </div>
    </div>
  );
}

function Piece({ name, img, label, dim, color }: { name: string; img: string; label: string; dim?: boolean; color?: string }) {
  return (
    <div className={`w-[96px] flex flex-col items-center ${dim ? 'opacity-60' : ''}`}>
      <img
        src={img}
        alt={name}
        loading="lazy"
        className={`block w-full h-auto rounded-[4.8%] shadow-[0_4px_14px_rgba(0,0,0,0.5)] ring-1 ring-black/60 ${dim ? 'grayscale-[0.35]' : ''}`}
        style={color ? { boxShadow: `0 6px 20px hsl(${color} / 0.4)` } : undefined}
      />
      <span className="mt-2 text-[10px] font-semibold uppercase tracking-wide" style={color ? { color: `hsl(${color})` } : undefined}>
        {label}
      </span>
    </div>
  );
}
