import { TrendingDown, Unplug, Flag, X, SkipForward, BarChart3, Trophy, ArrowUp, ArrowRight, Target } from 'lucide-react';
import type { Misfit, ScryfallCard, MisfitReasonKind } from '@/types';
import type { RoleKey } from '@/services/tagger/client';
import { getCardImageUrl } from '@/services/scryfall/client';
import { scryfallImg } from '../constants';
import { manaColorsFor } from './manaColor';
import { CardFitReplacementStrip } from './CardFitReplacementStrip';

interface CardFitHeroProps {
  misfit: Misfit;
  index: number;
  total: number;
  sampleSize: number | null;
  fitImpact: number;
  onPreview: (cardName: string) => void;
  onRemove?: (card: ScryfallCard) => void;
  onSwap?: (removeName: string, addName: string) => void;
  onSkip: () => void;
  /** Optional control rendered in the hero's header rail (e.g. Misfits/Gaps toggle). */
  headerActions?: React.ReactNode;
  /** Optional content rendered inside the aurora container, below the action row (e.g. filmstrip). */
  children?: React.ReactNode;
  candidates: ScryfallCard[];
  activeReplacement: ScryfallCard | null;
  onSelectReplacement: (name: string) => void;
  cardInclusionMap: Record<string, number>;
  roleProgress: { role: RoleKey; current: number; target: number; sameRole: boolean } | null;
}

const REASON_ICON: Record<MisfitReasonKind, React.ComponentType<{ className?: string }>> = {
  'inclusion-low': TrendingDown,
  'inclusion-absent': TrendingDown,
  'synergy-low': Unplug,
  'synergy-absent': Unplug,
  'role-missing': BarChart3,
  'theme-off': Flag,
};

const ROLE_LABEL: Record<RoleKey, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'boardwipe',
  cardDraw: 'card-draw',
};

export function CardFitHero({
  misfit, index, total, sampleSize, fitImpact,
  onPreview, onRemove, onSwap, onSkip, headerActions, children,
  candidates, activeReplacement, onSelectReplacement, cardInclusionMap, roleProgress,
}: CardFitHeroProps) {
  const colors = manaColorsFor(misfit.card);
  const imgUrl = getCardImageUrl(misfit.card, 'normal') ?? scryfallImg(misfit.card.name, 'normal');
  const artUrl = misfit.card.image_uris?.art_crop ?? imgUrl;
  const inclusionReason = misfit.reasons.find(r => r.kind === 'inclusion-low' || r.kind === 'inclusion-absent');
  const synergyReason = misfit.reasons.find(r => r.kind === 'synergy-low' || r.kind === 'synergy-absent');
  const activeInclusion = activeReplacement ? cardInclusionMap[activeReplacement.name] : undefined;
  const misfitInclusion = cardInclusionMap[misfit.card.name];
  const inclusionDelta = (activeInclusion != null && misfitInclusion != null)
    ? activeInclusion - misfitInclusion
    : null;

  return (
    <div
      className="relative overflow-hidden"
      style={{ background: '#0f0a18' }}
    >
      <style>{`
        @keyframes card-fit-float {
          0%, 100% { transform: rotate3d(0,1,0,-6deg) rotate(-1.5deg) translateY(0); }
          50%      { transform: rotate3d(0,1,0,-6deg) rotate(-1.5deg) translateY(-8px); }
        }
        .card-fit-hero-float { animation: card-fit-float 4.5s ease-in-out infinite; }
      `}</style>

      {/* Aurora layers */}
      <div
        className="absolute pointer-events-none"
        aria-hidden
        style={{
          inset: -40,
          backgroundImage: `url('${artUrl}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(60px) saturate(1.25) brightness(0.55)',
          opacity: 0.5,
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden
        style={{
          background: `radial-gradient(ellipse 70% 50% at 50% 35%, ${colors.glow(0.26)}, transparent 65%),
                       radial-gradient(ellipse 50% 40% at 20% 70%, rgba(168,85,247,0.14), transparent 60%),
                       linear-gradient(180deg, rgba(15,10,24,0) 35%, rgba(15,10,24,0.95) 95%)`,
        }}
      />

      <div className="relative p-7 pb-0">
        {/* Header rail — title + sample size on one line */}
        <div className="flex items-center gap-2.5 mb-5 flex-wrap">
          <span className="text-[11px] text-violet-200 uppercase tracking-[0.2em] font-bold">
            Card Fit · Misfits
          </span>
          {sampleSize != null && (
            <span className="text-[11px] text-violet-300/80">
              · Based on {sampleSize.toLocaleString()} decklists
            </span>
          )}
          <span className="flex-1" />
          <span className="text-[11px] text-violet-200/90 font-semibold">
            #{index + 1} <span className="text-violet-300/60">of {total}</span>
          </span>
          {headerActions && <div className="ml-2">{headerActions}</div>}
        </div>

        <div className="grid grid-cols-[240px_1fr] gap-7 items-start">
          {/* Hero card with float */}
          <div className="relative" style={{ perspective: 1200 }}>
            <div
              className="absolute -inset-[3px] rounded-2xl -z-10"
              style={{
                background: `linear-gradient(135deg, ${colors.glow(0.6)}, ${colors.glow(0)} 50%, ${colors.glow(0.6)})`,
                filter: 'blur(10px)',
              }}
              aria-hidden
            />
            <button
              type="button"
              onClick={() => onPreview(misfit.card.name)}
              className="card-fit-hero-float relative block aspect-[5/7] rounded-xl overflow-hidden w-full"
              style={{
                boxShadow: `0 30px 60px rgba(0,0,0,0.7), 0 0 80px ${colors.glow(0.3)}, inset 0 0 0 1px rgba(255,255,255,0.08)`,
              }}
            >
              <img src={imgUrl} alt={misfit.card.name} className="w-full h-full object-cover" loading="lazy" />
            </button>
          </div>

          {/* Right column */}
          <div className="pt-0.5 min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] text-rose-300 uppercase tracking-[0.22em] font-bold">
              <Trophy className="w-3 h-3" />
              Worst offender
            </div>
            <h1
              className="text-[40px] font-extrabold text-white leading-[1.02] mt-1 mb-1.5 break-words"
              style={{ textShadow: '0 2px 14px rgba(0,0,0,0.6)' }}
            >
              {misfit.card.name}
            </h1>
            <div className="text-[12px] text-violet-200/70 italic">
              {misfit.card.type_line}
              {misfit.card.mana_cost ? ` · ${misfit.card.mana_cost}` : ''}
            </div>

            {/* Stat strip */}
            <div
              className="grid grid-cols-3 gap-px rounded-xl overflow-hidden"
              style={{ background: 'rgba(168,85,247,0.22)', marginTop: 16, marginBottom: 14 }}
            >
              <StatCell
                icon={<BarChart3 className="w-3 h-3" />}
                label="Inclusion"
                value={renderInclusionValue(inclusionReason)}
                valueClass="text-rose-300"
                detail={renderInclusionDetail(inclusionReason, sampleSize)}
                delta={activeReplacement && activeInclusion != null ? (
                  inclusionDelta != null && inclusionDelta > 0
                    ? <><ArrowUp className="w-3 h-3" /> +{inclusionDelta.toFixed(0)}%</>
                    : <>↑ to {activeInclusion.toFixed(0)}%</>
                ) : undefined}
              />
              <StatCell
                icon={<Unplug className="w-3 h-3" />}
                label="Synergy"
                value={renderSynergyValue(synergyReason)}
                valueClass="text-rose-300"
                detail={renderSynergyDetail(synergyReason)}
              />
              <StatCell
                icon={<TrendingDown className="w-3 h-3" />}
                label="Fit impact"
                value={<>+{fitImpact}</>}
                valueClass="text-emerald-300"
                detail={activeReplacement ? 'After the swap below' : 'After removing this card'}
              />
            </div>

            {/* Extra reasons — inclusion + synergy are already covered by the stat strip,
                so we only render reasons the strip doesn't speak to (role, theme, etc.). */}
            {(() => {
              const extraReasons = misfit.reasons.filter(r =>
                r.kind !== 'inclusion-low' &&
                r.kind !== 'inclusion-absent' &&
                r.kind !== 'synergy-low' &&
                r.kind !== 'synergy-absent'
              );
              if (extraReasons.length === 0) return null;
              return (
                <div className="flex flex-col gap-1.5">
                  {extraReasons.map((r, i) => {
                    const Icon = REASON_ICON[r.kind];
                    return (
                      <div
                        key={i}
                        className="grid grid-cols-[32px_1fr] gap-3 items-center px-3.5 py-2 rounded-lg"
                        style={{
                          background: 'rgba(15,10,24,0.6)',
                          border: '1px solid rgba(168,85,247,0.18)',
                        }}
                      >
                        <span
                          className="w-7 h-7 rounded-md inline-flex items-center justify-center text-violet-200"
                          style={{ background: 'rgba(168,85,247,0.18)' }}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        <div className="text-[12px] leading-snug">
                          <b className="block text-white text-[13px] font-bold">{r.label}</b>
                          <span className="text-violet-200/70">{r.detail}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Sticky resolution bar — matchup + actions */}
      <div
        className="relative mt-4"
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'linear-gradient(180deg, rgba(15,10,24,0) 0%, rgba(15,10,24,0.95) 25%)',
          backdropFilter: 'blur(8px)',
          padding: '16px 28px 18px',
          zIndex: 5,
        }}
      >
        {roleProgress && activeReplacement && (() => {
          const { role, current: cur, target, sameRole } = roleProgress;
          const roleLabel = ROLE_LABEL[role];
          const atOrAbove = cur >= target;
          let copy: string;
          if (sameRole) {
            copy = inclusionDelta != null && inclusionDelta > 0
              ? `Same ${roleLabel} slot — but played in ${inclusionDelta.toFixed(0)}% more decklists.`
              : `Same ${roleLabel} slot.`;
          } else if (atOrAbove) {
            copy = `Already at ${cur}/${target} ${roleLabel} — this is a depth pick, not a gap fill.`;
          } else {
            copy = `+1 toward your ${target} ${roleLabel} pieces — currently at ${cur}/${target}.`;
          }
          return (
            <div className="flex items-center gap-2 mb-3 text-[12px] text-violet-200/85">
              <Target className="w-3.5 h-3.5 text-emerald-300" />
              <span>{copy}</span>
            </div>
          );
        })()}

        {!roleProgress && activeReplacement && !activeReplacement.deckRole && (
          <div className="flex items-center gap-2 mb-3 text-[12px] text-violet-200/85">
            <Target className="w-3.5 h-3.5 text-violet-300/70" />
            <span>No tagged role — swap improves synergy/inclusion, not role balance.</span>
          </div>
        )}

        {activeReplacement && onSwap && (
          <button
            type="button"
            onClick={() => onSwap(misfit.card.name, activeReplacement.name)}
            className="w-full inline-flex items-center justify-center gap-2 text-white text-sm font-bold px-5 py-2.5 rounded-md mb-3"
            style={{
              background: 'linear-gradient(135deg,#10b981,#059669)',
              boxShadow: '0 6px 18px rgba(16,185,129,0.55)',
            }}
          >
            Swap in {activeReplacement.name} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}

        <CardFitReplacementStrip
          candidates={candidates}
          activeName={activeReplacement?.name ?? null}
          inclusionMap={cardInclusionMap}
          onSelect={onSelectReplacement}
          onPreview={onPreview}
        />

        <div className="flex items-center justify-end gap-3 mt-4">
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center gap-1.5 text-violet-200 hover:text-violet-100 text-[12px] font-semibold px-3.5 py-2 rounded-md"
            style={{
              background: 'transparent',
              border: '1px solid rgba(167,139,250,0.45)',
            }}
          >
            <SkipForward className="w-3.5 h-3.5" /> Keep this card
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(misfit.card)}
              className="inline-flex items-center gap-1.5 text-white text-[12px] font-bold px-3.5 py-2 rounded-md"
              style={{
                background: 'rgb(225,29,72)',
                border: '1px solid rgb(225,29,72)',
              }}
            >
              <X className="w-3.5 h-3.5" /> Remove from deck
            </button>
          )}
        </div>
        {children && <div className="relative pb-6">{children}</div>}
      </div>
    </div>
  );
}

function StatCell({
  icon, label, value, valueClass, detail, delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  detail: string;
  delta?: React.ReactNode;
}) {
  return (
    <div
      className="px-3.5 py-3"
      style={{ background: 'rgba(15,10,24,0.78)' }}
    >
      <div className="text-[10px] text-violet-200/70 uppercase tracking-[0.16em] font-bold flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className={`text-[26px] font-extrabold leading-tight mt-1 ${valueClass ?? 'text-white'}`}>
        {value}
      </div>
      <div className="text-[11px] text-violet-200/60 mt-1 leading-snug">{detail}</div>
      {delta && (
        <div className="text-[10px] text-emerald-300/90 font-semibold mt-0.5 inline-flex items-center gap-0.5">{delta}</div>
      )}
    </div>
  );
}

function renderInclusionValue(r: { kind: string; label: string } | undefined): React.ReactNode {
  if (!r) return <span className="text-violet-200/40">—</span>;
  if (r.kind === 'inclusion-absent') return '0%';
  const match = r.label.match(/\d+%/);
  return match ? match[0] : r.label;
}

function renderInclusionDetail(r: { kind: string; detail: string } | undefined, sampleSize: number | null): string {
  if (!r) return 'Within inclusion floor';
  if (r.kind === 'inclusion-absent') {
    return sampleSize != null
      ? `Of ${sampleSize.toLocaleString()} decklists`
      : 'Not on EDHREC page';
  }
  return r.detail;
}

function renderSynergyValue(r: { kind: string } | undefined): React.ReactNode {
  if (!r) return <span className="text-violet-200/40">—</span>;
  if (r.kind === 'synergy-absent') {
    return (
      <span
        className="text-[10px] font-bold uppercase tracking-wider inline-flex items-center px-2 py-1 rounded-full"
        style={{ background: 'rgba(168,85,247,0.22)', color: '#ddd6fe', letterSpacing: '0.08em' }}
      >
        No data
      </span>
    );
  }
  return <span className="text-rose-300">low</span>;
}

function renderSynergyDetail(r: { kind: string; detail: string } | undefined): string {
  if (!r) return 'Synergy ≥ 0';
  return r.detail;
}
