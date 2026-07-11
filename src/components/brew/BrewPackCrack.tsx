import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getCardImageUrl } from '@/services/scryfall/client';
import { playPackCrack } from '@/services/brew/brewSound';
import type { BrewOption, BrewCandidate } from '@/services/brew/engine';
import { PACK_FLAVOR, themeColor, legibleText, routeKey } from '@/components/brew/brewVisuals';
import { Check, Crown, Sparkles, Package } from 'lucide-react';

/**
 * The crack-a-pack loop (2026-07-11 redesign): a pack round offers three SEALED packs — theme +
 * headline card showing, contents hidden. Cracking one is the strategic decision (the others are
 * gone); the fan of ~5 cards inside is the curation decision (keep any you like, min 1, pass the
 * rest). Guided drafting: pick the direction blind, pick the cards informed.
 *
 * A windfall rides in the fan as a FOIL — the gold/rainbow card is simply *in the pack* when you
 * crack it, Pokémon-style, replacing the old full-screen reveal ceremony for pack rounds.
 */

const COMMIT_MS = 380;   // matches the fly-to-deck / melt-away animations used across brew
const CRACK_MS = 880;    // grip-shake (340) → seam tears (340-640) → burst (620-880) → the fan

export function BrewPackCrack({ onCracked }: { onCracked?: (cracked: boolean) => void }) {
  const { brewNode, applyBrewOption } = useStore();
  // The opening in progress (option id): the chosen pack shakes, tears, and bursts while the
  // other two melt away — then `cracked` takes over and the fan deals in.
  const [cracking, setCracking] = useState<string | null>(null);
  // Which pack was cracked (option id) — null while the three sealed packs are on offer.
  const [cracked, setCracked] = useState<string | null>(null);
  // Names the player is keeping from the fan (the foil pre-selects — it's the pull).
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const crackTimer = useRef<number | null>(null);
  useEffect(() => () => { if (crackTimer.current) window.clearTimeout(crackTimer.current); }, []);

  if (!brewNode) return null;
  const options = brewNode.options;
  const crackedOption = cracked ? options.find(o => o.id === cracked) ?? null : null;

  function crack(option: BrewOption) {
    if (committing || cracked || cracking) return;
    onCracked?.(true);   // the crack is the commitment — the parent hides Back/reroll
    // The foil starts selected — you pulled it; passing it back is the deliberate act.
    setKeep(option.goldCard ? new Set([option.goldCard.name]) : new Set());
    if (reduceMotion) { setCracked(option.id); return; }   // no ceremony — straight to the fan
    playPackCrack();
    setCracking(option.id);
    crackTimer.current = window.setTimeout(() => { setCracked(option.id); setCracking(null); }, CRACK_MS);
  }

  function toggleKeep(name: string) {
    if (committing) return;
    setKeep(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // Lock in the kept cards as one decision. The synthetic option keeps the pack's identity
  // (id/label/flavor/engineScore → affinity, Rival, and pack-window bookkeeping all still work);
  // a kept foil stays on `goldCard` so the store's windfall moment + Treasury hook fire as before.
  function commitKeeps(option: BrewOption) {
    if (committing || keep.size === 0) return;
    setCommitting(true);
    const keptRegular = option.cards.filter(c => keep.has(c.name));
    const reasons = keptRegular.map(c => option.reasons[option.cards.findIndex(x => x.name === c.name)] ?? []);
    const foilKept = !!option.goldCard && keep.has(option.goldCard.name);
    const synthetic: BrewOption = {
      ...option,
      cards: keptRegular,
      reasons,
      goldCard: foilKept ? option.goldCard : undefined,
      windfallTier: foilKept ? option.windfallTier : undefined,
      windfallTease: undefined,
      wagerTrade: undefined,
    };
    const allNames = options.flatMap(o => [...o.cards.map(c => c.name), ...(o.goldCard ? [o.goldCard.name] : [])]);
    const passed = allNames.filter(n => !keep.has(n));
    window.setTimeout(() => applyBrewOption(synthetic, passed), COMMIT_MS);
  }

  // ── Phase 2: the fan — the cracked pack's cards, keep what you like. ──
  if (crackedOption) {
    const fl = (crackedOption.flavor && PACK_FLAVOR[crackedOption.flavor]) || PACK_FLAVOR.value;
    const packColor = crackedOption.flavor === 'theme' ? themeColor(routeKey(crackedOption.id) ?? '') : fl.color;
    const foil = crackedOption.goldCard;
    const fan: { card: BrewCandidate; isFoil: boolean }[] = [
      ...crackedOption.cards.map(card => ({ card, isFoil: false })),
      ...(foil ? [{ card: foil, isFoil: true }] : []),
    ];
    const isRainbow = crackedOption.windfallTier === 'rainbow';
    return (
      <div className="text-center" style={{ ['--pk' as string]: `hsl(${packColor})`, ['--pk-text' as string]: `hsl(${legibleText(packColor)})` }}>
        <div className="mb-5 inline-flex items-center gap-2 font-display text-lg font-semibold text-[color:var(--pk-text)]">
          <fl.Icon className="w-4 h-4" /> {crackedOption.label}
        </div>
        <div className="flex flex-wrap items-start justify-center gap-3 sm:gap-4" style={{ perspective: '1200px' }}>
          {fan.map(({ card, isFoil }, i) => {
            const kept = keep.has(card.name);
            const foilRing = isRainbow
              ? 'ring-2 ring-fuchsia-300/80 shadow-[0_0_26px_-4px_rgba(232,121,249,0.7),0_6px_18px_rgba(0,0,0,0.55)]'
              : 'ring-2 ring-amber-300/80 shadow-[0_0_26px_-4px_rgba(251,191,36,0.7),0_6px_18px_rgba(0,0,0,0.55)]';
            return (
              <button
                key={card.name}
                onClick={() => toggleKeep(card.name)}
                disabled={committing}
                aria-pressed={kept}
                style={committing ? undefined : { animationDelay: `${i * 90}ms` }}
                className={`relative w-[150px] sm:w-[176px] rounded-[4.8%] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pk)] ${
                  committing
                    ? (kept ? 'animate-brew-to-deck' : 'animate-brew-dismiss')
                    : 'animate-brew-card-in'
                }`}
              >
                {/* The foil — the windfall, sitting IN the pack like a real pull. */}
                {isFoil && (
                  <span className={`absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide backdrop-blur-sm ${
                    isRainbow
                      ? 'border-fuchsia-300/80 bg-[#160a2a]/90 text-fuchsia-100'
                      : 'border-amber-300/80 bg-[#241803]/90 text-amber-100'
                  }`}>
                    {isRainbow ? <Sparkles className="w-3 h-3" /> : <Crown className="w-3 h-3" />}
                    {isRainbow ? 'Rainbow foil' : 'Foil'}
                  </span>
                )}
                {kept && (
                  <span className="absolute top-1.5 right-1.5 z-20 grid place-items-center w-5 h-5 rounded-full bg-emerald-500 text-white shadow ring-1 ring-black/40">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                )}
                <img
                  src={getCardImageUrl(card.scryfall, 'normal')}
                  alt={card.name}
                  className={`block w-full h-auto rounded-[4.8%] transition-[box-shadow,opacity,transform] duration-150 ${
                    isFoil ? foilRing
                      : kept ? 'ring-2 ring-emerald-400/90 shadow-[0_0_20px_-4px_rgba(52,211,153,0.6),0_6px_18px_rgba(0,0,0,0.55)]'
                      : 'ring-1 ring-black/60 shadow-[0_6px_18px_rgba(0,0,0,0.55)] opacity-90 hover:opacity-100'
                  } ${kept ? '' : 'hover:ring-2 hover:ring-[color:var(--pk)]'}`}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-6">
          <Button size="lg" className="btn-shimmer" disabled={keep.size === 0 || committing} onClick={() => commitKeeps(crackedOption)}>
            {keep.size === 0 ? 'Keep at least 1 card'
              : keep.size === fan.length ? `Keep all ${fan.length}`
              : `Keep ${keep.size} · pass ${fan.length - keep.size}`}
          </Button>
        </div>
      </div>
    );
  }

  // ── Phase 1: three sealed booster packs — foil wrapper in the pack's hue, crimped seams,
  //    the headline card's art full-bleed under a sweeping holo sheen. Contents hidden. ──
  return (
    <div className="flex flex-wrap items-stretch justify-center gap-6 sm:gap-9" style={{ perspective: '1200px' }}>
      {options.map((option, idx) => {
        const fl = (option.flavor && PACK_FLAVOR[option.flavor]) || PACK_FLAVOR.value;
        const packColor = option.flavor === 'theme' ? themeColor(routeKey(option.id) ?? '') : fl.color;
        const sigCard = option.cards.find(c => c.name === option.hallmarkName) ?? option.cards[0];
        const packArt = sigCard?.scryfall.image_uris?.art_crop ?? sigCard?.scryfall.card_faces?.[0]?.image_uris?.art_crop;
        const count = option.cards.length + (option.goldCard ? 1 : 0);
        const opening = cracking === option.id;
        const dismissed = cracking !== null && !opening;
        return (
          <button
            key={option.id}
            onClick={() => crack(option)}
            disabled={committing || !!cracked || !!cracking}
            style={{
              ['--pk' as string]: `hsl(${packColor})`,
              ['--pk-hsl' as string]: packColor,
              ['--pk-soft' as string]: `hsl(${packColor} / 0.4)`,
              ['--pk-text' as string]: `hsl(${legibleText(packColor)})`,
              ...(cracking ? {} : { animationDelay: `${idx * 70}ms` }),
            }}
            className={`group relative w-[190px] sm:w-[210px] overflow-hidden rounded-lg text-left shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)] transition-[transform,box-shadow] duration-200 hover:-translate-y-2 hover:shadow-[0_26px_56px_-12px_var(--pk-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pk)] ${
              opening ? 'brew-pack-opening z-10' : dismissed ? 'animate-brew-dismiss' : 'animate-brew-card-in'
            } ${brewNode.godPack ? 'brew-godpack-glow' : ''}`}
          >
            {/* The wrapper body — foil in the pack's own hue, darker at the seams. */}
            <div aria-hidden="true" className="absolute inset-0"
              style={{ background: `linear-gradient(180deg, hsl(${packColor} / 0.55), hsl(${packColor} / 0.28) 18%, hsl(${packColor} / 0.2) 82%, hsl(${packColor} / 0.6))` }} />
            {/* Pack art: the headline card's art, the wrapper's centerpiece. */}
            {packArt && (
              <div aria-hidden="true" className="absolute inset-x-0 top-[13%] bottom-[24%]"
                style={{
                  backgroundImage: `url(${packArt})`, backgroundSize: 'cover', backgroundPosition: 'center 30%',
                  boxShadow: 'inset 0 0 34px rgba(0,0,0,0.55)',
                }} />
            )}
            {/* Art fade into the wrapper above and below, so it reads as printed, not pasted. */}
            <div aria-hidden="true" className="absolute inset-0"
              style={{ background: `linear-gradient(180deg, hsl(${packColor} / 0.5) 0%, transparent 20%, transparent 68%, hsl(${packColor} / 0.55) 84%)` }} />
            {/* The holo sheen — a slow glossy sweep + faint iridescence over the whole wrapper. */}
            <div aria-hidden="true" className="brew-pack-foil absolute inset-0" />
            {/* Crimped seams top + bottom — the "factory sealed" read. The top one rips away when
                this pack is being opened, with a bright tear-line flashing along the seam. */}
            <div aria-hidden="true" className={`brew-pack-crimp absolute inset-x-0 top-0 z-20 h-[18px] ${opening ? 'brew-pack-tear-top' : ''}`} />
            {opening && <span aria-hidden="true" className="brew-pack-tear-flash absolute inset-x-0 top-[16px] z-20 block h-[3px]" />}
            <div aria-hidden="true" className="brew-pack-crimp absolute inset-x-0 bottom-0 h-[18px]" />
            {/* Glimmer tease — honest twice over now: you can't see inside, and teased ⇒ a windfall
                really is in there. A gold thread glinting just under the seam. */}
            {option.windfallTease && (
              <span aria-hidden="true" className="brew-tease-seam absolute inset-x-0 top-[18px] z-10 block h-[2px]" />
            )}
            <div className="relative z-10 flex h-full min-h-[340px] flex-col items-center">
              {/* Brand line under the top crimp, like a set stamp. */}
              <span className="mt-[26px] text-[8px] font-bold uppercase tracking-[0.34em] text-white/75 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                ManaFoundry · Brew
              </span>
              <div className="flex-1" />
              {/* The set plate — theme name big, headline card beneath. */}
              <div className="mb-[30px] flex w-full flex-col items-center gap-1 px-3">
                {option.windfallTease && (
                  <span className="font-flavor text-[11px] italic text-amber-200 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">something glints inside…</span>
                )}
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/25 bg-black/55 px-3 py-1 font-display text-sm font-bold uppercase tracking-wide text-[color:var(--pk-text)] shadow-[0_3px_12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
                  <fl.Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{option.label}</span>
                </span>
                {option.hallmarkName && (
                  <span className="max-w-full truncate text-[11px] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                    feat. <span className="font-semibold">{option.hallmarkName}</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-white/65 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                  <Package className="w-3 h-3" /> {count} cards · crack it
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
