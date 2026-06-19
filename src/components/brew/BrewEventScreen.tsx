import { useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Sparkles, Infinity as InfinityIcon, GitFork, Crown, Dices, SkipForward, type LucideIcon } from 'lucide-react';
import { getCardImageUrl } from '@/services/scryfall/client';
import { PASS_CHOICE, type BrewEventKind } from '@/services/brew/engine';

/**
 * A "moment" — a framed, emotional decision the engine surfaces from runtime data (a Strange
 * Signal lift discovery, a Combo Fragment, a Crossroads). Distinct from the card-draft node: it's
 * a beat in the run's story, with its own mystery palette and dramatic framing.
 */

// Each moment owns a mood: signal = arcane magenta, combo = teal, crossroads = gold.
const MOMENT: Record<BrewEventKind, { color: string; Icon: LucideIcon; eyebrow: string }> = {
  strangeSignal: { color: '292 76% 64%', Icon: Sparkles, eyebrow: 'A curious discovery' },
  comboFragment: { color: '172 70% 50%', Icon: InfinityIcon, eyebrow: 'Treasure surfaced' },
  crossroads: { color: '43 92% 60%', Icon: GitFork, eyebrow: 'A pattern is emerging' },
  signaturePick: { color: '268 84% 72%', Icon: Crown, eyebrow: 'A centerpiece emerges' },
  gamble: { color: '25 88% 58%', Icon: Dices, eyebrow: 'Off the map' },
};

export function BrewEventScreen() {
  const { brewEvent, chooseBrewEvent } = useStore();
  const [chosen, setChosen] = useState<string | null>(null);
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
      <span
        className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full border-2 backdrop-blur-sm brew-node-pulse"
        style={{ color: `hsl(${mood.color})`, borderColor: `hsl(${mood.color} / 0.6)`,
          background: `hsl(${mood.color} / 0.12)`, boxShadow: `0 0 30px hsl(${mood.color} / 0.4)` }}
      >
        <mood.Icon className="w-6 h-6" />
      </span>
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
        {(brewEvent.kind === 'strangeSignal' || brewEvent.kind === 'signaturePick' || brewEvent.kind === 'gamble') && brewEvent.card && (
          <div className="flex justify-center" style={{ perspective: '1200px' }}>
            <img
              src={getCardImageUrl(brewEvent.card.scryfall, 'normal')}
              alt={brewEvent.card.name}
              loading="lazy"
              className={`block w-[210px] h-auto rounded-[4.8%] shadow-[0_10px_40px_var(--op-soft)] ring-1 ring-black/60 ${
                chosen === 'trust' || chosen === 'build' || chosen === 'leap' ? 'animate-brew-to-deck' : ''
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
              className="btn-shimmer"
              style={{ background: `hsl(${mood.color} / 0.18)`, borderColor: `hsl(${mood.color} / 0.6)`, color: `hsl(${mood.color})` }}
              variant="outline"
              title={c.blurb}
            >
              {c.label}
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
    <div className="flex flex-col items-center gap-4">
      <div className="flex flex-wrap items-end justify-center gap-3" style={{ perspective: '1200px' }}>
        {combo.have.map(p => (
          <Piece key={`have:${p.name}`} name={p.name} img={getCardImageUrl(p.scryfall, 'small')} label="Have" dim />
        ))}
        {combo.have.length > 0 && <span aria-hidden className="self-center pb-7 text-2xl font-light text-muted-foreground/50">+</span>}
        {combo.missing.map(c => (
          <Piece key={`miss:${c.name}`} name={c.name} img={getCardImageUrl(c.scryfall, 'small')} label="Need" color={color} />
        ))}
      </div>
      {combo.results.length > 0 && (
        <p className="text-xs uppercase tracking-[0.18em]" style={{ color: `hsl(${color})` }}>
          → {combo.results.join(' · ')}
        </p>
      )}
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
